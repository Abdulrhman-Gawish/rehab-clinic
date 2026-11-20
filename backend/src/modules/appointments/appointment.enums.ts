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

// What the appointment is for: chosen at booking (and at walk-in check-in),
// changed by reception at any time. Only a classification: it never changes
// the price, duration, slots, packages or invoices. It decides which fields
// the visit's clinical note has (clinical/note-fields.ts). NULL in the
// database = not set (rows from before types existed only).
export enum AppointmentType {
  EXAMINATION = 'EXAMINATION',
  FOLLOW_UP = 'FOLLOW_UP',
  SESSION = 'SESSION',
}

// Statuses that occupy the time slot (for both the doctor and the patient).
// Must match the WHERE clause of the appointments exclusion constraints.
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.ATTENDED,
];
