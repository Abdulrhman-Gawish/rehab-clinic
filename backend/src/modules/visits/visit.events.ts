/**
 * Domain events for other modules. They are emitted through
 * @nestjs/event-emitter ONLY after the transaction has committed, so a
 * listener always sees the persisted state. Billing listens to CHECKED_IN
 * (automatic invoice) and CANCELLED (cancel an unpaid invoice).
 */
export enum VisitEvent {
  CHECKED_IN = 'visit.checked_in',
  STARTED = 'visit.started',
  COMPLETED = 'visit.completed',
  // Undo check-in and "patient left" both end the visit as CANCELLED.
  CANCELLED = 'visit.cancelled',
}

export interface VisitEventPayload {
  visitId: string;
  // NULL for walk-ins.
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  serviceId: string;
  // When it happened (UTC).
  at: Date;
}
