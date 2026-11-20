import { Gender } from '../../common/enums/gender.enum.js';
import {
  codeDigits,
  formatPatientCode,
  normalizeNationalId,
  normalizePassport,
  parseNationalId,
} from './patient-identity.js';

const TODAY = '2026-11-14';

describe('patient identity', () => {
  it('normalizes a National ID typed with Arabic digits, spaces or dashes', () => {
    expect(normalizeNationalId('٢٩٠٠١٠١ 0112-345 6')).toBe(
      '29001010112345' + '6',
    );
  });

  it('reads the birth date and gender of a valid National ID', () => {
    // 2 = 1900s, 90-01-01, governorate 01, sequence 1234 (4: even -> female).
    expect(parseNationalId('29001010112348', TODAY)).toEqual({
      dateOfBirth: '1990-01-01',
      gender: Gender.FEMALE,
    });
    // 3 = 2000s, 2005-12-31, sequence ending in 5 (odd -> male).
    expect(parseNationalId('30512312101257', TODAY)).toEqual({
      dateOfBirth: '2005-12-31',
      gender: Gender.MALE,
    });
  });

  it('rejects a malformed or impossible National ID', () => {
    for (const bad of [
      '2900101011234', // 13 digits
      '290010101123456', // 15 digits
      '19001010112345', // century 1
      '49001010112345', // century 4
      '29013010112345', // month 13
      '29002300112345', // 30 February
      '2900101011234a',
      '32701010112345', // 2027: after today
    ]) {
      expect(parseNationalId(bad, TODAY)).toBeNull();
    }
    // Born today is valid; tomorrow is not.
    expect(parseNationalId('32611140112345', TODAY)).not.toBeNull();
    expect(parseNationalId('32611150112345', TODAY)).toBeNull();
  });

  it('normalizes a passport number', () => {
    expect(normalizePassport(' a12 34-567 ')).toBe('A1234567');
  });

  it('builds the RH code from the first 4 digits (0000 for a passport) and a 4-digit sequence', () => {
    expect(codeDigits('29001010112345')).toBe('2900');
    expect(codeDigits(null)).toBe('0000');
    expect(formatPatientCode('2900', 1)).toBe('RH29000001');
    expect(formatPatientCode('3051', 9999)).toBe('RH30519999');
    expect(formatPatientCode('0000', 42)).toBe('RH00000042');
    expect(() => formatPatientCode('2900', 0)).toThrow();
    expect(() => formatPatientCode('2900', 10000)).toThrow();
    expect(() => formatPatientCode('290', 1)).toThrow();
  });
});
