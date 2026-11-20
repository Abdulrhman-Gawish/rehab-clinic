// Pure rules of a patient's identity document and clinic code (no
// database). The frontend keeps the same rules in src/patientIdentity.ts.
import { Gender } from '../../common/enums/gender.enum.js';
import { toAsciiDigits } from '../../common/utils/phone.util.js';

export const PATIENT_CODE_PREFIX = 'RH';
// The code digits of a patient identified by a passport (non-Egyptian): a
// National ID always starts with 2 or 3, so they never collide.
export const PASSPORT_CODE_DIGITS = '0000';
export const MAX_CODE_SEQUENCE = 9999;
// RH + 4 digits + 4-digit sequence.
export const PATIENT_CODE_PATTERN = /^RH\d{8}$/;
export const NATIONAL_ID_PATTERN = /^[23]\d{13}$/;
export const PASSPORT_PATTERN = /^[A-Z0-9]{5,20}$/;

/** Digits only (Arabic-Indic digits accepted; spaces and dashes dropped). */
export function normalizeNationalId(input: string): string {
  return toAsciiDigits(input).replace(/[\s-]/g, '');
}

/** Upper case, without spaces or dashes. */
export function normalizePassport(input: string): string {
  return toAsciiDigits(input).replace(/[\s-]/g, '').toUpperCase();
}

export interface NationalIdInfo {
  // 'YYYY-MM-DD'
  dateOfBirth: string;
  gender: Gender;
}

/**
 * What an Egyptian National ID says, or null when it is not a valid one:
 * 14 digits, century (2 = 1900s, 3 = 2000s), birth date YYMMDD (a real
 * date, not after `today`), governorate (2), sequence (4, the last of them
 * odd for a male, even for a female), check digit.
 */
export function parseNationalId(
  id: string,
  today: string,
): NationalIdInfo | null {
  if (!NATIONAL_ID_PATTERN.test(id)) return null;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const dateOfBirth = `${year}-${id.slice(3, 5)}-${id.slice(5, 7)}`;
  if (dateOfBirth > today) return null;
  return {
    dateOfBirth,
    gender: Number(id[12]) % 2 === 1 ? Gender.MALE : Gender.FEMALE,
  };
}

/** The 4 code digits: the National ID's first 4, or 0000 for a passport. */
export function codeDigits(nationalId: string | null): string {
  return nationalId ? nationalId.slice(0, 4) : PASSPORT_CODE_DIGITS;
}

/** RH + the 4 code digits + the sequence on 4 digits (1..9999). */
export function formatPatientCode(digits: string, sequence: number): string {
  if (!/^\d{4}$/.test(digits)) throw new Error(`Invalid code digits ${digits}`);
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_CODE_SEQUENCE
  ) {
    throw new Error(`Invalid code sequence ${sequence}`);
  }
  return `${PATIENT_CODE_PREFIX}${digits}${String(sequence).padStart(4, '0')}`;
}
