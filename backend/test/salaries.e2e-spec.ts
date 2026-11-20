import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { Expense } from '../src/modules/expenses/entities/expense.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertAppointment,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';
import { checkInDetailsFor, completeCheckInDetails } from './utils/check-in.js';

// Frozen clock: "today" is Friday 2026-11-20 in Cairo (+02:00).
const TODAY = '2026-11-20';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('12:00') };

type DoctorUser = TestUser & { doctorId: string };

describe('Doctor salaries (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: DoctorUser; // commission only
  let doctorB: DoctorUser; // fixed salary + commission per service
  let physioId: string;
  let consultId: string;
  let phone = 0;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = local('12:00');
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    physioId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        basePrice: '300.00',
      })
    ).id;
    consultId = (
      await insertService(ctx.dataSource, {
        name: 'Consultation',
        basePrice: '400.00',
      })
    ).id;
    for (const d of [doctorA, doctorB]) {
      await assignService(ctx.dataSource, d.doctorId, physioId);
      await assignService(ctx.dataSource, d.doctorId, consultId);
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Authorization', bearer(user)),
    put: (path: string, body: object) =>
      request(server)
        .put(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });

  const setTerms = (doctor: DoctorUser, body: object) =>
    as(owner).put(`/doctors/${doctor.doctorId}/salary/terms`, body);
  const statement = async (doctor: DoctorUser, month = '2026-11') =>
    (
      await as(owner)
        .get(`/doctors/${doctor.doctorId}/salary/statement?month=${month}`)
        .expect(200)
    ).body;
  // A walk-in now (a visit and its session invoice).
  const walkIn = async (doctor: DoctorUser, serviceId: string) => {
    phone += 1;
    const number = `0100${String(phone).padStart(7, '0')}`;
    const res = await as(receptionist)
      .post('/visits/walk-in', {
        name: `Patient ${phone}`,
        phone: number,
        patientDetails: checkInDetailsFor(number),
        doctorId: doctor.doctorId,
        serviceId,
        type: 'SESSION',
      })
      .expect(201);
    return res.body as {
      id: string;
      invoiceId: string;
      patient: { id: string };
    };
  };

  it('is OWNER only', async () => {
    for (const user of [receptionist, doctorA]) {
      await as(user).get('/doctor-salaries?month=2026-11').expect(403);
      await as(user)
        .put(`/doctors/${doctorA.doctorId}/salary/terms`, {
          effectiveMonth: '2026-11',
          fixedSalary: '1000.00',
          commissionMode: 'NONE',
        })
        .expect(403);
      await as(user)
        .get(`/doctors/${doctorA.doctorId}/salary/statement?month=2026-11`)
        .expect(403);
    }
  });

  it('validates terms', async () => {
    const base = { effectiveMonth: '2026-11', fixedSalary: '0.00' };
    const bad = [
      { ...base, commissionMode: 'PER_SESSION' },
      { ...base, commissionMode: 'PER_SERVICE', serviceRates: [] },
      {
        ...base,
        commissionMode: 'NONE',
        sessionRate: { type: 'FIXED', value: '10' },
      },
      {
        ...base,
        commissionMode: 'PER_SESSION',
        sessionRate: { type: 'PERCENT', value: '120' },
      },
      {
        ...base,
        commissionMode: 'PER_SERVICE',
        serviceRates: [
          { serviceId: physioId, type: 'FIXED', value: '10' },
          { serviceId: physioId, type: 'FIXED', value: '20' },
        ],
      },
    ];
    for (const body of bad) {
      const res = await setTerms(doctorA, body).expect(422);
      expect(res.body.code).toBe('SALARY_TERMS_INVALID');
    }
    await setTerms(doctorA, {
      ...base,
      effectiveMonth: '2026-13',
      commissionMode: 'NONE',
    }).expect(400);
    await setTerms(doctorA, {
      ...base,
      fixedSalary: '-5',
      commissionMode: 'NONE',
    }).expect(400);
  });

  it('commission only, per session: every attended session, undone ones excluded', async () => {
    const terms = await setTerms(doctorA, {
      effectiveMonth: '2026-11',
      fixedSalary: '0.00',
      commissionMode: 'PER_SESSION',
      sessionRate: { type: 'FIXED', value: '50' },
    }).expect(200);
    expect(terms.body).toMatchObject({
      effectiveMonth: '2026-11',
      fixedSalary: '0.00',
      commissionMode: 'PER_SESSION',
      sessionRate: { type: 'FIXED', value: '50.00' },
      serviceRates: [],
    });
    await walkIn(doctorA, physioId);
    await walkIn(doctorA, consultId);
    const undone = await walkIn(doctorA, physioId);
    await as(receptionist)
      .post(`/visits/${undone.id}/undo-attend`, { reason: 'Wrong doctor' })
      .expect(200);
    await walkIn(doctorB, physioId); // another doctor's session

    const s = await statement(doctorA);
    expect(s).toMatchObject({
      month: '2026-11',
      fixedSalary: '0.00',
      sessionCount: 2,
      commissionTotal: '100.00',
      earned: '100.00',
      paid: '0.00',
      remaining: '100.00',
    });
    expect(s.sessions.map((x: { commission: string }) => x.commission)).toEqual(
      ['50.00', '50.00'],
    );
  });

  it('fixed salary + per service: percentage of the invoice or of a package session; unlisted services earn nothing', async () => {
    await setTerms(doctorB, {
      effectiveMonth: '2026-11',
      fixedSalary: '5000.00',
      commissionMode: 'PER_SERVICE',
      serviceRates: [{ serviceId: physioId, type: 'PERCENT', value: '20' }],
    }).expect(200);
    await walkIn(doctorB, physioId); // 300 -> 60
    await walkIn(doctorB, consultId); // no rate -> 0

    // A package session: 10 sessions for 2000 -> 200 each -> 40.
    const pkg = await as(owner)
      .post('/packages', {
        name: '10 physio',
        serviceId: physioId,
        sessionsCount: 10,
        price: '2000.00',
        allDoctors: true,
      })
      .expect(201);
    const visit = await walkIn(doctorB, physioId);
    const patientId = visit.patient.id;
    const sold = await as(receptionist)
      .post(`/patients/${patientId}/packages`, { packageId: pkg.body.id })
      .expect(201);
    const apt = await insertAppointment(ctx.dataSource, {
      patientId,
      doctorId: doctorB.doctorId,
      serviceId: physioId,
      startAt: local('11:00'),
    });
    await completeCheckInDetails(ctx.dataSource);
    await as(receptionist)
      .post(`/appointments/${apt.id}/attend`, {
        patientPackageId: sold.body.id,
      })
      .expect(201);

    const s = await statement(doctorB);
    const lines = s.sessions.map(
      (x: {
        service: { name: string };
        valueSource: string;
        sessionValue: string;
        commission: string;
      }) => [x.service.name, x.valueSource, x.sessionValue, x.commission],
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        ['Physio', 'INVOICE', '300.00', '60.00'],
        ['Consultation', 'INVOICE', '400.00', '0.00'],
        ['Physio', 'PACKAGE', '200.00', '40.00'],
      ]),
    );
    expect(s).toMatchObject({
      fixedSalary: '5000.00',
      sessionCount: 4,
      commissionTotal: '160.00',
      earned: '5160.00',
    });
    expect(
      s.sessions.find(
        (x: { service: { name: string } }) => x.service.name === 'Consultation',
      ).rate,
    ).toBeNull();
  });

  it('terms are versioned by month: past months keep theirs', async () => {
    const terms = (month: string, fixed: string) =>
      setTerms(doctorB, {
        effectiveMonth: month,
        fixedSalary: fixed,
        commissionMode: 'NONE',
      }).expect(200);
    await terms('2026-10', '4000.00');
    await terms('2026-11', '5000.00');
    await terms('2026-11', '5500.00'); // replaces November's version
    clock.current = local('10:00', '2026-10-15');
    await walkIn(doctorB, physioId);
    clock.current = local('12:00');

    expect(await statement(doctorB, '2026-09')).toMatchObject({
      terms: null,
      earned: '0.00',
    });
    expect(await statement(doctorB, '2026-10')).toMatchObject({
      fixedSalary: '4000.00',
      sessionCount: 1,
    });
    expect(await statement(doctorB, '2026-11')).toMatchObject({
      fixedSalary: '5500.00',
      sessionCount: 0,
    });
    const versions = await as(owner)
      .get(`/doctors/${doctorB.doctorId}/salary/terms`)
      .expect(200);
    expect(
      versions.body.map(
        (v: { effectiveMonth: string; fixedSalary: string }) => [
          v.effectiveMonth,
          v.fixedSalary,
        ],
      ),
    ).toEqual([
      ['2026-11', '5500.00'],
      ['2026-10', '4000.00'],
    ]);
  });

  it('payments: parts and advances, each an expense; voiding; paid months lock their terms', async () => {
    await setTerms(doctorB, {
      effectiveMonth: '2026-11',
      fixedSalary: '5000.00',
      commissionMode: 'NONE',
    }).expect(200);
    const pay = (body: object) =>
      as(owner).post(`/doctors/${doctorB.doctorId}/salary/payments`, {
        month: '2026-11',
        method: 'CASH',
        ...body,
      });
    const first = await pay({ amount: '3000.00', reference: 'R-1' }).expect(
      201,
    );
    expect(first.body).toMatchObject({
      month: '2026-11',
      amount: '3000.00',
      paymentDate: TODAY,
      status: 'VALID',
      expense: { expenseNumber: expect.stringMatching(/^EXP-/) },
    });
    const expense = await ctx.dataSource.getRepository(Expense).findOneOrFail({
      where: { id: first.body.expense.id },
      relations: { category: true },
    });
    expect(expense).toMatchObject({
      amount: '3000.00',
      status: 'VALID',
      expenseDate: TODAY,
    });
    expect(expense.category?.systemKey).toBe('DOCTOR_SALARY');
    // The expense can't be voided on its own.
    const direct = await as(owner)
      .post(`/expenses/${expense.id}/void`, { reason: 'Trying directly' })
      .expect(422);
    expect(direct.body.code).toBe('EXPENSE_EDIT_NOT_ALLOWED');

    await pay({ amount: '2500.00' }).expect(201); // more than what remains: allowed
    expect(await statement(doctorB)).toMatchObject({
      paid: '5500.00',
      remaining: '-500.00',
    });

    const voided = await as(owner)
      .post(`/doctor-salaries/payments/${first.body.id}/void`, {
        reason: 'Wrong amount',
      })
      .expect(201);
    expect(voided.body).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Wrong amount',
    });
    expect(
      (
        await ctx.dataSource
          .getRepository(Expense)
          .findOneByOrFail({ id: expense.id })
      ).status,
    ).toBe('VOIDED');
    expect(await statement(doctorB)).toMatchObject({
      paid: '2500.00',
      remaining: '2500.00',
    });
    const again = await as(owner)
      .post(`/doctor-salaries/payments/${first.body.id}/void`, {
        reason: 'Again please',
      })
      .expect(422);
    expect(again.body.code).toBe('PAYOUT_VOIDED');

    // Not a future month, not a future date.
    expect(
      (await pay({ month: '2026-12', amount: '10.00' }).expect(422)).body.code,
    ).toBe('DATE_OUT_OF_RANGE');
    expect(
      (await pay({ amount: '10.00', paymentDate: '2026-11-21' }).expect(422))
        .body.code,
    ).toBe('EXPENSE_DATE_IN_FUTURE');

    // November is paid: new terms only from December.
    for (const month of ['2026-11', '2026-10']) {
      const res = await setTerms(doctorB, {
        effectiveMonth: month,
        fixedSalary: '1.00',
        commissionMode: 'NONE',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'SALARY_MONTH_PAID',
        details: { paidMonth: '2026-11' },
      });
    }
    await setTerms(doctorB, {
      effectiveMonth: '2026-12',
      fixedSalary: '6000.00',
      commissionMode: 'NONE',
    }).expect(200);
  });

  it('overview: every doctor with the month totals', async () => {
    await setTerms(doctorA, {
      effectiveMonth: '2026-11',
      fixedSalary: '0.00',
      commissionMode: 'PER_SESSION',
      sessionRate: { type: 'PERCENT', value: '10' },
    }).expect(200);
    await walkIn(doctorA, physioId); // 30
    const res = await as(owner)
      .get('/doctor-salaries?month=2026-11')
      .expect(200);
    const byId = new Map(
      res.body.map((r: { doctor: { id: string } }) => [r.doctor.id, r]),
    );
    expect(byId.get(doctorA.doctorId)).toMatchObject({
      hasTerms: true,
      commissionMode: 'PER_SESSION',
      sessionCount: 1,
      commissionTotal: '30.00',
      earned: '30.00',
      remaining: '30.00',
    });
    expect(byId.get(doctorB.doctorId)).toMatchObject({
      hasTerms: false,
      earned: '0.00',
    });
    await as(owner).get('/doctor-salaries?month=2026-11-01').expect(400);
  });
});
