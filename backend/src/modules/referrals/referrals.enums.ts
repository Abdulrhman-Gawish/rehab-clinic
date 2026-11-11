// How a commission or a patient discount is expressed. NONE = not given.
// PERCENT: 10.00 = 10%. FIXED: EGP (commission: per covered session).
export enum ReferralRateType {
  NONE = 'NONE',
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

// Which of the patient's sessions the terms cover. A session is a billed
// visit or a package sale (one each); a visit paid by a package is not.
export enum ReferralApplicability {
  FIRST_SESSION = 'FIRST_SESSION',
  ALL_SESSIONS = 'ALL_SESSIONS',
  SESSION_COUNT = 'SESSION_COUNT',
  DATE_RANGE = 'DATE_RANGE',
}

export enum PatientReferralStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

/**
 * Why a ledger row exists. Every patient payment event writes at most one
 * row of its kind (uq_referral_commissions_event), so replaying an event
 * never adds a second commission.
 */
export enum CommissionKind {
  // A payment was recorded (positive).
  EARNED = 'EARNED',
  // A refund was recorded (negative).
  REFUND_REVERSAL = 'REFUND_REVERSAL',
  // A payment was voided (negative).
  VOID_REVERSAL = 'VOID_REVERSAL',
  // A refund was voided: the money is back, so is the commission (positive).
  REFUND_VOIDED = 'REFUND_VOIDED',
  // Added by the OWNER with a reason (either sign).
  ADJUSTMENT = 'ADJUSTMENT',
}

/**
 * PENDING: the money was received but no session was attended yet (a
 * package paid before its first session). ELIGIBLE: owed to the doctor.
 * PAID: included in a payout.
 */
export enum CommissionStatus {
  PENDING = 'PENDING',
  ELIGIBLE = 'ELIGIBLE',
  PAID = 'PAID',
}
