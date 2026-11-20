// Run with `npm test` (node:test through tsx: no extra dependency).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageOn, checkForm, detailsPayload, formFromPatient, isComplete, normalizeNationalId, normalizePassport, parseNationalId,
  withIdNumber, type PatientDetails,
} from './patientIdentity';

const TODAY = '2026-11-14';
const NID = '29001010101231'; // 1990-01-01, ...3: male

const patient = (over: Partial<PatientDetails> = {}): PatientDetails => ({
  patientCode: null, nationalId: null, passportNumber: null, gender: null, dateOfBirth: null, notes: null, ...over,
});

describe('National ID and passport', () => {
  it('normalizes what the desk types', () => {
    assert.equal(normalizeNationalId('٢٩٠ ٠١٠١-٠١٠١٢٣١'), NID);
    assert.equal(normalizePassport(' a12-345 678 '), 'A12345678');
  });

  it('reads the birth date and gender, and rejects impossible IDs', () => {
    assert.deepEqual(parseNationalId(NID, TODAY), { dateOfBirth: '1990-01-01', gender: 'MALE' });
    assert.deepEqual(parseNationalId('30512312101248', TODAY), { dateOfBirth: '2005-12-31', gender: 'FEMALE' });
    for (const bad of ['19001010101231', '29013010101231', '29002300101231', '32701010101231', '2900101010123']) {
      assert.equal(parseNationalId(bad, TODAY), null, bad);
    }
  });
});

describe('check-in details form', () => {
  it('a new patient: the National ID (birth date and gender come from it) and the source are required', () => {
    assert.deepEqual(checkForm(formFromPatient(null), true, TODAY), { idNumber: 'required', channel: 'required' });
    assert.deepEqual(checkForm(formFromPatient(null), false, TODAY).channel, undefined);
    // A passport: the birth date and gender are typed, so they are required.
    assert.deepEqual(checkForm({ ...formFromPatient(null), idType: 'PASSPORT' }, false, TODAY), {
      idNumber: 'required', gender: 'required', dateOfBirth: 'required',
    });
  });

  it('the birth date and gender follow the National ID typed, and the form is ready', () => {
    const form = { ...withIdNumber(formFromPatient(null), NID, TODAY), channel: 'FACEBOOK' };
    assert.equal(form.dateOfBirth, '1990-01-01');
    assert.equal(form.gender, 'MALE');
    assert.deepEqual(checkForm(form, true, TODAY), {});
    // Even over values typed before (a National ID can't be contradicted)...
    const typed = withIdNumber({ ...formFromPatient(null), dateOfBirth: '1991-05-05', gender: 'FEMALE' }, NID, TODAY);
    assert.deepEqual([typed.dateOfBirth, typed.gender], ['1990-01-01', 'MALE']);
    // ...and left alone while the ID is incomplete.
    const partial = withIdNumber({ ...formFromPatient(null), dateOfBirth: '1991-05-05' }, '2900101', TODAY);
    assert.deepEqual([partial.dateOfBirth, partial.gender], ['1991-05-05', '']);
    // A passport leaves them as typed.
    const passport = withIdNumber({ ...form, idType: 'PASSPORT' }, 'A1234567', TODAY);
    assert.deepEqual([passport.dateOfBirth, passport.gender], ['1990-01-01', 'MALE']);
  });

  it('age: full years, months under a year, birthdays not reached yet, 29 February', () => {
    assert.deepEqual(ageOn('1990-01-01', TODAY), { years: 36, months: 10 });
    assert.deepEqual(ageOn('1990-11-15', TODAY), { years: 35, months: 11 }); // birthday tomorrow
    assert.deepEqual(ageOn('1990-11-14', TODAY), { years: 36, months: 0 }); // birthday today
    assert.deepEqual(ageOn('2026-03-20', TODAY), { years: 0, months: 7 });
    assert.deepEqual(ageOn('2024-02-29', '2027-02-28'), { years: 2, months: 11 });
    assert.deepEqual(ageOn('2024-02-29', '2027-03-01'), { years: 3, months: 0 });
    assert.equal(ageOn('2027-01-01', TODAY), null);
    assert.equal(ageOn(null, TODAY), null);
  });

  it('flags a malformed or invalid ID, a passport with bad characters, and mismatches', () => {
    const base = { ...formFromPatient(null), gender: 'MALE' as const, dateOfBirth: '1990-01-01', channel: 'OTHER' };
    assert.equal(checkForm({ ...base, idNumber: '123' }, true, TODAY).idNumber, 'nationalIdFormat');
    assert.equal(checkForm({ ...base, idNumber: '19001010101231' }, true, TODAY).idNumber, 'nationalIdInvalid');
    assert.equal(checkForm({ ...base, idType: 'PASSPORT', idNumber: 'A#1' }, true, TODAY).idNumber, 'passportFormat');
    const mismatch = checkForm({ ...base, idNumber: NID, gender: 'FEMALE', dateOfBirth: '1990-01-02' }, true, TODAY);
    assert.deepEqual(mismatch, { gender: 'genderMismatch', dateOfBirth: 'dobMismatch' });
    assert.equal(checkForm({ ...base, idType: 'PASSPORT', idNumber: 'A1234567', dateOfBirth: '2027-01-01' }, true, TODAY).dateOfBirth, 'future');
  });

  it('sends only what changed: an unchanged document is never resent', () => {
    const known = patient({ patientCode: 'RH29000001', nationalId: NID, gender: 'MALE', dateOfBirth: '1990-01-01', notes: 'Old' });
    const form = { ...formFromPatient(known), notes: '  New note ', channel: 'WEBSITE', channelDetails: ' ad ' };
    assert.deepEqual(detailsPayload(form, known, true), {
      notes: 'New note', referralSource: { channel: 'WEBSITE', details: 'ad' },
    });
    // The source is sent only when the patient has none.
    assert.deepEqual(detailsPayload(form, known, false), { notes: 'New note' });
  });

  it('a new passport patient: the whole payload, normalized', () => {
    const form = { ...formFromPatient(null), idType: 'PASSPORT' as const, idNumber: 'x98-765 43', gender: 'FEMALE' as const,
      dateOfBirth: '1979-09-09', channel: 'FRIENDS_FAMILY' };
    assert.deepEqual(detailsPayload(form, null, true), {
      passportNumber: 'X9876543', gender: 'FEMALE', dateOfBirth: '1979-09-09', referralSource: { channel: 'FRIENDS_FAMILY' },
    });
  });

  it('a doctor referral is not sent as a plain referral source', () => {
    const form = { ...formFromPatient(null), idType: 'PASSPORT' as const, idNumber: 'X9876543', gender: 'MALE' as const,
      dateOfBirth: '1979-09-09', channel: 'DOCTOR_REFERRAL' };
    assert.deepEqual(checkForm(form, true, TODAY), {});
    assert.deepEqual(detailsPayload(form, null, true), { passportNumber: 'X9876543', gender: 'MALE', dateOfBirth: '1979-09-09' });
  });

  it('isComplete: a document, gender, birth date and a source', () => {
    const full = patient({ passportNumber: 'A1234567', gender: 'MALE', dateOfBirth: '1990-01-01' });
    assert.equal(isComplete(full, true), true);
    assert.equal(isComplete(full, false), false);
    assert.equal(isComplete({ ...full, gender: null }, true), false);
    assert.equal(isComplete(null, true), false);
  });
});
