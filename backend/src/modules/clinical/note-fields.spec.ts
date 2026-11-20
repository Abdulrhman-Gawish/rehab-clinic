import { AppointmentType } from '../appointments/appointment.enums.js';
import {
  fieldsOutsideType,
  NOTE_FIELDS,
  noteFieldsFor,
} from './note-fields.js';

describe('note fields by appointment type', () => {
  it('each type has its own fields; pain level is in every type', () => {
    expect(noteFieldsFor(AppointmentType.EXAMINATION)).toEqual([
      'chiefComplaint',
      'assessment',
      'diagnosis',
      'plan',
      'painScore',
    ]);
    expect(noteFieldsFor(AppointmentType.SESSION)).toEqual([
      'treatmentDone',
      'progress',
      'painScore',
    ]);
    expect(noteFieldsFor(AppointmentType.FOLLOW_UP)).toEqual([
      'assessment',
      'progress',
      'plan',
      'painScore',
    ]);
  });

  it('a visit whose type is not set keeps every field', () => {
    expect(noteFieldsFor(null)).toEqual(NOTE_FIELDS);
  });

  it('every field belongs to at least one type', () => {
    const typed = new Set(
      Object.values(AppointmentType).flatMap((t) => noteFieldsFor(t)),
    );
    expect([...typed].sort()).toEqual([...NOTE_FIELDS].sort());
  });

  it('reports the fields sent that the type does not have (null counts, undefined does not)', () => {
    expect(
      fieldsOutsideType(AppointmentType.SESSION, {
        treatmentDone: 'Manual therapy',
        diagnosis: null,
        assessment: 'x',
        progress: undefined,
      }),
    ).toEqual(['assessment', 'diagnosis']);
    expect(
      fieldsOutsideType(AppointmentType.EXAMINATION, {
        chiefComplaint: 'Knee pain',
        painScore: 4,
      }),
    ).toEqual([]);
    expect(
      fieldsOutsideType(null, { treatmentDone: 'x', diagnosis: 'y' }),
    ).toEqual([]);
  });
});
