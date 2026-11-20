import { addDays } from '../../common/time/clinic-time.util.js';
import { addMoney, subMoney, ZERO } from '../../common/utils/money.util.js';
import {
  SalaryCommissionMode,
  SalaryRateType,
} from '../salaries/salaries.enums.js';
import {
  fixedSalaryOf,
  nextMonth,
  salaryBalances,
  salaryEarnedBetween,
  sessionCommission,
  splitBalances,
  type SalaryDoctor,
  type SalaryPaymentRow,
  type SessionGroup,
  type SalaryTermsVersion,
} from './outstanding-math.js';

const PHYSIO = 'physio';
const CONSULT = 'consult';

const terms = (over: Partial<SalaryTermsVersion>): SalaryTermsVersion => ({
  effectiveMonth: '2026-09',
  fixedSalary: '3000.00',
  commissionMode: SalaryCommissionMode.PER_SESSION,
  sessionRateType: SalaryRateType.PERCENT,
  sessionRateValue: '10.00',
  serviceRates: [],
  ...over,
});

// 3000 fixed + 10% per session from September; from November 4000 fixed +
// 50 per Physio session only.
const doctor: SalaryDoctor = {
  id: 'd1',
  deletedOn: null,
  terms: [
    terms({}),
    terms({
      effectiveMonth: '2026-11',
      fixedSalary: '4000.00',
      commissionMode: SalaryCommissionMode.PER_SERVICE,
      sessionRateType: null,
      sessionRateValue: null,
      serviceRates: [
        { serviceId: PHYSIO, rateType: SalaryRateType.FIXED, value: '50.00' },
      ],
    }),
  ],
};

const group = (over: Partial<SessionGroup>): SessionGroup => ({
  doctorId: 'd1',
  serviceId: PHYSIO,
  date: '2026-10-10',
  invoiceTotal: '300.00',
  packagePrice: null,
  packageSessions: null,
  sessions: 1,
  ...over,
});

const pay = (
  month: string,
  amount: string,
  paymentDate: string,
): SalaryPaymentRow => ({ doctorId: 'd1', month, amount, paymentDate });

describe('outstanding math', () => {
  it('nextMonth rolls over the year', () => {
    expect(nextMonth('2026-11')).toBe('2026-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('fixedSalaryOf: the terms of the month; none before them or after deletion', () => {
    expect(fixedSalaryOf(doctor, '2026-08')).toBe(ZERO);
    expect(fixedSalaryOf(doctor, '2026-10')).toBe('3000.00');
    expect(fixedSalaryOf(doctor, '2026-12')).toBe('4000.00');
    const deleted = { ...doctor, deletedOn: '2026-10-15' };
    expect(fixedSalaryOf(deleted, '2026-10')).toBe('3000.00');
    expect(fixedSalaryOf(deleted, '2026-11')).toBe(ZERO);
  });

  it('sessionCommission: package value first, else the invoice; times the sessions', () => {
    // October: 10% of 300, three sessions.
    expect(sessionCommission(doctor, group({ sessions: 3 }))).toBe('90.00');
    // A package session: 10% of 1000 / 3 = 333.33 -> 33.33 each.
    expect(
      sessionCommission(
        doctor,
        group({ packagePrice: '1000.00', packageSessions: 3, sessions: 2 }),
      ),
    ).toBe('66.66');
    // No invoice and no package: nothing to take a percentage of.
    expect(sessionCommission(doctor, group({ invoiceTotal: null }))).toBe(ZERO);
    // November terms: 50 per Physio, nothing for Consultation.
    expect(sessionCommission(doctor, group({ date: '2026-11-02' }))).toBe(
      '50.00',
    );
    expect(
      sessionCommission(
        doctor,
        group({ date: '2026-11-02', serviceId: CONSULT }),
      ),
    ).toBe(ZERO);
  });

  describe('salaryBalances', () => {
    const sessions = [
      group({ date: '2026-10-10', sessions: 2 }), // 60
      group({ date: '2026-10-31', sessions: 1 }), // 30
      group({ date: '2026-11-05', sessions: 3 }), // 150
    ];

    it('the fixed salary is owed on the last day of its month, commissions from the session day', () => {
      const oct30 = salaryBalances(doctor, sessions, [], '2026-10-30');
      expect(oct30.map((l) => [l.month, l.fixedDue, l.balance])).toEqual([
        ['2026-09', true, '3000.00'],
        ['2026-10', false, '60.00'],
      ]);
      const oct31 = salaryBalances(doctor, sessions, [], '2026-10-31');
      expect(oct31[1]).toMatchObject({
        month: '2026-10',
        fixedSalary: '3000.00',
        fixedDue: true,
        sessionCount: 3,
        commissions: '90.00',
        earned: '3090.00',
        balance: '3090.00',
      });
    });

    it('a payment counts from its date, even when recorded for a later month (advance)', () => {
      const payments = [
        pay('2026-09', '3000.00', '2026-10-01'),
        pay('2026-10', '1000.00', '2026-10-20'), // part of October, early
        pay('2026-11', '500.00', '2026-10-25'), // November advance
        pay('2026-10', '2090.00', '2026-11-02'), // the rest of October
      ];
      const oct25 = salaryBalances(doctor, sessions, payments, '2026-10-25');
      expect(oct25.map((l) => [l.month, l.paid, l.balance])).toEqual([
        ['2026-09', '3000.00', '0.00'],
        // 60 earned so far (fixed not due yet), 1000 paid.
        ['2026-10', '1000.00', '-940.00'],
        ['2026-11', '500.00', '-500.00'],
      ]);
      expect(splitBalances(oct25.map((l) => l.balance))).toEqual({
        owed: ZERO,
        advances: '1440.00',
      });

      const nov2 = salaryBalances(doctor, sessions, payments, '2026-11-02');
      expect(nov2.map((l) => [l.month, l.balance])).toEqual([
        ['2026-09', '0.00'],
        ['2026-10', '0.00'],
        ['2026-11', '-500.00'],
      ]);
      const nov30 = salaryBalances(doctor, sessions, payments, '2026-11-30');
      // 4000 + 150 earned, 500 paid in advance.
      expect(nov30.at(-1)).toMatchObject({
        earned: '4150.00',
        balance: '3650.00',
      });
    });

    it('ignores other doctors', () => {
      const other = group({ doctorId: 'd2', sessions: 10 });
      const lines = salaryBalances(
        doctor,
        [other],
        [{ ...pay('2026-10', '99.00', '2026-10-01'), doctorId: 'd2' }],
        '2026-10-20',
      );
      expect(lines.map((l) => l.month)).toEqual(['2026-09']);
    });

    it('a doctor without terms earns nothing: sessions are counted, a payment is an advance', () => {
      const noTerms: SalaryDoctor = { id: 'd1', deletedOn: null, terms: [] };
      const lines = salaryBalances(
        noTerms,
        [group({ date: '2026-11-03', sessions: 2 })],
        [pay('2026-11', '200.00', '2026-11-04')],
        '2026-11-30',
      );
      expect(lines).toEqual([
        {
          doctorId: 'd1',
          month: '2026-11',
          fixedSalary: ZERO,
          fixedDue: true,
          sessionCount: 2,
          commissions: ZERO,
          earned: ZERO,
          paid: '200.00',
          balance: '-200.00',
        },
      ]);
    });
  });

  it('balances move by exactly what is earned minus what is paid in between', () => {
    const sessions = [
      group({ date: '2026-09-30', sessions: 4 }),
      group({ date: '2026-10-01', sessions: 1 }),
      group({
        date: '2026-10-31',
        sessions: 2,
        packagePrice: '900.00',
        packageSessions: 9,
      }),
      group({ date: '2026-11-01', sessions: 5 }),
      group({ date: '2026-11-30', sessions: 1, serviceId: CONSULT }),
    ];
    const payments = [
      pay('2026-09', '1000.00', '2026-09-15'),
      pay('2026-09', '2120.00', '2026-10-03'),
      pay('2026-12', '700.00', '2026-11-20'),
    ];
    const net = (asOf: string) =>
      addMoney(
        ZERO,
        ...salaryBalances(doctor, sessions, payments, asOf).map(
          (l) => l.balance,
        ),
      );
    const paidBetween = (from: string, to: string) =>
      addMoney(
        ZERO,
        ...payments
          .filter((p) => p.paymentDate >= from && p.paymentDate <= to)
          .map((p) => p.amount),
      );
    for (const [from, to] of [
      ['2026-09-30', '2026-09-30'],
      ['2026-10-01', '2026-10-31'],
      ['2026-10-15', '2026-11-30'],
      ['2026-09-01', '2026-12-31'],
    ]) {
      const moved = subMoney(net(to), net(addDays(from, -1)));
      expect(moved).toBe(
        subMoney(
          salaryEarnedBetween(doctor, sessions, from, to),
          paidBetween(from, to),
        ),
      );
    }
  });

  it('splitBalances keeps advances apart from what is owed', () => {
    expect(splitBalances(['100.00', '-30.00', '0.00', '25.50'])).toEqual({
      owed: '125.50',
      advances: '30.00',
    });
    expect(splitBalances([])).toEqual({ owed: ZERO, advances: ZERO });
  });
});
