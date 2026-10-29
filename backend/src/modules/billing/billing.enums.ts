// Derived from the amounts; stored for querying.
export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  WALLET = 'WALLET',
  INSTAPAY = 'INSTAPAY',
}

export enum PaymentType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
}

export enum PaymentStatus {
  VALID = 'VALID',
  VOIDED = 'VOIDED',
}

// Gapless yearly numbering scopes (document_counters.scope).
export enum DocumentScope {
  INVOICE = 'INVOICE',
  RECEIPT = 'RECEIPT',
  EXPENSE = 'EXPENSE',
}

export const DOCUMENT_PREFIX: Record<DocumentScope, string> = {
  [DocumentScope.INVOICE]: 'INV',
  [DocumentScope.RECEIPT]: 'RCP',
  [DocumentScope.EXPENSE]: 'EXP',
};
