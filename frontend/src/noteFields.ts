// Which clinical-note fields each appointment type has. Mirrors the API (backend clinical/note-fields.ts), which
// enforces it: saving a field of another type is refused (NOTE_FIELDS_NOT_IN_TYPE). Values written under another
// type (before reception changed it) are kept and shown read-only, never hidden.

export const APPOINTMENT_TYPES = ['EXAMINATION', 'FOLLOW_UP', 'SESSION'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** Every note field, in display order (treatmentDone = "treatment provided", plan = "treatment plan"). */
export const NOTE_FIELDS = ['chiefComplaint', 'assessment', 'diagnosis', 'treatmentDone', 'progress', 'plan', 'painScore'] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

const BY_TYPE: Record<AppointmentType, readonly NoteField[]> = {
  EXAMINATION: ['chiefComplaint', 'assessment', 'diagnosis', 'plan', 'painScore'],
  SESSION: ['treatmentDone', 'progress', 'painScore'],
  FOLLOW_UP: ['assessment', 'progress', 'plan', 'painScore'],
};

/** The fields the doctor fills in for this type. Not set (an appointment from before types): every field. */
export function noteFieldsFor(type: string | null | undefined): readonly NoteField[] {
  return BY_TYPE[type as AppointmentType] ?? NOTE_FIELDS;
}

/** Examination notes (and notes whose type is not set) show the visit's attachments, with an upload. */
export function showsAttachments(type: string | null | undefined): boolean {
  return noteFieldsFor(type) === NOTE_FIELDS || type === 'EXAMINATION';
}

const filled = (value: unknown) => value !== null && value !== undefined && value !== '';

/** Fields of other types that hold a value: shown read-only, so a type change never hides clinical data. */
export function otherFilledFields(type: string | null | undefined, note: Partial<Record<NoteField, unknown>>): NoteField[] {
  const own = noteFieldsFor(type);
  return NOTE_FIELDS.filter((f) => !own.includes(f) && filled(note[f]));
}
