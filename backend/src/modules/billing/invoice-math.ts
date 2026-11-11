import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import {
  addMoney,
  compareMoney,
  isZeroMoney,
  lineTotal,
  percentOf,
  subMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { PatientReferralStatus } from '../referrals/referrals.enums.js';
import { VisitStatus } from '../visits/visit.enums.js';
import {
  DiscountType,
  InvoiceStatus,
  ReplacementAction,
  ReplacementBlocker,
} from './billing.enums.js';

// Pure invoice arithmetic. All totals are computed here, server-side.

export interface PricedLine {
  unitPrice: string;
  quantity: number;
}

export interface DiscountRule {
  type: DiscountType;
  // PERCENT: 20 = 20%. FIXED: EGP amount.
  value: string;
}

export interface InvoiceTotals {
  subtotal: string;
  discountTotal: string;
  total: string;
}

export function discountAmount(subtotal: string, rule: DiscountRule): string {
  const amount =
    rule.type === DiscountType.PERCENT
      ? percentOf(subtotal, rule.value)
      : addMoney(rule.value);
  if (compareMoney(amount, subtotal) > 0) {
    throw unprocessable(
      ErrorCode.DISCOUNT_EXCEEDS_SUBTOTAL,
      'The discount cannot exceed the invoice subtotal',
      { subtotal, discount: amount },
    );
  }
  return amount;
}

export function computeTotals(
  lines: PricedLine[],
  discount: DiscountRule | null,
): InvoiceTotals {
  const subtotal = addMoney(
    ...lines.map((line) => lineTotal(line.unitPrice, line.quantity)),
  );
  const discountTotal = discount ? discountAmount(subtotal, discount) : ZERO;
  return { subtotal, discountTotal, total: subMoney(subtotal, discountTotal) };
}

/**
 * Status is derived from the amounts. An invoice with nothing left to pay
 * (including a 0.00 total) is PAID.
 */
export function deriveInvoiceStatus(
  total: string,
  amountPaid: string,
): InvoiceStatus {
  if (compareMoney(amountPaid, total) >= 0) return InvoiceStatus.PAID;
  return isZeroMoney(amountPaid)
    ? InvoiceStatus.ISSUED
    : InvoiceStatus.PARTIALLY_PAID;
}

// Items and discount change only while nothing is paid and not cancelled.
export function assertEditable(invoice: {
  status: InvoiceStatus;
  amountPaid: string;
}): void {
  if (invoice.status === InvoiceStatus.CANCELLED) {
    throw unprocessable(ErrorCode.INVOICE_LOCKED, 'The invoice is cancelled');
  }
  if (!isZeroMoney(invoice.amountPaid)) {
    throw unprocessable(
      ErrorCode.INVOICE_LOCKED,
      'The invoice has payments; items and discount can no longer change',
    );
  }
}

export type ReplacementOption =
  | { action: ReplacementAction; blockedBy: null }
  | { action: null; blockedBy: ReplacementBlocker };

/**
 * The one rule for replacing a session invoice (a new invoice of the same
 * visit, linked to it, with the current referral). Each invoice is
 * replaced at most once.
 * - REISSUE: it is cancelled and its visit is still attended (the visit has
 *   no live invoice then: a cancelled invoice is never replaced twice).
 * - CORRECT: it is live, billed with a referral that has since ended
 *   (recorded by mistake), and no money is on it: every receipt voided (a
 *   voided payment never counts; a refunded one is money that moved, so
 *   such an invoice is left for review).
 */
export function replacementOption(facts: {
  status: InvoiceStatus;
  replaced: boolean;
  // null = manual invoice or package sale.
  visitStatus: VisitStatus | null;
  // amount_paid <> 0 or any VALID payment/refund row.
  hasPayments: boolean;
  // Status of the referral the invoice was billed with (null = none).
  referralStatus: PatientReferralStatus | null;
}): ReplacementOption {
  const blocked = (blockedBy: ReplacementBlocker) =>
    ({ action: null, blockedBy }) as const;
  if (facts.replaced) return blocked(ReplacementBlocker.ALREADY_REPLACED);
  if (!facts.visitStatus) {
    return blocked(ReplacementBlocker.NOT_A_SESSION_INVOICE);
  }
  if (facts.status === InvoiceStatus.CANCELLED) {
    return facts.visitStatus === VisitStatus.ACTIVE
      ? { action: ReplacementAction.REISSUE, blockedBy: null }
      : blocked(ReplacementBlocker.VISIT_VOIDED);
  }
  if (facts.hasPayments) return blocked(ReplacementBlocker.HAS_PAYMENTS);
  if (!facts.referralStatus) return blocked(ReplacementBlocker.NO_REFERRAL);
  if (facts.referralStatus === PatientReferralStatus.ACTIVE) {
    return blocked(ReplacementBlocker.REFERRAL_ACTIVE);
  }
  return { action: ReplacementAction.CORRECT, blockedBy: null };
}
