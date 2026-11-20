// Pure rules of what the clinic owes its doctors (no database). Money as
// decimal strings; dates are clinic local dates ('YYYY-MM-DD'), and "as of
// D" means at the end of that local day.
import {
  addMoney,
  dec,
  isPositiveMoney,
  isZeroMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import {
  commissionOf,
  monthDates,
  packageSessionValue,
  rateFor,
  termsForMonth,
  type TermsLike,
} from '../salaries/salary-math.js';

export interface SalaryTermsVersion extends TermsLike {
  fixedSalary: string;
}

export interface SalaryDoctor {
  id: string;
  // Local date the doctor was deleted (null = not deleted). Like the
  // salaries overview, a month that starts after it has no fixed salary.
  deletedOn: string | null;
  terms: SalaryTermsVersion[];
}

// Attended (ACTIVE) sessions of one doctor, service, local day and value.
export interface SessionGroup {
  doctorId: string;
  serviceId: string;
  date: string;
  // The visit's live invoice total (null: none).
  invoiceTotal: string | null;
  // The package sale behind a package session (null: not a package session).
  packagePrice: string | null;
  packageSessions: number | null;
  sessions: number;
}

// A valid salary payment.
export interface SalaryPaymentRow {
  doctorId: string;
  // 'YYYY-MM' the payment is for.
  month: string;
  amount: string;
  paymentDate: string;
}

// One doctor-month as of a day: what was earned by then minus what was paid.
export interface SalaryBalanceLine {
  doctorId: string;
  month: string;
  // The month's fixed salary once its last day is reached, else 0.00.
  fixedSalary: string;
  fixedDue: boolean;
  sessionCount: number;
  commissions: string;
  earned: string;
  paid: string;
  // > 0: owed. < 0: paid in advance of what was earned.
  balance: string;
}

const monthOf = (date: string) => date.slice(0, 7);

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * The fixed salary of `month` under the terms in effect then; 0.00 without
 * terms, or when the doctor was deleted before the month started.
 */
export function fixedSalaryOf(doctor: SalaryDoctor, month: string): string {
  if (doctor.deletedOn !== null && doctor.deletedOn < monthDates(month).first)
    return ZERO;
  const terms = termsForMonth(doctor.terms, month);
  return terms ? toMoney(terms.fixedSalary) : ZERO;
}

/**
 * What a group of sessions earns: each session's commission (the salary
 * statement's rule: the package price / sessions for a package session,
 * else the live invoice total) times the number of sessions.
 */
export function sessionCommission(
  doctor: SalaryDoctor,
  group: SessionGroup,
): string {
  const terms = termsForMonth(doctor.terms, monthOf(group.date));
  const rate = rateFor(terms, group.serviceId);
  let value = ZERO;
  if (group.packagePrice !== null && group.packageSessions !== null) {
    value = packageSessionValue(group.packagePrice, group.packageSessions);
  } else if (group.invoiceTotal !== null) {
    value = toMoney(group.invoiceTotal);
  }
  return toMoney(dec(commissionOf(rate, value)).times(group.sessions));
}

/**
 * Every doctor-month with something earned or paid by the end of `asOf`:
 * fixed salaries whose month ended by then (due on the month's last day),
 * commissions of sessions attended by then, and valid payments dated by
 * then (a payment for a later month is an advance). Ordered by month.
 */
export function salaryBalances(
  doctor: SalaryDoctor,
  sessions: SessionGroup[],
  payments: SalaryPaymentRow[],
  asOf: string,
): SalaryBalanceLine[] {
  const lines = new Map<string, SalaryBalanceLine>();
  const line = (month: string) => {
    let found = lines.get(month);
    if (!found) {
      found = {
        doctorId: doctor.id,
        month,
        fixedSalary: ZERO,
        fixedDue: monthDates(month).last <= asOf,
        sessionCount: 0,
        commissions: ZERO,
        earned: ZERO,
        paid: ZERO,
        balance: ZERO,
      };
      lines.set(month, found);
    }
    return found;
  };

  const first = doctor.terms.reduce<string | null>(
    (min, t) =>
      min === null || t.effectiveMonth < min ? t.effectiveMonth : min,
    null,
  );
  if (first !== null) {
    for (let m = first; monthDates(m).last <= asOf; m = nextMonth(m)) {
      const fixed = fixedSalaryOf(doctor, m);
      if (isPositiveMoney(fixed)) line(m).fixedSalary = fixed;
    }
  }
  for (const group of sessions) {
    if (group.doctorId !== doctor.id || group.date > asOf) continue;
    const l = line(monthOf(group.date));
    l.sessionCount += group.sessions;
    l.commissions = addMoney(l.commissions, sessionCommission(doctor, group));
  }
  for (const payment of payments) {
    if (payment.doctorId !== doctor.id || payment.paymentDate > asOf) continue;
    const l = line(payment.month);
    l.paid = addMoney(l.paid, payment.amount);
  }

  return [...lines.values()]
    .map((l) => {
      const earned = addMoney(l.fixedSalary, l.commissions);
      return { ...l, earned, balance: subMoney(earned, l.paid) };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** The commissions of the doctor's sessions attended up to `asOf`. */
export function commissionsThrough(
  doctor: SalaryDoctor,
  sessions: SessionGroup[],
  asOf: string,
): string {
  let total = ZERO;
  for (const group of sessions) {
    if (group.doctorId !== doctor.id || group.date > asOf) continue;
    total = addMoney(total, sessionCommission(doctor, group));
  }
  return total;
}

/**
 * Earned from `from` to `to` (inclusive): the fixed salaries falling due in
 * the range (their month's last day is in it) and the commissions of the
 * sessions attended in it. With the same session values at both ends,
 * balances move by exactly this minus the payments dated in the range.
 */
export function salaryEarnedBetween(
  doctor: SalaryDoctor,
  sessions: SessionGroup[],
  from: string,
  to: string,
): string {
  let earned = ZERO;
  for (let m = monthOf(from); m <= monthOf(to); m = nextMonth(m)) {
    const { last } = monthDates(m);
    if (last >= from && last <= to) {
      earned = addMoney(earned, fixedSalaryOf(doctor, m));
    }
  }
  for (const group of sessions) {
    if (group.doctorId !== doctor.id) continue;
    if (group.date < from || group.date > to) continue;
    earned = addMoney(earned, sessionCommission(doctor, group));
  }
  return earned;
}

/**
 * Splits signed balances: `owed` adds the positive ones (what is owed), and
 * `advances` the negative ones as a positive amount (paid ahead). One
 * party's advance never hides what is owed to another.
 */
export function splitBalances(balances: string[]): {
  owed: string;
  advances: string;
} {
  let owed = ZERO;
  let advances = ZERO;
  for (const b of balances) {
    if (isZeroMoney(b)) continue;
    if (isPositiveMoney(b)) owed = addMoney(owed, b);
    else advances = subMoney(advances, b);
  }
  return { owed, advances };
}
