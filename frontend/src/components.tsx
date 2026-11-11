// Domain pickers shared by several areas (desk booking, day list, owner services and packages), the paged-list hook,
// and the invoice replacement (correct / create invoice) used by the invoice page and the day list.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { act, get, notify, post, qs } from './api';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent, fmtTime, fmtWeekday } from './format';
import { label, msg, useI18n } from './i18n';
import { addDays, dayOfWeek, todayCairo } from './time';
import {
  Alert, askReason, Badge, Card, Checkbox, confirmAction, EmptyState, Field, FilterChip, IconButton, Input, Pagination, Select,
  Button, Loading, Totals, TotalsRow,
} from './ui';
import { Ltr, useLoad } from './util';

export interface Doctor {
  id: string; name: string; specialty: string; isActive: boolean; isPublic: boolean; email: string; phone: string | null;
  services: { serviceId: string; name: string; durationMinutes: number; price: string; basePrice: string; priceOverride: string | null; isActive: boolean }[];
}

export function useDoctors(activeOnly = true) {
  return useLoad(() => get<{ items: Doctor[] }>(`/doctors${qs({ limit: 100, isActive: activeOnly ? true : undefined })}`).then((r) => r.items), []);
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

/** Staff slot picker. With `outside`, the whole day is listed, past dates and times included (back to BACKDATE_MAX_DAYS). */
export function SlotPicker({ doctorId, serviceId, outside, value, onPick }: {
  doctorId: string; serviceId: string; outside: boolean; value: string; onPick: (startAt: string) => void;
}) {
  const { t } = useI18n();
  const [date, setDate] = useState(todayCairo());
  const ready = !!(doctorId && serviceId && date);
  const [slots, , loading] = useLoad(
    () => (ready
      ? get<{ startAt: string; endAt: string }[]>(`/appointments/availability${qs({ doctorId, serviceId, date, includeOutsideSchedule: outside || undefined })}`)
      : Promise.resolve([])),
    [doctorId, serviceId, date, outside],
  );
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
              <button type="button" key={s.startAt} className="slot" aria-pressed={value === s.startAt} onClick={() => onPick(s.startAt)}>
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
