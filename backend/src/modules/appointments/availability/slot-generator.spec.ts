import { toZonedIso } from '../../../common/time/clinic-time.util.js';
import {
  generateSlots,
  scheduleWindows,
  type Interval,
  type LocalRange,
} from './slot-generator.js';

const CAIRO = 'Africa/Cairo';
const LONG_AGO = new Date('2000-01-01T00:00:00Z');

const at = (iso: string) => new Date(iso);
const local = (slots: Interval[]) =>
  slots.map((slot) => toZonedIso(slot.start, CAIRO).slice(11, 16));

function slotsFor(
  date: string,
  ranges: LocalRange[],
  options: Partial<{
    durationMinutes: number;
    intervalMinutes: number;
    blocked: Interval[];
    notBefore: Date;
  }> = {},
): Interval[] {
  return generateSlots(scheduleWindows(date, ranges, CAIRO), {
    durationMinutes: 30,
    intervalMinutes: 15,
    blocked: [],
    notBefore: LONG_AGO,
    ...options,
  });
}

describe('slot generation', () => {
  // 2026-11-05 is a Thursday in winter (+02:00).
  const DATE = '2026-11-05';

  it('generates starts every interval that fully fit inside each range', () => {
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '10:00' }]);
    expect(local(slots)).toEqual(['09:00', '09:15', '09:30']);
    expect(toZonedIso(slots[0].start, CAIRO)).toBe('2026-11-05T09:00:00+02:00');
    expect(toZonedIso(slots[0].end, CAIRO)).toBe('2026-11-05T09:30:00+02:00');
  });

  it('handles multiple ranges per day (morning + evening) without crossing the gap', () => {
    const slots = slotsFor(
      DATE,
      [
        { startTime: '17:00', endTime: '18:00' },
        { startTime: '09:00', endTime: '10:00' },
      ],
      { durationMinutes: 45 },
    );
    // 09:15 + 45 = 10:00 fits; 09:30 would end 10:15, outside the range.
    expect(local(slots)).toEqual(['09:00', '09:15', '17:00', '17:15']);
  });

  it('drops starts whose service duration does not fit before the range ends', () => {
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '10:10' }], {
      durationMinutes: 60,
      intervalMinutes: 15,
    });
    expect(local(slots)).toEqual(['09:00']);
  });

  it('returns nothing when the service is longer than the range', () => {
    expect(
      slotsFor(DATE, [{ startTime: '09:00', endTime: '09:20' }], {
        durationMinutes: 30,
      }),
    ).toEqual([]);
  });

  it('excludes slots overlapping time off', () => {
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '11:00' }], {
      blocked: [
        {
          start: at('2026-11-05T09:20:00+02:00'),
          end: at('2026-11-05T10:00:00+02:00'),
        },
      ],
    });
    // 09:00-09:30 overlaps 09:20; first free start is 10:00.
    expect(local(slots)).toEqual(['10:00', '10:15', '10:30']);
  });

  it('excludes slots overlapping existing bookings but allows touching ones', () => {
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '10:30' }], {
      blocked: [
        {
          start: at('2026-11-05T09:30:00+02:00'),
          end: at('2026-11-05T10:00:00+02:00'),
        },
      ],
    });
    // 09:00-09:30 ends exactly when the booking starts: allowed.
    expect(local(slots)).toEqual(['09:00', '10:00']);
  });

  it('excludes past slots and slots inside the minimum lead time', () => {
    // "now" 08:50 local + 60 min lead -> earliest start 09:50.
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '11:00' }], {
      notBefore: at('2026-11-05T09:50:00+02:00'),
    });
    expect(local(slots)).toEqual(['10:00', '10:15', '10:30']);
  });

  it('respects a non-default interval', () => {
    const slots = slotsFor(DATE, [{ startTime: '09:00', endTime: '10:00' }], {
      intervalMinutes: 20,
      durationMinutes: 20,
    });
    expect(local(slots)).toEqual(['09:00', '09:20', '09:40']);
  });

  describe('DST in Egypt', () => {
    it('same wall-clock schedule maps to different UTC times in summer and winter', () => {
      const summer = slotsFor('2026-07-02', [
        { startTime: '09:00', endTime: '09:30' },
      ]);
      const winter = slotsFor('2026-11-05', [
        { startTime: '09:00', endTime: '09:30' },
      ]);
      expect(summer[0].start.toISOString()).toBe('2026-07-02T06:00:00.000Z');
      expect(winter[0].start.toISOString()).toBe('2026-11-05T07:00:00.000Z');
    });

    it('spring forward (2026-04-24): no slots in the skipped hour, real 1h window', () => {
      // Local 00:00-02:00 exists only from 01:00 (+03) on: one real hour.
      const slots = slotsFor('2026-04-24', [
        { startTime: '00:00', endTime: '02:00' },
      ]);
      expect(slots.map((s) => toZonedIso(s.start, CAIRO))).toEqual([
        '2026-04-24T01:00:00+03:00',
        '2026-04-24T01:15:00+03:00',
        '2026-04-24T01:30:00+03:00',
      ]);
    });

    it('spring forward: a normal daytime schedule is unaffected', () => {
      const slots = slotsFor('2026-04-24', [
        { startTime: '09:00', endTime: '10:00' },
      ]);
      expect(slots.map((s) => toZonedIso(s.start, CAIRO))).toEqual([
        '2026-04-24T09:00:00+03:00',
        '2026-04-24T09:15:00+03:00',
        '2026-04-24T09:30:00+03:00',
      ]);
    });

    it('fall back (2026-10-29): the repeated hour yields slots in both occurrences', () => {
      // Local 22:00 -> 23:59 spans 22:00(+03) .. 23:59(+02) = 2h59 real time.
      const slots = slotsFor(
        '2026-10-29',
        [{ startTime: '22:00', endTime: '23:59' }],
        { durationMinutes: 30, intervalMinutes: 30 },
      );
      // 19:00Z .. 21:59Z: the 21:30Z start would end at 22:00Z, too late.
      expect(slots.map((s) => toZonedIso(s.start, CAIRO))).toEqual([
        '2026-10-29T22:00:00+03:00',
        '2026-10-29T22:30:00+03:00',
        '2026-10-29T23:00:00+03:00',
        '2026-10-29T23:30:00+03:00',
        '2026-10-29T23:00:00+02:00',
      ]);
      // Strictly increasing real instants, no duplicates.
      const times = slots.map((s) => s.start.getTime());
      expect(new Set(times).size).toBe(times.length);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('fall back: a normal daytime schedule on the next day uses +02:00', () => {
      const slots = slotsFor('2026-10-30', [
        { startTime: '09:00', endTime: '09:30' },
      ]);
      expect(toZonedIso(slots[0].start, CAIRO)).toBe(
        '2026-10-30T09:00:00+02:00',
      );
      expect(slots[0].start.toISOString()).toBe('2026-10-30T07:00:00.000Z');
    });
  });
});
