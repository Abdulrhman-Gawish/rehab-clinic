// The check-in details form, as pure functions (no React, no API): the same identity rules as the backend
// (backend/src/modules/patients/patient-identity.ts), so the desk sees a mistake before sending. Tested by
// patientIdentity.test.ts (npm test).

export type Gender = 'MALE' | 'FEMALE';
export type IdType = 'NATIONAL_ID' | 'PASSPORT';

export const DOCTOR_REFERRAL = 'DOCTOR_REFERRAL';
export const NATIONAL_ID_PATTERN = /^[23]\d{13}$/;
export const PASSPORT_PATTERN = /^[A-Z0-9]{5,20}$/;

const toAscii = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Digits only (Arabic digits accepted; spaces and dashes dropped). */
export const normalizeNationalId = (s: string) => toAscii(s).replace(/[\s-]/g, '');
/** Upper case, without spaces or dashes. */
export const normalizePassport = (s: string) => toAscii(s).replace(/[\s-]/g, '').toUpperCase();

/** Birth date and gender of a valid Egyptian National ID (not born after `today`), else null. */
export function parseNationalId(id: string, today: string): { dateOfBirth: string; gender: Gender } | null {
  if (!NATIONAL_ID_PATTERN.test(id)) return null;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const dateOfBirth = `${year}-${id.slice(3, 5)}-${id.slice(5, 7)}`;
  if (dateOfBirth > today) return null;
  return { dateOfBirth, gender: Number(id[12]) % 2 === 1 ? 'MALE' : 'FEMALE' };
}

/** What GET /patients/:id gives that the form uses. */
export interface PatientDetails {
  patientCode: string | null;
  nationalId: string | null;
  passportNumber: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  notes: string | null;
}

export interface DetailsForm {
  idType: IdType;
  idNumber: string;
  gender: Gender | '';
  dateOfBirth: string;
  notes: string;
  // How the patient found the clinic (an AcquisitionChannel), when the patient has no source yet.
  channel: string;
  channelDetails: string;
}

/** The form for a patient (null: a new one), prefilled with what is known. */
export function formFromPatient(p: PatientDetails | null): DetailsForm {
  return {
    idType: p?.passportNumber ? 'PASSPORT' : 'NATIONAL_ID',
    idNumber: p?.passportNumber ?? p?.nationalId ?? '',
    gender: p?.gender ?? '',
    dateOfBirth: p?.dateOfBirth ?? '',
    notes: p?.notes ?? '',
    channel: '',
    channelDetails: '',
  };
}

/** Typing a valid National ID sets the birth date and gender from it (over anything typed before). */
export function withIdNumber(form: DetailsForm, idNumber: string, today: string): DetailsForm {
  const next = { ...form, idNumber };
  if (form.idType !== 'NATIONAL_ID') return next;
  // A valid National ID states the birth date and gender: they follow it (shown read-only).
  const info = parseNationalId(normalizeNationalId(idNumber), today);
  return info ? { ...next, dateOfBirth: info.dateOfBirth, gender: info.gender } : next;
}

/** Age on `today` (both 'YYYY-MM-DD'): full years, and the full months past them; null for no or a future date. */
export function ageOn(dateOfBirth: string | null | undefined, today: string): { years: number; months: number } | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || dateOfBirth > today) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  // A month counts once its day is reached (29 February: on 1 March in other years).
  const months = (ty - y) * 12 + (tm - m) - (td < d ? 1 : 0);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export type Problem =
  | 'required' | 'nationalIdFormat' | 'nationalIdInvalid' | 'passportFormat' | 'dobMismatch' | 'genderMismatch' | 'future';
export type Problems = Partial<Record<'idNumber' | 'gender' | 'dateOfBirth' | 'channel' | 'referringDoctor', Problem>>;

/** What blocks sending the form (empty: ready). `needsSource`: the patient has no referral source yet. */
export function checkForm(form: DetailsForm, needsSource: boolean, today: string): Problems {
  const problems: Problems = {};
  if (!form.idNumber.trim()) problems.idNumber = 'required';
  else if (form.idType === 'NATIONAL_ID') {
    const id = normalizeNationalId(form.idNumber);
    const info = /^\d{14}$/.test(id) ? parseNationalId(id, today) : null;
    if (!/^\d{14}$/.test(id)) problems.idNumber = 'nationalIdFormat';
    else if (!info) problems.idNumber = 'nationalIdInvalid';
    else {
      if (form.dateOfBirth && form.dateOfBirth !== info.dateOfBirth) problems.dateOfBirth = 'dobMismatch';
      if (form.gender && form.gender !== info.gender) problems.gender = 'genderMismatch';
    }
  } else if (!PASSPORT_PATTERN.test(normalizePassport(form.idNumber))) problems.idNumber = 'passportFormat';
  // With a National ID they come from it: only its own problem is shown.
  const fromId = form.idType === 'NATIONAL_ID';
  if (!form.gender && !fromId) problems.gender ??= 'required';
  if (!form.dateOfBirth && !fromId) problems.dateOfBirth ??= 'required';
  else if (form.dateOfBirth > today) problems.dateOfBirth = 'future';
  if (needsSource && !form.channel) problems.channel = 'required';
  return problems;
}

/**
 * The `patientDetails` body for attend / walk-in, or the PATCH /patients/:id body: only what changed (an
 * unchanged identity document is not sent, so a receptionist never trips the owner-only rule), normalized.
 */
export function detailsPayload(form: DetailsForm, patient: PatientDetails | null, needsSource: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (form.idType === 'NATIONAL_ID') {
    const id = normalizeNationalId(form.idNumber);
    if (id !== (patient?.nationalId ?? '')) body.nationalId = id;
  } else {
    const passport = normalizePassport(form.idNumber);
    if (passport !== (patient?.passportNumber ?? '')) body.passportNumber = passport;
  }
  if (form.gender && form.gender !== patient?.gender) body.gender = form.gender;
  if (form.dateOfBirth && form.dateOfBirth !== patient?.dateOfBirth) body.dateOfBirth = form.dateOfBirth;
  const notes = form.notes.trim();
  if (notes !== (patient?.notes ?? '')) body.notes = notes || null;
  // A doctor referral is sent as `referral` (with its doctor and terms), never as a plain channel.
  if (needsSource && form.channel && form.channel !== DOCTOR_REFERRAL) {
    body.referralSource = { channel: form.channel, ...(form.channelDetails.trim() && { details: form.channelDetails.trim() }) };
  }
  return body;
}

/** Whether a patient still needs details before entering the doctor. */
export function isComplete(p: PatientDetails | null, hasSource: boolean): boolean {
  return !!p && !!(p.nationalId || p.passportNumber) && !!p.gender && !!p.dateOfBirth && hasSource;
}
