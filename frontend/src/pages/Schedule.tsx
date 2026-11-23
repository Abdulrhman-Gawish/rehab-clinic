// The desk's day list as a calendar (OWNER, RECEPTIONIST): one column per doctor on a shared time axis (day view) or
// one column per day (week view), a separate walk-ins column, and a side panel with the details and the actions.
// Data: GET /appointments/day per shown day (the same rows and allowedActions as the table), the doctors' weekly
// schedules and time off for the working-hours shading. Nothing about the state machine is computed here.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { act, get, getSession, patch, qs } from '../api';
import { AppointmentTypePicker, matchesType, TypeBadge, TypeFilterChips, useDoctors } from '../components';
import { fmtDate, fmtMoney, fmtNumber, fmtTime, fmtWallTime, fmtWeekday } from '../format';
import { label, useI18n } from '../i18n';
import { addDays, cairoWall, dayOfWeek, todayCairo } from '../time';
import {
  Avatar, Badge, Button, ButtonLink, Card, cx, DescriptionList, Dialog, EmptyState, Field, FilterChip, Icon, IconButton, Input,
  Loading, PageHeader, Segmented, STATUS_TONES, StatusBadge, type IconName,
} from '../ui';
import { Ltr, useLoad } from '../util';
import { DayList, fmtLongDate, STATUSES, useRowActions, type Row } from './DayList';
import { NoteView } from './PatientRecords';
import '../styles/areas/desk.css';
import '../styles/areas/calendar.css';

type View = 'day' | 'week';
interface Schedule { doctorId: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }
interface TimeOff { id: string; doctorId: string; startAt: string; endAt: string; reason: string | null }
interface Span { start: number; end: number }
/** A doctor column: `active` doctors can be booked; `color` tells the columns apart (avatar only, never meaning). */
interface Doc { id: string; name: string; sub: string; color: string; active: boolean }
type Now = { date: string; minutes: number };

const STATUS_ICON: Record<string, IconName> = {
  PENDING: 'clock', CONFIRMED: 'calendar-check', ATTENDED: 'user-check', NO_SHOW: 'user-x', CANCELLED: 'ban', RESCHEDULED: 'switch-horizontal',
};
const DAY = 24 * 60;
/** Minutes per bookable slot (a click on a free slot opens the booking form at that time). */
const SLOT = 30;
const DOC_COLORS = 6;
const keyOf = (r: Row) => r.id ?? `walk-in:${r.visitId}`;
const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isVoid = (r: Row) => r.status === 'CANCELLED' || r.status === 'RESCHEDULED';
/** The week shown around a date: Saturday to Friday (the clinic's week). */
const weekStart = (date: string) => addDays(date, -((dayOfWeek(date) + 1) % 7));

/** The count pills, which double as quick status filters. */
const QUICK = [
  { key: 'total', statuses: [], tone: 'neutral' },
  { key: 'attended', statuses: ['ATTENDED'], tone: 'success' },
  { key: 'waiting', statuses: ['PENDING', 'CONFIRMED'], tone: 'info' },
  { key: 'noShow', statuses: ['NO_SHOW'], tone: 'error' },
] as const;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The API's status filter, applied here so the counts stay put while filtering (and a filter click needs no request):
 * walk-ins count as ATTENDED while their visit is active.
 */
function hasStatus(r: Row, statuses: readonly string[]): boolean {
  if (!statuses.length) return true;
  return r.isWalkIn ? statuses.includes('ATTENDED') && r.visitStatus === 'ACTIVE' : statuses.includes(r.status ?? '');
}

/** An instant's minutes on clinic day `date` (clamped to that day). */
function minutesOn(iso: string, date: string): number {
  const w = cairoWall(iso);
  return w.date < date ? 0 : w.date > date ? DAY : w.minutes;
}

/** The working ranges of the given doctors on a date (active weekly schedule rows). */
function workSpans(schedules: Record<string, Schedule[]> | undefined, doctorIds: string[], date: string): Span[] {
  const dow = dayOfWeek(date);
  return doctorIds.flatMap((id) => (schedules?.[id] ?? [])
    .filter((s) => s.isActive && s.dayOfWeek === dow)
    .map((s) => ({ start: hhmm(s.startTime), end: hhmm(s.endTime) })));
}

function offSpans(timeOff: Record<string, TimeOff[]> | undefined, doctorIds: string[], date: string) {
  return doctorIds.flatMap((id) => (timeOff?.[id] ?? [])
    .map((o) => ({ start: minutesOn(o.startAt, date), end: minutesOn(o.endAt, date), reason: o.reason, id: o.id }))
    .filter((o) => o.end > o.start));
}

/**
 * The slots a click can book on a doctor's day: inside the working hours, outside time off, not started yet. Only a
 * shortcut into the booking form, which still lists the free times itself (a slot may already be taken).
 */
function bookableSlots(work: Span[], off: Span[], date: string, now: Now): Span[] {
  if (date < now.date) return [];
  const earliest = date === now.date ? now.minutes : 0;
  return work.flatMap((w) => {
    const out: Span[] = [];
    for (let m = w.start; m < w.end; m += SLOT) {
      const s = { start: m, end: Math.min(m + SLOT, w.end) };
      if (s.start >= earliest && !off.some((o) => o.start < s.end && o.end > s.start)) out.push(s);
    }
    return out;
  });
}

interface Placed { row: Row; start: number; end: number; col: number; cols: number }

/**
 * Overlapping appointments side by side (the usual calendar layout): each group of transitively overlapping
 * appointments is split into as many lanes as it needs, and each appointment takes the first free lane.
 */
function place(rows: Row[], date: string): Placed[] {
  const items = rows
    .filter((r) => r.startAt && r.endAt)
    .map((r) => {
      const start = minutesOn(r.startAt!, date);
      return { row: r, start, end: Math.max(minutesOn(r.endAt!, date), start + 5), col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Placed[] = [];
  let lanes: number[] = [];
  let groupEnd = -1;
  const close = () => { group.forEach((p) => { p.cols = lanes.length; }); group = []; lanes = []; };
  for (const p of items) {
    if (p.start >= groupEnd) close();
    let lane = lanes.findIndex((end) => end <= p.start);
    if (lane < 0) { lane = lanes.length; lanes.push(p.end); } else lanes[lane] = p.end;
    p.col = lane;
    group.push(p);
    groupEnd = Math.max(groupEnd, p.end);
  }
  close();
  return items;
}

/** Position on the time axis (CSS turns minutes into pixels with --cal-hour-h). */
const at = (start: number, end: number, from: number): CSSProperties => ({ '--s': start - from, '--l': end - start } as CSSProperties);

function useNow(): Now {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const id = setInterval(() => setNow(new Date().toISOString()), 60_000); return () => clearInterval(id); }, []);
  return cairoWall(now);
}

/** /reception: the calendar for the desk (OWNER, RECEPTIONIST); a DOCTOR keeps their own day list there, as before. */
export function Schedule() {
  return getSession()?.user.role === 'DOCTOR' ? <DayList /> : <DeskCalendar />;
}

function DeskCalendar() {
  const { t } = useI18n();
  const dl = t.dayList;
  const tc = t.calendar;
  const [params, setParams] = useSearchParams();
  const today = todayCairo();
  const date = params.get('date') ?? today;
  const view: View = params.get('view') === 'week' ? 'week' : 'day';
  const status = params.getAll('status');
  // Appointment types shown (NO_TYPE = not set); none = every type.
  const types = params.getAll('type');
  const [doctors] = useDoctors();
  // An older link's ?doctorId= shows that doctor only (it becomes ?hide= on the next change).
  const only = params.get('doctorId');
  const hidden = only ? (doctors ?? []).map((d) => d.id).filter((id) => id !== only) : params.getAll('hide');
  const setFilter = (next: { date?: string; view?: View; status?: readonly string[]; hidden?: string[]; types?: string[] }) => {
    const p = new URLSearchParams();
    p.set('date', next.date ?? date);
    if ((next.view ?? view) === 'week') p.set('view', 'week');
    (next.status ?? status).forEach((s) => p.append('status', s));
    (next.hidden ?? hidden).forEach((id) => p.append('hide', id));
    (next.types ?? types).forEach((type) => p.append('type', type));
    setParams(p);
  };

  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i)) : [date];
  const daysKey = days.join(',');
  const from = days[0];
  const to = days[days.length - 1];
  // One request for the day or the whole week (the API allows up to 7 days with `to`), every status: the status
  // filter is applied here (hasStatus).
  const [loaded, reload, loading] = useLoad(async () => {
    const list = await get<Row[]>(`/appointments/day${qs({ date: from, to: to !== from ? to : undefined })}`);
    return { key: daysKey, list };
  }, [daysKey]);
  // Only the response for what is shown now (a reload keeps the current one on screen, so nothing jumps).
  const rows = loaded?.key === daysKey ? loaded.list : null;

  // Every doctor's weekly hours and time off for the shown days, in one request; grouped by doctor.
  const [hours] = useLoad(() => get<{ schedules: Schedule[]; timeOff: TimeOff[] }>(`/working-hours${qs({ from, to })}`), [daysKey]);
  const byDoctor = <T extends { doctorId: string }>(items: T[] | undefined) => items && items.reduce<Record<string, T[]>>(
    (acc, item) => { (acc[item.doctorId] ??= []).push(item); return acc; }, {},
  );
  const schedules = byDoctor(hours?.schedules);
  const timeOff = byDoctor(hours?.timeOff);

  // The side panel: the selected row is looked up in the latest data, so it follows reloads after an action.
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = (r: Row, el: HTMLElement) => { opener.current = el; setSelected(keyOf(r)); };
  const closePanel = () => {
    setSelected(null);
    const el = opener.current;
    if (el?.isConnected) el.focus({ preventScroll: true });
  };
  const { buttons, dialogs } = useRowActions(reload);

  // Columns: every active doctor, plus any doctor who has rows here but is no longer in the active list.
  const all = rows ?? [];
  const columns = new Map((doctors ?? []).map((d) => [d.id, { id: d.id, name: d.name, sub: d.specialty, active: true }]));
  all.forEach((r) => { if (!columns.has(r.doctor.id)) columns.set(r.doctor.id, { id: r.doctor.id, name: r.doctor.name, sub: '', active: false }); });
  const allDoctors: Doc[] = [...columns.values()].map((d, i) => ({ ...d, color: `var(--cal-doc-${(i % DOC_COLORS) + 1})` }));
  const shown = allDoctors.filter((d) => !hidden.includes(d.id));
  const shownIds = shown.map((d) => d.id);
  // The type filter, like the doctors, narrows what is counted; the status filter only what is drawn.
  const ofShown = all.filter((r) => !hidden.includes(r.doctor.id) && matchesType(r.type, types));
  const visible = ofShown.filter((r) => hasStatus(r, status));
  const toggleDoctor = (id: string) => setFilter({ hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  const toggleStatus = (s: string) => setFilter({ status: status.includes(s) ? status.filter((x) => x !== s) : [...status, s] });
  const toggleType = (type: string) => setFilter({ types: types.includes(type) ? types.filter((x) => x !== type) : [...types, type] });

  // The counts cover the shown doctors and types and every status, so they stay put while a status filter is on.
  const counts = Object.fromEntries(QUICK.map((q) => [q.key, ofShown.filter((r) => hasStatus(r, q.statuses)).length]));
  const quick = QUICK.find((q) => sameSet(q.statuses, status));
  // Filters the count pills do not show: hidden doctors, chosen types, or a mix of statuses no pill stands for.
  const extraFilters = hidden.length + types.length + (quick ? 0 : status.length);
  const [filtersOpen, setFiltersOpen] = useState(extraFilters > 0);

  const selectedRow = selected ? all.find((r) => keyOf(r) === selected) : undefined;

  const move = (n: number) => setFilter({ date: addDays(date, view === 'week' ? 7 * n : n) });
  const title = view === 'week'
    ? tc.weekRange(fmtDate(days[0]), fmtDate(days[6]))
    : fmtLongDate(date);

  // The title opens the browser's date picker; without showPicker() a plain date field is shown instead.
  const dateRef = useRef<HTMLInputElement>(null);
  const [typedDate, setTypedDate] = useState(false);
  const pickDate = () => {
    try { dateRef.current!.showPicker(); } catch { setTypedDate(true); }
  };
  const onDate = (value: string) => { if (value) setFilter({ date: value }); };

  return (
    <div className={cx('cal-page', selected && 'has-panel')}>
      <PageHeader
        title={dl.titleDesk}
        actions={<ButtonLink to="/reception/book" variant="primary" icon="calendar-plus">{dl.newBooking}</ButtonLink>}
      />
      <Card flush className="cal-card">
        <div className="cal-toolbar">
          <div className="cal-toolbar__nav">
            <Button size="sm" disabled={date === today} onClick={() => setFilter({ date: today })}>{t.ui.today}</Button>
            <span className="cal-toolbar__arrows">
              <IconButton icon="chevron-left" label={view === 'week' ? tc.prevWeek : t.ui.prevDay} onClick={() => move(-1)} />
              <IconButton icon="chevron-right" label={view === 'week' ? tc.nextWeek : t.ui.nextDay} onClick={() => move(1)} />
            </span>
            <div className="cal-toolbar__date">
              <h2 className="cal-toolbar__title">
                <button type="button" className="cal-toolbar__title-btn" onClick={pickDate} aria-label={tc.pickDate(title)}>
                  <span>{title}</span><Icon name="chevron-down" size={18} />
                </button>
              </h2>
              {days.includes(today) && <Badge tone="info">{t.ui.today}</Badge>}
              {typedDate
                ? <Input dense type="date" className="cal-toolbar__typed" aria-label={t.common.date} value={date} autoFocus onChange={(e) => onDate(e.target.value)} />
                : <input ref={dateRef} type="date" className="cal-toolbar__picker" tabIndex={-1} aria-hidden="true" value={date} onChange={(e) => onDate(e.target.value)} />}
            </div>
          </div>
          <div className="cal-toolbar__end">
            <Segmented
              className="cal-toolbar__view" label={tc.view} value={view} onChange={(v) => setFilter({ view: v })}
              options={[{ value: 'day', label: tc.day, icon: 'calendar' }, { value: 'week', label: tc.week, icon: 'calendar-days' }]}
            />
            <IconButton icon="refresh" label={t.common.refresh} onClick={reload} disabled={loading} />
          </div>
        </div>

        <div className="cal-filterbar">
          <div className="cal-kpis" role="group" aria-label={tc.quickFilter}>
            {QUICK.map((q) => (
              <button
                key={q.key} type="button" className={cx('cal-kpi', `cal-kpi--${q.tone}`)} aria-pressed={quick?.key === q.key}
                onClick={() => setFilter({ status: q.key !== 'total' && quick?.key === q.key ? [] : q.statuses })}
              >
                <span className="cal-kpi__dot" aria-hidden="true" />
                <span>{dl.stats[q.key]}</span>
                <span className="cal-kpi__value">{rows ? fmtNumber(counts[q.key]) : '…'}</span>
              </button>
            ))}
          </div>
          <div className="cal-filterbar__end">
            {(status.length > 0 || hidden.length > 0 || types.length > 0) && (
              <Button size="sm" variant="ghost" icon="x" onClick={() => setFilter({ status: [], hidden: [], types: [] })}>{t.ui.clearFilters}</Button>
            )}
            <Button
              size="sm" variant={filtersOpen ? 'secondary' : 'outline'} icon="filter" iconEnd={filtersOpen ? 'chevron-up' : 'chevron-down'}
              aria-expanded={filtersOpen} aria-controls="cal-filters" onClick={() => setFiltersOpen((o) => !o)}
            >
              {tc.filters}{extraFilters > 0 && <span className="cal-count cal-count--brand">{fmtNumber(extraFilters)}</span>}
            </Button>
          </div>
        </div>
        {filtersOpen && (
          <div id="cal-filters" className="cal-filters">
            <Field group label={tc.doctors} hint={tc.doctorsHint}>
              <div className="filter-chips">
                {allDoctors.map((d) => (
                  <FilterChip key={d.id} icon="stethoscope" pressed={!hidden.includes(d.id)} onClick={() => toggleDoctor(d.id)}>{d.name}</FilterChip>
                ))}
                {hidden.length > 0 && <Button size="sm" variant="ghost" icon="eye" onClick={() => setFilter({ hidden: [] })}>{tc.showAll}</Button>}
              </div>
            </Field>
            <Field group label={t.apptType.label} hint={tc.typesHint}>
              <TypeFilterChips value={types} onToggle={toggleType} />
            </Field>
            <Field group label={dl.status} hint={dl.statusHint}>
              <div className="filter-chips">
                {STATUSES.map((s) => (
                  <FilterChip key={s} pressed={status.includes(s)} onClick={() => toggleStatus(s)}>{label(t.enums.AppointmentStatus, s)}</FilterChip>
                ))}
              </div>
            </Field>
          </div>
        )}

        {!rows || !doctors ? <Loading /> : view === 'day' && shown.length === 0 ? (
          <EmptyState icon="stethoscope" title={tc.noDoctors} text={tc.noDoctorsHint}
            action={<Button icon="eye" onClick={() => setFilter({ hidden: [] })}>{tc.showAll}</Button>} />
        ) : (
          <Calendar
            view={view} days={days} rows={visible} doctors={shown} doctorIds={shownIds} schedules={schedules} timeOff={timeOff}
            selected={selected} busy={loading} onOpen={open} onOpenDay={(d) => setFilter({ date: d, view: 'day' })}
          />
        )}
        <Legend bookable={view === 'day'} />
      </Card>
      {selected && (
        <DetailsPanel row={selectedRow} onClose={closePanel} actions={selectedRow ? buttons(selectedRow, 'md') : null} onChanged={reload} />
      )}
      {dialogs}
    </div>
  );
}

// ---------- The grid ----------

function Calendar({ view, days, rows, doctors, doctorIds, schedules, timeOff, selected, busy, onOpen, onOpenDay }: {
  view: View; days: string[]; rows: Row[]; doctors: Doc[]; doctorIds: string[];
  schedules?: Record<string, Schedule[]>; timeOff?: Record<string, TimeOff[]>; selected: string | null; busy: boolean;
  onOpen: (r: Row, el: HTMLElement) => void; onOpenDay: (date: string) => void;
}) {
  const { t } = useI18n();
  const tc = t.calendar;
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const booked = rows.filter((r) => !r.isWalkIn);
  const walkIns = rows.filter((r) => r.isWalkIn).sort((a, b) => (a.attendedAt ?? '').localeCompare(b.attendedAt ?? ''));

  // One column per doctor (day) or per day (week); each with its rows, its working / time-off shading and (day view,
  // active doctors) the free slots a click books.
  const cols = view === 'day'
    ? doctors.map((d) => {
      const work = workSpans(schedules, [d.id], days[0]);
      const off = offSpans(timeOff, [d.id], days[0]);
      const own = booked.filter((r) => r.doctor.id === d.id);
      return {
        key: d.id, date: days[0], rows: own, work, off,
        slots: schedules && d.active ? bookableSlots(work, off, days[0], now) : [],
        head: <DoctorHead doctor={d} work={schedules ? work : null} count={own.filter((r) => !isVoid(r)).length} canBook={d.active && days[0] >= now.date} date={days[0]} />,
      };
    })
    : days.map((d) => {
      const dayName = `${fmtWeekday(dayOfWeek(d))} ${fmtDate(d)}`;
      return {
        key: d, date: d, rows: booked.filter((r) => r.startAt && cairoWall(r.startAt).date === d),
        work: workSpans(schedules, doctorIds, d),
        // Time off only means something for one doctor.
        off: doctorIds.length === 1 ? offSpans(timeOff, doctorIds, d) : [],
        slots: [] as Span[],
        head: (
          <button type="button" className={cx('cal__day-link', d === now.date && 'is-today')} onClick={() => onOpenDay(d)} aria-label={tc.openDay(dayName)}>
            <span className="cal__dow">{fmtWeekday(dayOfWeek(d))}</span>
            <span className="cal__dom">{fmtNumber(Number(d.slice(8, 10)))}</span>
          </button>
        ),
      };
    });

  // The hours shown: 09:00-17:00 at least, widened to every working range and appointment shown.
  let from = 9 * 60;
  let to = 17 * 60;
  cols.forEach((c) => {
    c.work.forEach((s) => { from = Math.min(from, s.start); to = Math.max(to, s.end); });
    c.rows.forEach((r) => { from = Math.min(from, minutesOn(r.startAt!, c.date)); to = Math.max(to, minutesOn(r.endAt!, c.date)); });
  });
  from = Math.max(0, Math.floor(from / 60) * 60);
  to = Math.min(DAY, Math.ceil(to / 60) * 60);
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60);
  const showWalkIns = view === 'day';
  const showNow = days.includes(now.date) && now.minutes >= from && now.minutes <= to;
  const rowsTemplate = showWalkIns ? 'auto auto' : 'auto auto auto';
  // Overlapping appointments sit side by side; a column that needs more lanes gets wider (the grid scrolls sideways)
  // instead of squeezing the cards until nothing can be read.
  const placed = cols.map((c) => place(c.rows, c.date));
  const widths = placed.map((ps) => {
    const lanes = Math.max(1, ...ps.map((p) => p.cols));
    return lanes > 1 ? `minmax(max(var(--cal-col-min), calc(${lanes} * var(--cal-lane-min))), 1fr)` : 'minmax(var(--cal-col-min), 1fr)';
  });
  const template = `var(--cal-axis-w)${showWalkIns ? ' var(--cal-walkin-w)' : ''} ${widths.join(' ')}`;
  const bodyStyle = { '--cal-len': to - from } as CSSProperties;

  // Scroll to the part of the day that matters, once per day / week shown (and again when the working hours arrive,
  // which can widen the range): around now on today, else the first working hour or appointment. Reloads after an
  // action keep the scroll position.
  const scrollKey = `${view}|${days[0]}|${schedules ? 1 : 0}`;
  const scrolledFor = useRef('');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    const hourH = parseFloat(getComputedStyle(el).getPropertyValue('--cal-hour-h')) || 96;
    const starts = cols.flatMap((c) => [...c.work.map((s) => s.start), ...c.rows.map((r) => minutesOn(r.startAt!, c.date))]);
    const target = showNow ? now.minutes - 90 : Math.min(...starts) - 30;
    el.scrollTop = Number.isFinite(target) ? Math.max(0, ((target - from) * hourH) / 60) : 0;
  });

  return (
    <div className={cx('cal', busy && 'is-busy')}>
      <div ref={scrollRef} className="cal__scroll" role="region" aria-label={t.dayList.titleDesk} tabIndex={0}>
        <div className="cal__grid" style={{ gridTemplateColumns: template, gridTemplateRows: rowsTemplate }}>
          {/* Header row */}
          <div className="cal__corner" aria-hidden="true" />
          {showWalkIns && (
            <div className="cal__head cal__head--walkin">
              <div className="cal__res">
                <span className="cal__res-icon" aria-hidden="true"><Icon name="user-plus" size={16} /></span>
                <span className="cal__res-text">
                  <span className="cal__head-title">
                    <span className="cal__res-name">{tc.walkIns}</span>
                    <span className="cal-count cal-count--accent">{fmtNumber(walkIns.length)}</span>
                  </span>
                  <span className="cal__head-sub">{tc.byArrival}</span>
                </span>
                {days[0] === now.date && (
                  <Link className="icon-btn cal__add" to="/reception/book?mode=walkIn" aria-label={tc.addWalkIn} title={tc.addWalkIn}>
                    <Icon name="plus" />
                  </Link>
                )}
              </div>
            </div>
          )}
          {cols.map((c) => <div key={c.key} className="cal__head">{c.head}</div>)}

          {/* Week: the walk-ins of each day in their own row (like an all-day row), never on the time axis. */}
          {!showWalkIns && (
            <>
              <div className="cal__band-label"><Icon name="user-plus" size={14} /> {tc.walkIns}</div>
              {cols.map((c) => {
                const list = walkIns.filter((r) => r.attendedAt && cairoWall(r.attendedAt).date === c.date);
                return (
                  <div key={c.key} className="cal__band">
                    {list.map((r) => <WalkInCard key={keyOf(r)} row={r} compact selected={selected === keyOf(r)} onOpen={onOpen} />)}
                  </div>
                );
              })}
            </>
          )}

          {/* Body row */}
          <div className="cal__axis" style={bodyStyle} aria-label={tc.timeAxis}>
            {hours.map((h) => (
              <span key={h} className="cal__hour" style={at(h, h + 60, from)}>{fmtWallTime(toHhmm(h))}</span>
            ))}
            {showNow && <span className="cal__now-label" style={at(now.minutes, now.minutes, from)}>{fmtWallTime(toHhmm(now.minutes))}</span>}
          </div>
          {showWalkIns && (
            <div className="cal__walkins" style={bodyStyle}>
              <div className="cal__walkins-list">
                {walkIns.length === 0 ? <p className="cal__walkins-empty">{tc.noWalkIns}</p> : walkIns.map((r) => (
                  <WalkInCard key={keyOf(r)} row={r} selected={selected === keyOf(r)} onOpen={onOpen} />
                ))}
              </div>
            </div>
          )}
          {cols.map((c, i) => (
            <div key={c.key} className={cx('cal__col', i === 0 && 'cal__col--first')} style={bodyStyle}>
              {c.work.map((s, i) => <div key={i} className="cal__work" style={at(s.start, s.end, from)} />)}
              {c.off.map((o) => (
                <div key={o.id} className="cal__off" style={at(o.start, o.end, from)} title={o.reason ?? tc.timeOff}>
                  <span>{tc.timeOff}{o.reason && ` · ${o.reason}`}</span>
                </div>
              ))}
              {/* A mouse shortcut only (out of the tab order): the column header's + and "New booking" do the same. */}
              {c.slots.map((s) => (
                <Link
                  key={s.start} className="cal__slot" style={at(s.start, s.end, from)} tabIndex={-1} aria-hidden="true" draggable={false}
                  to={`/reception/book${qs({ doctorId: c.key, date: c.date, time: toHhmm(s.start) })}`}
                >
                  <Icon name="plus" size={12} />{fmtWallTime(toHhmm(s.start))}
                </Link>
              ))}
              {c.date === now.date && showNow && (
                <div className="cal__now" style={at(now.minutes, now.minutes, from)} aria-label={tc.now} />
              )}
              {placed[i].map((p) => (
                <EventCard key={keyOf(p.row)} placed={p} from={from} week={view === 'week'} selected={selected === keyOf(p.row)} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A doctor's column header: avatar, name and live appointments, specialty and today's working hours, and "+" to book. */
function DoctorHead({ doctor: d, work, count, canBook, date }: {
  doctor: Doc; work: Span[] | null; count: number; canBook: boolean; date: string;
}) {
  const { t } = useI18n();
  const tc = t.calendar;
  const hours = work && (work.length ? work.map((s) => `${fmtWallTime(toHhmm(s.start))}–${fmtWallTime(toHhmm(s.end))}`).join(', ') : tc.dayOff);
  return (
    <div className="cal__res">
      <span className="cal__avatar" style={{ '--doc': d.color } as CSSProperties}><Avatar name={d.name} size={30} /></span>
      <span className="cal__res-text">
        <span className="cal__head-title">
          {/* dir="auto": a Latin name in the Arabic UI is cut at its own end. */}
          <span className="cal__res-name" dir="auto" title={d.name}>{d.name}</span>
          <span className="cal-count" title={tc.booked(fmtNumber(count))}>
            <span aria-hidden="true">{fmtNumber(count)}</span><span className="visually-hidden">{tc.booked(fmtNumber(count))}</span>
          </span>
        </span>
        {/* The specialty only when the column is wide enough (calendar.css). */}
        <span className="cal__head-sub" title={[hours, d.sub].filter(Boolean).join(' · ')}>
          {hours && <span className="tabular">{hours}</span>}
          {d.sub && <span className="cal__spec">{hours && ' · '}{d.sub}</span>}
        </span>
      </span>
      {canBook && (
        <Link className="icon-btn cal__add" to={`/reception/book${qs({ doctorId: d.id, date })}`} aria-label={tc.bookWith(d.name)} title={tc.bookWith(d.name)}>
          <Icon name="plus" />
        </Link>
      )}
    </div>
  );
}

function EventCard({ placed, from, week, selected, onOpen }: {
  placed: Placed; from: number; week: boolean; selected: boolean; onOpen: (r: Row, el: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const { row: r, start, end, col, cols } = placed;
  const status = r.status ?? '';
  const tone = STATUS_TONES.AppointmentStatus?.[status] ?? 'neutral';
  const statusText = label(t.enums.AppointmentStatus, status);
  const time = `${fmtTime(r.startAt)}–${fmtTime(r.endAt)}`;
  const style = { ...at(start, end, from), '--c': col, '--n': cols } as CSSProperties;
  const typeText = r.type ? label(t.enums.AppointmentType, r.type) : '';
  const text = `${r.patient.name}, ${time}, ${week ? `${r.doctor.name}, ` : ''}${r.service.name}, ${typeText ? `${typeText}, ` : ''}${statusText}`;
  // The status icon always sits before the name (status never by colour alone); the status pill needs a wide card.
  return (
    <button
      type="button" style={style} aria-pressed={selected} onClick={(e) => onOpen(r, e.currentTarget)} aria-label={text} title={text}
      className={cx('cal-event', `cal-event--${tone}`, isVoid(r) && 'is-void', end - start < 30 && 'is-short', selected && 'is-selected')}
    >
      <span className="cal-event__top">
        <span className="cal-event__name"><Icon name={STATUS_ICON[status] ?? 'info'} size={12} /><span dir="auto">{r.patient.name}</span></span>
        <span className="cal-event__pill">{statusText}</span>
      </span>
      <span className="cal-event__line">
        <span className="cal-event__time">{time}</span>
        {typeText && <span className="cal-event__type">{typeText}</span>}
        <span className="cal-event__meta">{week ? `${r.doctor.name} · ${r.service.name}` : r.service.name}</span>
      </span>
    </button>
  );
}

function WalkInCard({ row: r, selected, compact, onOpen }: {
  row: Row; selected: boolean; compact?: boolean; onOpen: (r: Row, el: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const voided = r.visitStatus === 'VOIDED';
  if (compact) {
    return (
      <button
        type="button" aria-pressed={selected} onClick={(e) => onOpen(r, e.currentTarget)}
        className={cx('cal-walkin cal-walkin--compact', voided && 'is-void', selected && 'is-selected')}
        aria-label={`${t.booking.walkIn}: ${r.patient.name}, ${fmtTime(r.attendedAt)}, ${r.doctor.name}, ${label(t.enums.VisitStatus, r.visitStatus)}`}
      >
        <span className="cal-event__time">{fmtTime(r.attendedAt)}</span> <span className="cal-event__name">{r.patient.name}</span>
      </button>
    );
  }
  return (
    <button
      type="button" aria-pressed={selected} onClick={(e) => onOpen(r, e.currentTarget)}
      className={cx('cal-walkin', voided && 'is-void', selected && 'is-selected')}
    >
      <span className="cal-walkin__top">
        <span className="cal-event__name" dir="auto">{r.patient.name}</span>
        <span className="cal-event__time"><Icon name="log-in" size={12} />{fmtTime(r.attendedAt)}</span>
      </span>
      <span className="cal-event__meta">{r.doctor.name} · {r.service.name}</span>
      <span className="cal-event__status">
        <Icon name={voided ? 'x-circle' : 'user-check'} size={12} />{label(t.enums.VisitStatus, r.visitStatus)}
        {r.type && <span className="cal-event__type">{label(t.enums.AppointmentType, r.type)}</span>}
      </span>
    </button>
  );
}

/** What the shading, the colours and the dashes mean, under the grid. */
function Legend({ bookable }: { bookable: boolean }) {
  const { t } = useI18n();
  const tc = t.calendar;
  const status = (s: string) => label(t.enums.AppointmentStatus, s);
  const items: [string, string][] = [
    ['work', tc.workHours], ['off-hours', tc.offHours], ['time-off', tc.timeOff],
    ['warning', status('PENDING')], ['info', status('CONFIRMED')], ['success', status('ATTENDED')], ['error', status('NO_SHOW')],
    ['void', tc.voided],
  ];
  return (
    <footer className="cal-legend">
      <ul className="cal-legend__items">
        {items.map(([key, text]) => (
          <li key={key}><span className={`cal-legend__swatch cal-legend__swatch--${key}`} aria-hidden="true" />{text}</li>
        ))}
      </ul>
      <span className="cal-legend__hint">{bookable ? tc.hintDay : tc.hintWeek}</span>
    </footer>
  );
}

// ---------- Side panel ----------

type Pair = [ReactNode, ReactNode];
/** Description-list rows; any falsy entry (a condition that did not hold) is skipped. */
const pairs = (items: (Pair | false | null | undefined | '' | 0)[]) => items.filter((x): x is Pair => !!x);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cal-panel__section"><h3 className="cal-panel__title">{title}</h3>{children}</section>;
}

/**
 * The selected appointment or walk-in, beside the calendar (non-modal: the calendar stays usable behind it). Shows the
 * day-list row (billing fields only come for roles allowed to see them) and the patient's overview. The RECEPTIONIST
 * may change the appointment type here; clinical text is shown to the OWNER only (read-only), never to reception.
 */
function DetailsPanel({ row: r, onClose, actions, onChanged }: {
  row: Row | undefined; onClose: () => void; actions: ReactNode; onChanged: () => void;
}) {
  const { t } = useI18n();
  const tp = t.calendar.panel;
  const dl = t.dayList;
  const role = getSession()?.user.role;
  const [changingType, setChangingType] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const patientId = r?.patient.id;
  const [overview] = useLoad(() => (patientId ? get(`/patients/${patientId}/overview`) : Promise.resolve(null)), [patientId]);

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape in an action dialog closes that dialog only.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const o = overview?.patient?.id === patientId ? overview : null;
  const date = r && (r.isWalkIn ? r.attendedAt : r.startAt);
  const when = r && date && `${fmtLongDate(cairoWall(date).date)} · ${r.isWalkIn ? fmtTime(r.attendedAt) : `${fmtTime(r.startAt)}–${fmtTime(r.endAt)}`}`;
  const actionList = Array.isArray(actions) ? actions.filter(Boolean) : actions;
  const hasActions = Array.isArray(actionList) ? actionList.length > 0 : !!actionList;
  const billing = r && (r.invoiceId || r.paymentStatus || r.invoiceStatus);
  const tone = r ? (r.isWalkIn ? (r.visitStatus === 'VOIDED' ? 'neutral' : 'success') : STATUS_TONES.AppointmentStatus?.[r.status ?? ''] ?? 'neutral') : 'neutral';

  return (
    <aside className={cx('cal-panel', `cal-panel--${tone}`)} role="dialog" aria-modal="false" aria-labelledby="cal-panel-title">
      <header className="cal-panel__header">
        <div className="cal-panel__heading">
          <span className="cal-panel__kicker">{r?.isWalkIn ? tp.walkIn : tp.appointment}</span>
          <h2 id="cal-panel-title" className="cal-panel__name">{r?.patient.name ?? '—'}</h2>
          {when && <p className="cal-panel__when tabular">{when}</p>}
          {r && (
            <div className="daylist-badges">
              <TypeBadge type={r.type} />
              {r.isWalkIn ? <Badge tone="info" dot>{t.booking.walkIn}</Badge> : <StatusBadge kind="AppointmentStatus" value={r.status} />}
              {r.visitStatus && (r.visitStatus === 'VOIDED' || r.isWalkIn) && <StatusBadge kind="VisitStatus" value={r.visitStatus} dot={false} />}
            </div>
          )}
        </div>
        <IconButton ref={closeRef} icon="x" size="md" label={tp.close} onClick={onClose} />
      </header>

      {!r ? <div className="cal-panel__body"><EmptyState compact icon="alert-circle" title={tp.gone} /></div> : (
        <div className="cal-panel__body">
          <Section title={tp.actions}>
            {hasActions ? <div className="cal-panel__actions">{actionList}</div> : <p className="text-muted text-body-sm">{tp.noActions}</p>}
          </Section>

          <Section title={tp.patient}>
            <DescriptionList items={pairs([
              [tp.phone, <Ltr>{r.patient.phone}</Ltr>],
              r.nameMismatch && [dl.col.patient, <Badge tone="warning">{dl.bookedAs(r.bookedName ?? '')}</Badge>],
              o && [tp.patientSource, <StatusBadge kind="PatientSource" value={o.patient.createdSource} dot={false} />],
              o && [tp.patientSince, fmtDate(cairoWall(o.patient.createdAt).date)],
              o?.counts && [tp.attendedCount, `${fmtNumber(o.counts.attended)} · ${tp.noShowCount}: ${fmtNumber(o.counts.noShow)}`],
              o?.balance && [tp.patientBalance, <span className="tabular">{fmtMoney(o.balance.balance)}</span>],
            ])} />
            <div className="cluster">
              <ButtonLink size="sm" variant="outline" icon="user" to={`/patients/${r.patient.id}`}>{tp.openPatient}</ButtonLink>
              <ButtonLink size="sm" variant="ghost" icon="calendar-plus" to={`/reception/book${qs({ phone: r.patient.phone })}`}>{tp.bookAgain}</ButtonLink>
            </div>
          </Section>

          <Section title={tp.details}>
            <DescriptionList items={pairs([
              !r.isWalkIn && r.referenceCode && [tp.reference, <Ltr>{r.referenceCode}</Ltr>],
              [tp.doctor, r.doctor.name],
              [tp.service, r.service.name],
              [t.apptType.label, <span className="cluster">
                <TypeBadge type={r.type} />
                {role === 'RECEPTIONIST' && (
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => setChangingType(true)}>{t.apptType.change}</Button>
                )}
              </span>],
              date && [tp.date, fmtLongDate(cairoWall(date).date)],
              r.isWalkIn
                ? [tp.arrived, <span className="tabular">{fmtTime(r.attendedAt)}</span>]
                : [tp.time, <span className="tabular">{fmtTime(r.startAt)}–{fmtTime(r.endAt)}</span>],
              !r.isWalkIn && r.startAt && r.endAt && [tp.duration, tp.minutes(fmtNumber(Math.round((Date.parse(r.endAt) - Date.parse(r.startAt)) / 60000)))],
              !r.isWalkIn && r.source && [tp.source, <StatusBadge kind="AppointmentSource" value={r.source} dot={false} />],
              r.notes && [tp.notes, <span className="pre-line">{r.notes}</span>],
              r.cancelReason && [tp.reason, r.cancelReason],
              r.package && [tp.package, `${r.package.name} · ${dl.used(fmtNumber(r.package.used), fmtNumber(r.package.total))}`],
              !r.package && r.requestedPackage && [tp.package, <Badge tone="accent" icon="package">{dl.wants(r.requestedPackage.name)}</Badge>],
            ])} />
          </Section>

          {(r.visitId || billing) && (
            <Section title={tp.visitBilling}>
              <DescriptionList items={pairs([
                r.visitStatus && [tp.visit, <StatusBadge kind="VisitStatus" value={r.visitStatus} dot={false} />],
                !r.isWalkIn && r.attendedAt && [tp.arrived, <span className="tabular">{fmtTime(r.attendedAt)}</span>],
                r.noteStatus && [tp.note, <StatusBadge kind="NoteStatus" value={r.noteStatus} dot={false} />],
                billing && [tp.payment, r.invoiceStatus === 'CANCELLED'
                  ? <Badge tone="error" dot>{dl.invoiceCancelled}</Badge>
                  : <StatusBadge kind="DayPaymentStatus" value={r.paymentStatus} />],
                r.invoiceTotal && [tp.total, <span className="tabular">{fmtMoney(r.invoiceTotal)}</span>],
                r.balance && [tp.balance, <span className="tabular">{fmtMoney(r.balance)}</span>],
              ])} />
              {r.invoiceId && (
                <div className="cluster">
                  <ButtonLink size="sm" variant="outline" icon="receipt" to={`/reception/invoices/${r.invoiceId}`}>{tp.openInvoice}</ButtonLink>
                </div>
              )}
            </Section>
          )}

          {/* Clinical notes: the OWNER only (read-only, drafts too). Reception never loads them. */}
          {role === 'OWNER' && r.visitId && r.visitStatus === 'ACTIVE' && (
            <Section title={tp.clinicalNote}>
              <PanelNote key={r.visitId} visitId={r.visitId} />
            </Section>
          )}
        </div>
      )}
      {changingType && r && (
        <ChangeType row={r} onClose={() => setChangingType(false)} onDone={() => { setChangingType(false); onChanged(); }} />
      )}
    </aside>
  );
}

/** The visit's note for the OWNER, read-only (remounted per visit, so another visit's note never shows meanwhile). */
function PanelNote({ visitId }: { visitId: string }) {
  const { t } = useI18n();
  const [note, , loading] = useLoad(() => get(`/visits/${visitId}/note`), [visitId]);
  if (note) return <NoteView note={note} />;
  return loading || note === undefined ? <Loading /> : <p className="text-muted text-body-sm">{t.calendar.panel.noNote}</p>;
}

/** RECEPTIONIST: set or change the type of an appointment (any status) or of a walk-in (through its visit). */
function ChangeType({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [type, setType] = useState(row.type ?? '');
  const path = row.isWalkIn ? `/visits/${row.visitId}/type` : `/appointments/${row.id}/type`;
  const save = async () => {
    if (await act(() => patch(path, { type }), t.apptType.changed)) onDone();
  };
  return (
    <Dialog
      open onClose={onClose} title={t.apptType.changeTitle} description={t.apptType.changeHint}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="check" disabled={!type || type === row.type} onClick={save}>{t.common.save}</Button>
      </>}
    >
      <AppointmentTypePicker value={type} onChange={setType} />
    </Dialog>
  );
}
