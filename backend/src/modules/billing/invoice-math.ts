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
import { DiscountType, InvoiceStatus } from './billing.enums.js';

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

export function balanceOf(total: string, amountPaid: string): string {
  return subMoney(total, amountPaid);
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
