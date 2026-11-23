import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { createLoggedInDoctor } from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Frozen clock: "today" is Friday 2026-11-20 in Cairo (+02:00).
const TODAY = '2026-11-20';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('12:00') };

interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  phone: string | null;
  isActive: boolean;
  user: { id: string; role: string } | null;
  currentSalary: { effectiveMonth: string; fixedSalary: string } | null;
  upcomingSalary: { effectiveMonth: string; fixedSalary: string } | null;
}

describe('Employee salaries (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctor: TestUser & { doctorId: string };

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
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
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
    patch: (path: string, body: object = {}) =>
      request(server)
        .patch(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });

  const addEmployee = async (body: object): Promise<Employee> =>
    (await as(owner).post('/employees', body).expect(201)).body;
  const setSalary = (employeeId: string, body: object) =>
    as(owner).put(`/employees/${employeeId}/salary/terms`, body);
  const pay = (employeeId: string, body: object) =>
    as(owner).post(`/employees/${employeeId}/salary/payments`, {
      method: 'CASH',
      ...body,
    });
  const statement = async (employeeId: string, month = '2026-11') =>
    (
      await as(owner)
        .get(`/employees/${employeeId}/salary/statement?month=${month}`)
        .expect(200)
    ).body;

  it('is OWNER only', async () => {
    const sara = await addEmployee({ name: 'Sara', jobTitle: 'Accountant' });
    for (const user of [receptionist, doctor]) {
      await as(user).get('/employees').expect(403);
      await as(user)
        .post('/employees', { name: 'X', jobTitle: 'Y' })
        .expect(403);
      await as(user).get(`/employees/${sara.id}`).expect(403);
      await as(user).patch(`/employees/${sara.id}`, { name: 'Z' }).expect(403);
      await as(user).patch(`/employees/${sara.id}/deactivate`).expect(403);
      await as(user).get('/employee-salaries?month=2026-11').expect(403);
      await as(user).get(`/employees/${sara.id}/salary/terms`).expect(403);
      await as(user)
        .put(`/employees/${sara.id}/salary/terms`, {
          effectiveMonth: '2026-11',
          fixedSalary: '1.00',
        })
        .expect(403);
      await as(user)
        .get(`/employees/${sara.id}/salary/statement?month=2026-11`)
        .expect(403);
      await as(user)
        .post(`/employees/${sara.id}/salary/payments`, {
          month: '2026-11',
          amount: '1.00',
          method: 'CASH',
        })
        .expect(403);
    }
    await request(server).get('/api/v1/employees').expect(401);
  });

  it('employees need no login; linking an account is optional and checked', async () => {
    // No login: name collapsed, phone normalized, no salary yet.
    const omar = await addEmployee({
      name: '  Omar   Adel ',
      jobTitle: 'Office boy',
      phone: '01012345678',
    });
    expect(omar).toMatchObject({
      name: 'Omar Adel',
      jobTitle: 'Office boy',
      phone: '+201012345678',
      isActive: true,
      user: null,
      currentSalary: null,
      upcomingSalary: null,
    });

    // With a receptionist's account and a first salary.
    const sara = await addEmployee({
      name: 'Sara Hassan',
      jobTitle: 'Receptionist',
      userId: receptionist.id,
      salary: { effectiveMonth: '2026-11', fixedSalary: '6000' },
    });
    expect(sara).toMatchObject({
      user: { id: receptionist.id, role: 'RECEPTIONIST' },
      currentSalary: { effectiveMonth: '2026-11', fixedSalary: '6000.00' },
    });

    // One account, one employee; never a doctor's account.
    const taken = await as(owner)
      .post('/employees', {
        name: 'Copy',
        jobTitle: 'Receptionist',
        userId: receptionist.id,
      })
      .expect(409);
    expect(taken.body).toMatchObject({
      code: 'EMPLOYEE_USER_TAKEN',
      details: { employeeId: sara.id },
    });
    const doctorAccount = await as(owner)
      .patch(`/employees/${omar.id}`, { userId: doctor.id })
      .expect(422);
    expect(doctorAccount.body.code).toBe('EMPLOYEE_USER_INVALID');
    await as(owner)
      .patch(`/employees/${omar.id}`, {
        userId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404);

    // Unlinked, the account can go to someone else.
    const unlinked = await as(owner)
      .patch(`/employees/${sara.id}`, { userId: null, jobTitle: 'Front desk' })
      .expect(200);
    expect(unlinked.body).toMatchObject({ user: null, jobTitle: 'Front desk' });
    const relinked = await as(owner)
      .patch(`/employees/${omar.id}`, { userId: receptionist.id })
      .expect(200);
    expect(relinked.body.user).toMatchObject({ id: receptionist.id });

    // Validation.
    for (const body of [
      { name: 'A', jobTitle: 'Receptionist' },
      { name: 'Valid Name' },
      { name: 'Valid Name', jobTitle: 'X'.repeat(81) },
      { name: 'Valid Name', jobTitle: 'Nurse', phone: '123' },
      {
        name: 'Valid Name',
        jobTitle: 'Nurse',
        salary: { effectiveMonth: '2026-13', fixedSalary: '10' },
      },
      {
        name: 'Valid Name',
        jobTitle: 'Nurse',
        salary: { effectiveMonth: '2026-11', fixedSalary: '-1' },
      },
    ]) {
      await as(owner).post('/employees', body).expect(400);
    }

    // Audited with old and new values.
    const updates = await ctx.dataSource.getRepository(AuditLog).findBy({
      entityType: 'EMPLOYEE',
      entityId: sara.id,
      action: 'EMPLOYEE_UPDATED',
    });
    expect(updates[0]).toMatchObject({
      oldValues: { userId: receptionist.id, jobTitle: 'Receptionist' },
      newValues: { userId: null, jobTitle: 'Front desk' },
    });

    // Search, status filter, deactivate / activate.
    await as(owner).patch(`/employees/${omar.id}/deactivate`).expect(200);
    const active = (await as(owner).get('/employees?isActive=true').expect(200))
      .body;
    expect(active.items.map((e: Employee) => e.name)).toEqual(['Sara Hassan']);
    const search = (await as(owner).get('/employees?search=office').expect(200))
      .body;
    expect(search.items).toMatchObject([
      { name: 'Omar Adel', isActive: false },
    ]);
    const back = await as(owner)
      .patch(`/employees/${omar.id}/activate`)
      .expect(200);
    expect(back.body.isActive).toBe(true);
  });

  it('salary versions by month: past months keep theirs, paid months are locked', async () => {
    const sara = await addEmployee({ name: 'Sara', jobTitle: 'Accountant' });
    await setSalary(sara.id, {
      effectiveMonth: '2026-10',
      fixedSalary: '5000',
    }).expect(200);
    await setSalary(sara.id, {
      effectiveMonth: '2026-11',
      fixedSalary: '6000',
    }).expect(200);
    // The same month again replaces its version.
    await setSalary(sara.id, {
      effectiveMonth: '2026-11',
      fixedSalary: '6500.5',
    }).expect(200);
    await setSalary(sara.id, {
      effectiveMonth: '2026-12',
      fixedSalary: '7000',
    }).expect(200);

    const versions = (
      await as(owner).get(`/employees/${sara.id}/salary/terms`).expect(200)
    ).body;
    expect(
      versions.map((v: { effectiveMonth: string; fixedSalary: string }) => [
        v.effectiveMonth,
        v.fixedSalary,
      ]),
    ).toEqual([
      ['2026-12', '7000.00'],
      ['2026-11', '6500.50'],
      ['2026-10', '5000.00'],
    ]);
    expect((await statement(sara.id, '2026-09')).fixedSalary).toBe('0.00');
    expect((await statement(sara.id, '2026-10')).fixedSalary).toBe('5000.00');
    expect((await statement(sara.id, '2026-11')).fixedSalary).toBe('6500.50');
    const detail = (await as(owner).get(`/employees/${sara.id}`).expect(200))
      .body;
    expect(detail).toMatchObject({
      currentSalary: { effectiveMonth: '2026-11', fixedSalary: '6500.50' },
      upcomingSalary: { effectiveMonth: '2026-12', fixedSalary: '7000.00' },
    });

    // November is paid: a new version can only start after it.
    const paid = (
      await pay(sara.id, { month: '2026-11', amount: '1000' }).expect(201)
    ).body;
    for (const month of ['2026-11', '2026-10']) {
      const res = await setSalary(sara.id, {
        effectiveMonth: month,
        fixedSalary: '1.00',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'SALARY_MONTH_PAID',
        details: { paidMonth: '2026-11' },
      });
    }
    await setSalary(sara.id, {
      effectiveMonth: '2026-12',
      fixedSalary: '0',
    }).expect(200);
    // A voided payment no longer locks it.
    await as(owner)
      .post(`/employee-salaries/payments/${paid.id}/void`, {
        reason: 'Wrong month',
      })
      .expect(201);
    await setSalary(sara.id, {
      effectiveMonth: '2026-11',
      fixedSalary: '6000',
    }).expect(200);

    const audit = await ctx.dataSource.getRepository(AuditLog).findBy({
      action: 'EMPLOYEE_SALARY_SET',
    });
    expect(audit.some((a) => a.oldValues?.fixedSalary === '6000.00')).toBe(
      true,
    );
  });

  it('payments: parts and advances, each an expense; voiding voids the expense', async () => {
    const sara = await addEmployee({
      name: 'Sara Hassan',
      jobTitle: 'Receptionist',
      salary: { effectiveMonth: '2026-11', fixedSalary: '6000' },
    });
    const first = await pay(sara.id, {
      month: '2026-11',
      amount: '2000',
      paymentDate: '2026-11-15',
      method: 'INSTAPAY',
      reference: 'T-1',
      notes: 'First half',
    }).expect(201);
    expect(first.body).toMatchObject({
      employee: { id: sara.id, name: 'Sara Hassan', jobTitle: 'Receptionist' },
      month: '2026-11',
      amount: '2000.00',
      paymentDate: '2026-11-15',
      method: 'INSTAPAY',
      status: 'VALID',
      expense: { expenseNumber: expect.stringMatching(/^EXP-/) },
    });

    // Its expense: same amount, method, date and reference, in the reserved
    // category, paid to the employee; it changes only with the payment.
    const expense = (
      await as(owner).get(`/expenses/${first.body.expense.id}`).expect(200)
    ).body;
    expect(expense).toMatchObject({
      amount: '2000.00',
      expenseDate: '2026-11-15',
      paymentMethod: 'INSTAPAY',
      reference: 'T-1',
      vendorName: 'Sara Hassan',
      description: 'Salary 2026-11: Sara Hassan',
      status: 'VALID',
      category: { systemKey: 'EMPLOYEE_SALARY' },
    });
    const direct = await as(owner)
      .post(`/expenses/${expense.id}/void`, { reason: 'Trying directly' })
      .expect(422);
    expect(direct.body.code).toBe('EXPENSE_EDIT_NOT_ALLOWED');

    // More than what remains is allowed: an advance.
    await pay(sara.id, { month: '2026-11', amount: '5000' }).expect(201);
    expect(await statement(sara.id)).toMatchObject({
      fixedSalary: '6000.00',
      paid: '7000.00',
      remaining: '-1000.00',
    });

    const voided = await as(owner)
      .post(`/employee-salaries/payments/${first.body.id}/void`, {
        reason: 'Recorded twice',
      })
      .expect(201);
    expect(voided.body).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Recorded twice',
    });
    expect(
      (await as(owner).get(`/expenses/${expense.id}`).expect(200)).body.status,
    ).toBe('VOIDED');
    const s = await statement(sara.id);
    expect(s).toMatchObject({ paid: '5000.00', remaining: '1000.00' });
    expect(s.payments.map((p: { status: string }) => p.status)).toEqual([
      'VALID',
      'VOIDED',
    ]);
    const again = await as(owner)
      .post(`/employee-salaries/payments/${first.body.id}/void`, {
        reason: 'Again',
      })
      .expect(422);
    expect(again.body.code).toBe('PAYOUT_VOIDED');

    // Not a future month, not a future date, nothing for nobody.
    expect(
      (await pay(sara.id, { month: '2026-12', amount: '10' }).expect(422)).body
        .code,
    ).toBe('DATE_OUT_OF_RANGE');
    expect(
      (
        await pay(sara.id, {
          month: '2026-11',
          amount: '10',
          paymentDate: '2026-11-21',
        }).expect(422)
      ).body.code,
    ).toBe('EXPENSE_DATE_IN_FUTURE');
    await pay(sara.id, { month: '2026-11', amount: '0' }).expect(400);
    await pay('00000000-0000-4000-8000-000000000000', {
      month: '2026-11',
      amount: '10',
    }).expect(404);

    // Someone who left can still get their last month.
    await as(owner).patch(`/employees/${sara.id}/deactivate`).expect(200);
    await pay(sara.id, { month: '2026-11', amount: '1000' }).expect(201);
    expect((await statement(sara.id)).remaining).toBe('0.00');
  });

  it('overview: active employees, and inactive ones only when they have something that month', async () => {
    const sara = await addEmployee({
      name: 'Sara',
      jobTitle: 'Receptionist',
      salary: { effectiveMonth: '2026-11', fixedSalary: '6000' },
    });
    const ali = await addEmployee({ name: 'Ali', jobTitle: 'Assistant' });
    const mona = await addEmployee({
      name: 'Mona',
      jobTitle: 'Accountant',
      salary: { effectiveMonth: '2026-11', fixedSalary: '4000' },
    });
    const omar = await addEmployee({ name: 'Omar', jobTitle: 'Office boy' });
    for (const e of [mona, omar]) {
      await as(owner).patch(`/employees/${e.id}/deactivate`).expect(200);
    }
    await pay(sara.id, { month: '2026-11', amount: '2500' }).expect(201);

    const rows = (
      await as(owner).get('/employee-salaries?month=2026-11').expect(200)
    ).body;
    expect(rows).toEqual([
      {
        employee: { id: ali.id, name: 'Ali', jobTitle: 'Assistant' },
        isActive: true,
        hasTerms: false,
        fixedSalary: '0.00',
        paid: '0.00',
        remaining: '0.00',
      },
      {
        employee: { id: mona.id, name: 'Mona', jobTitle: 'Accountant' },
        isActive: false,
        hasTerms: true,
        fixedSalary: '4000.00',
        paid: '0.00',
        remaining: '4000.00',
      },
      {
        employee: { id: sara.id, name: 'Sara', jobTitle: 'Receptionist' },
        isActive: true,
        hasTerms: true,
        fixedSalary: '6000.00',
        paid: '2500.00',
        remaining: '3500.00',
      },
    ]);
    await as(owner).get('/employee-salaries?month=2026-1').expect(400);
  });

  it('reports: salary payments are expenses, counted once; the clinic owes them like doctors’ salaries', async () => {
    // A doctor on a fixed salary next to the employee: separate figures.
    await as(owner)
      .put(`/doctors/${doctor.doctorId}/salary/terms`, {
        effectiveMonth: '2026-10',
        fixedSalary: '3000',
        commissionMode: 'NONE',
      })
      .expect(200);
    const sara = await addEmployee({
      name: 'Sara Hassan',
      jobTitle: 'Receptionist',
      salary: { effectiveMonth: '2026-10', fixedSalary: '6000' },
    });
    // October: 4000 of 6000 paid on Nov 5. November: 1000 ahead, today.
    await pay(sara.id, {
      month: '2026-10',
      amount: '4000',
      paymentDate: '2026-11-05',
      method: 'CARD',
    }).expect(201);
    const advance = (
      await pay(sara.id, { month: '2026-11', amount: '1000' }).expect(201)
    ).body;

    // Daily summary: part of the day's expenses (and of the cash drawer).
    const day = (
      await as(owner).get(`/billing/daily-summary?date=${TODAY}`).expect(200)
    ).body;
    expect(day).toMatchObject({
      expenses: { count: 1, total: '1000.00' },
      salaryPayments: { count: 0, total: '0.00' },
      employeeSalaryPayments: {
        count: 1,
        total: '1000.00',
        byMethod: { CASH: '1000.00' },
      },
      expectedCash: '-1000.00',
    });

    const RANGE = '?from=2026-11-01&to=2026-11-20';
    const summary = (await as(owner).get(`/reports/summary${RANGE}`)).body;
    expect(summary).toMatchObject({
      expenses: '5000.00',
      salaryPayments: '0.00',
      employeeSalaryPayments: '5000.00',
      netAfterExpenses: '-5000.00',
      clinicOwes: '5000.00', // doctor October 3000 + Sara October 2000
    });
    const expenses = (await as(owner).get(`/reports/expenses${RANGE}`)).body;
    expect(expenses).toMatchObject({
      total: '5000.00',
      employeeSalaryPayments: '5000.00',
      byCategory: [{ category: { name: 'رواتب الموظفين' }, count: 2 }],
    });
    const transactions = (
      await as(owner).get(`/reports/transactions${RANGE}&kind=EXPENSE`)
    ).body;
    expect(transactions.totals).toMatchObject({
      expenses: { count: 2, total: '5000.00' },
      salaryPayments: { count: 0, total: '0.00' },
      employeeSalaryPayments: { count: 2, total: '5000.00' },
    });
    expect(
      transactions.items.map((t: { expenseOrigin: string; payee: string }) => [
        t.expenseOrigin,
        t.payee,
      ]),
    ).toEqual([
      ['EMPLOYEE_SALARY', 'Sara Hassan'],
      ['EMPLOYEE_SALARY', 'Sara Hassan'],
    ]);

    // What the clinic owes: October is due (its last day passed); November
    // is not yet, so its 1000 is an advance that never hides October.
    const owes = (
      await as(owner).get(`/reports/clinic-owes?asOf=${TODAY}`).expect(200)
    ).body;
    expect(owes).toMatchObject({
      owed: '5000.00',
      advances: '1000.00',
      doctorSalaries: { owed: '3000.00', advances: '0.00' },
      employeeSalaries: {
        owed: '2000.00',
        advances: '1000.00',
        rows: [
          {
            employee: { id: sara.id, name: 'Sara Hassan' },
            month: '2026-10',
            fixedSalary: '6000.00',
            fixedDue: true,
            paid: '4000.00',
            balance: '2000.00',
          },
          {
            employee: { id: sara.id, name: 'Sara Hassan' },
            month: '2026-11',
            fixedSalary: '0.00',
            fixedDue: false,
            paid: '1000.00',
            balance: '-1000.00',
          },
        ],
      },
    });
    expect(day.outstanding.clinicOwes.closing).toMatchObject({
      owed: '5000.00',
      doctorSalaries: '3000.00',
      employeeSalaries: '2000.00',
    });

    // Money flow: opening + earned - paid + advance change = closing.
    const october = (
      await as(owner).get('/reports/money-flow?from=2026-10-01&to=2026-10-31')
    ).body.clinicOwes;
    expect(october).toMatchObject({
      salariesEarned: '3000.00',
      employeeSalariesEarned: '6000.00',
      closing: { owed: '9000.00', employeeSalaries: '6000.00' },
    });
    const flow = (await as(owner).get(`/reports/money-flow${RANGE}`)).body
      .clinicOwes;
    expect(flow).toMatchObject({
      opening: { owed: '9000.00' },
      employeeSalariesEarned: '0.00',
      employeeSalaryPayments: '5000.00',
      salaryPayments: '0.00',
      advancesChange: '1000.00',
      closing: { owed: '5000.00', advances: '1000.00' },
    });

    // Receptionists see the day's totals, never what the clinic owes.
    const desk = (
      await as(receptionist).get('/billing/daily-summary').expect(200)
    ).body;
    expect(desk.outstanding.clinicOwes).toBeNull();

    // A voided payment never counted anywhere.
    await as(owner)
      .post(`/employee-salaries/payments/${advance.id}/void`, {
        reason: 'Paid by mistake',
      })
      .expect(201);
    const after = (
      await as(owner).get(`/billing/daily-summary?date=${TODAY}`).expect(200)
    ).body;
    expect(after).toMatchObject({
      expenses: { count: 0, total: '0.00' },
      employeeSalaryPayments: { count: 0, total: '0.00' },
      expectedCash: '0.00',
    });
    expect(after.outstanding.clinicOwes.closing).toMatchObject({
      owed: '5000.00',
      advances: '0.00',
    });
  });
});
