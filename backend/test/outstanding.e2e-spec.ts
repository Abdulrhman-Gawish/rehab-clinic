import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { addMoney, subMoney } from '../src/common/utils/money.util.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertAppointment,
  insertPatient,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';
import { completeCheckInDetails } from './utils/check-in.js';

/**
 * Outstanding money, both ways, at the end of each day (Cairo; +03:00 in
 * October before the DST change, +02:00 from Oct 30). Doctor A: 3000 fixed
 * + 10% of each session, from October. Referring doctor R: 10% of P2's
 * payments. Physio 300.00.
 *
 *  Oct 20  I1 P1 walk-in with A (300, unpaid)        A earns 30 (October)
 *  Oct 31  October ends                                A's 3000 fixed is owed
 *  Nov 1   I1 discounted by 50 -> 250 (still unpaid)   A's session -> 25
 *  Nov 2   P1 pays 100 on I1; A paid 2000 for October (expense)
 *  Nov 3   I2 P2 (referred by R) walk-in with A, paid 300 -> R earns 30,
 *          A earns 30 (November); I3 P3 manual 150, unpaid
 *  Nov 4   A paid 500 for November (an advance: 60 earned so far);
 *          P4 buys a package (I4 900, paid) and attends a package session
 *          with A (0.00 invoice) -> A earns 10% of 900/3 = 30;
 *          I3 discounted by 30 -> 120
 *  Nov 5   P1 pays the last 150 on I1; I3 cancelled (at 120)
 *  Nov 6   R paid 30 (expense); a 100 salary payment typed by mistake, voided
 *
 * The two later discounts must never change an earlier day.
 */
const at = (value: string) => new Date(value);
const nov = (date: string, time = '10:00') =>
  at(`2026-11-${date}T${time}:00+02:00`);
const clock = { current: at('2026-10-20T09:00:00+03:00') };

type Flow = {
  patientsOwe: {
    opening: string;
    invoiced: string;
    adjustments: string;
    cancelled: string;
    payments: string;
    refunds: string;
    closing: string;
    unpaidInvoices: number;
  };
  clinicOwes: {
    opening: Totals;
    salariesEarned: string;
    salaryAdjustments: string;
    employeeSalariesEarned: string;
    commissionsEarned: string;
    salaryPayments: string;
    employeeSalaryPayments: string;
    commissionPayouts: string;
    advancesChange: string;
    closing: Totals;
  } | null;
};
type Totals = {
  owed: string;
  doctorSalaries: string;
  employeeSalaries: string;
  referralCommissions: string;
  advances: string;
  pendingCommissions: string;
};
type Summary = {
  payments: { total: string };
  refunds: { total: string };
  expenses: { total: string };
  commissionPayouts: { total: string };
  salaryPayments: { total: string };
  expectedCash: string;
  outstanding: Flow;
};

describe('Outstanding balances (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: TestUser & { doctorId: string };
  const ids: Record<string, string> = {};
  // Daily summaries fetched on the day itself (before later events).
  const live: Record<string, Summary> = {};

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Authorization', bearer(user)),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    put: (path: string, body: object) =>
      request(server)
        .put(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });
  const ok = async (res: request.Test, status = 201) =>
    (await res.expect(status)).body;
  const daily = async (date: string, by: TestUser = owner) =>
    (await as(by).get(`/billing/daily-summary?date=${date}`).expect(200))
      .body as Summary;

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
    const physio = await insertService(ctx.dataSource, {
      name: 'Physio',
      basePrice: '300.00',
    });
    await assignService(ctx.dataSource, doctorA.doctorId, physio.id);
    const p1 = await insertPatient(
      ctx.dataSource,
      'Patient One',
      '+201011111111',
    );
    const p2 = await insertPatient(
      ctx.dataSource,
      'Patient Two',
      '+201022222222',
    );
    const p3 = await insertPatient(
      ctx.dataSource,
      'Patient Three',
      '+201033333333',
    );
    const p4 = await insertPatient(
      ctx.dataSource,
      'Patient Four',
      '+201044444444',
    );
    ids.p1 = p1.id;
    ids.p3 = p3.id;

    const walkIn = async (patientId: string) => {
      await completeCheckInDetails(ctx.dataSource);
      return (await ok(
        as(receptionist).post('/visits/walk-in', {
          patientId,
          doctorId: doctorA.doctorId,
          serviceId: physio.id,
          type: 'SESSION',
        }),
      )) as { id: string; invoiceId: string };
    };
    const pay = (invoiceId: string, amount: string, method = 'CASH') =>
      ok(
        as(receptionist).post(`/invoices/${invoiceId}/payments`, {
          amount,
          method,
        }),
      );
    const discount = (invoiceId: string, value: string, reason: string) =>
      ok(
        as(receptionist).post(`/invoices/${invoiceId}/discount`, {
          type: 'FIXED',
          value,
          reason,
        }),
        200,
      );
    const paySalary = (month: string, amount: string, method = 'CASH') =>
      ok(
        as(owner).post(`/doctors/${doctorA.doctorId}/salary/payments`, {
          month,
          amount,
          method,
        }),
      );

    // ---- October ----
    await ok(
      as(owner).put(`/doctors/${doctorA.doctorId}/salary/terms`, {
        effectiveMonth: '2026-10',
        fixedSalary: '3000.00',
        commissionMode: 'PER_SESSION',
        sessionRate: { type: 'PERCENT', value: '10' },
      }),
      200,
    );
    clock.current = at('2026-10-20T10:00:00+03:00');
    const i1 = await walkIn(p1.id);
    clock.current = at('2026-10-31T20:00:00+02:00');
    live['2026-10-31'] = await daily('2026-10-31');

    // ---- Nov 1 ----
    clock.current = nov('01');
    await discount(i1.invoiceId, '50', 'Loyal');

    // ---- Nov 2 ----
    clock.current = nov('02');
    await pay(i1.invoiceId, '100.00');
    clock.current = nov('02', '11:00');
    await paySalary('2026-10', '2000.00');
    live['2026-11-02'] = await daily('2026-11-02');

    // ---- Nov 3 ----
    clock.current = nov('03');
    const r = await ok(
      as(owner).post('/referring-doctors', {
        name: 'Dr. Referrer',
        commission: { type: 'PERCENT', value: '10' },
        discount: { type: 'NONE' },
      }),
    );
    ids.referrer = r.id;
    await ok(
      as(receptionist).post(`/patients/${p2.id}/referrals`, {
        referringDoctorId: r.id,
        commission: { type: 'PERCENT', value: '10' },
        discount: { type: 'NONE' },
        applicability: { type: 'ALL_SESSIONS' },
      }),
    );
    const i2 = await walkIn(p2.id);
    await pay(i2.invoiceId, '300.00', 'CARD');
    clock.current = nov('03', '12:00');
    const i3 = await ok(
      as(receptionist).post('/invoices', {
        patientId: p3.id,
        items: [
          { description: 'Medical report', unitPrice: '150.00', quantity: 1 },
        ],
      }),
    );
    live['2026-11-03'] = await daily('2026-11-03');

    // ---- Nov 4 ----
    clock.current = nov('04');
    await paySalary('2026-11', '500.00', 'WALLET');
    const pkg = await ok(
      as(owner).post('/packages', {
        name: '3 physio',
        serviceId: physio.id,
        sessionsCount: 3,
        price: '900.00',
        allDoctors: true,
      }),
    );
    const sold = await ok(
      as(receptionist).post(`/patients/${p4.id}/packages`, {
        packageId: pkg.id,
      }),
    );
    await pay(sold.invoiceId, '900.00');
    const apt = await insertAppointment(ctx.dataSource, {
      patientId: p4.id,
      doctorId: doctorA.doctorId,
      serviceId: physio.id,
      startAt: nov('04', '11:00'),
    });
    clock.current = nov('04', '11:05');
    await completeCheckInDetails(ctx.dataSource);
    await ok(
      as(receptionist).post(`/appointments/${apt.id}/attend`, {
        patientPackageId: sold.id,
      }),
    );
    clock.current = nov('04', '12:00');
    await discount(i3.id, '30', 'Student');
    live['2026-11-04'] = await daily('2026-11-04');

    // ---- Nov 5 ----
    clock.current = nov('05');
    await pay(i1.invoiceId, '150.00');
    await ok(
      as(receptionist).post(`/invoices/${i3.id}/cancel`, {
        reason: 'Not needed',
      }),
      200,
    );

    // ---- Nov 6 (today) ----
    clock.current = nov('06');
    await ok(
      as(owner).post(`/referring-doctors/${r.id}/payouts`, {
        amount: '30.00',
        method: 'CASH',
      }),
    );
    const mistake = await paySalary('2026-10', '100.00');
    await ok(
      as(owner).post(`/doctor-salaries/payments/${mistake.id}/void`, {
        reason: 'Typed twice',
      }),
    );
    clock.current = nov('06', '18:00');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // Owed by the clinic at one moment (pending: none in this story).
  const owes = (
    doctorSalaries: string,
    referral: string,
    advances = '0.00',
  ) => ({
    owed: addMoney(doctorSalaries, referral),
    doctorSalaries,
    employeeSalaries: '0.00', // no employees in this story
    referralCommissions: referral,
    advances,
    pendingCommissions: '0.00',
  });
  const noMove = {
    salariesEarned: '0.00',
    salaryAdjustments: '0.00',
    employeeSalariesEarned: '0.00',
    commissionsEarned: '0.00',
    salaryPayments: '0.00',
    employeeSalaryPayments: '0.00',
    commissionPayouts: '0.00',
    advancesChange: '0.00',
  };

  it('shows, for each day, what was still unpaid at its end (even if paid later)', async () => {
    expect((await daily('2026-10-31')).outstanding).toEqual({
      patientsOwe: {
        // I1 at 300: the Nov 1 discount does not reach back.
        opening: '300.00',
        invoiced: '0.00',
        adjustments: '0.00',
        cancelled: '0.00',
        payments: '0.00',
        refunds: '0.00',
        closing: '300.00',
        unpaidInvoices: 1,
      },
      clinicOwes: {
        ...noMove,
        // October's session (10% of 300); the fixed salary is owed on the 31st.
        opening: owes('30.00', '0.00'),
        salariesEarned: '3000.00',
        closing: owes('3030.00', '0.00'),
      },
    });

    // The discount day: what patients owe and A's commission both drop.
    expect((await daily('2026-11-01')).outstanding).toEqual({
      patientsOwe: {
        opening: '300.00',
        invoiced: '0.00',
        adjustments: '-50.00',
        cancelled: '0.00',
        payments: '0.00',
        refunds: '0.00',
        closing: '250.00',
        unpaidInvoices: 1,
      },
      clinicOwes: {
        ...noMove,
        opening: owes('3030.00', '0.00'),
        salaryAdjustments: '-5.00', // 10% of 250 instead of 300
        closing: owes('3025.00', '0.00'),
      },
    });

    const nov2 = await daily('2026-11-02');
    expect(nov2).toMatchObject({
      payments: { total: '100.00' },
      expenses: { total: '2000.00' },
      salaryPayments: { total: '2000.00' }, // part of expenses, not added again
      expectedCash: '-1900.00',
    });
    expect(nov2.outstanding).toEqual({
      patientsOwe: {
        opening: '250.00',
        invoiced: '0.00',
        adjustments: '0.00',
        cancelled: '0.00',
        payments: '100.00',
        refunds: '0.00',
        // I1 was fully paid on Nov 5: on Nov 2, 150 was still owed.
        closing: '150.00',
        unpaidInvoices: 1,
      },
      clinicOwes: {
        ...noMove,
        opening: owes('3025.00', '0.00'),
        salaryPayments: '2000.00',
        closing: owes('1025.00', '0.00'),
      },
    });

    expect((await daily('2026-11-03')).outstanding).toEqual({
      patientsOwe: {
        opening: '150.00',
        invoiced: '450.00', // I2 300 + I3 150 (its discount came on Nov 4)
        adjustments: '0.00',
        cancelled: '0.00',
        payments: '300.00',
        refunds: '0.00',
        closing: '300.00',
        unpaidInvoices: 2,
      },
      clinicOwes: {
        ...noMove,
        opening: owes('1025.00', '0.00'),
        salariesEarned: '30.00',
        commissionsEarned: '30.00',
        // October 1025 + November 30 to A, 30 to R.
        closing: owes('1055.00', '30.00'),
      },
    });

    expect((await daily('2026-11-04')).outstanding).toEqual({
      patientsOwe: {
        opening: '300.00',
        invoiced: '900.00', // the package sale (its session's invoice is 0.00)
        adjustments: '-30.00', // I3's discount
        cancelled: '0.00',
        payments: '900.00',
        refunds: '0.00',
        closing: '270.00', // I1 150 + I3 120
        unpaidInvoices: 2,
      },
      clinicOwes: {
        ...noMove,
        opening: owes('1055.00', '30.00'),
        salariesEarned: '30.00', // the package session
        salaryPayments: '500.00',
        // 500 paid for November, 60 earned in it: 440 ahead. October's
        // 1025 is still owed: an advance never hides it.
        advancesChange: '440.00',
        closing: owes('1025.00', '30.00', '440.00'),
      },
    });

    expect((await daily('2026-11-05')).outstanding.patientsOwe).toEqual({
      opening: '270.00',
      invoiced: '0.00',
      adjustments: '0.00',
      cancelled: '120.00', // I3, at its total when cancelled
      payments: '150.00',
      refunds: '0.00',
      closing: '0.00',
      unpaidInvoices: 0,
    });

    const nov6 = await daily('2026-11-06');
    expect(nov6).toMatchObject({
      // The payout; the voided salary payment never counts.
      expenses: { total: '30.00' },
      commissionPayouts: { total: '30.00' },
      salaryPayments: { total: '0.00' },
    });
    expect(nov6.outstanding.clinicOwes).toEqual({
      ...noMove,
      opening: owes('1025.00', '30.00', '440.00'),
      commissionPayouts: '30.00',
      closing: owes('1025.00', '0.00', '440.00'),
    });
  });

  it('a past day reads the same later as on the day itself: later discounts and payments never reach back', async () => {
    expect(Object.keys(live)).toHaveLength(4);
    for (const [date, then] of Object.entries(live)) {
      expect(await daily(date)).toEqual(then);
    }
  });

  it('each day starts where the day before ended, and its movements explain the change', async () => {
    let previous: Flow | null = null;
    for (let d = 30; d <= 37; d += 1) {
      const date =
        d <= 31 ? `2026-10-${d}` : `2026-11-${String(d - 31).padStart(2, '0')}`;
      const s = await daily(date);
      const { patientsOwe: p, clinicOwes: c } = s.outstanding;
      expect(p.closing).toBe(
        addMoney(
          subMoney(
            subMoney(
              addMoney(p.opening, p.invoiced, p.adjustments),
              p.cancelled,
            ),
            p.payments,
          ),
          p.refunds,
        ),
      );
      // The day's payments and expenses are the same money.
      expect(p.payments).toBe(s.payments.total);
      expect(p.refunds).toBe(s.refunds.total);
      expect(c!.salaryPayments).toBe(s.salaryPayments.total);
      expect(c!.commissionPayouts).toBe(s.commissionPayouts.total);
      expect(c!.closing.owed).toBe(
        addMoney(
          subMoney(
            subMoney(
              subMoney(
                addMoney(
                  c!.opening.owed,
                  c!.salariesEarned,
                  c!.salaryAdjustments,
                  c!.employeeSalariesEarned,
                  c!.commissionsEarned,
                ),
                c!.salaryPayments,
              ),
              c!.employeeSalaryPayments,
            ),
            c!.commissionPayouts,
          ),
          c!.advancesChange,
        ),
      );
      if (previous) {
        expect(p.opening).toBe(previous.patientsOwe.closing);
        expect(c!.opening).toEqual(previous.clinicOwes!.closing);
      }
      previous = s.outstanding;
    }
  });

  it('receptionists see what patients owe, not what the clinic owes', async () => {
    const mine = await daily('2026-11-06', receptionist);
    const owners = await daily('2026-11-06');
    expect(mine.outstanding).toEqual({
      patientsOwe: owners.outstanding.patientsOwe,
      clinicOwes: null,
    });
  });

  describe('reports agree with the daily summary', () => {
    const RANGE = '?from=2026-11-01&to=2026-11-06';

    it('money flow over a range: opens on the day before, closes on the last day', async () => {
      const flow = await ok(as(owner).get(`/reports/money-flow${RANGE}`), 200);
      const oct31 = await daily('2026-10-31');
      const nov6 = await daily('2026-11-06');
      expect(flow).toEqual({
        from: '2026-11-01',
        to: '2026-11-06',
        patientsOwe: {
          opening: oct31.outstanding.patientsOwe.closing,
          // I2 300 + I3 150 + I4 900 + 0.00, each at its total when issued.
          invoiced: '1350.00',
          adjustments: '-80.00', // the two discounts
          cancelled: '120.00', // I3
          payments: '1450.00',
          refunds: '0.00',
          closing: nov6.outstanding.patientsOwe.closing,
          unpaidInvoices: 0,
        },
        clinicOwes: {
          opening: oct31.outstanding.clinicOwes!.closing,
          salariesEarned: '60.00',
          salaryAdjustments: '-5.00',
          employeeSalariesEarned: '0.00',
          commissionsEarned: '30.00',
          salaryPayments: '2500.00',
          employeeSalaryPayments: '0.00',
          commissionPayouts: '30.00',
          advancesChange: '440.00',
          closing: nov6.outstanding.clinicOwes!.closing,
        },
      });

      const report = await ok(as(owner).get(`/reports/summary${RANGE}`), 200);
      expect(report).toMatchObject({
        collected: '1450.00',
        expenses: '2530.00',
        salaryPayments: '2500.00',
        commissionPayouts: '30.00',
        patientsOwe: '0.00',
        clinicOwes: '1025.00',
      });
    });

    it('clinic owes: each doctor-month and referring doctor, as of a day', async () => {
      const nov4 = await ok(
        as(owner).get('/reports/clinic-owes?asOf=2026-11-04'),
        200,
      );
      const doctor = { id: doctorA.doctorId, name: expect.any(String) };
      expect(nov4).toEqual({
        asOf: '2026-11-04',
        owed: '1055.00',
        advances: '440.00',
        doctorSalaries: {
          owed: '1025.00',
          advances: '440.00',
          rows: [
            {
              doctor,
              month: '2026-10',
              fixedSalary: '3000.00',
              fixedDue: true,
              sessionCount: 1,
              commissions: '25.00', // 10% of 250 (discounted on Nov 1)
              earned: '3025.00',
              paid: '2000.00',
              balance: '1025.00',
            },
            {
              doctor,
              month: '2026-11',
              fixedSalary: '0.00',
              fixedDue: false,
              sessionCount: 2,
              commissions: '60.00', // 10% of 300 and of 900 / 3
              earned: '60.00',
              paid: '500.00',
              balance: '-440.00',
            },
          ],
        },
        employeeSalaries: { owed: '0.00', advances: '0.00', rows: [] },
        referralCommissions: {
          owed: '30.00',
          advances: '0.00',
          pending: '0.00',
          rows: [
            {
              referringDoctor: { id: ids.referrer, name: 'Dr. Referrer' },
              earned: '30.00',
              paid: '0.00',
              balance: '30.00',
              pending: '0.00',
            },
          ],
        },
      });
      // The daily summary's figure is this report's total.
      expect(
        (await daily('2026-11-04')).outstanding.clinicOwes!.closing.owed,
      ).toBe(nov4.owed);

      // Before the discount, the session was worth 10% of 300.
      const oct31 = await ok(
        as(owner).get('/reports/clinic-owes?asOf=2026-10-31'),
        200,
      );
      expect(oct31).toMatchObject({
        owed: '3030.00',
        doctorSalaries: {
          rows: [
            { month: '2026-10', commissions: '30.00', balance: '3030.00' },
          ],
        },
      });

      // Paid out: R no longer listed; the voided 100 never counted.
      const nov6 = await ok(
        as(owner).get('/reports/clinic-owes?asOf=2026-11-06'),
        200,
      );
      expect(nov6.referralCommissions.rows).toEqual([]);
      expect(nov6.doctorSalaries.rows[0]).toMatchObject({
        month: '2026-10',
        paid: '2000.00',
        balance: '1025.00',
      });
    });

    it('a month’s salary balance matches its statement once the month has ended', async () => {
      for (const [month, asOf] of [
        ['2026-10', '2026-11-06'],
        ['2026-11', '2026-11-30'],
      ]) {
        const statement = await ok(
          as(owner).get(
            `/doctors/${doctorA.doctorId}/salary/statement?month=${month}`,
          ),
          200,
        );
        const owesReport = await ok(
          as(owner).get(`/reports/clinic-owes?asOf=${asOf}`),
          200,
        );
        const row = owesReport.doctorSalaries.rows.find(
          (r: { month: string }) => r.month === month,
        );
        expect(row).toMatchObject({
          fixedSalary: statement.fixedSalary,
          sessionCount: statement.sessionCount,
          commissions: statement.commissionTotal,
          earned: statement.earned,
          paid: statement.paid,
          balance: statement.remaining,
        });
      }
    });

    it('patients owe: the invoices still unpaid at the end of a day, at their totals then', async () => {
      const oct31 = await ok(
        as(owner).get('/reports/patients-owe?asOf=2026-10-31'),
        200,
      );
      expect(oct31).toMatchObject({
        totalBalance: '300.00', // = the Oct 31 daily summary
        items: [
          {
            patient: { id: ids.p1 },
            invoices: [{ total: '300.00', paid: '0.00', balance: '300.00' }],
          },
        ],
      });
      const nov3 = await ok(
        as(owner).get('/reports/patients-owe?asOf=2026-11-03'),
        200,
      );
      expect(nov3).toMatchObject({
        asOf: '2026-11-03',
        totalBalance: '300.00', // = the Nov 3 daily summary
        unpaidInvoices: 2,
        items: [
          {
            patient: { id: ids.p1 },
            balance: '150.00',
            oldestUnpaidInvoiceDate: '2026-10-20',
            invoices: [{ total: '250.00', paid: '100.00', balance: '150.00' }],
          },
          {
            patient: { id: ids.p3 },
            balance: '150.00', // discounted only on Nov 4
            invoices: [{ total: '150.00', paid: '0.00', balance: '150.00' }],
          },
        ],
      });
      const nov4 = await ok(
        as(owner).get('/reports/patients-owe?asOf=2026-11-04'),
        200,
      );
      expect(nov4).toMatchObject({
        totalBalance: '270.00',
        items: [
          { patient: { id: ids.p1 }, balance: '150.00' },
          {
            patient: { id: ids.p3 },
            invoices: [{ total: '120.00', balance: '120.00' }],
          },
        ],
      });
      const now = await ok(
        as(owner).get('/reports/patients-owe?asOf=2026-11-06'),
        200,
      );
      expect(now).toMatchObject({ totalBalance: '0.00', items: [] });
    });

    it('transactions: every payment and expense, with what each expense pays for', async () => {
      const list = await ok(
        as(owner).get('/reports/transactions?from=2026-11-02&to=2026-11-06'),
        200,
      );
      expect(list.totals).toEqual({
        payments: { count: 4, total: '1450.00' },
        refunds: { count: 0, total: '0.00' },
        expenses: { count: 3, total: '2530.00' },
        salaryPayments: { count: 2, total: '2500.00' },
        employeeSalaryPayments: { count: 0, total: '0.00' },
        commissionPayouts: { count: 1, total: '30.00' },
        net: '-1080.00',
      });
      const expenses = await ok(
        as(owner).get(
          '/reports/transactions?from=2026-11-02&to=2026-11-06&kind=EXPENSE',
        ),
        200,
      );
      expect(
        expenses.items.map(
          (t: {
            date: string;
            expenseOrigin: string;
            amount: string;
            payee: string;
          }) => [t.date, t.expenseOrigin, t.amount, t.payee],
        ),
      ).toEqual([
        ['2026-11-06', 'REFERRAL_PAYOUT', '30.00', 'Dr. Referrer'],
        ['2026-11-04', 'DOCTOR_SALARY', '500.00', expect.any(String)],
        ['2026-11-02', 'DOCTOR_SALARY', '2000.00', expect.any(String)],
      ]);
    });

    it('validates the dates', async () => {
      await as(owner).get('/reports/clinic-owes').expect(400);
      await as(owner).get('/reports/patients-owe?asOf=2026-13-01').expect(400);
      await as(owner)
        .get('/reports/money-flow?from=2026-11-06&to=2026-11-01')
        .expect(400);
    });
  });
});
