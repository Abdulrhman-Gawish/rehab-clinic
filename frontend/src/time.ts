// Africa/Cairo helpers using Intl only (DST-aware, no hardcoded offset). Also imported by the seed script.
export const TZ = 'Africa/Cairo';

const pad = (n: number) => String(n).padStart(2, '0');

function offsetMinutes(utcMs: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName')!.value; // "GMT+02:00" or "GMT"
  const m = name.match(/GMT([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** "2026-11-05" + "17:00" -> "2026-11-05T17:00:00+02:00" (clinic wall time). */
export function cairoIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMinutes(wall - 2 * 3600_000);
  off = offsetMinutes(wall - off * 60_000);
  const a = Math.abs(off);
  return `${date}T${pad(h)}:${pad(mi)}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Today's clinic local date, YYYY-MM-DD. */
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD -> the first day of its month. */
export const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;

/** The first day of last month (clinic local date): the default "from" of the report pages. */
export const firstOfLastMonth = () => firstOfMonth(addDays(firstOfMonth(todayCairo()), -1));

/** 0 = Sunday */
export function dayOfWeek(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

/** <input type="datetime-local"> value -> ISO with Cairo offset */
export function localInputToIso(value: string): string {
  return cairoIso(value.slice(0, 10), value.slice(11, 16));
}

// Display formatting (dates, times, money in the UI language) is in format.ts. The helpers here build
// machine values for the API and must not follow the UI locale.

/** An instant as clinic wall time: its local date (YYYY-MM-DD) and minutes since that day's midnight. */
export function cairoWall(iso: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
