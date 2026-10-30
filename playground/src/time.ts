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

/** Current clinic wall time, HH:mm. */
export function nowCairoHHmm(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday */
export function dayOfWeek(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

/** <input type="datetime-local"> value -> ISO with Cairo offset */
export function localInputToIso(value: string): string {
  return cairoIso(value.slice(0, 10), value.slice(11, 16));
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
