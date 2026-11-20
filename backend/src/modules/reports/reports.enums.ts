export enum RevenueGroupBy {
  DAY = 'day',
  MONTH = 'month',
  DOCTOR = 'doctor',
  SERVICE = 'service',
  METHOD = 'method',
}

// A row of GET /reports/transactions: money in (PAYMENT), money back to a
// patient (REFUND) or money spent (EXPENSE).
export enum TransactionKind {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  EXPENSE = 'EXPENSE',
}

// What an EXPENSE row pays for.
export enum ExpenseOrigin {
  // Typed at the desk.
  MANUAL = 'MANUAL',
  // A salary payment to one of the clinic's doctors.
  DOCTOR_SALARY = 'DOCTOR_SALARY',
  // A payout to a referring doctor.
  REFERRAL_PAYOUT = 'REFERRAL_PAYOUT',
}
