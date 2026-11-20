import { AppointmentType } from '../appointments/appointment.enums.js';

// Every field a clinical note can hold. All optional, also when signing.
export const NOTE_FIELDS = [
  'chiefComplaint',
  'assessment',
  'diagnosis',
  'treatmentDone',
  'progress',
  'plan',
  'painScore',
] as const;

export type NoteField = (typeof NOTE_FIELDS)[number];

/**
 * The fields the doctor fills in, by the visit's appointment type
 * (treatmentDone is "treatment provided", plan is "treatment plan").
 * EXAMINATION notes also show the visit's attachments (patient attachments
 * linked to the visit; uploaded with POST /patients/:id/attachments).
 */
export const NOTE_FIELDS_BY_TYPE: Readonly<
  Record<AppointmentType, readonly NoteField[]>
> = {
  [AppointmentType.EXAMINATION]: [
    'chiefComplaint',
    'assessment',
    'diagnosis',
    'plan',
    'painScore',
  ],
  [AppointmentType.SESSION]: ['treatmentDone', 'progress', 'painScore'],
  [AppointmentType.FOLLOW_UP]: ['assessment', 'progress', 'plan', 'painScore'],
};

/**
 * The editable fields of a note on a visit of this type. A visit whose type
 * is not set (booked before types existed) keeps every field. The other
 * fields are read-only: their stored values are kept and still shown, so a
 * type change never hides or deletes clinical data.
 */
export function noteFieldsFor(
  type: AppointmentType | null,
): readonly NoteField[] {
  return type === null ? NOTE_FIELDS : NOTE_FIELDS_BY_TYPE[type];
}

/** Fields sent (any value, null included) that this type doesn't have. */
export function fieldsOutsideType(
  type: AppointmentType | null,
  input: Partial<Record<NoteField, unknown>>,
): NoteField[] {
  const editable = noteFieldsFor(type);
  return NOTE_FIELDS.filter(
    (field) => input[field] !== undefined && !editable.includes(field),
  );
}
