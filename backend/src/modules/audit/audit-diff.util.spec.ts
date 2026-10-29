import { diffValues, pickValues } from './audit-diff.util.js';

describe('diffValues', () => {
  it('returns only the changed keys', () => {
    const before = {
      name: 'A',
      phone: '+201012345678',
      notes: null as string | null,
    };
    const after = { ...before, phone: '+201112345678' };

    expect(diffValues(before, after, ['name', 'phone', 'notes'])).toEqual({
      oldValues: { phone: '+201012345678' },
      newValues: { phone: '+201112345678' },
    });
  });

  it('returns null when nothing changed', () => {
    const value = { name: 'A' };
    expect(diffValues(value, { ...value }, ['name'])).toBeNull();
  });

  it('compares dates by value and serializes them', () => {
    const before = { at: new Date('2026-01-01T00:00:00Z') };
    expect(
      diffValues(before, { at: new Date('2026-01-01T00:00:00Z') }, ['at']),
    ).toBeNull();
    expect(
      diffValues(before, { at: new Date('2026-02-01T00:00:00Z') }, ['at']),
    ).toEqual({
      oldValues: { at: '2026-01-01T00:00:00.000Z' },
      newValues: { at: '2026-02-01T00:00:00.000Z' },
    });
  });

  it('treats undefined and null as the same', () => {
    const before: { notes?: string | null } = {};
    expect(diffValues(before, { notes: null }, ['notes'])).toBeNull();
  });
});

describe('pickValues', () => {
  it('only copies the listed keys', () => {
    const user = { name: 'A', passwordHash: 'secret' };
    expect(pickValues(user, ['name'])).toEqual({ name: 'A' });
  });
});
