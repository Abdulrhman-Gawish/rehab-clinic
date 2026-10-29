import {
  dayOfWeek,
  localDateOf,
  localDayBounds,
  localToUtc,
  parseIsoWithOffset,
  toZonedIso,
} from './clinic-time.util.js';

const CAIRO = 'Africa/Cairo';
const iso = (d: Date) => d.toISOString();

// Egypt DST (2023+): clocks go forward on the last Friday of April at 00:00
// (-> 01:00) and back on the last Thursday of October at 24:00 (-> 23:00).
// In 2026: forward on 2026-04-24, back on the night of 2026-10-29.
describe('clinic time utils (Africa/Cairo)', () => {
  it('uses +02:00 in winter and +03:00 in summer for the same wall time', () => {
    expect(iso(localToUtc('2026-11-05', '17:00', CAIRO))).toBe(
      '2026-11-05T15:00:00.000Z',
    );
    expect(iso(localToUtc('2026-07-05', '17:00', CAIRO))).toBe(
      '2026-07-05T14:00:00.000Z',
    );
    expect(toZonedIso(new Date('2026-11-05T15:00:00Z'), CAIRO)).toBe(
      '2026-11-05T17:00:00+02:00',
    );
    expect(toZonedIso(new Date('2026-07-05T14:00:00Z'), CAIRO)).toBe(
      '2026-07-05T17:00:00+03:00',
    );
  });

  describe('spring forward (2026-04-24, 00:00-00:59 does not exist)', () => {
    it('shifts a non-existent wall time forward by the gap', () => {
      expect(iso(localToUtc('2026-04-24', '00:30', CAIRO))).toBe(
        '2026-04-23T22:30:00.000Z',
      );
      expect(toZonedIso(localToUtc('2026-04-24', '00:30', CAIRO), CAIRO)).toBe(
        '2026-04-24T01:30:00+03:00',
      );
    });

    it('converts times on both sides of the gap correctly', () => {
      expect(iso(localToUtc('2026-04-23', '23:00', CAIRO))).toBe(
        '2026-04-23T21:00:00.000Z',
      );
      expect(iso(localToUtc('2026-04-24', '01:00', CAIRO))).toBe(
        '2026-04-23T22:00:00.000Z',
      );
    });

    it('the local day is 23 hours long', () => {
      const { start, end } = localDayBounds('2026-04-24', CAIRO);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    });
  });

  describe('fall back (2026-10-29, 23:00-23:59 happens twice)', () => {
    it('resolves an ambiguous wall time to the earlier or later occurrence', () => {
      expect(iso(localToUtc('2026-10-29', '23:30', CAIRO, 'earlier'))).toBe(
        '2026-10-29T20:30:00.000Z',
      );
      expect(iso(localToUtc('2026-10-29', '23:30', CAIRO, 'later'))).toBe(
        '2026-10-29T21:30:00.000Z',
      );
    });

    it('unambiguous times around the transition use their own offset', () => {
      expect(iso(localToUtc('2026-10-29', '22:00', CAIRO))).toBe(
        '2026-10-29T19:00:00.000Z',
      );
      expect(iso(localToUtc('2026-10-30', '09:00', CAIRO))).toBe(
        '2026-10-30T07:00:00.000Z',
      );
    });

    it('the local day is 25 hours long', () => {
      const { start, end } = localDayBounds('2026-10-29', CAIRO);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    });
  });

  it('computes the local date and weekday (0 = Sunday)', () => {
    // 23:30Z on Nov 4 is already Nov 5 in Cairo.
    expect(localDateOf(new Date('2026-11-04T23:30:00Z'), CAIRO)).toBe(
      '2026-11-05',
    );
    expect(dayOfWeek('2026-11-01')).toBe(0);
    expect(dayOfWeek('2026-11-07')).toBe(6);
  });

  it('parses only ISO strings that carry an offset', () => {
    expect(parseIsoWithOffset('2026-11-05T17:00:00+02:00')?.toISOString()).toBe(
      '2026-11-05T15:00:00.000Z',
    );
    expect(parseIsoWithOffset('2026-11-05T15:00:00Z')).not.toBeNull();
    expect(parseIsoWithOffset('2026-11-05T17:00:00')).toBeNull();
    expect(parseIsoWithOffset('2026-02-30T17:00:00+02:00')).toBeNull();
  });
});
