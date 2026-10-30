export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  // Reception sent the patient in to the doctor (the visit exists).
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

export enum AppointmentSource {
  ONLINE = 'ONLINE',
  RECEPTION = 'RECEPTION',
}

// Statuses that occupy the time slot (for both the doctor and the patient).
// Must match the WHERE clause of the appointments exclusion constraints.
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.ATTENDED,
];
