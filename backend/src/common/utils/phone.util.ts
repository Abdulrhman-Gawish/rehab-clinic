import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error.js';

// Normalized form stored in the DB: +20 followed by 1[0125] and 8 digits.
export const EGYPTIAN_MOBILE_E164 = /^\+201[0125]\d{8}$/;

const NATIONAL_MOBILE = /^1[0125]\d{8}$/;
// Spaces, dashes, dots, parentheses and invisible direction marks that come
// along when numbers are copied from Arabic text.
const SEPARATORS = /[\s\-().‎‏‪-‮⁦-⁩]/g;

// Arabic-Indic (٠-٩) and Extended Arabic-Indic / Persian (۰-۹) -> 0-9.
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalizes an Egyptian mobile number to E.164 (+201XXXXXXXXX).
 *
 * Accepts 01012345678, +201012345678, 00201012345678, 201012345678, with
 * spaces/dashes and Arabic-Indic digits. Only 010/011/012/015 mobiles are
 * valid; anything else throws InvalidPhoneNumberError.
 */
export function normalizeEgyptianMobile(input: string): string {
  if (typeof input !== 'string') {
    throw new InvalidPhoneNumberError(String(input));
  }
  const compact = toAsciiDigits(input).replace(SEPARATORS, '');

  let national: string | null = null;
  if (compact.startsWith('+20')) national = compact.slice(3);
  else if (compact.startsWith('0020')) national = compact.slice(4);
  else if (compact.startsWith('20') && compact.length === 12)
    national = compact.slice(2);
  else if (compact.startsWith('0') && compact.length === 11)
    national = compact.slice(1);

  // "+20 010..." (trunk zero kept after the country code) is a common typo.
  if (national?.length === 11 && national.startsWith('0')) {
    national = national.slice(1);
  }

  if (!national || !NATIONAL_MOBILE.test(national)) {
    throw new InvalidPhoneNumberError(input);
  }
  return `+20${national}`;
}

// Same as normalizeEgyptianMobile but returns null instead of throwing.
export function tryNormalizeEgyptianMobile(input: string): string | null {
  try {
    return normalizeEgyptianMobile(input);
  } catch {
    return null;
  }
}
