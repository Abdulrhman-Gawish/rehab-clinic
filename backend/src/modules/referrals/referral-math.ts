import { BadRequestException } from '@nestjs/common';
import {
  addMoney,
  compareMoney,
  dec,
  isZeroMoney,
  percentOf,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { DiscountType } from '../billing/billing.enums.js';
import { ReferralApplicability, ReferralRateType } from './referrals.enums.js';

// Pure referral arithmetic and rules: no I/O, unit tested.

export interface RateRule {
  type: ReferralRateType;
  // null for NONE. PERCENT: 10.00 = 10%. FIXED: EGP.
  value: string | null;
}

export interface Applicability {
  applicability: ReferralApplicability;
  maxSessions: number | null;
  validFrom: string | null;
  validTo: string | null;
}

export const NO_RATE: RateRule = { type: ReferralRateType.NONE, value: null };

function invalid(field: string, message: string, constraint: string): never {
  throw new BadRequestException({
    message: 'Validation failed',
    details: [{ field, errors: [message], constraints: [constraint] }],
  });
}

/**
 * A rate as stored: NONE without a value, PERCENT in (0, 100], FIXED > 0
 * (the DTO already checked that a value is a positive money string).
 */
export function normalizeRate(
  field: string,
  type: ReferralRateType,
  value: string | null | undefined,
): RateRule {
  if (type === ReferralRateType.NONE) {
    if (value !== undefined && value !== null) {
      invalid(`${field}.value`, 'NONE takes no value', 'isEmpty');
    }
    return NO_RATE;
  }
  if (value === undefined || value === null) {
    invalid(`${field}.value`, 'A value is required', 'isNotEmpty');
  }
  if (type === ReferralRateType.PERCENT && dec(value).greaterThan(100)) {
    invalid(`${field}.value`, 'A percentage is at most 100', 'max');
  }
  return { type, value: toMoney(value) };
}

/**
 * Applicability as stored: only the fields its type uses, and a date range
 * whose end is not before its start.
 */
export function normalizeApplicability(input: {
  type: ReferralApplicability;
  maxSessions?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
}): Applicability {
  const out: Applicability = {
    applicability: input.type,
    maxSessions: null,
    validFrom: null,
    validTo: null,
  };
  const unused = (name: 'maxSessions' | 'validFrom' | 'validTo') => {
    if (input[name] !== undefined && input[name] !== null) {
      invalid(
        `applicability.${name}`,
        `${name} is not used by ${input.type}`,
        'isEmpty',
      );
    }
  };
  switch (input.type) {
    case ReferralApplicability.FIRST_SESSION:
    case ReferralApplicability.ALL_SESSIONS:
      unused('maxSessions');
      unused('validFrom');
      unused('validTo');
      return out;
    case ReferralApplicability.SESSION_COUNT:
      unused('validFrom');
      unused('validTo');
      if (!input.maxSessions) {
        invalid(
          'applicability.maxSessions',
          'maxSessions is required',
          'isNotEmpty',
        );
      }
      return { ...out, maxSessions: input.maxSessions };
    case ReferralApplicability.DATE_RANGE:
      unused('maxSessions');
      if (!input.validFrom || !input.validTo) {
        invalid(
          'applicability.validTo',
          'validFrom and validTo are required',
          'isNotEmpty',
        );
      }
      if (input.validFrom > input.validTo) {
        invalid(
          'applicability.validTo',
          'validTo must not be before validFrom',
          'endAfterStart',
        );
      }
      return { ...out, validFrom: input.validFrom, validTo: input.validTo };
  }
}

export function sameRate(a: RateRule, b: RateRule): boolean {
  if (a.type !== b.type) return false;
  if (a.value === null || b.value === null) return a.value === b.value;
  return compareMoney(a.value, b.value) === 0;
}

// The applied commission or discount differs from the doctor's default.
export function isOverride(
  applied: { commission: RateRule; discount: RateRule },
  defaults: { commission: RateRule; discount: RateRule },
): boolean {
  return (
    !sameRate(applied.commission, defaults.commission) ||
    !sameRate(applied.discount, defaults.discount)
  );
}

/**
 * The doctor's agreement in force on `today`: the highest version whose
 * effective date has come. Versions never go back in time (enforced when a
 * version is added), so the highest version in effect is the latest one.
 */
export function currentAgreement<
  T extends { version: number; effectiveFrom: string },
>(versions: T[], today: string): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > today) continue;
    if (!best || v.version > best.version) best = v;
  }
  return best;
}

/**
 * Whether the terms cover one more session, given how many sessions they
 * (all versions of the same referral) already cover and the session's
 * clinic local date.
 */
export function coversSession(
  terms: Applicability,
  coveredSoFar: number,
  sessionDate: string,
): boolean {
  switch (terms.applicability) {
    case ReferralApplicability.FIRST_SESSION:
      return coveredSoFar === 0;
    case ReferralApplicability.ALL_SESSIONS:
      return true;
    case ReferralApplicability.SESSION_COUNT:
      return coveredSoFar < (terms.maxSessions ?? 0);
    case ReferralApplicability.DATE_RANGE:
      return (
        terms.validFrom !== null &&
        terms.validTo !== null &&
        terms.validFrom <= sessionDate &&
        sessionDate <= terms.validTo
      );
  }
}

/**
 * The invoice discount the terms give on a subtotal: the percentage, or the
 * fixed amount capped at the subtotal (a discount never exceeds what is
 * billed). null when there is nothing to discount.
 */
export function referralDiscountRule(
  rule: RateRule,
  subtotal: string,
): { type: DiscountType; value: string } | null {
  if (rule.type === ReferralRateType.NONE || rule.value === null) return null;
  if (isZeroMoney(subtotal)) return null;
  if (rule.type === ReferralRateType.PERCENT) {
    return { type: DiscountType.PERCENT, value: rule.value };
  }
  const value = compareMoney(rule.value, subtotal) > 0 ? subtotal : rule.value;
  return { type: DiscountType.FIXED, value: toMoney(value) };
}

/**
 * What the invoice's commission rows must add up to, given the money
 * actually kept from the patient (valid payments - valid refunds):
 * - PERCENT: rate% of it;
 * - FIXED: the fixed amount for the session, in proportion to the part of
 *   the invoice total collected (all of it once fully paid).
 * Computed on the cumulative amount, so partial payments and refunds never
 * leave a rounding residue (a full refund brings it back to 0.00 exactly).
 */
export function commissionTarget(
  rule: RateRule,
  netCollected: string,
  invoiceTotal: string,
): string {
  if (rule.type === ReferralRateType.NONE || rule.value === null) return ZERO;
  if (rule.type === ReferralRateType.PERCENT) {
    return percentOf(netCollected, rule.value);
  }
  if (isZeroMoney(invoiceTotal)) return ZERO;
  const collected =
    compareMoney(netCollected, invoiceTotal) > 0 ? invoiceTotal : netCollected;
  return toMoney(
    dec(rule.value).times(dec(collected)).dividedBy(dec(invoiceTotal)),
  );
}

// The new ledger row for an event: target after the event - rows so far.
export function commissionDelta(
  rule: RateRule,
  netCollected: string,
  invoiceTotal: string,
  recordedSoFar: string,
): string {
  return subMoney(
    commissionTarget(rule, netCollected, invoiceTotal),
    recordedSoFar,
  );
}

// A commission row not yet fully settled by valid payouts.
export interface OpenCommission {
  id: string;
  // amount - what valid payouts already settled; never 0.
  remaining: string;
}

export interface PayoutAllocation {
  commissionId: string;
  amount: string;
}

/**
 * What a payout of `amount` settles. Money the doctor owes back (negative
 * rows) is deducted first, then the positive rows are paid in the given
 * order (oldest first), the last one possibly in part. The allocations add
 * up to `amount`, which must be > 0 and at most the outstanding total.
 */
export function allocatePayout(
  open: OpenCommission[],
  amount: string,
): PayoutAllocation[] {
  const negative = open.filter((row) => compareMoney(row.remaining, ZERO) < 0);
  const allocations: PayoutAllocation[] = negative.map((row) => ({
    commissionId: row.id,
    amount: toMoney(row.remaining),
  }));
  // The owed-back money raises what the positive rows must cover.
  let left = subMoney(
    amount,
    addMoney(ZERO, ...negative.map((r) => r.remaining)),
  );
  for (const row of open) {
    if (compareMoney(left, ZERO) <= 0) break;
    if (compareMoney(row.remaining, ZERO) <= 0) continue;
    const part =
      compareMoney(row.remaining, left) < 0 ? toMoney(row.remaining) : left;
    allocations.push({ commissionId: row.id, amount: part });
    left = subMoney(left, part);
  }
  if (!isZeroMoney(left)) {
    throw new Error(`Payout ${amount} exceeds the outstanding commission`);
  }
  return allocations;
}
