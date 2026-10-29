import { DateTime, IANAZone } from 'luxon';

// Pure helpers for converting clinic wall-clock times to UTC instants.
// The clinic zone (e.g. Africa/Cairo) observes DST, so offsets must always be
// resolved per date; never hardcode +02:00.

export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Wall-clock input (HH:mm). Values read from `time` columns may carry :ss.
export const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// ISO 8601 date-time that carries an explicit offset (or Z).
export const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type AmbiguityPolicy = 'earlier' | 'later';

export function isValidZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/**
 * Converts a local wall-clock time on a given local date to a UTC instant.
 *
 * - Ambiguous times (the repeated hour when clocks go back) resolve to the
 *   earlier or later occurrence depending on `ambiguity`.
 * - Non-existent times (the skipped hour when clocks go forward) shift
 *   forward by the gap, e.g. 00:30 -> 01:30 on Egypt's spring-forward night.
 */
export function localToUtc(
  date: string,
  time: string,
  zoneName: string,
  ambiguity: AmbiguityPolicy = 'earlier',
): Date {
  const zone = IANAZone.create(zoneName);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  // The wall time read as if it were UTC; real instants are this minus offset.
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);

  const offsets = new Set(
    [naive - DAY_MS, naive, naive + DAY_MS].map((ts) => zone.offset(ts)),
  );
  const candidates = [...offsets]
    .map((offset) => naive - offset * MINUTE_MS)
    .filter((ts) => zone.offset(ts) * MINUTE_MS === naive - ts)
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    // Inside a DST gap: let Luxon shift it forward.
    return DateTime.fromObject(
      { year, month, day, hour, minute, second },
      { zone },
    ).toJSDate();
  }
  return new Date(
    ambiguity === 'earlier' ? candidates[0] : candidates[candidates.length - 1],
  );
}

// ISO 8601 in the clinic zone with offset, e.g. 2026-11-05T17:00:00+02:00.
export function toZonedIso(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toISO({
    suppressMilliseconds: true,
  })!;
}

// Local calendar date (YYYY-MM-DD) of an instant in the clinic zone.
export function localDateOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toISODate()!;
}

// 0 = Sunday ... 6 = Saturday, for a local date.
export function dayOfWeek(date: string): number {
  return DateTime.fromISO(date, { zone: 'UTC' }).weekday % 7;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!;
}

export function isValidLocalDate(value: string): boolean {
  return LOCAL_DATE.test(value) && DateTime.fromISO(value).isValid;
}

// [start, end) of a local calendar day as UTC instants (23h/25h on DST days).
export function localDayBounds(
  date: string,
  zone: string,
): { start: Date; end: Date } {
  return {
    start: localToUtc(date, '00:00', zone, 'earlier'),
    end: localToUtc(addDays(date, 1), '00:00', zone, 'earlier'),
  };
}

export function parseIsoWithOffset(value: string): Date | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed.toJSDate() : null;
}
