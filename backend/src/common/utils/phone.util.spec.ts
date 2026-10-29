import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error.js';
import {
  normalizeEgyptianMobile,
  toAsciiDigits,
  tryNormalizeEgyptianMobile,
} from './phone.util.js';

describe('normalizeEgyptianMobile', () => {
  describe('accepted formats', () => {
    it.each([
      ['local', '01012345678', '+201012345678'],
      ['E.164', '+201012345678', '+201012345678'],
      ['00 international prefix', '00201012345678', '+201012345678'],
      ['country code without +', '201012345678', '+201012345678'],
      ['spaces', '010 1234 5678', '+201012345678'],
      ['dashes', '010-1234-5678', '+201012345678'],
      ['spaces in E.164', '+20 10 1234 5678', '+201012345678'],
      ['dots and parentheses', '(010) 1234.5678', '+201012345678'],
      ['surrounding whitespace', '  01012345678\t', '+201012345678'],
      ['trunk zero after +20', '+20 010 1234 5678', '+201012345678'],
      ['Arabic-Indic digits', '٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
      ['Arabic-Indic with +20', '+٢٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
      ['Persian digits', '۰۱۰۱۲۳۴۵۶۷۸', '+201012345678'],
      ['mixed digits and separators', '٠١٠-1234 ٥٦٧٨', '+201012345678'],
      ['RTL marks from copied Arabic text', '‏01012345678‎', '+201012345678'],
    ])('%s: %j -> %s', (_label, input, expected) => {
      expect(normalizeEgyptianMobile(input)).toBe(expected);
    });

    it.each([
      ['010', '01012345678', '+201012345678'],
      ['011', '01112345678', '+201112345678'],
      ['012', '01212345678', '+201212345678'],
      ['015', '01512345678', '+201512345678'],
    ])('accepts the %s prefix', (_prefix, input, expected) => {
      expect(normalizeEgyptianMobile(input)).toBe(expected);
    });

    it('is idempotent', () => {
      const once = normalizeEgyptianMobile('010 1234 5678');
      expect(normalizeEgyptianMobile(once)).toBe(once);
    });
  });

  describe('rejected inputs', () => {
    it.each([
      ['empty string', ''],
      ['only spaces', '   '],
      ['unknown operator prefix 013', '01312345678'],
      ['unknown operator prefix 014', '01412345678'],
      ['unknown operator prefix 016', '01612345678'],
      ['landline (Cairo)', '0223456789'],
      ['too short', '0101234567'],
      ['too long', '010123456789'],
      ['missing leading zero', '1012345678'],
      ['other country code', '+966512345678'],
      ['+20 too long', '+2010123456789'],
      ['letters', '0101234567a'],
      ['plus in the middle', '010+12345678'],
      ['words', 'not a phone'],
      ['double country code', '+20201012345678'],
    ])('%s: %j', (_label, input) => {
      expect(() => normalizeEgyptianMobile(input)).toThrow(
        InvalidPhoneNumberError,
      );
    });

    it('rejects non-string input', () => {
      expect(() =>
        normalizeEgyptianMobile(1012345678 as unknown as string),
      ).toThrow(InvalidPhoneNumberError);
    });
  });
});

describe('tryNormalizeEgyptianMobile', () => {
  it('returns null instead of throwing', () => {
    expect(tryNormalizeEgyptianMobile('123')).toBeNull();
    expect(tryNormalizeEgyptianMobile('01012345678')).toBe('+201012345678');
  });
});

describe('toAsciiDigits', () => {
  it('converts Arabic-Indic and Persian digits only', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc 42')).toBe(
      '0123456789 0123456789 abc 42',
    );
  });
});
