import { localToUtc } from '../../../common/time/clinic-time.util.js';

// Pure slot computation. All instants are UTC Dates; schedule ranges are
// clinic-local wall-clock times converted per concrete date.

export interface Interval {
  start: Date;
  end: Date;
}

export interface LocalRange {
  // 'HH:mm' or 'HH:mm:ss'
  startTime: string;
  endTime: string;
}

const MINUTE_MS = 60_000;

export function overlaps(a: Interval, b: Interval): boolean {
  return (
    a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
  );
}

/**
 * Converts a doctor's local ranges for one local date to UTC windows.
 * On the fall-back night a range keeps its widest real extent (start at the
 * earlier, end at the later occurrence of an ambiguous wall time); on the
 * spring-forward night a time inside the gap moves forward with the clock.
 */
export function scheduleWindows(
  date: string,
  ranges: LocalRange[],
  zone: string,
): Interval[] {
  return ranges
    .map((range) => ({
      start: localToUtc(date, range.startTime, zone, 'earlier'),
      end: localToUtc(date, range.endTime, zone, 'later'),
    }))
    .filter((window) => window.end.getTime() > window.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface SlotOptions {
  durationMinutes: number;
  intervalMinutes: number;
  // Time off, existing appointments...
  blocked: Interval[];
  // Earliest allowed slot start (now + lead time).
  notBefore: Date;
}

/**
 * Candidate starts every `intervalMinutes` from each window's start; a slot
 * must fit entirely inside one window, start at/after `notBefore` and not
 * overlap any blocked interval.
 */
export function generateSlots(
  windows: Interval[],
  options: SlotOptions,
): Interval[] {
  const duration = options.durationMinutes * MINUTE_MS;
  const step = options.intervalMinutes * MINUTE_MS;
  const notBefore = options.notBefore.getTime();
  const slots: Interval[] = [];

  for (const window of windows) {
    const windowEnd = window.end.getTime();
    for (
      let start = window.start.getTime();
      start + duration <= windowEnd;
      start += step
    ) {
      if (start < notBefore) continue;
      const slot = { start: new Date(start), end: new Date(start + duration) };
      if (!options.blocked.some((busy) => overlaps(slot, busy))) {
        slots.push(slot);
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}
