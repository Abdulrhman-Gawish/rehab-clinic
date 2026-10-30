import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { act, get, getSession, post, qs } from '../api';
import { fmtDateTime } from '../time';
import { useLoad } from '../util';

export function Patients() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [res] = useLoad(() => get(`/patients${qs({ search: q, limit: 50 })}`), [q]);
  return (
    <>
      <h2>Patients</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(search); }}>
        <input placeholder="name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button style={{ width: 'auto' }}>Search</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Source</th><th>Created</th></tr></thead>
        <tbody>
          {res?.items.map((p: any) => (
            <tr key={p.id}><td><Link to={`/reception/patients/${p.id}`}>{p.name}</Link></td><td>{p.phone}</td><td>{p.createdSource}</td><td>{fmtDateTime(p.createdAt)}</td></tr>
          ))}
        </tbody>
      </table>
      <small>{res?.meta.total} patients</small>
    </>
  );
}

// One request for the page (GET /patients/:id/overview) + the paged timeline.
export function PatientPage() {
  const { id } = useParams();
  const role = getSession()?.user.role ?? 'RECEPTIONIST';
  const [o] = useLoad(() => get(`/patients/${id}/overview`), [id]);
  if (!o) return <p>Loading…</p>;
  const { patient, nextAppointment: next, lastVisit: last, counts, doctors, balance, notesNeedingAttention: notes } = o;
  return (
    <>
      <h2>{patient.name} <small>{patient.phone}</small></h2>
      <p>source {patient.createdSource} · since {fmtDateTime(patient.createdAt)}</p>
      <div className="cols">
        <div className="box">
          <p>Next appointment: {next ? <b>{fmtDateTime(next.startAt)} {next.doctor.name} · {next.service.name} ({next.status})</b> : '-'}</p>
          <p>Last visit: {last ? <b>{fmtDateTime(last.attendedAt)} {last.doctor.name} · {last.service.name}{last.isWalkIn && ' (walk-in)'}</b> : '-'}</p>
          <p>Attended {counts.attended} · no-show {counts.noShow} · cancelled {counts.cancelled}</p>
          {balance && <p><b>Balance: {balance.balance}</b> (invoiced {balance.totalInvoiced}, paid {balance.totalPaid})</p>}
        </div>
        <div className="box">
          <b>Doctors seen</b>
          <table><tbody>
            {doctors.map((d: any) => <tr key={d.id}><td>{d.name}</td><td>last {fmtDateTime(d.lastVisitAt)}</td></tr>)}
          </tbody></table>
          {notes && <>
            <b>Notes needing attention ({notes.length})</b>
            <table><tbody>
              {notes.map((n: any) => (
                <tr key={n.visitId}>
                  <td>{role === 'DOCTOR' ? <Link to={`/doctor/visits/${n.visitId}`}>{fmtDateTime(n.attendedAt)}</Link> : fmtDateTime(n.attendedAt)}</td>
                  <td>{n.doctor.name}</td><td>{n.service.name}</td><td>{n.noteStatus ?? 'no note'}</td>
                </tr>
              ))}
            </tbody></table>
          </>}
        </div>
      </div>
      <PatientPackages patientId={id!} role={role} />
      <Timeline patientId={id!} role={role} />
    </>
  );
}

/** Sold packages; the desk sells one, restores a no-show session; the owner cancels. A doctor gets no prices. */
function PatientPackages({ patientId, role }: { patientId: string; role: string }) {
  const desk = role !== 'DOCTOR';
  const [list, reload] = useLoad(() => get<any[]>(`/patients/${patientId}/packages`), [patientId]);
  const [catalog] = useLoad(() => (desk ? get(`/packages${qs({ isActive: true, limit: 100 })}`) : Promise.resolve(null)), [desk]);
  const [packageId, setPackageId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const showSessions = async (ppId: string) => {
    if (open === ppId) { setOpen(null); return; }
    setOpen(ppId);
    setDetail(await get(`/patient-packages/${ppId}`).catch(() => null));
  };
  const after = async (ok: boolean) => { if (!ok) return; reload(); if (open) setDetail(await get(`/patient-packages/${open}`)); };
  return (
    <>
      <h3>Packages</h3>
      {desk && (
        <div className="row">
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">-- package to sell --</option>
            {catalog?.items.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name} · {p.sessionsCount} × {p.service.name} · {p.sellingPrice}{p.offerActive ? ` (offer, was ${p.price})` : ''}</option>
            ))}
          </select>
          <button style={{ width: 'auto' }} disabled={!packageId}
            onClick={() => act(() => post(`/patients/${patientId}/packages`, { packageId })).then((ok) => { if (ok) setPackageId(''); reload(); })}>
            Sell (creates the invoice)
          </button>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Package</th><th>Service</th><th>Sessions</th><th>Status</th><th>Doctors</th>
            {desk && <><th>Price</th><th>Paid</th><th>Balance</th></>}<th></th>
          </tr>
        </thead>
        <tbody>
          {list?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}<div><small>sold {fmtDateTime(p.soldAt)} by {p.soldBy.name}</small></div></td>
              <td>{p.service.name}</td>
              <td>{p.usedSessions}/{p.totalSessions} used · <b>{p.sessionsLeft} left</b></td>
              <td>{p.status}{p.cancelReason && <div><small>{p.cancelReason}</small></div>}</td>
              <td>{p.allDoctors ? <i>all</i> : p.doctors.map((d: any) => d.name).join(', ')}</td>
              {desk && <>
                <td>{p.price}{p.offerAmount !== '0.00' && <div><small>list {p.listPrice} − {p.offerAmount}</small></div>}</td>
                <td>{p.amountPaid}</td>
                <td>{p.balance} <Link to={`/reception/invoices/${p.invoiceId}`}>invoice</Link></td>
              </>}
              <td>
                <button onClick={() => showSessions(p.id)}>{open === p.id ? 'hide' : 'sessions'}</button>
                {role === 'OWNER' && p.status !== 'CANCELLED' && (
                  <button onClick={() => { const r = prompt('Reason to cancel the package (min 3 chars)'); if (r) act(() => post(`/patient-packages/${p.id}/cancel`, { reason: r })).then(after); }}>cancel package</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list?.length === 0 && <small>No packages.</small>}
      {open && detail && (
        <div className="box">
          <b>Sessions of {detail.name}</b>
          <table>
            <thead><tr><th>Used</th><th>Reason</th><th>Doctor</th><th>By</th><th>Restored</th><th></th></tr></thead>
            <tbody>
              {detail.usages.map((u: any) => (
                <tr key={u.id} style={u.restored ? { opacity: 0.5 } : {}}>
                  <td>{fmtDateTime(u.usedAt)}</td><td>{u.reason}</td><td>{u.doctor.name}</td><td>{u.usedBy.name}</td>
                  <td>{u.restored ? `${fmtDateTime(u.restoredAt)} by ${u.restoredBy.name}: ${u.restoreReason}` : '-'}</td>
                  <td>
                    {desk && !u.restored && u.reason === 'NO_SHOW' && (
                      <button onClick={() => { const r = prompt('Reason to give the session back (min 3 chars)'); if (r) act(() => post(`/package-usages/${u.id}/restore`, { reason: r })).then(after); }}>restore</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.usages.length === 0 && <small>No sessions used yet.</small>}
        </div>
      )}
    </>
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

// `data` as "key: value" text; instants (…At) in Cairo time, {id, name} as the name.
function describe(data: Record<string, any>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `${k}: ${k.endsWith('At') ? fmtDateTime(v) : typeof v === 'object' && !Array.isArray(v) ? v.name ?? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

function Timeline({ patientId, role }: { patientId: string; role: string }) {
  const groups = Object.keys(TYPE_GROUPS).filter((g) => g !== HIDDEN_GROUP[role]);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const types = filter ? TYPE_GROUPS[filter] ?? [filter] : undefined;
  const load = async (after: string | null) => {
    setLoading(true);
    try {
      const page = await get(`/patients/${patientId}/timeline${qs({ types, from, to, cursor: after, limit: 20 })}`);
      setItems((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch { /* shown in the error bar */ } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(null); }, [patientId, filter, from, to]);

  return (
    <>
      <h3>Timeline</h3>
      <div className="row">
        <label>Type
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">all</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                <option value={g}>all {g.toLowerCase()}</option>
                {TYPE_GROUPS[g].map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <table>
        <thead><tr><th>When</th><th>Event</th><th>By</th><th>Doctor</th><th>Details</th><th></th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{fmtDateTime(e.at)}</td><td>{e.type}</td><td>{e.actor?.name ?? <i>online</i>}</td><td>{e.doctor?.name}</td>
              <td><small>{describe(e.data)}</small></td>
              <td>
                {e.refs.invoiceId && role !== 'DOCTOR' && <Link to={`/reception/invoices/${e.refs.invoiceId}`}>invoice</Link>}{' '}
                {e.refs.visitId && role === 'DOCTOR' && <Link to={`/doctor/visits/${e.refs.visitId}`}>visit</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && !loading && <small>No events.</small>}
      {cursor && <button style={{ width: 'auto' }} disabled={loading} onClick={() => load(cursor)}>{loading ? 'Loading…' : 'Load more'}</button>}
    </>
  );
}
