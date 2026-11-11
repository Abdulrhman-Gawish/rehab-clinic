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

// How a session invoice gets its replacement (a new invoice of the same
// visit, linked to it, with the patient's current referral and discount).
export enum ReplacementAction {
  // Live invoice billed with a referral recorded by mistake: cancel + issue.
  CORRECT = 'CORRECT',
  // Cancelled invoice of a visit still attended: issue only.
  REISSUE = 'REISSUE',
}

// Why neither replacement action applies.
export enum ReplacementBlocker {
  ALREADY_REPLACED = 'ALREADY_REPLACED',
  NOT_A_SESSION_INVOICE = 'NOT_A_SESSION_INVOICE',
  VISIT_VOIDED = 'VISIT_VOIDED',
  HAS_PAYMENTS = 'HAS_PAYMENTS',
  NO_REFERRAL = 'NO_REFERRAL',
  REFERRAL_ACTIVE = 'REFERRAL_ACTIVE',
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
