import {
  generateReferenceCode,
  normalizeReferenceCode,
  REFERENCE_CODE_PATTERN,
} from './reference-code.util.js';

describe('reference codes', () => {
  it('generates APT- plus 6 unambiguous characters', () => {
    const codes = Array.from({ length: 500 }, generateReferenceCode);
    for (const code of codes) {
      expect(code).toMatch(REFERENCE_CODE_PATTERN);
      expect(code.slice(4)).not.toMatch(/[01OILU]/);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalizes what people type', () => {
    expect(normalizeReferenceCode(' apt-7k3q9x ')).toBe('APT-7K3Q9X');
    expect(normalizeReferenceCode('APT7K3Q9X')).toBe('APT-7K3Q9X');
    expect(normalizeReferenceCode('apt 7k3 q9x')).toBe('APT-7K3Q9X');
  });
});
