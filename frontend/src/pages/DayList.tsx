import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { act, get, getSession, post, qs } from '../api';
import { CheckInDetailsFields, PatientCode, useCheckInDetails } from '../checkInDetails';
import { replaceInvoice, SlotPicker, TypeBadge, useDoctors } from '../components';
import { fmtMoney, fmtNumber, fmtTime } from '../format';
import { label, locale, useI18n } from '../i18n';
import { addDays, todayCairo } from '../time';
import {
  askReason, Badge, Button, ButtonLink, Card, CellText, ChoiceCard, Dialog, EmptyState, Field, FilterChip, IconButton,
  Input, Loading, PageHeader, Select, Stat, Stats, StatusBadge, Switch, Table, Textarea, type ButtonSize, type ButtonVariant, type IconName,
} from '../ui';
import { Ltr, useLoad } from '../util';
import '../styles/areas/desk.css';

export interface Row {
  isWalkIn: boolean; id: string | null; referenceCode: string | null; status: string | null; source: string | null;
  // The appointment's type, or the walk-in's own; null = not set (from before appointment types).
  type: string | null;
  startAt: string | null; endAt: string | null; bookedName: string | null; nameMismatch: boolean;
  patient: { id: string; name: string; phone: string }; doctor: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number }; notes: string | null; cancelReason: string | null;
  visitId: string | null; visitStatus: string | null; attendedAt: string | null; noteStatus: string | null;
  allowedActions: string[];
  // The package session this visit / no-show used.
  package: { usageId: string; patientPackageId: string; name: string; used: number; total: number } | null;
  // Picked when booking online (to sell at the desk).
  requestedPackage: { id: string; name: string } | null;
  // Not sent to doctors.
  invoiceId?: string | null; invoiceTotal?: string | null; amountPaid?: string | null; balance?: string | null; paymentStatus?: string;
  // The live invoice's status; CANCELLED (with cancelledInvoiceId) only when that cancelled invoice can be created
  // again, i.e. exactly when allowedActions has 'createInvoice'.
  invoiceStatus?: string | null; cancelledInvoiceId?: string | null;
}

export const STATUSES = ['PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'];

// How each allowed action looks. Unknown future actions fall back to an outline button.
const ACTION_STYLE: Record<string, { variant: ButtonVariant; icon: IconName }> = {
  attend: { variant: 'primary', icon: 'user-check' },
  writeNote: { variant: 'primary', icon: 'note-pen' },
  viewNote: { variant: 'outline', icon: 'eye' },
  confirm: { variant: 'outline', icon: 'calendar-check' },
  reschedule: { variant: 'outline', icon: 'switch-horizontal' },
  noShow: { variant: 'outline', icon: 'user-x' },
  cancel: { variant: 'danger-outline', icon: 'ban' },
  undoNoShow: { variant: 'ghost', icon: 'undo' },
  undoAttend: { variant: 'ghost', icon: 'undo' },
  restoreSession: { variant: 'ghost', icon: 'undo' },
  createInvoice: { variant: 'outline', icon: 'receipt' },
};

/** "Saturday, 7 November 2026" in the UI language (a clinic local date, no time zone shift). */
export function fmtLongDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * A day-list row's actions, shared by the doctor's day list and the desk calendar's side panel. Every button comes
 * from the row's `allowedActions` (computed by the API from the state machine and the time / undo rules), so the UI
 * copies no rules. `buttons(row)` renders them; `dialogs` (attend, reschedule) must be rendered once by the caller.
 * `reload` runs after an action that changed something (not when a dialog was closed without sending).
 */
export function useRowActions(reload: () => void) {
  const { t } = useI18n();
  const [resched, setResched] = useState<Row | null>(null);
  const [attending, setAttending] = useState<Row | null>(null);
  const dl = t.dayList;
  const who = (r: Row) => `${r.patient.name} · ${r.isWalkIn ? fmtTime(r.attendedAt) : fmtTime(r.startAt)} · ${r.doctor.name}`;
  // Each returns false when the user closed the reason dialog (nothing was sent, nothing to reload).
  const withReason = async (title: string, confirmLabel: string, r: Row, send: (reason: string) => Promise<unknown>, done: string, danger = false) => {
    const reason = await askReason({ title, message: who(r), confirmLabel, cancelLabel: t.ui.back, tone: danger ? 'danger' : 'primary' });
    if (reason === null) return false;
    await act(() => send(reason), done);
    return true;
  };
  const actions: Record<string, (r: Row) => Promise<boolean>> = {
    confirm: (r) => act(() => post(`/appointments/${r.id}/confirm`), dl.done.confirm).then(() => true),
    cancel: (r) => withReason(dl.prompt.cancel, dl.confirmBtn.cancel, r, (reason) => post(`/appointments/${r.id}/cancel`, { reason }), dl.done.cancel, true),
    noShow: (r) => act(() => post(`/appointments/${r.id}/no-show`), dl.done.noShow).then(() => true),
    undoNoShow: (r) => act(() => post(`/appointments/${r.id}/undo-no-show`), dl.done.undoNoShow).then(() => true),
    restoreSession: (r) => withReason(dl.prompt.restore, dl.confirmBtn.restore, r,
      (reason) => post(`/package-usages/${r.package?.usageId}/restore`, { reason }), dl.done.restoreSession),
    // A walk-in has no appointment: it is undone through its visit.
    undoAttend: (r) => (r.isWalkIn
      ? withReason(dl.prompt.undoWalkIn, dl.confirmBtn.undoWalkIn, r, (reason) => post(`/visits/${r.visitId}/undo-attend`, { reason }), dl.done.undoAttend, true)
      : withReason(dl.prompt.undoAttend, dl.confirmBtn.undoAttend, r, (reason) => post(`/appointments/${r.id}/undo-attend`, { reason }), dl.done.undoAttend, true)),
    // A new invoice in place of the visit's cancelled one: the API's preview is confirmed first (see replaceInvoice).
    createInvoice: async (r) => (await replaceInvoice(r.cancelledInvoiceId!, 'REISSUE')) !== false,
  };
  const run = async (a: string, r: Row) => { if (await actions[a](r)) reload(); };

  const buttons = (r: Row, size: ButtonSize = 'sm') => r.allowedActions.map((a) => {
    const style = ACTION_STYLE[a] ?? { variant: 'outline' as ButtonVariant, icon: 'chevron-right' as IconName };
    const text = label(dl.action, a);
    if (a === 'writeNote' || a === 'viewNote') {
      return <ButtonLink key={a} size={size} variant={style.variant} icon={style.icon} to={`/visits/${r.visitId}`}>{text}</ButtonLink>;
    }
    if (a === 'reschedule') return <Button key={a} size={size} variant={style.variant} icon={style.icon} onClick={() => setResched(r)}>{text}</Button>;
    if (a === 'attend') return <Button key={a} size={size} variant={style.variant} icon={style.icon} onClick={() => setAttending(r)}>{text}</Button>;
    if (!actions[a]) return null;
    return <Button key={a} size={size} variant={style.variant} icon={style.icon} onClick={() => run(a, r)}>{text}</Button>;
  });
  const dialogs = (
    <>
      {resched && <Reschedule row={resched} onClose={() => setResched(null)} onDone={() => { setResched(null); reload(); }} />}
      {attending && <Attend row={attending} onClose={() => setAttending(null)} onDone={() => { setAttending(null); reload(); }} />}
    </>
  );
  return { buttons, dialogs };
}

/**
 * The doctor's day list (the desk uses the calendar, pages/Schedule.tsx). A DOCTOR gets their own rows, without
 * billing columns.
 */
export function DayList() {
  const { t } = useI18n();
  const isDoctor = getSession()?.user.role === 'DOCTOR';
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayCairo();
  const status = params.getAll('status');
  const doctorId = params.get('doctorId') ?? '';
  const [doctors] = useDoctors();
  const [rows, reload, loading] = useLoad(
    () => get<Row[]>(`/appointments/day${qs({ date, status, doctorId: doctorId || undefined })}`),
    [date, status.join(','), doctorId],
  );
  const { buttons, dialogs } = useRowActions(reload);
  const setFilter = (next: { date?: string; status?: string[]; doctorId?: string }) => {
    const p = new URLSearchParams();
    p.set('date', next.date ?? date);
    (next.status ?? status).forEach((s) => p.append('status', s));
    if ((next.doctorId ?? doctorId)) p.set('doctorId', next.doctorId ?? doctorId);
    setParams(p);
  };
  const toggle = (s: string) => setFilter({ status: status.includes(s) ? status.filter((x) => x !== s) : [...status, s] });

  const dl = t.dayList;
  const all = rows ?? [];
  const attended = all.filter((r) => (r.isWalkIn ? r.visitStatus === 'ACTIVE' : r.status === 'ATTENDED')).length;
  const waiting = all.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED').length;
  const noShow = all.filter((r) => r.status === 'NO_SHOW').length;
  const c = dl.col;
  const today = todayCairo();

  return (
    <>
      <PageHeader
        title={isDoctor ? dl.titleDoctor : dl.titleDesk}
        description={<span className="cluster">{fmtLongDate(date)}{date === today && <Badge tone="info">{t.ui.today}</Badge>}</span>}
        actions={!isDoctor && <ButtonLink to="/reception/book" variant="primary" icon="calendar-plus">{dl.newBooking}</ButtonLink>}
      />
      <div className="stack-lg">
        <Card>
          <div className="daylist-toolbar">
            <div className="daylist-toolbar__row">
              <Field label={t.common.date} className="daylist-toolbar__date">
                <div className="input-group">
                  <IconButton icon="chevron-left" size="md" variant="outline" label={t.ui.prevDay} onClick={() => setFilter({ date: addDays(date, -1) })} />
                  <Input type="date" value={date} onChange={(e) => e.target.value && setFilter({ date: e.target.value })} />
                  <IconButton icon="chevron-right" size="md" variant="outline" label={t.ui.nextDay} onClick={() => setFilter({ date: addDays(date, 1) })} />
                  <Button disabled={date === today} onClick={() => setFilter({ date: today })}>{t.ui.today}</Button>
                </div>
              </Field>
              {!isDoctor && (
                <Field label={dl.doctor} className="daylist-toolbar__doctor">
                  <Select value={doctorId} onChange={(e) => setFilter({ doctorId: e.target.value })}>
                    <option value="">{dl.allDoctors}</option>
                    {doctors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
              )}
              <IconButton icon="refresh" size="md" variant="outline" label={t.common.refresh} onClick={reload} disabled={loading} />
            </div>
            <Field group label={dl.status} hint={dl.statusHint}>
              <div className="filter-chips">
                {STATUSES.map((s) => (
                  <FilterChip key={s} pressed={status.includes(s)} onClick={() => toggle(s)}>{label(t.enums.AppointmentStatus, s)}</FilterChip>
                ))}
                {status.length > 0 && <Button size="sm" variant="ghost" icon="x" onClick={() => setFilter({ status: [] })}>{t.ui.clearFilters}</Button>}
              </div>
            </Field>
          </div>
        </Card>

        {rows && rows.length > 0 && (
          <div className="daylist-stats">
            <Stats>
              <Stat icon="list" tone="neutral" label={dl.stats.total} value={fmtNumber(all.length)} />
              <Stat icon="user-check" label={dl.stats.attended} value={fmtNumber(attended)} />
              <Stat icon="clock" tone="info" label={dl.stats.waiting} value={fmtNumber(waiting)} />
              <Stat icon="user-x" tone="error" label={dl.stats.noShow} value={fmtNumber(noShow)} />
            </Stats>
          </div>
        )}

        <Card flush>
          {!rows ? <Loading /> : (
            <Table
              className="daylist-table" caption={isDoctor ? dl.titleDoctor : dl.titleDesk}
              head={<>
                <th>{c.time}</th><th>{c.patient}</th><th>{isDoctor ? c.service : c.doctorService}</th><th>{c.status}</th><th>{c.package}</th>
                {!isDoctor && <th>{c.payment}</th>}
                <th className="actions">{c.actions}</th>
              </>}
              isEmpty={rows.length === 0}
              empty={<EmptyState icon="calendar-days" title={dl.nothing} text={dl.nothingHint} />}
            >
              {rows.map((r) => (
                <tr key={r.id ?? r.visitId!} className={r.status === 'CANCELLED' || r.status === 'RESCHEDULED' ? 'is-muted' : undefined}>
                  <td>
                    <span className="daylist-time">{r.isWalkIn ? fmtTime(r.attendedAt) : `${fmtTime(r.startAt)}–${fmtTime(r.endAt)}`}</span>
                    <span className="cell-sub">
                      {r.isWalkIn ? t.booking.walkIn : <><Ltr>{r.referenceCode}</Ltr> · {label(t.enums.AppointmentSource, r.source)}</>}
                    </span>
                  </td>
                  <td>
                    {isDoctor ? <span className="cell-strong">{r.patient.name}</span> : <Link to={`/patients/${r.patient.id}`}>{r.patient.name}</Link>}
                    <span className="cell-sub"><Ltr>{r.patient.phone}</Ltr></span>
                    {r.nameMismatch && (
                      <span className="badge badge--warning mismatch" title={dl.bookedAs(r.bookedName ?? '')}>{dl.bookedAs(r.bookedName ?? '')}</span>
                    )}
                  </td>
                  <td>
                    {isDoctor ? <span className="cell-strong">{r.service.name}</span>
                      : <CellText sub={r.service.name}><span className="cell-strong">{r.doctor.name}</span></CellText>}
                  </td>
                  <td>
                    <div className="daylist-badges">
                      <TypeBadge type={r.type} />
                      {r.isWalkIn ? <Badge tone="info" dot>{t.booking.walkIn}</Badge> : <StatusBadge kind="AppointmentStatus" value={r.status} />}
                      {r.visitStatus && (r.visitStatus === 'VOIDED' || r.isWalkIn) && <StatusBadge kind="VisitStatus" value={r.visitStatus} dot={false} />}
                      {r.noteStatus && <StatusBadge kind="NoteStatus" value={r.noteStatus} dot={false} />}
                    </div>
                    {r.cancelReason && <span className="cell-sub">{r.cancelReason}</span>}
                    {r.attendedAt && !r.isWalkIn && <span className="cell-sub">{c.visit}: {fmtTime(r.attendedAt)}</span>}
                  </td>
                  <td>
                    {r.package ? <CellText sub={dl.used(fmtNumber(r.package.used), fmtNumber(r.package.total))}>{r.package.name}</CellText>
                      : r.requestedPackage ? <Badge tone="accent" icon="package">{dl.wants(r.requestedPackage.name)}</Badge>
                      : <span className="text-muted">{t.common.none}</span>}
                  </td>
                  {!isDoctor && (
                    <td>
                      {r.invoiceStatus === 'CANCELLED'
                        ? <Badge tone="error" dot>{dl.invoiceCancelled}</Badge>
                        : <StatusBadge kind="DayPaymentStatus" value={r.paymentStatus} />}
                      {r.balance && <span className="cell-sub tabular">{fmtMoney(r.balance)}{r.invoiceTotal && ` ${dl.of(fmtMoney(r.invoiceTotal))}`}</span>}
                    </td>
                  )}
                  <td className="actions">
                    <div className="row-actions">
                      {buttons(r)}
                      {r.invoiceId && <ButtonLink size="sm" variant="ghost" icon="receipt" to={`/reception/invoices/${r.invoiceId}`}>{t.common.invoice}</ButtonLink>}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {dialogs}
    </>
  );
}

/**
 * Attend, choosing who pays the session: the package picked online (sold first: FINDINGS #29), the API's default
 * (oldest usable package), a specific package, or none.
 * "Usable" is worked out here from GET /patients/:id/packages (same service, doctor allowed, ACTIVE): see FINDINGS #23.
 */
function Attend({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [packages] = useLoad(() => get<any[]>(`/patients/${row.patient.id}/packages`), [row.patient.id]);
  // Identity document, gender, date of birth, referral source: collected here when missing (sent with attend).
  const details = useCheckInDetails(row.patient.id);
  const usable = (packages ?? []).filter((p) => p.status === 'ACTIVE' && p.service.id === row.service.id
    && (p.allDoctors || p.doctors.some((d: any) => d.id === row.doctor.id)));
  // Picked online: offered (and preselected) as "sell it now and use it".
  const requested = row.requestedPackage;
  const [choice, setChoice] = useState(requested ? 'sell' : 'auto');
  const attend = async () => {
    let body: object = choice === 'auto' ? {} : choice === 'none' ? { usePackage: false } : { patientPackageId: choice };
    if (choice === 'sell' && requested) {
      const sold = await post(`/patients/${row.patient.id}/packages`, { packageId: requested.id });
      body = { patientPackageId: sold.id };
    }
    const patientDetails = details.payload();
    return post(`/appointments/${row.id}/attend`, patientDetails ? { ...body, patientDetails } : body);
  };
  const ta = t.attend;
  const hasChoice = !!requested || usable.length > 0;
  return (
    <Dialog
      open onClose={onClose} title={ta.heading} description={ta.title(row.patient.name, row.doctor.name, row.service.name)}
      size={!details.loading && !details.complete ? 'lg' : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button
          variant="primary" icon="user-check" disabled={!packages || details.loading}
          onClick={async () => { if (details.validate() && await act(attend, t.dayList.done.attend)) onDone(); }}
        >
          {ta.submit}
        </Button>
      </>}
    >
      <div className="stack-lg">
      {details.loading ? <Loading /> : details.complete ? (
        <div className="checkin-status">
          <Badge tone="success" icon="check-circle">{t.checkIn.complete}</Badge>
          <PatientCode code={details.patient?.patientCode} />
        </div>
      ) : (
        <Field group label={t.checkIn.title} hint={t.checkIn.hint}>
          <CheckInDetailsFields state={details} />
        </Field>
      )}
      {!packages ? <Loading label={ta.loadingPackages} /> : !hasChoice ? (
        <EmptyState compact icon="package" title={ta.noUsable} />
      ) : (
        <Field group label={ta.choose}>
          <div className="choice-list">
            {requested && (
              <ChoiceCard name="attend-pay" checked={choice === 'sell'} onChange={() => setChoice('sell')}>
                <span className="cell-strong">{ta.sellRequested(requested.name)}</span>
                <span className="cell-sub">{ta.sellHint}</span>
              </ChoiceCard>
            )}
            {usable.length > 0 && (
              <ChoiceCard name="attend-pay" checked={choice === 'auto'} onChange={() => setChoice('auto')}>
                <span className="cell-strong">{ta.oldestUsable}</span>
                <span className="cell-sub">{ta.oldestHint}</span>
              </ChoiceCard>
            )}
            {usable.map((p) => (
              <ChoiceCard key={p.id} name="attend-pay" checked={choice === p.id} onChange={() => setChoice(p.id)}>
                <span className="cell-strong">{ta.packageLeft(p.name, fmtNumber(p.sessionsLeft))}</span>
              </ChoiceCard>
            ))}
            <ChoiceCard name="attend-pay" checked={choice === 'none'} onChange={() => setChoice('none')}>
              <span className="cell-strong">{ta.noPackage}</span>
              <span className="cell-sub">{ta.noPackageHint}</span>
            </ChoiceCard>
          </div>
        </Field>
      )}
      </div>
    </Dialog>
  );
}

function Reschedule({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [startAt, setStartAt] = useState('');
  const [outside, setOutside] = useState(false);
  const [why, setWhy] = useState('');
  const tr = t.reschedule;
  const submit = async () => {
    const ok = await act(
      () => post(`/appointments/${row.id}/reschedule`, { startAt, reason: why || undefined, allowOutsideSchedule: outside || undefined }),
      t.dayList.done.reschedule,
    );
    if (ok) onDone();
  };
  return (
    <Dialog
      open onClose={onClose} size="lg" dismissible={!startAt && !why} title={tr.heading}
      description={tr.title(row.referenceCode ?? '', label(t.enums.AppointmentStatus, row.status), row.patient.name, row.doctor.name, row.service.name)}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="switch-horizontal" disabled={!startAt} onClick={submit}>{tr.submit}</Button>
      </>}
    >
      <div className="stack">
        <Switch label={tr.outside} checked={outside} onChange={(v) => { setOutside(v); setStartAt(''); }} />
        <SlotPicker doctorId={row.doctor.id} serviceId={row.service.id} outside={outside} value={startAt} onPick={setStartAt} />
        <Field label={tr.reasonPh} optional>
          <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        <p className="field__help">{tr.hint}</p>
      </div>
    </Dialog>
  );
}
