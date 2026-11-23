// Domain pickers shared by several areas (desk booking, day list, owner services and packages), the paged-list hook,
// and the invoice replacement (correct / create invoice) used by the invoice page and the day list.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { act, get, notify, post, qs } from './api';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent, fmtTime, fmtWeekday } from './format';
import { label, msg, useI18n } from './i18n';
import { addDays, cairoWall, dayOfWeek, todayCairo } from './time';
import { APPOINTMENT_TYPES, type AppointmentType } from './noteFields';
import {
  Alert, askReason, Badge, Card, Checkbox, confirmAction, EmptyState, Field, FilterChip, IconButton, Input, Pagination, Select,
  Button, Loading, Segmented, StatusBadge, Totals, TotalsRow,
} from './ui';
import { Ltr, useLoad } from './util';

export interface Doctor {
  id: string; name: string; specialty: string; isActive: boolean; isPublic: boolean; email: string; phone: string | null;
  services: { serviceId: string; name: string; durationMinutes: number; price: string; basePrice: string; priceOverride: string | null; isActive: boolean }[];
}

export function useDoctors(activeOnly = true) {
  return useLoad(() => get<{ items: Doctor[] }>(`/doctors${qs({ limit: 100, isActive: activeOnly ? true : undefined })}`).then((r) => r.items), []);
}

/**
 * The appointment type (examination / follow-up / session): required, with no default ('' = nothing chosen yet).
 * Used by the public booking, the desk booking and walk-in forms, and the change-type dialog.
 */
export function AppointmentTypePicker({ value, onChange, label: fieldLabel, hint }: {
  value: string; onChange: (type: AppointmentType) => void; label?: string; hint?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Field group label={fieldLabel ?? t.apptType.label} hint={hint}>
      <Segmented
        block label={fieldLabel ?? t.apptType.label} value={value as AppointmentType} onChange={onChange}
        options={APPOINTMENT_TYPES.map((type) => ({ value: type, label: label(t.enums.AppointmentType, type) }))}
      />
    </Field>
  );
}

/** In type filters: appointments and walk-ins without a type (booked before types existed). */
export const NO_TYPE = 'NONE';

/** True when a row's type passes a type filter; an empty filter passes every row. */
export const matchesType = (type: string | null | undefined, types: readonly string[]) =>
  types.length === 0 || types.includes(type ?? NO_TYPE);

/** Appointment type filter chips (several can be on; none = every type), with "Type not set" last. */
export function TypeFilterChips({ value, onToggle }: { value: readonly string[]; onToggle: (type: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="filter-chips">
      {[...APPOINTMENT_TYPES, NO_TYPE].map((type) => (
        <FilterChip key={type} pressed={value.includes(type)} onClick={() => onToggle(type)}>
          {type === NO_TYPE ? t.apptType.notSet : label(t.enums.AppointmentType, type)}
        </FilterChip>
      ))}
    </div>
  );
}

/** The type as a badge; "Type not set" for appointments booked before types existed. */
export function TypeBadge({ type }: { type: string | null | undefined }) {
  const { t } = useI18n();
  if (!type) return <Badge tone="outline">{t.apptType.notSet}</Badge>;
  return <StatusBadge kind="AppointmentType" value={type} dot={false} />;
}

/** Doctor select + service select (services of that doctor), side by side from sm. */
export function DoctorService({ doctorId, serviceId, onChange }: {
  doctorId: string; serviceId: string; onChange: (doctorId: string, serviceId: string) => void;
}) {
  const { t } = useI18n();
  const [doctors] = useDoctors();
  const doctor = doctors?.find((d) => d.id === doctorId);
  return (
    <div className="form-grid form-grid--2">
      <Field label={t.picker.doctor}>
        <Select value={doctorId} onChange={(e) => onChange(e.target.value, '')}>
          <option value="">{t.picker.pickDoctor}</option>
          {doctors?.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.specialty}</option>)}
        </Select>
      </Field>
      <Field label={t.picker.service}>
        <Select value={serviceId} disabled={!doctor} onChange={(e) => onChange(doctorId, e.target.value)}>
          <option value="">{t.picker.pickService}</option>
          {doctor?.services.filter((s) => s.isActive).map((s) => (
            <option key={s.serviceId} value={s.serviceId}>{t.picker.serviceOption(s.name, fmtNumber(s.durationMinutes), fmtMoney(s.price))}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export interface DoctorChoice { all: boolean; ids: string[] }
export const doctorBody = (c: DoctorChoice) => (c.all ? { allDoctors: true } : { doctorIds: c.ids });

/** "All doctors" or a chip per active doctor (services: all active now; packages: also doctors added later). */
export function DoctorPicker({ value, onChange, allLabel }: { value: DoctorChoice; onChange: (c: DoctorChoice) => void; allLabel: string }) {
  const [doctors] = useDoctors();
  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] });
  return (
    <div className="stack-sm">
      <Checkbox label={<strong>{allLabel}</strong>} checked={value.all} onChange={(all) => onChange({ ...value, all })} />
      {!value.all && (
        <div className="filter-chips">
          {doctors?.map((d) => (
            <FilterChip key={d.id} pressed={value.ids.includes(d.id)} icon="stethoscope" onClick={() => toggle(d.id)}>{d.name}</FilterChip>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Staff slot picker. With `outside`, the whole day is listed, past dates and times included (back to BACKDATE_MAX_DAYS).
 * `initialDate` / `preferTime` (HH:MM, from a free slot clicked on the desk calendar): that day is shown, and that
 * time is picked once it is listed as free, unless the user has picked or changed the day first.
 */
export function SlotPicker({ doctorId, serviceId, outside, value, onPick, initialDate, preferTime }: {
  doctorId: string; serviceId: string; outside: boolean; value: string; onPick: (startAt: string) => void;
  initialDate?: string; preferTime?: string;
}) {
  const { t } = useI18n();
  const [date, setDateState] = useState(initialDate || todayCairo());
  const preferred = useRef(preferTime);
  const setDate = (d: string) => { preferred.current = undefined; setDateState(d); };
  const pick = (startAt: string) => { preferred.current = undefined; onPick(startAt); };
  const ready = !!(doctorId && serviceId && date);
  const [slots, , loading] = useLoad(
    () => (ready
      ? get<{ startAt: string; endAt: string }[]>(`/appointments/availability${qs({ doctorId, serviceId, date, includeOutsideSchedule: outside || undefined })}`)
      : Promise.resolve([])),
    [doctorId, serviceId, date, outside],
  );
  useEffect(() => {
    const want = preferred.current;
    if (!want || value || !slots?.length) return;
    const [h, m] = want.split(':').map(Number);
    const slot = slots.find((s) => { const w = cairoWall(s.startAt); return w.date === date && w.minutes === h * 60 + m; });
    if (slot) pick(slot.startAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);
  const move = (days: number) => setDate(addDays(date, days));
  return (
    <div className="stack">
      <Field label={t.common.date} hint={date && `${fmtWeekday(dayOfWeek(date))} · ${fmtDate(date)}`}>
        <div className="input-group input-group--date">
          <IconButton icon="chevron-left" label={t.ui.prevDay} variant="outline" size="md" onClick={() => move(-1)} />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <IconButton icon="chevron-right" label={t.ui.nextDay} variant="outline" size="md" onClick={() => move(1)} />
          <Button onClick={() => setDate(todayCairo())}>{t.ui.today}</Button>
        </div>
      </Field>
      {!ready ? <EmptyState compact icon="calendar" title={t.picker.pickFirst} />
        : loading && !slots ? <Loading />
        : slots?.length === 0 ? <EmptyState compact icon="clock" title={t.picker.noSlots} />
        : (
          <div className="slots" role="group" aria-label={t.common.date}>
            {slots?.map((s) => (
              <button type="button" key={s.startAt} className="slot" aria-pressed={value === s.startAt} onClick={() => pick(s.startAt)}>
                {fmtTime(s.startAt)}
              </button>
            ))}
          </div>
        )}
      {value && <p className="text-body-sm">{t.picker.picked} <strong className="text-brand">{fmtDate(value.slice(0, 10))} · {fmtTime(value)}</strong></p>}
    </div>
  );
}

/** A paginated API response; some lists add fields next to `items` (e.g. the expenses' `totalAmount`). */
export interface Page<T = any> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * One page of a paginated list endpoint. Every server-paged list uses this, so they all behave the same:
 * - back to page 1 whenever `path` changes (another patient, filter or search is another list);
 * - back to the last page when the list got shorter than the page shown (rows deleted, settled or filtered out);
 * - while another page loads, the shown one stays on screen and `loading` is true. useLoad drops a response that
 *   arrives after a newer request, so rapid clicks never end on an older page.
 * `deps` reload the same page when they change (e.g. a `tick` bumped after a write). `pager` is the page controls,
 * or `false` when everything fits on one page, so it can go straight into a Card footer.
 */
export function usePaged<R extends Page = Page>(path: string, limit = 20, deps: unknown[] = []) {
  const [at, setAt] = useState({ path, page: 1 });
  if (at.path !== path) setAt({ path, page: 1 });
  const page = at.path === path ? at.page : 1;
  const setPage = useCallback((p: number) => setAt({ path, page: p }), [path]);
  const sep = path.includes('?') ? '&' : '?';
  const [res, reload, loading] = useLoad(() => get<R>(`${path}${sep}${qs({ page, limit }).slice(1)}`), [path, page, limit, ...deps]);
  useEffect(() => {
    const last = Math.max(res?.meta.totalPages ?? 1, 1);
    if (res && res.meta.page > last) setPage(last);
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  const pager = !!res && res.meta.totalPages > 1 && (
    <Pagination page={res.meta.page} pages={res.meta.totalPages} total={res.meta.total} onPage={setPage} />
  );
  return { res, setPage, reload, loading, pager };
}

// ---------- Invoice replacement (correct invoice / create invoice) ----------

/** CORRECT: a live session invoice whose referral was ended as a mistake. REISSUE: a cancelled session invoice. */
export type ReplacementAction = 'CORRECT' | 'REISSUE';

/** One side of GET /invoices/:id/replacement: the invoice as it is, or the new invoice. Money as decimal strings. */
export interface ReplacementSide {
  referral: { referralId: string; termsId: string; termsVersion: number; referringDoctor: { id: string; name: string }; isOverride: boolean } | null;
  discount: { type: string; value: string; amount: string; reason: string } | null;
  subtotal: string; discountTotal: string; total: string;
}

export interface ReplacementPreview {
  invoiceId: string; invoiceNumber: string;
  /** Which POST applies now; null: neither (see blockedBy). */
  action: ReplacementAction | null;
  blockedBy: string | null;
  current: ReplacementSide;
  replacement: ReplacementSide | null;
  /** Why the new invoice gets no referral (NO_ACTIVE_REFERRAL, NOT_COVERED, PACKAGE_SESSION), else null. */
  replacementNotCovered: string | null;
}

function ReplacementSideView({ title, side, variant }: { title: ReactNode; side: ReplacementSide; variant: 'muted' | 'brand' }) {
  const { t } = useI18n();
  const ti = t.invoice;
  const d = side.discount;
  return (
    <Card variant={variant} className="stack-sm">
      <span className="text-semibold">{title}</span>
      <Totals>
        <TotalsRow
          label={ti.referralTitle}
          value={side.referral
            ? <span>{side.referral.referringDoctor.name}{side.referral.isOverride && <> <Badge tone="warning">{t.referrals.overridden}</Badge></>}</span>
            : ti.noReferral}
        />
        <TotalsRow label={ti.subtotal} value={fmtMoney(side.subtotal)} />
        <TotalsRow
          label={<span>{ti.discount}{d && (
            <><br /><small className="text-muted">
              {label(t.enums.DiscountType, d.type)} {d.type === 'PERCENT' ? fmtPercent(d.value) : fmtMoney(d.value)} · {d.reason}
            </small></>
          )}</span>}
          value={fmtMoney(side.discountTotal, true)}
        />
        <TotalsRow label={ti.total} value={fmtMoney(side.total)} strong />
      </Totals>
    </Card>
  );
}

/** What the API will do (its preview, nothing computed here): the invoice now, the new invoice, and why it has no referral. */
export function ReplacementReview({ preview }: { preview: ReplacementPreview }) {
  const { t } = useI18n();
  const ti = t.invoice;
  return (
    <div className="stack">
      <p>{preview.action === 'CORRECT' ? ti.correctIntro : ti.reissueIntro}</p>
      <ReplacementSideView title={<>{ti.reviewCurrent} <Ltr>{preview.invoiceNumber}</Ltr></>} side={preview.current} variant="muted" />
      {preview.replacement && <ReplacementSideView title={ti.reviewNew} side={preview.replacement} variant="brand" />}
      {preview.replacementNotCovered && (
        <Alert tone="warning" icon="share" title={ti.notCoveredTitle}>{label(ti.notCovered, preview.replacementNotCovered)}</Alert>
      )}
    </div>
  );
}

/**
 * Correct or create an invoice again. The API decides whether it is allowed and computes the new invoice: its preview
 * (GET /invoices/:id/replacement) is shown for confirmation (a reason for CORRECT), then posted.
 * Resolves with the new invoice; false when the dialog was closed (nothing sent); null when nothing was replaced and the
 * caller should reload: the preview no longer offers this action (a short notice), or the request failed (error shown).
 */
export async function replaceInvoice(invoiceId: string, action: ReplacementAction): Promise<{ id: string; invoiceNumber: string } | false | null> {
  const t = msg();
  const ti = t.invoice;
  const got: { preview?: ReplacementPreview; invoice?: { id: string; invoiceNumber: string } } = {};
  if (!(await act(async () => { got.preview = await get<ReplacementPreview>(`/invoices/${invoiceId}/replacement`); })) || !got.preview) return null;
  const preview = got.preview;
  if (preview.action !== action) {
    notify(preview.blockedBy ? `${ti.replaceStale} ${label(ti.replaceBlocked, preview.blockedBy)}` : ti.replaceStale, 'info');
    return null;
  }
  const message = <ReplacementReview preview={preview} />;
  if (action === 'CORRECT') {
    const reason = await askReason({
      title: ti.correctTitle(preview.invoiceNumber), message, tone: 'warning', icon: 'switch-horizontal',
      confirmLabel: ti.correctInvoice, cancelLabel: t.ui.back, label: ti.promptCorrect,
    });
    if (reason === null) return false;
    await act(async () => { got.invoice = await post(`/invoices/${invoiceId}/correct`, { reason }); });
  } else {
    const ok = await confirmAction({
      title: ti.reissueTitle(preview.invoiceNumber), message, icon: 'receipt', confirmLabel: ti.reissueInvoice, cancelLabel: t.ui.back,
    });
    if (!ok) return false;
    await act(async () => { got.invoice = await post(`/invoices/${invoiceId}/reissue`); });
  }
  if (got.invoice) notify(ti.replaced(got.invoice.invoiceNumber));
  return got.invoice ?? null;
}
