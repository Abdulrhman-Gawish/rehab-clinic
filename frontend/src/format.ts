// Locale-aware display formatting (ar-EG / en-GB), always in clinic time. Display only: values sent to the API
// stay ISO 8601 with offset, YYYY-MM-DD and decimal strings (see time.ts for those).
import { locale } from './i18n';
import { TZ } from './time';

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(), {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

/** A clinic local date ("2026-11-05"), shown as is (no time zone shift). */
export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2026-11" as month and year. */
export function fmtMonth(ym: string | null | undefined): string {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** 0 = Sunday. */
export function fmtWeekday(dayOfWeek: number): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(2023, 0, 1 + dayOfWeek)));
}

/** "HH:mm" wall time from the API (schedules). */
export function fmtWallTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(Date.UTC(2023, 0, 1, h, m)));
}

/** A decimal string from the API ("150.00") as EGP. `negate` shows it as a deduction. */
export function fmtMoney(amount: string | null | undefined, negate = false): string {
  if (amount == null || amount === '') return '';
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  const value = negate ? -n : n;
  // `value || 0` turns -0 into 0, so a zero deduction isn't shown as "-0.00".
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EGP' }).format(value || 0);
}

/** A percentage given as 0-100 ("10" or 12.5): "10%" / "١٠٪". */
export function fmtPercent(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 2 }).format(n / 100);
}

/** Counts and plain numbers. */
export function fmtNumber(n: number | string | null | undefined): string {
  if (n == null || n === '') return '';
  const value = Number(n);
  return Number.isNaN(value) ? String(n) : new Intl.NumberFormat(locale()).format(value);
}
