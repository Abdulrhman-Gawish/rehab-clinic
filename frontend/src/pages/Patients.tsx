import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { act, get, getSession, post, qs } from '../api';
import { usePaged } from '../components';
import { fmtDateTime, fmtMoney, fmtNumber } from '../format';
import { label, useI18n } from '../i18n';
import {
  askReason, Avatar, Badge, Icon, Button, ButtonLink, Card, CellText, DescriptionList, Dialog, EmptyState, Field, LoadMore,
  Loading, PageHeader, Person, SearchInput, Select, Stat, Stats, StatusBadge, Table, Tabs, Input,
} from '../ui';
import { Ltr, useLoad, Values } from '../util';
import { PatientAcquisition } from './PatientReferral';
import {
  Appointments, AuditHistory, Clinical, Discounts, Invoices, Payments, PersonalInfo, TABS, Visits, type Tab,
} from './PatientRecords';
import '../styles/areas/desk.css';

/** Patient search. ?q= is the search (the top bar's patient search links here). */
export function Patients() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  // A new search from the top bar while this page is open.
  useEffect(() => setSearch(q), [q]);
  // A new search is another list: back to page 1.
  const { res, loading, pager } = usePaged(`/patients${qs({ search: q })}`, 20);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(search.trim() ? { q: search.trim() } : {});
  };
  const c = t.patients.col;
  return (
    <>
      <PageHeader
        title={t.patients.title} description={t.patients.desc}
        actions={<ButtonLink to="/reception/book" variant="primary" icon="calendar-plus">{t.dayList.newBooking}</ButtonLink>}
      />
      <div className="stack-lg">
        <Card>
          <form className="input-group" role="search" onSubmit={submit}>
            <SearchInput placeholder={t.patients.searchPh} aria-label={t.patients.searchPh} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button type="submit" variant="primary" icon="search">{t.common.search}</Button>
          </form>
        </Card>
        <Card flush title={t.patients.title} description={res && t.patients.count(fmtNumber(res.meta.total))} icon="users">
          {!res && loading ? <Loading /> : (
            <>
              <Table
                head={<><th>{c.name}</th><th>{c.phone}</th><th>{c.source}</th><th>{c.created}</th></>}
                isEmpty={res?.items.length === 0}
                empty={<EmptyState compact icon="users" title={t.patients.noneFound} text={q ? t.ui.noResultsHint : undefined} />}
              >
                {res?.items.map((p: any) => (
                  <tr key={p.id}>
                    <td><Person name={p.name} to={`/patients/${p.id}`} size={32} /></td>
                    <td className="nowrap"><Ltr>{p.phone}</Ltr></td>
                    <td><StatusBadge kind="PatientSource" value={p.createdSource} /></td>
                    <td className="nowrap tabular">{fmtDateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </Table>
              {pager}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

// The overview (GET /patients/:id/overview) plus one tab per record type;
// each role only gets the tabs its API calls allow. The open tab is kept in ?tab= (survives a reload).
export function PatientPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const role = getSession()?.user.role ?? 'RECEPTIONIST';
  const desk = role !== 'DOCTOR';
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => x.roles.includes(role));
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some((x) => x.tab === requested) ? requested! : 'overview';
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  const [o] = useLoad(() => get(`/patients/${id}/overview`), [id]);
  if (!o) return <Loading />;
  const { patient } = o;
  const pid = id!;
  const tp = t.patients;
  return (
    <>
      <PageHeader
        back={desk ? { to: '/reception/patients', label: tp.title } : undefined}
        tabTitle={patient.name}
        title={<span className="patient-title"><Avatar name={patient.name} size={52} />{patient.name}</span>}
        description={(
          <span className="patient-meta">
            <span className="cluster"><Icon name="phone" size={16} /><Ltr>{patient.phone}</Ltr></span>
            <StatusBadge kind="PatientSource" value={patient.createdSource} />
            <span className="text-muted text-body-sm">{tp.since(fmtDateTime(patient.createdAt))}</span>
          </span>
        )}
        actions={desk && (
          <ButtonLink to={`/reception/book?phone=${encodeURIComponent(patient.phone)}`} variant="primary" icon="calendar-plus">
            {tp.bookAppointment}
          </ButtonLink>
        )}
      />
      <Tabs label={tp.tabsLabel} value={tab} onChange={setTab} tabs={tabs.map((x) => ({ id: x.tab, label: label(tp.tabs, x.tab) }))} />
      {/* Keyed by patient: another patient (back/forward between two patient pages) starts every tab afresh, on page 1. */}
      <div role="tabpanel" key={pid}>
        {tab === 'overview' && <Overview overview={o} role={role} />}
        {tab === 'personal' && <PersonalInfo patientId={pid} />}
        {tab === 'appointments' && <Appointments patientId={pid} />}
        {tab === 'visits' && <Visits patientId={pid} />}
        {tab === 'clinical' && <Clinical patientId={pid} />}
        {tab === 'invoices' && <Invoices patientId={pid} />}
        {tab === 'payments' && <Payments patientId={pid} />}
        {tab === 'discounts' && <Discounts patientId={pid} />}
        {tab === 'packages' && <PatientPackages patientId={pid} role={role} />}
        {tab === 'acquisition' && <PatientAcquisition patientId={pid} role={role} />}
        {tab === 'timeline' && <Timeline patientId={pid} role={role} />}
        {tab === 'audit' && <AuditHistory patientId={pid} />}
      </div>
    </>
  );
}

function Overview({ overview, role }: { overview: any; role: string }) {
  const { t } = useI18n();
  const { nextAppointment: next, lastVisit: last, counts, doctors, balance, notesNeedingAttention: notes } = overview;
  // The OWNER opens any visit (drafts read-only); a doctor their own.
  const openVisit = role === 'OWNER' || role === 'DOCTOR';
  const tp = t.patients;
  return (
    <div className="stack-lg">
      <Stats>
        <Stat icon="user-check" label={tp.stat.attended} value={fmtNumber(counts.attended)} />
        <Stat icon="user-x" tone="error" label={tp.stat.noShow} value={fmtNumber(counts.noShow)} />
        <Stat icon="ban" tone="neutral" label={tp.stat.cancelled} value={fmtNumber(counts.cancelled)} />
        {balance && (
          <Stat
            icon="wallet" tone={Number(balance.balance) > 0 ? 'warning' : undefined} label={tp.stat.balance}
            value={fmtMoney(balance.balance)} hint={tp.balanceDetail(fmtMoney(balance.totalInvoiced), fmtMoney(balance.totalPaid))}
          />
        )}
      </Stats>
      <div className="split split--even">
        <Card title={tp.next} icon="calendar">
          {next ? (
            <DescriptionList
              columns={2}
              items={[
                [t.fields.startAt, <span className="tabular">{fmtDateTime(next.startAt)}</span>],
                [t.fields.status, <StatusBadge kind="AppointmentStatus" value={next.status} />],
                [t.fields.doctorId, next.doctor.name],
                [t.fields.serviceId, next.service.name],
              ]}
            />
          ) : <EmptyState compact icon="calendar" title={tp.noNext} />}
        </Card>
        <Card title={tp.last} icon="history">
          {last ? (
            <DescriptionList
              columns={2}
              items={[
                [t.fields.attendedAt, <span className="tabular">{fmtDateTime(last.attendedAt)}{last.isWalkIn && tp.walkInSuffix}</span>],
                [t.fields.doctorId, last.doctor.name],
                [t.fields.serviceId, last.service.name],
              ]}
            />
          ) : <EmptyState compact icon="history" title={tp.noLast} />}
        </Card>
      </div>
      <div className="split split--even">
        <Card title={tp.doctorsSeen} icon="stethoscope">
          {doctors.length === 0 ? <EmptyState compact icon="stethoscope" title={tp.noDoctors} /> : (
            <ul className="overview-list" role="list">
              {doctors.map((d: any) => (
                <li key={d.id}><Person name={d.name} meta={tp.lastAt(fmtDateTime(d.lastVisitAt))} size={36} /></li>
              ))}
            </ul>
          )}
        </Card>
        {notes && (
          <Card flush title={tp.notesNeedingAttention(fmtNumber(notes.length))} icon="clipboard-check">
            <Table
              head={<><th>{t.records.vcol.attended}</th><th>{t.records.vcol.doctor}</th><th>{t.records.vcol.service}</th><th>{t.records.vcol.status}</th></>}
              isEmpty={notes.length === 0} empty={<EmptyState compact icon="check-circle" title={tp.noNote} />}
            >
              {notes.map((n: any) => (
                <tr key={n.visitId}>
                  <td className="nowrap tabular">{openVisit ? <Link to={`/visits/${n.visitId}`}>{fmtDateTime(n.attendedAt)}</Link> : fmtDateTime(n.attendedAt)}</td>
                  <td>{n.doctor.name}</td>
                  <td>{n.service.name}</td>
                  <td>{n.noteStatus ? <StatusBadge kind="NoteStatus" value={n.noteStatus} /> : <Badge tone="neutral">{tp.noNote}</Badge>}</td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Sold packages; the desk sells one, restores a no-show session; the owner cancels. A doctor gets no prices. */
function PatientPackages({ patientId, role }: { patientId: string; role: string }) {
  const { t } = useI18n();
  const desk = role !== 'DOCTOR';
  const [list, reload] = useLoad(() => get<any[]>(`/patients/${patientId}/packages`), [patientId]);
  const [catalog] = useLoad(() => (desk ? get(`/packages${qs({ isActive: true, limit: 100 })}`) : Promise.resolve(null)), [desk]);
  const [packageId, setPackageId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const showSessions = async (ppId: string) => {
    setOpen(ppId);
    setDetail(null);
    setDetail(await get(`/patient-packages/${ppId}`).catch(() => null));
  };
  const after = async (ok: boolean) => { if (!ok) return; reload(); if (open) setDetail(await get(`/patient-packages/${open}`)); };
  const tp = t.patientPackages;

  const sell = async (e: FormEvent) => {
    e.preventDefault();
    if (!packageId) return;
    const ok = await act(() => post(`/patients/${patientId}/packages`, { packageId }), tp.sold);
    if (ok) setPackageId('');
    reload();
  };
  const cancel = async (p: any) => {
    const reason = await askReason({ title: tp.promptCancel, message: p.name, tone: 'danger', confirmLabel: tp.cancel, cancelLabel: t.ui.back });
    if (reason !== null) await act(() => post(`/patient-packages/${p.id}/cancel`, { reason }), tp.cancelled).then(after);
  };
  const restore = async (u: any) => {
    const reason = await askReason({ title: tp.promptRestore, message: `${fmtDateTime(u.usedAt)} · ${u.doctor.name}`, confirmLabel: tp.restore, cancelLabel: t.ui.back });
    if (reason !== null) await act(() => post(`/package-usages/${u.id}/restore`, { reason }), tp.restored).then(after);
  };

  return (
    <div className="stack-lg">
      {desk && (
        <Card title={tp.sellTitle} description={tp.sellHint} icon="package">
          <form className="input-group" onSubmit={sell}>
            <Select value={packageId} onChange={(e) => setPackageId(e.target.value)} aria-label={tp.pick}>
              <option value="">{tp.pick}</option>
              {catalog?.items.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {tp.option(p.name, fmtNumber(p.sessionsCount), p.service.name, fmtMoney(p.sellingPrice))}{p.offerActive ? tp.offerWas(fmtMoney(p.price)) : ''}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary" icon="plus" disabled={!packageId}>{tp.sell}</Button>
          </form>
        </Card>
      )}
      <Card flush title={tp.title} icon="package">
        {!list ? <Loading /> : (
          <Table
            head={<>
              <th>{tp.col.package}</th><th>{tp.col.service}</th><th>{tp.col.sessions}</th><th>{tp.col.status}</th><th>{tp.col.doctors}</th>
              {desk && <><th className="num">{tp.col.price}</th><th className="num">{tp.col.paid}</th><th className="num">{tp.col.balance}</th></>}
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
            isEmpty={list.length === 0} empty={<EmptyState compact icon="package" title={tp.none} />}
          >
            {list.map((p) => (
              <tr key={p.id} className={p.status === 'CANCELLED' ? 'is-muted' : undefined}>
                <td><CellText sub={tp.soldBy(fmtDateTime(p.soldAt), p.soldBy.name)}><span className="cell-strong">{p.name}</span></CellText></td>
                <td>{p.service.name}</td>
                <td className="nowrap"><CellText sub={tp.usage(fmtNumber(p.usedSessions), fmtNumber(p.totalSessions))}><strong>{tp.left(fmtNumber(p.sessionsLeft))}</strong></CellText></td>
                <td><StatusBadge kind="PatientPackageStatus" value={p.status} />{p.cancelReason && <span className="cell-sub">{p.cancelReason}</span>}</td>
                <td>{p.allDoctors ? <Badge tone="outline">{t.common.allItalic}</Badge> : p.doctors.map((d: any) => d.name).join(t.common.listSep)}</td>
                {desk && <>
                  <td className="num"><CellText sub={p.offerAmount !== '0.00' && tp.list(fmtMoney(p.listPrice), fmtMoney(p.offerAmount))}>{fmtMoney(p.price)}</CellText></td>
                  <td className="num">{fmtMoney(p.amountPaid)}</td>
                  <td className="num"><CellText sub={<Link to={`/reception/invoices/${p.invoiceId}`}>{t.common.invoice}</Link>}><span className="cell-strong">{fmtMoney(p.balance)}</span></CellText></td>
                </>}
                <td className="actions">
                  <div className="row-actions">
                    <Button size="sm" icon="list" onClick={() => showSessions(p.id)}>{tp.sessions}</Button>
                    {role === 'OWNER' && p.status !== 'CANCELLED' && (
                      <Button size="sm" variant="danger-outline" icon="ban" onClick={() => cancel(p)}>{tp.cancel}</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog
        open={!!open} onClose={() => setOpen(null)} size="lg"
        title={detail ? tp.sessionsOf(detail.name) : tp.sessions}
        footer={<Button onClick={() => setOpen(null)}>{t.common.close}</Button>}
      >
        {!detail ? <Loading /> : detail.usages.length === 0 ? <EmptyState compact icon="list" title={tp.noSessions} /> : (
          <Table
            dense
            head={<>
              <th>{tp.ucol.used}</th><th>{tp.ucol.reason}</th><th>{tp.ucol.doctor}</th><th>{tp.ucol.by}</th><th>{tp.ucol.restored}</th>
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
          >
            {detail.usages.map((u: any) => (
              <tr key={u.id} className={u.restored ? 'is-muted' : undefined}>
                <td className="nowrap tabular">{fmtDateTime(u.usedAt)}</td>
                <td><StatusBadge kind="PackageUsageReason" value={u.reason} /></td>
                <td>{u.doctor.name}</td>
                <td>{u.usedBy.name}</td>
                <td>{u.restored ? <span className="text-body-sm">{tp.restoredBy(fmtDateTime(u.restoredAt), u.restoredBy.name, u.restoreReason)}</span> : <span className="text-muted">{t.common.none}</span>}</td>
                <td className="actions">
                  {desk && !u.restored && u.reason === 'NO_SHOW' && (
                    <Button size="sm" variant="secondary" icon="undo" onClick={() => restore(u)}>{tp.restore}</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Dialog>
    </div>
  );
}

const TYPE_GROUPS: Record<string, string[]> = {
  Patient: ['PATIENT_CREATED', 'PATIENT_UPDATED'],
  Appointments: ['APPOINTMENT_BOOKED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_NO_SHOW', 'NO_SHOW_UNDONE'],
  Visits: ['VISIT_ATTENDED', 'ATTEND_UNDONE'],
  Billing: ['INVOICE_ISSUED', 'INVOICE_CANCELLED', 'DISCOUNT_APPLIED', 'DISCOUNT_REMOVED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'PAYMENT_REFUNDED'],
  Clinical: ['NOTE_SIGNED', 'ADDENDUM_ADDED', 'MEDICAL_INFO_UPDATED', 'ATTACHMENT_UPLOADED'],
  // PACKAGE_SOLD is hidden from doctors by the API.
  Packages: ['PACKAGE_SOLD', 'PACKAGE_SESSION_USED', 'PACKAGE_SESSION_RESTORED', 'PACKAGE_CANCELLED'],
};
// Only offer what the role can see (the API filters anyway).
const HIDDEN_GROUP: Record<string, string> = { RECEPTIONIST: 'Clinical', DOCTOR: 'Billing' };

function Timeline({ patientId, role }: { patientId: string; role: string }) {
  const { t } = useI18n();
  const groups = Object.keys(TYPE_GROUPS).filter((g) => g !== HIDDEN_GROUP[role]);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);

  const types = filter ? TYPE_GROUPS[filter] ?? [filter] : undefined;
  // Only the newest request may change the list: a response for older filters (or a "Load more" of the old list)
  // that arrives late is dropped.
  const load = async (after: string | null) => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const page = await get(`/patients/${patientId}/timeline${qs({ types, from, to, cursor: after, limit: 20 })}`);
      if (request !== latest.current) return;
      setItems((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch { /* shown in the error toast */ } finally {
      if (request === latest.current) { setLoading(false); setLoaded(true); }
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(null); }, [patientId, filter, from, to]);
  const tt = t.timeline;
  const myDoctorId = getSession()?.user.doctorId;

  return (
    <div className="stack-lg">
      <Card title={t.ui.filters} icon="filter">
        <div className="form-grid form-grid--3">
          <Field label={tt.type}>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{t.common.all}</option>
              {groups.map((g) => (
                <optgroup key={g} label={label(tt.groups, g)}>
                  <option value={g}>{tt.allGroup(label(tt.groups, g))}</option>
                  {TYPE_GROUPS[g].map((type) => <option key={type} value={type}>{label(t.enums.TimelineEventType, type)}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label={t.common.from}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t.common.to}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      <Card flush title={tt.title} icon="history">
        {!loaded ? <Loading /> : (
          <>
            <Table
              head={<>
                <th>{tt.col.when}</th><th>{tt.col.event}</th><th>{tt.col.by}</th><th>{tt.col.doctor}</th><th>{tt.col.details}</th>
                <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
              </>}
              isEmpty={items.length === 0} empty={<EmptyState compact icon="history" title={tt.none} />}
            >
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap tabular">{fmtDateTime(e.at)}</td>
                  <td className="cell-strong">{label(t.enums.TimelineEventType, e.type)}</td>
                  <td>{e.actor?.name ?? <em className="text-muted">{t.common.online}</em>}</td>
                  <td>{e.doctor?.name ?? <span className="text-muted">{t.common.none}</span>}</td>
                  <td className="text-body-sm"><Values value={e.data} inline /></td>
                  <td className="actions">
                    <div className="row-actions">
                      {e.refs.invoiceId && role !== 'DOCTOR' && (
                        <ButtonLink size="sm" variant="ghost" icon="receipt" to={`/reception/invoices/${e.refs.invoiceId}`}>{t.common.invoice}</ButtonLink>
                      )}
                      {e.refs.visitId && (role === 'OWNER' || (role === 'DOCTOR' && e.doctor?.id === myDoctorId)) && (
                        <ButtonLink size="sm" variant="ghost" icon="eye" to={`/visits/${e.refs.visitId}`}>{tt.visit}</ButtonLink>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            {cursor && <LoadMore loading={loading} onClick={() => load(cursor)}>{tt.loadMore}</LoadMore>}
          </>
        )}
      </Card>
    </div>
  );
}
