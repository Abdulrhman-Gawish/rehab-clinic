export enum VisitStatus {
  // Checked in, waiting for the doctor.
  WAITING = 'WAITING',
  // The doctor started the session.
  IN_SESSION = 'IN_SESSION',
  COMPLETED = 'COMPLETED',
  // Checked in by mistake, or the patient left before being seen.
  CANCELLED = 'CANCELLED',
}

// A patient may have only one open visit at a time.
export const OPEN_VISIT_STATUSES: readonly VisitStatus[] = [
  VisitStatus.WAITING,
  VisitStatus.IN_SESSION,
];
