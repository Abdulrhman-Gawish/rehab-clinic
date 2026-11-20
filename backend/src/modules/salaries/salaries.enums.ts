// How a doctor earns commission on attended sessions.
export enum SalaryCommissionMode {
  // Fixed salary only.
  NONE = 'NONE',
  // One rate for every attended session, whatever the service.
  PER_SESSION = 'PER_SESSION',
  // A rate per service; services without a rate earn nothing.
  PER_SERVICE = 'PER_SERVICE',
}

export enum SalaryRateType {
  // EGP per session.
  FIXED = 'FIXED',
  // % of the session's value (its invoice total after discount, or the
  // package price / sessions for a package session).
  PERCENT = 'PERCENT',
}

// Where a session's value (the base of a PERCENT rate) came from.
export enum SessionValueSource {
  INVOICE = 'INVOICE',
  PACKAGE = 'PACKAGE',
  // No live invoice and no package session (e.g. its invoice was cancelled).
  NONE = 'NONE',
}
