import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { Patient } from '../src/modules/patients/entities/patient.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertService,
  insertWeeklySchedule,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

/**
 * One dataset around Egypt's fall-back night (Thu 2026-10-29: 24:00 +03:00
 * -> 23:00 +02:00, so that local day lasts 25 hours). The main range is
 * 2026-10-29..2026-10-31. Services: Session 300.00, Assessment 500.00.
 *
 *  I1  P1 walk-in A Session   Oct 28 23:30+03  paid 300 CASH            (before range)
 *  I2  P2 walk-in B Assess.   Oct 29 00:30+03  paid 500 CARD            (DST day, early)
 *  I3  P3 walk-in A Session   Oct 29 23:30+02  paid 100 CASH            (repeated hour, 2nd)
 *                             Oct 30           +50 WALLET, voided
 *  I4  P1 appt    A Session   Oct 30  10% "Loyal" -> 270, paid 270 CASH, refund 70
 *  I5  P1 manual 100.00       Oct 30  10 off, then cancelled            (excluded)
 *  I6  P3 manual 150.00       Oct 30  20 off "Student" (OWNER) -> 130, unpaid
 *  I7  P2 online  A Session   Oct 31  50 "Mistake" replaced by 30 "student" -> 270, unpaid
 *  I8  P1 walk-in B Session   Oct 31  repeat of "Loyal" -> 270, paid 200 INSTAPAY
 *  I9  P3 walk-in B Session   Oct 31  undone (visit voided, invoice cancelled)
 *  I10 P3 walk-in A Session   Nov 01  paid 300 CASH                     (after range)
 *
 * Appointments starting in range: P1/A Oct 30 attended, P2/B Oct 30 no-show,
 * P3/A Oct 30 cancelled, P2/A Oct 31 online attended, P1/B Oct 31
 * rescheduled to Nov 02 (neither counts). Expenses Oct 30: 80 CASH
 * (Hospitality), 200 CARD (Supplies), 999 voided; Nov 01: 40 CASH.
 * Patients created: P1 Oct 28, P2 Oct 29 00:10+03, P3 Oct 31.
 */
const at = (value: string) => new Date(value);
const clock = { current: at('2026-10-28T09:00:00+03:00') };
const RANGE = '?from=2026-10-29&to=2026-10-31';

describe('Reports (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: TestUser & { doctorId: string };
  let doctorB: TestUser & { doctorId: string };
  const ids: Record<string, string> = {};

  const api = (path: string) => `/api/v1${path}`;
  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  async function post(
    path: string,
    body: object = {},
    by: TestUser = receptionist,
  ): Promise<Record<string, any>> {
    const res = await request(server).post(api(path)).set(as(by)).send(body);
    if (res.status >= 300) {
      throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  const report = (path: string, by: TestUser = owner) =>
    request(server)
      .get(api(`/reports/${path}`))
      .set(as(by));

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
    await resetDatabase(ctx.dataSource);

    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    const session = await insertService(ctx.dataSource, {
      name: 'Session',
      basePrice: '300.00',
    });
    const assessment = await insertService(ctx.dataSource, {
      name: 'Assessment',
      basePrice: '500.00',
    });
    ids.session = session.id;
    ids.assessment = assessment.id;
    for (const doctor of [doctorA, doctorB]) {
      await assignService(ctx.dataSource, doctor.doctorId, session.id);
      await assignService(ctx.dataSource, doctor.doctorId, assessment.id);
      await insertWeeklySchedule(ctx.dataSource, doctor.doctorId);
    }

    const patient = async (name: string, phone: string, createdAt: string) => {
      const { id } = await post('/patients', { name, phone });
      await ctx.dataSource
        .getRepository(Patient)
        .update(id, { createdAt: at(createdAt) });
      return id as string;
    };
    const p1 = await patient(
      'Patient One',
      '01011111111',
      '2026-10-28T12:00:00+03:00',
    );
    const p2 = await patient(
      'Patient Two',
      '01022222222',
      '2026-10-29T00:10:00+03:00',
    );
    const p3 = await patient(
      'Patient Three',
      '01033333333',
      '2026-10-31T08:00:00+02:00',
    );

    const walkIn = async (
      when: string,
      patientId: string,
      doctorId: string,
      serviceId = session.id,
    ) => {
      clock.current = at(when);
      return post('/visits/walk-in', { patientId, doctorId, serviceId });
    };
    const pay = (invoiceId: string, amount: string, method: string) =>
      post(`/invoices/${invoiceId}/payments`, { amount, method });
    const book = (patientId: string, doctorId: string, startAt: string) =>
      post('/appointments', {
        patientId,
        doctorId,
        serviceId: session.id,
        startAt,
        allowOutsideSchedule: true,
      });

    // ---- Oct 28 (before the range) ----
    const i1 = await walkIn('2026-10-28T23:30:00+03:00', p1, doctorA.doctorId);
    await pay(i1.invoiceId, '300.00', 'CASH');

    // ---- Oct 29, the 25-hour day ----
    const i2 = await walkIn(
      '2026-10-29T00:30:00+03:00',
      p2,
      doctorB.doctorId,
      assessment.id,
    );
    await pay(i2.invoiceId, '500.00', 'CARD');
    // 23:30 for the second time (+02:00 = 21:30Z): still the 29th.
    const i3 = await walkIn('2026-10-29T23:30:00+02:00', p3, doctorA.doctorId);
    ids.i3 = i3.invoiceId;
    await pay(i3.invoiceId, '100.00', 'CASH');
    await request(server)
      .put(api(`/visits/${i3.id}/note`))
      .set(as(doctorA))
      .send({ assessment: 'Draft, not signed' })
      .expect(200);

    // ---- Oct 30 ----
    clock.current = at('2026-10-30T09:00:00+02:00');
    const attended = await book(
      p1,
      doctorA.doctorId,
      '2026-10-30T10:00:00+02:00',
    );
    const noShow = await book(
      p2,
      doctorB.doctorId,
      '2026-10-30T11:00:00+02:00',
    );
    const cancelled = await book(
      p3,
      doctorA.doctorId,
      '2026-10-30T12:00:00+02:00',
    );
    const online = await request(server)
      .post(api('/public/appointments'))
      .send({
        name: 'Patient Two',
        phone: '01022222222',
        doctorId: doctorA.doctorId,
        serviceId: session.id,
        startAt: '2026-10-31T11:00:00+02:00',
      })
      .expect(201);
    await post(`/appointments/${cancelled.id}/cancel`, {
      reason: 'Travelling',
    });

    clock.current = at('2026-10-30T10:05:00+02:00');
    const i4 = await post(`/appointments/${attended.id}/attend`);
    await post(`/invoices/${i4.invoiceId}/discount`, {
      type: 'PERCENT',
      value: '10',
      reason: 'Loyal',
    });
    const i4cash = await pay(i4.invoiceId, '270.00', 'CASH');
    await request(server)
      .put(api(`/visits/${i4.id}/note`))
      .set(as(doctorA))
      .send({ assessment: 'Better' })
      .expect(200);
    await request(server)
      .post(api(`/visits/${i4.id}/note/sign`))
      .set(as(doctorA))
      .expect(200);

    clock.current = at('2026-10-30T11:30:00+02:00');
    await post(`/appointments/${noShow.id}/no-show`);

    clock.current = at('2026-10-30T12:00:00+02:00');
    await post(
      `/payments/${i4cash.id}/refund`,
      { amount: '70.00', reason: 'Partial refund' },
      owner,
    );

    clock.current = at('2026-10-30T14:00:00+02:00');
    const wallet = await pay(i3.invoiceId, '50.00', 'WALLET');
    await post(`/payments/${wallet.id}/void`, { reason: 'Typed twice' });

    const manual = (patientId: string, unitPrice: string) =>
      post('/invoices', {
        patientId,
        items: [{ description: 'Medical report', unitPrice, quantity: 1 }],
      });
    const i5 = await manual(p1, '100.00');
    await post(`/invoices/${i5.id}/discount`, {
      type: 'FIXED',
      value: '10',
      reason: 'Goodwill',
    });
    await post(`/invoices/${i5.id}/cancel`, { reason: 'Not needed' });
    const i6 = await manual(p3, '150.00');
    await post(
      `/invoices/${i6.id}/discount`,
      { type: 'FIXED', value: '20', reason: 'Student' },
      owner,
    );

    const category = async (name: string) =>
      (await post('/expense-categories', { name }, owner)).id as string;
    const hospitality = await category('Hospitality');
    const supplies = await category('Supplies');
    const expense = (
      categoryId: string,
      amount: string,
      paymentMethod: string,
      expenseDate = '2026-10-30',
    ) =>
      post('/expenses', {
        categoryId,
        description: 'Purchase',
        amount,
        expenseDate,
        paymentMethod,
      });
    await expense(hospitality, '80.00', 'CASH');
    await expense(supplies, '200.00', 'CARD');
    const wrong = await expense(supplies, '999.00', 'CASH');
    await post(`/expenses/${wrong.id}/void`, { reason: 'Wrong amount' });

    // ---- Oct 31 ----
    clock.current = at('2026-10-31T09:00:00+02:00');
    const moved = await book(p1, doctorB.doctorId, '2026-10-31T09:30:00+02:00');
    await post(`/appointments/${moved.id}/reschedule`, {
      startAt: '2026-11-02T09:30:00+02:00',
      allowOutsideSchedule: true,
    });

    clock.current = at('2026-10-31T11:00:00+02:00');
    const onlineId = (
      await request(server)
        .get(api(`/appointments/by-reference/${online.body.referenceCode}`))
        .set(as(receptionist))
        .expect(200)
    ).body.id;
    const i7 = await post(`/appointments/${onlineId}/attend`);
    await post(`/invoices/${i7.invoiceId}/discount`, {
      type: 'FIXED',
      value: '50',
      reason: 'Mistake',
    });
    await post(`/invoices/${i7.invoiceId}/discount`, {
      type: 'FIXED',
      value: '30',
      reason: ' student ',
    });

    const i8 = await walkIn('2026-10-31T12:00:00+02:00', p1, doctorB.doctorId);
    const loyal = await request(server)
      .get(
        api(`/patients/${p1}/last-discount?excludeInvoiceId=${i8.invoiceId}`),
      )
      .set(as(receptionist))
      .expect(200);
    await post(`/invoices/${i8.invoiceId}/discount`, {
      repeatFromDiscountId: loyal.body.id,
    });
    await pay(i8.invoiceId, '200.00', 'INSTAPAY');

    const i9 = await walkIn('2026-10-31T13:00:00+02:00', p3, doctorB.doctorId);
    await post(`/visits/${i9.id}/undo-attend`, { reason: 'Wrong patient' });

    // ---- Nov 1 (after the range) ----
    const i10 = await walkIn('2026-11-01T10:00:00+02:00', p3, doctorA.doctorId);
    await pay(i10.invoiceId, '300.00', 'CASH');
    await expense(hospitality, '40.00', 'CASH', '2026-11-01');

    ids.p1 = p1;
    ids.p2 = p2;
    ids.p3 = p3;
    ids.hospitality = hospitality;
    ids.supplies = supplies;
    clock.current = at('2026-11-03T09:00:00+02:00');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /reports/summary', async () => {
    const { body } = await report(`summary${RANGE}`).expect(200);
    expect(body).toEqual({
      from: '2026-10-29',
      to: '2026-10-31',
      collected: '1070.00', // 500 + 100 + 270 + 200 (the voided 50 doesn't count)
      refunded: '70.00',
      netCollected: '1000.00',
      expenses: '280.00', // 80 + 200 (voided 999 and Nov 1 excluded)
      netAfterExpenses: '720.00',
      invoiced: '1740.00', // I2 500 + I3 300 + I4 270 + I6 130 + I7 270 + I8 270
      outstanding: '740.00', // I3 200 + I4 70 + I6 130 + I7 270 + I8 70
      discountsGiven: '110.00', // 30 + 20 + 30 + 30
      attendedVisits: 5, // I2, I3, I4, I7, I8
      noShows: 1,
      cancellations: 1,
      newPatients: 2, // P2 (DST night) and P3
      unsignedNotes: 4, // I4's visit is signed; I3's has only a draft
    });
  });

  it('puts events of the 25-hour day on the right local date', async () => {
    const day = await report('summary?from=2026-10-29&to=2026-10-29').expect(
      200,
    );
    expect(day.body).toMatchObject({
      collected: '600.00', // 00:30+03:00 (Oct 28 UTC) and 23:30+02:00
      invoiced: '800.00',
      attendedVisits: 2,
      newPatients: 1,
    });
    const before = await report('summary?from=2026-10-28&to=2026-10-28').expect(
      200,
    );
    expect(before.body).toMatchObject({
      collected: '300.00',
      attendedVisits: 1,
      newPatients: 1,
    });
  });

  describe('GET /reports/revenue', () => {
    it('groups by local day (default)', async () => {
      const { body } = await report(`revenue${RANGE}`).expect(200);
      expect(body).toEqual({
        from: '2026-10-29',
        to: '2026-10-31',
        groupBy: 'day',
        rows: [
          {
            key: '2026-10-29',
            label: '2026-10-29',
            collected: '600.00',
            invoiced: '800.00',
            visits: 2,
          },
          {
            key: '2026-10-30',
            label: '2026-10-30',
            collected: '200.00',
            invoiced: '400.00',
            visits: 1,
          },
          {
            key: '2026-10-31',
            label: '2026-10-31',
            collected: '200.00',
            invoiced: '540.00',
            visits: 2,
          },
        ],
        totals: { collected: '1000.00', invoiced: '1740.00', visits: 5 },
      });
    });

    it('groups by month', async () => {
      const { body } = await report(
        'revenue?from=2026-10-28&to=2026-11-01&groupBy=month',
      ).expect(200);
      expect(body.rows).toEqual([
        {
          key: '2026-10',
          label: '2026-10',
          collected: '1300.00',
          invoiced: '2040.00',
          visits: 6,
        },
        {
          key: '2026-11',
          label: '2026-11',
          collected: '300.00',
          invoiced: '300.00',
          visits: 1,
        },
      ]);
    });

    it('groups by doctor, manual invoices last', async () => {
      const { body } = await report(`revenue${RANGE}&groupBy=doctor`).expect(
        200,
      );
      expect(body.rows).toEqual([
        {
          key: doctorB.doctorId,
          label: expect.any(String),
          collected: '700.00',
          invoiced: '770.00',
          visits: 2,
        },
        {
          key: doctorA.doctorId,
          label: expect.any(String),
          collected: '300.00',
          invoiced: '840.00',
          visits: 3,
        },
        {
          key: null,
          label: 'Manual invoices (no visit)',
          collected: '0.00',
          invoiced: '130.00',
          visits: 0,
        },
      ]);
      expect(body.totals).toEqual({
        collected: '1000.00',
        invoiced: '1740.00',
        visits: 5,
      });
    });

    it('groups by service', async () => {
      const { body } = await report(`revenue${RANGE}&groupBy=service`).expect(
        200,
      );
      expect(body.rows).toEqual([
        {
          key: ids.assessment,
          label: 'Assessment',
          collected: '500.00',
          invoiced: '500.00',
          visits: 1,
        },
        {
          key: ids.session,
          label: 'Session',
          collected: '500.00',
          invoiced: '1110.00',
          visits: 4,
        },
        {
          key: null,
          label: 'Manual invoices (no visit)',
          collected: '0.00',
          invoiced: '130.00',
          visits: 0,
        },
      ]);
    });

    it('groups by method (collected only)', async () => {
      const { body } = await report(`revenue${RANGE}&groupBy=method`).expect(
        200,
      );
      expect(body.rows).toEqual([
        {
          key: 'CARD',
          label: 'CARD',
          collected: '500.00',
          invoiced: null,
          visits: null,
        },
        {
          key: 'CASH',
          label: 'CASH',
          collected: '300.00',
          invoiced: null,
          visits: null,
        },
        {
          key: 'INSTAPAY',
          label: 'INSTAPAY',
          collected: '200.00',
          invoiced: null,
          visits: null,
        },
      ]);
      expect(body.totals).toEqual({
        collected: '1000.00',
        invoiced: null,
        visits: null,
      });
    });
  });

  it('GET /reports/attendance', async () => {
    const { body } = await report(`attendance${RANGE}`).expect(200);
    const row = (doctorId: string) =>
      body.doctors.find(
        (d: { doctor: { id: string } }) => d.doctor.id === doctorId,
      );

    expect(body.doctors).toHaveLength(2);
    expect(row(doctorA.doctorId)).toEqual({
      doctor: { id: doctorA.doctorId, name: expect.any(String) },
      booked: 3,
      attended: 2,
      noShow: 0,
      cancelled: 1,
      noShowRate: '0.00',
      walkIns: 1,
      onlineBookings: 1,
      receptionBookings: 2,
    });
    // The rescheduled Oct 31 appointment doesn't count (its target is in Nov).
    expect(row(doctorB.doctorId)).toEqual({
      doctor: { id: doctorB.doctorId, name: expect.any(String) },
      booked: 1,
      attended: 0,
      noShow: 1,
      cancelled: 0,
      noShowRate: '100.00',
      walkIns: 2, // the undone walk-in doesn't count
      onlineBookings: 0,
      receptionBookings: 1,
    });
    expect(body.totals).toEqual({
      booked: 4,
      attended: 2,
      noShow: 1,
      cancelled: 1,
      noShowRate: '33.33',
      walkIns: 3,
      onlineBookings: 1,
      receptionBookings: 3,
    });

    const onlyB = await report(
      `attendance${RANGE}&doctorId=${doctorB.doctorId}`,
    ).expect(200);
    expect(onlyB.body.doctors).toEqual([row(doctorB.doctorId)]);
  });

  it('GET /reports/discounts', async () => {
    const { body } = await report(`discounts${RANGE}`).expect(200);
    expect(body).toEqual({
      from: '2026-10-29',
      to: '2026-10-31',
      count: 4,
      totalAmount: '110.00',
      repeats: 1,
      byUser: [
        {
          user: { id: receptionist.id, name: expect.any(String) },
          count: 3,
          amount: '90.00',
        },
        {
          user: { id: owner.id, name: expect.any(String) },
          count: 1,
          amount: '20.00',
        },
      ],
      byReason: [
        { reason: 'Loyal', count: 2, amount: '60.00' },
        // "Student" and " student " are one reason.
        {
          reason: expect.stringMatching(/^student$/i),
          count: 2,
          amount: '50.00',
        },
      ],
    });
  });

  it('GET /reports/expenses', async () => {
    const { body } = await report(`expenses${RANGE}`).expect(200);
    expect(body).toEqual({
      from: '2026-10-29',
      to: '2026-10-31',
      count: 2,
      total: '280.00',
      byCategory: [
        {
          category: { id: ids.supplies, name: 'Supplies' },
          count: 1,
          total: '200.00',
        },
        {
          category: { id: ids.hospitality, name: 'Hospitality' },
          count: 1,
          total: '80.00',
        },
      ],
      byMethod: {
        CASH: '80.00',
        CARD: '200.00',
        WALLET: '0.00',
        INSTAPAY: '0.00',
      },
    });
  });

  it('GET /reports/outstanding', async () => {
    const { body } = await report(`outstanding${RANGE}`).expect(200);
    expect(body).toEqual({
      items: [
        {
          patient: {
            id: ids.p3,
            name: 'Patient Three',
            phone: '+201033333333',
          },
          balance: '330.00', // I3 200 + I6 130
          oldestUnpaidInvoiceDate: '2026-10-29', // 23:30+02:00, not the 30th
        },
        {
          patient: { id: ids.p2, name: 'Patient Two', phone: '+201022222222' },
          balance: '270.00',
          oldestUnpaidInvoiceDate: '2026-10-31',
        },
        {
          patient: { id: ids.p1, name: 'Patient One', phone: '+201011111111' },
          balance: '140.00', // I4 70 + I8 70
          oldestUnpaidInvoiceDate: '2026-10-30',
        },
      ],
      meta: { page: 1, limit: 20, total: 3, totalPages: 1 },
    });

    const page2 = await report(`outstanding${RANGE}&limit=2&page=2`).expect(
      200,
    );
    expect(
      page2.body.items.map((r: { patient: { id: string } }) => r.patient.id),
    ).toEqual([ids.p1]);
    expect(page2.body.meta).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it('requires both dates, with from on or before to', async () => {
    await report('summary?from=2026-10-29').expect(400);
    await report('summary?from=2026-10-31&to=2026-10-29').expect(400);
    await report('revenue?from=2026-10-29&to=2026-10-31&groupBy=week').expect(
      400,
    );
  });
});
