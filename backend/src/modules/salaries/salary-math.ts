// Pure salary rules (no database): which terms apply to a month, which rate a
// session gets, and what it earns. Money as decimal strings throughout.
import { addDays } from '../../common/time/clinic-time.util.js';
import {
  dec,
  percentOf,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { SalaryCommissionMode, SalaryRateType } from './salaries.enums.js';

export interface Rate {
  type: SalaryRateType;
  value: string;
}

export interface TermsLike {
  effectiveMonth: string;
  commissionMode: SalaryCommissionMode;
  sessionRateType: SalaryRateType | null;
  sessionRateValue: string | null;
  serviceRates?: {
    serviceId: string;
    rateType: SalaryRateType;
    value: string;
  }[];
}

/** 'YYYY-MM' -> its first and last clinic local dates. */
export function monthDates(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const next =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { first, last: addDays(next, -1) };
}

/** The version in effect in `month`: the latest one starting on or before it. */
export function termsForMonth<T extends { effectiveMonth: string }>(
  versions: T[],
  month: string,
): T | null {
  let found: T | null = null;
  for (const v of versions) {
    if (
      v.effectiveMonth <= month &&
      (!found || v.effectiveMonth > found.effectiveMonth)
    ) {
      found = v;
    }
  }
  return found;
}

/** The rate a session of `serviceId` gets under `terms`; null = no commission. */
export function rateFor(
  terms: TermsLike | null,
  serviceId: string,
): Rate | null {
  if (!terms) return null;
  switch (terms.commissionMode) {
    case SalaryCommissionMode.PER_SESSION:
      return terms.sessionRateType && terms.sessionRateValue !== null
        ? {
            type: terms.sessionRateType,
            value: toMoney(terms.sessionRateValue),
          }
        : null;
    case SalaryCommissionMode.PER_SERVICE: {
      const rate = terms.serviceRates?.find((r) => r.serviceId === serviceId);
      return rate ? { type: rate.rateType, value: toMoney(rate.value) } : null;
    }
    default:
      return null;
  }
}

/** What a session earns: the fixed amount, or the percentage of its value. */
export function commissionOf(rate: Rate | null, sessionValue: string): string {
  if (!rate) return ZERO;
  return rate.type === SalaryRateType.FIXED
    ? toMoney(rate.value)
    : percentOf(sessionValue, rate.value);
}

/** One package session's value: the price paid / its sessions (2 decimals). */
export function packageSessionValue(
  price: string,
  totalSessions: number,
): string {
  return totalSessions > 0
    ? toMoney(dec(price).dividedBy(totalSessions))
    : ZERO;
}
