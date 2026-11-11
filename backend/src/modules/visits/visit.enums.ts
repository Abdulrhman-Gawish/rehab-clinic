export enum VisitStatus {
  // The patient attended (reception sent them in). Stays ACTIVE for good:
  // the doctor writes the note on it, any day after.
  ACTIVE = 'ACTIVE',
  // Attended by mistake and undone the same day.
  VOIDED = 'VOIDED',
}
