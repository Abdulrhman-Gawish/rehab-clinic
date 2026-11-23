import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { checkInDetailsFor } from './utils/check-in.js';
import {
  assignService,
  createLoggedInDoctor,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Salaries (doctors' and employees') are the OWNER's only: no other role
// sees an amount or a payment anywhere (expenses, receipts, categories,
// daily summary, reports, salary APIs, audit), while receptionists keep
// their normal expenses and the day's money.

// A receipt the upload accepts (PNG magic bytes).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body'),
]);

// Frozen clock: "today" is Friday 2026-11-20 in Cairo (+02:00).
const TODAY = '2026-11-20';
const clock = { current: new Date(`${TODAY}T12:00:00+02:00`) };
const DAY = `?from=${TODAY}&to=${TODAY}`;
// Salary figures of the story: none may show up in what others receive.
const SALARY_FIGURES = /(^|[^0-9])(500|1000|1550|3000|6000|2500|5000)\.00/;

type Method = 'get' | 'post' | 'put' | 'patch';

interface Story {
  doctorPayment: { id: string; expenseId: string };
  employeePayment: { id: string; expenseId: string };
  employeeId: string;
  manualExpenseId: string;
  categoryIds: { DOCTOR_SALARY: string; EMPLOYEE_SALARY: string };
}

describe('Salary privacy (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctor: TestUser & { doctorId: string };
  let serviceId: string;
  let story: Story;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        basePrice: '300.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctor.doctorId, serviceId);
    story = await tellStory();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // `user` null = no credentials.
  const call = (
    user: TestUser | null,
    method: Method,
    path: string,
    body?: object,
  ) => {
    const req = request(server)[method](`/api/v1${path}`);
    if (user) req.set('Authorization', bearer(user));
    return body ? req.send(body) : req;
  };
  const as = (user: TestUser) => ({
    get: (path: string) => call(user, 'get', path),
    post: (path: string, body: object = {}) => call(user, 'post', path, body),
    put: (path: string, body: object) => call(user, 'put', path, body),
    patch: (path: string, body: object = {}) => call(user, 'patch', path, body),
    upload: (path: string) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .attach('file', PNG, 'receipt.png'),
  });
  const keys = (items: { category: { systemKey: string | null } }[]) =>
    items.map((e) => e.category.systemKey ?? 'MANUAL').sort();

  /**
   * One day at the clinic: the owner pays a doctor's salary (500) and an
   * employee's (1000), both in cash with a transfer slip; the receptionist
   * records a typed expense (50, with its receipt) and takes a patient's
   * payment (300). Sara, the employee, is the receptionist's own login.
   */
  async function tellStory(): Promise<Story> {
    await as(owner)
      .put(`/doctors/${doctor.doctorId}/salary/terms`, {
        effectiveMonth: '2026-11',
        fixedSalary: '3000',
        commissionMode: 'NONE',
      })
      .expect(200);
    const sara = (
      await as(owner)
        .post('/employees', {
          name: 'Sara Hassan',
          jobTitle: 'Receptionist',
          userId: receptionist.id,
          salary: { effectiveMonth: '2026-11', fixedSalary: '6000' },
        })
        .expect(201)
    ).body;
    const doctorPayment = (
      await as(owner)
        .post(`/doctors/${doctor.doctorId}/salary/payments`, {
          month: '2026-11',
          amount: '500',
          method: 'CASH',
        })
        .expect(201)
    ).body;
    const employeePayment = (
      await as(owner)
        .post(`/employees/${sara.id}/salary/payments`, {
          month: '2026-11',
          amount: '1000',
          method: 'CASH',
        })
        .expect(201)
    ).body;
    for (const p of [doctorPayment, employeePayment]) {
      await as(owner).upload(`/expenses/${p.expense.id}/receipt`).expect(200);
    }

    const supplies = (
      await as(owner)
        .post('/expense-categories', { name: 'Supplies' })
        .expect(201)
    ).body;
    const manual = (
      await as(receptionist)
        .post('/expenses', {
          categoryId: supplies.id,
          description: 'Printer paper',
          amount: '50',
          expenseDate: TODAY,
          paymentMethod: 'CASH',
        })
        .expect(201)
    ).body;
    await as(receptionist).upload(`/expenses/${manual.id}/receipt`).expect(200);

    const phone = '01000000001';
    const visit = (
      await as(receptionist)
        .post('/visits/walk-in', {
          name: 'Patient One',
          phone,
          patientDetails: checkInDetailsFor(phone),
          doctorId: doctor.doctorId,
          serviceId,
          type: 'SESSION',
        })
        .expect(201)
    ).body;
    await as(receptionist)
      .post(`/invoices/${visit.invoiceId}/payments`, {
        amount: '300.00',
        method: 'CASH',
      })
      .expect(201);

    const all = (await as(owner).get(`/expenses${DAY}`).expect(200)).body;
    const categoryOf = (key: string) =>
      all.items.find(
        (e: { category: { systemKey: string | null } }) =>
          e.category.systemKey === key,
      ).category.id;
    return {
      doctorPayment: {
        id: doctorPayment.id,
        expenseId: doctorPayment.expense.id,
      },
      employeePayment: {
        id: employeePayment.id,
        expenseId: employeePayment.expense.id,
      },
      employeeId: sara.id,
      manualExpenseId: manual.id,
      categoryIds: {
        DOCTOR_SALARY: categoryOf('DOCTOR_SALARY'),
        EMPLOYEE_SALARY: categoryOf('EMPLOYEE_SALARY'),
      },
    };
  }

  const salaryExpenses = () => [
    story.doctorPayment.expenseId,
    story.employeePayment.expenseId,
  ];

  describe('receptionists', () => {
    it('keep their expenses, without any salary in the list or its total', async () => {
      const list = (await as(receptionist).get(`/expenses${DAY}`).expect(200))
        .body;
      expect(list).toMatchObject({ totalAmount: '50.00', meta: { total: 1 } });
      expect(keys(list.items)).toEqual(['MANUAL']);
      expect(list.items[0]).toMatchObject({
        id: story.manualExpenseId,
        hasReceipt: true,
      });

      // No filter brings a salary back.
      for (const query of [
        `${DAY}&source=MANUAL`,
        `${DAY}&status=VALID`,
        `${DAY}&method=CASH`,
        `${DAY}&createdBy=${owner.id}`,
        '',
      ]) {
        const res = (
          await as(receptionist).get(`/expenses${query}`).expect(200)
        ).body;
        expect(keys(res.items)).not.toContain('DOCTOR_SALARY');
        expect(keys(res.items)).not.toContain('EMPLOYEE_SALARY');
      }
      for (const categoryId of Object.values(story.categoryIds)) {
        expect(
          (
            await as(receptionist)
              .get(`/expenses?categoryId=${categoryId}`)
              .expect(200)
          ).body,
        ).toMatchObject({ items: [], totalAmount: '0.00', meta: { total: 0 } });
      }
    });

    it('still read, change, attach to and void their own expense', async () => {
      const id = story.manualExpenseId;
      await as(receptionist).get(`/expenses/${id}`).expect(200);
      const receipt = await as(receptionist)
        .get(`/expenses/${id}/receipt`)
        .expect(200);
      expect(receipt.headers['content-type']).toBe('image/png');
      await as(receptionist).upload(`/expenses/${id}/receipt`).expect(200);
      expect(
        (
          await as(receptionist)
            .patch(`/expenses/${id}`, { description: 'A4 paper' })
            .expect(200)
        ).body.description,
      ).toBe('A4 paper');
      expect(
        (
          await as(receptionist)
            .post(`/expenses/${id}/void`, { reason: 'Typed twice' })
            .expect(200)
        ).body.status,
      ).toBe('VOIDED');
    });

    it('find no salary payment by its id: details, receipt, edit, void and upload are 404', async () => {
      for (const id of salaryExpenses()) {
        await as(receptionist).get(`/expenses/${id}`).expect(404);
        await as(receptionist).get(`/expenses/${id}/receipt`).expect(404);
        await as(receptionist)
          .patch(`/expenses/${id}`, { description: 'Changed' })
          .expect(404);
        await as(receptionist)
          .post(`/expenses/${id}/void`, { reason: 'Trying' })
          .expect(404);
        await as(receptionist).upload(`/expenses/${id}/receipt`).expect(404);
      }
      // Nothing happened to them.
      for (const id of salaryExpenses()) {
        expect(
          (await as(owner).get(`/expenses/${id}`).expect(200)).body,
        ).toMatchObject({ status: 'VALID', hasReceipt: true });
      }
    });

    it('see the expense categories they can use, never a salary one', async () => {
      for (const query of ['', '?includeInactive=true']) {
        const listed = (
          await as(receptionist).get(`/expense-categories${query}`).expect(200)
        ).body as { name: string; systemKey: string | null }[];
        expect(listed.map((c) => c.name)).toContain('Supplies');
        expect(listed.map((c) => c.systemKey)).not.toContain('DOCTOR_SALARY');
        expect(listed.map((c) => c.systemKey)).not.toContain('EMPLOYEE_SALARY');
      }
    });

    it('get the day’s money without salaries, expected cash included', async () => {
      const day = (
        await as(receptionist).get('/billing/daily-summary').expect(200)
      ).body;
      expect(day).toMatchObject({
        payments: { count: 1, total: '300.00', byMethod: { CASH: '300.00' } },
        expenses: { count: 1, total: '50.00', byMethod: { CASH: '50.00' } },
        commissionPayouts: { count: 0, total: '0.00' },
        salaryPayments: null,
        employeeSalaryPayments: null,
        expectedCash: '250.00', // 300 in - 50 out; the salaries left out
        outstanding: { clinicOwes: null },
      });
      expect(JSON.stringify(day)).not.toMatch(SALARY_FIGURES);
    });

    it('see no salary in a doctor’s profile', async () => {
      for (const user of [receptionist, doctor]) {
        const profile = await as(user)
          .get(`/doctors/${doctor.doctorId}`)
          .expect(200);
        expect(JSON.stringify(profile.body)).not.toMatch(/salary/i);
        expect(JSON.stringify(profile.body)).not.toMatch(SALARY_FIGURES);
      }
    });
  });

  describe('every other role is refused every salary, report and audit route', () => {
    // GETs and writes, each with a valid body so only the role decides.
    const routes = (): [Method, string, object?][] => {
      const d = doctor.doctorId;
      const e = story.employeeId;
      const pay = { month: '2026-11', amount: '1.00', method: 'CASH' };
      return [
        // Doctors' salaries.
        ['get', '/doctor-salaries?month=2026-11'],
        ['get', `/doctors/${d}/salary/terms`],
        [
          'put',
          `/doctors/${d}/salary/terms`,
          {
            effectiveMonth: '2026-12',
            fixedSalary: '1',
            commissionMode: 'NONE',
          },
        ],
        ['get', `/doctors/${d}/salary/statement?month=2026-11`],
        ['post', `/doctors/${d}/salary/payments`, pay],
        [
          'post',
          `/doctor-salaries/payments/${story.doctorPayment.id}/void`,
          { reason: 'Not allowed' },
        ],
        // Employees and their salaries.
        ['get', '/employees'],
        ['post', '/employees', { name: 'Someone', jobTitle: 'Assistant' }],
        ['get', `/employees/${e}`],
        ['patch', `/employees/${e}`, { name: 'Changed' }],
        ['patch', `/employees/${e}/deactivate`, {}],
        ['patch', `/employees/${e}/activate`, {}],
        ['get', '/employee-salaries?month=2026-11'],
        ['get', `/employees/${e}/salary/terms`],
        [
          'put',
          `/employees/${e}/salary/terms`,
          { effectiveMonth: '2026-12', fixedSalary: '1' },
        ],
        ['get', `/employees/${e}/salary/statement?month=2026-11`],
        ['post', `/employees/${e}/salary/payments`, pay],
        [
          'post',
          `/employee-salaries/payments/${story.employeePayment.id}/void`,
          { reason: 'Not allowed' },
        ],
        // Reports (salaries are in their totals) and the audit log.
        ['get', `/reports/summary${DAY}`],
        ['get', `/reports/revenue${DAY}&groupBy=day`],
        ['get', `/reports/expenses${DAY}`],
        ['get', `/reports/money-flow${DAY}`],
        ['get', `/reports/transactions${DAY}`],
        ['get', `/reports/clinic-owes?asOf=${TODAY}`],
        ['get', `/reports/patients-owe?asOf=${TODAY}`],
        ['get', '/audit-logs'],
        ['get', '/audit-logs?entityType=DOCTOR_SALARY_PAYMENT'],
      ];
    };

    it('receptionists and doctors get 403, without credentials 401', async () => {
      for (const [method, path, body] of routes()) {
        for (const user of [receptionist, doctor]) {
          const res = await call(user, method, path, body);
          expect([method, path, user.role, res.status]).toEqual([
            method,
            path,
            user.role,
            403,
          ]);
        }
        expect((await call(null, method, path, body)).status).toBe(401);
      }

      // Nothing changed: the doctor's and the employee's months, terms and
      // payments are as the owner left them.
      expect(
        (
          await as(owner)
            .get(`/doctors/${doctor.doctorId}/salary/statement?month=2026-11`)
            .expect(200)
        ).body,
      ).toMatchObject({
        fixedSalary: '3000.00',
        paid: '500.00',
        remaining: '2500.00',
        payments: [{ status: 'VALID' }],
      });
      expect(
        (
          await as(owner)
            .get(
              `/employees/${story.employeeId}/salary/statement?month=2026-11`,
            )
            .expect(200)
        ).body,
      ).toMatchObject({
        fixedSalary: '6000.00',
        paid: '1000.00',
        payments: [{ status: 'VALID' }],
      });
      for (const path of [
        `/doctors/${doctor.doctorId}/salary/terms`,
        `/employees/${story.employeeId}/salary/terms`,
      ]) {
        expect((await as(owner).get(path).expect(200)).body).toHaveLength(1);
      }
      expect(
        (await as(owner).get(`/employees/${story.employeeId}`).expect(200))
          .body,
      ).toMatchObject({ name: 'Sara Hassan', isActive: true });
    });

    it('doctors reach no expense, category or daily summary at all', async () => {
      const ids = [...salaryExpenses(), story.manualExpenseId];
      const denied: [Method, string, object?][] = [
        ['get', `/expenses${DAY}`],
        ['get', '/expense-categories'],
        ['get', '/billing/daily-summary'],
        [
          'post',
          '/expenses',
          {
            categoryId: story.categoryIds.DOCTOR_SALARY,
            description: 'x',
            amount: '1',
            expenseDate: TODAY,
            paymentMethod: 'CASH',
          },
        ],
        ...ids.flatMap((id): [Method, string, object?][] => [
          ['get', `/expenses/${id}`],
          ['get', `/expenses/${id}/receipt`],
          ['patch', `/expenses/${id}`, { description: 'x' }],
          ['post', `/expenses/${id}/void`, { reason: 'Not allowed' }],
        ]),
      ];
      for (const [method, path, body] of denied) {
        expect([path, (await call(doctor, method, path, body)).status]).toEqual(
          [path, 403],
        );
      }
    });
  });

  describe('the owner', () => {
    it('sees every salary payment, with its receipt and category', async () => {
      const list = (await as(owner).get(`/expenses${DAY}`).expect(200)).body;
      expect(list).toMatchObject({
        totalAmount: '1550.00',
        meta: { total: 3 },
      });
      expect(keys(list.items)).toEqual([
        'DOCTOR_SALARY',
        'EMPLOYEE_SALARY',
        'MANUAL',
      ]);
      for (const id of salaryExpenses()) {
        await as(owner).get(`/expenses/${id}`).expect(200);
        await as(owner).get(`/expenses/${id}/receipt`).expect(200);
      }
      const categories = (
        await as(owner).get('/expense-categories').expect(200)
      ).body.map((c: { systemKey: string | null }) => c.systemKey);
      expect(categories).toEqual(
        expect.arrayContaining(['DOCTOR_SALARY', 'EMPLOYEE_SALARY']),
      );
    });

    it('gets the full day and the reports, the salaries counted once', async () => {
      const day = (
        await as(owner).get(`/billing/daily-summary?date=${TODAY}`).expect(200)
      ).body;
      expect(day).toMatchObject({
        payments: { total: '300.00' },
        expenses: { count: 3, total: '1550.00' },
        salaryPayments: { count: 1, total: '500.00' },
        employeeSalaryPayments: { count: 1, total: '1000.00' },
        expectedCash: '-1250.00', // 300 - 50 - 500 - 1000
      });
      expect(day.outstanding.clinicOwes).not.toBeNull();

      expect(
        (await as(owner).get(`/reports/summary${DAY}`).expect(200)).body,
      ).toMatchObject({
        collected: '300.00',
        expenses: '1550.00',
        salaryPayments: '500.00',
        employeeSalaryPayments: '1000.00',
        netAfterExpenses: '-1250.00',
      });
      expect(
        (await as(owner).get(`/reports/expenses${DAY}`).expect(200)).body,
      ).toMatchObject({
        total: '1550.00',
        salaryPayments: '500.00',
        employeeSalaryPayments: '1000.00',
      });
      const transactions = (
        await as(owner).get(`/reports/transactions${DAY}&kind=EXPENSE`)
      ).body;
      expect(
        transactions.items
          .map((t: { expenseOrigin: string }) => t.expenseOrigin)
          .sort(),
      ).toEqual(['DOCTOR_SALARY', 'EMPLOYEE_SALARY', 'MANUAL']);
      // November is not over: both payments are ahead of what is owed.
      expect(
        (await as(owner).get(`/reports/clinic-owes?asOf=${TODAY}`).expect(200))
          .body,
      ).toMatchObject({
        owed: '0.00',
        advances: '1500.00',
        doctorSalaries: { advances: '500.00' },
        employeeSalaries: { advances: '1000.00' },
      });
    });
  });
});
