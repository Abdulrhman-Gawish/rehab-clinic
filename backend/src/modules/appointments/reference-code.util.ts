import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L or U: easy to read out over the phone or WhatsApp.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const LENGTH = 6;

export const REFERENCE_CODE_PATTERN = /^APT-[A-HJKMNP-TV-Z2-9]{6}$/;

// e.g. APT-7K3Q9X. ~729M combinations; uniqueness is enforced by the DB.
export function generateReferenceCode(): string {
  let code = '';
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `APT-${code}`;
}

// Accepts lower case and missing dash ("apt7k3q9x") from humans.
export function normalizeReferenceCode(input: string): string {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  return compact.startsWith('APT') ? `APT-${compact.slice(3)}` : compact;
}
