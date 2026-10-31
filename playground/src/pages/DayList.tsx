import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { act, get, getSession, post, qs } from '../api';
import { SlotPicker, useDoctors } from '../components';
import { fmtTime, todayCairo } from '../time';
import { useLoad } from '../util';

interface Row {
  isWalkIn: boolean; id: string | null; referenceCode: string | null; status: string | null; source: string | null;
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
}

const STATUSES = ['PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'];
const reason = (what: string) => window.prompt(`Reason to ${what} (min 3 chars)`) ?? '';

/**
 * The day list. Every button comes from the row's `allowedActions` (computed by the API from the state machine and
 * the time / undo rules), so the UI copies no rules. A DOCTOR gets their own rows, without billing columns.
 */
export function DayList() {
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
  const [resched, setResched] = useState<Row | null>(null);
  const [attending, setAttending] = useState<Row | null>(null);
  const run = async (fn: () => Promise<unknown>) => { await act(fn); reload(); };
  const setFilter = (next: { date?: string; status?: string[]; doctorId?: string }) => {
    const p = new URLSearchParams();
    p.set('date', next.date ?? date);
    (next.status ?? status).forEach((s) => p.append('status', s));
    if ((next.doctorId ?? doctorId)) p.set('doctorId', next.doctorId ?? doctorId);
    setParams(p);
  };
  const toggle = (s: string) => setFilter({ status: status.includes(s) ? status.filter((x) => x !== s) : [...status, s] });

  const actions: Record<string, (r: Row) => Promise<unknown>> = {
    confirm: (r) => post(`/appointments/${r.id}/confirm`),
    cancel: (r) => post(`/appointments/${r.id}/cancel`, { reason: reason('cancel') }),
    noShow: (r) => post(`/appointments/${r.id}/no-show`),
    undoNoShow: (r) => post(`/appointments/${r.id}/undo-no-show`),
    restoreSession: (r) => post(`/package-usages/${r.package?.usageId}/restore`, { reason: reason('give the session back') }),
    // A walk-in has no appointment: it is undone through its visit.
    undoAttend: (r) => r.isWalkIn
      ? post(`/visits/${r.visitId}/undo-attend`, { reason: reason('undo the walk-in') })
      : post(`/appointments/${r.id}/undo-attend`, { reason: reason('undo attend') }),
  };

  return (
    <>
      <h2>{isDoctor ? 'My day' : 'Reception day list'}</h2>
      <div className="row">
        <label>Date <input type="date" value={date} onChange={(e) => setFilter({ date: e.target.value })} /></label>
        {!isDoctor && (
          <label>Doctor
            <select value={doctorId} onChange={(e) => setFilter({ doctorId: e.target.value })}>
              <option value="">all</option>{doctors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={reload} style={{ width: 'auto' }}>{loading ? '...' : 'Refresh'}</button>
        {!isDoctor && <Link to="/reception/book">+ New booking / walk-in</Link>}
      </div>
      <div className="inline">
        Status:{' '}
        {STATUSES.map((s) => (
          <label key={s} style={{ display: 'inline', marginRight: 12 }}>
            <input type="checkbox" checked={status.includes(s)} onChange={() => toggle(s)} /> {s}
          </label>
        ))}
        <small> (none = all; walk-ins count as ATTENDED)</small>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Patient</th><th>Phone</th><th>Doctor</th><th>Service</th><th>Appt</th><th>Visit</th><th>Note</th><th>Package</th>
            {!isDoctor && <><th>Payment</th><th>Balance</th></>}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id ?? r.visitId!}>
              <td>
                {r.isWalkIn ? <i>walk-in {fmtTime(r.attendedAt)}</i> : `${fmtTime(r.startAt)}-${fmtTime(r.endAt)}`}<br />
                <small>{r.referenceCode} {r.source}</small>
              </td>
              <td>
                {isDoctor ? r.patient.name : <Link to={`/reception/patients/${r.patient.id}`}>{r.patient.name}</Link>}
                {r.nameMismatch && <div className="warn">⚠ booked as "{r.bookedName}"</div>}
              </td>
              <td>{r.patient.phone}</td>
              <td>{r.doctor.name}</td>
              <td>{r.service.name}</td>
              <td>{r.status ?? '-'}{r.cancelReason && <div><small>{r.cancelReason}</small></div>}</td>
              <td>{r.visitStatus ?? '-'}{r.attendedAt && !r.isWalkIn && <div><small>{fmtTime(r.attendedAt)}</small></div>}</td>
              <td>{r.noteStatus ?? '-'}</td>
              <td>
                {r.package ? <>{r.package.name}<div><small>{r.package.used}/{r.package.total} used</small></div></>
                  : r.requestedPackage ? <i>wants: {r.requestedPackage.name}</i> : '-'}
              </td>
              {!isDoctor && <>
                <td>{r.paymentStatus}</td>
                <td>{r.balance ?? '-'}{r.invoiceTotal && <div><small>of {r.invoiceTotal}</small></div>}</td>
              </>}
              <td>
                {r.allowedActions.map((a) => {
                  if (a === 'reschedule') return <button key={a} onClick={() => setResched(r)}>reschedule</button>;
                  if (a === 'attend') return <button key={a} onClick={() => setAttending(r)}>attend</button>;
                  if (a === 'writeNote' || a === 'viewNote') {
                    return <Link key={a} role="button" to={`/doctor/visits/${r.visitId}`}>{a === 'writeNote' ? 'write note' : 'view note'}</Link>;
                  }
                  return <button key={a} onClick={() => run(() => actions[a](r))}>{a}</button>;
                })}
                {r.invoiceId && <Link role="button" to={`/reception/invoices/${r.invoiceId}`}>invoice</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p>Nothing on this day.</p>}
      {resched && <Reschedule row={resched} onDone={() => { setResched(null); reload(); }} />}
      {attending && <Attend row={attending} onDone={() => { setAttending(null); reload(); }} />}
    </>
  );
}

/**
 * Attend, choosing who pays the session: the package picked online (sold first: FINDINGS #29), the API's default
 * (oldest usable package), a specific package, or none.
 * "Usable" is worked out here from GET /patients/:id/packages (same service, doctor allowed, ACTIVE): see FINDINGS #23.
 */
function Attend({ row, onDone }: { row: Row; onDone: () => void }) {
  const [packages] = useLoad(() => get<any[]>(`/patients/${row.patient.id}/packages`), [row.patient.id]);
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
    return post(`/appointments/${row.id}/attend`, body);
  };
  return (
    <div className="box">
      <h4>Attend {row.patient.name} with {row.doctor.name} ({row.service.name})</h4>
      {!packages ? <p>Loading packages…</p> : (
        <div>
          {requested && (
            <label><input type="radio" checked={choice === 'sell'} onChange={() => setChoice('sell')} />{' '}
              <b>sell "{requested.name}" (asked for online) and use it</b> <small>(creates its invoice)</small></label>
          )}
          {usable.length > 0 && <label><input type="radio" checked={choice === 'auto'} onChange={() => setChoice('auto')} /> oldest usable package</label>}
          {usable.map((p) => (
            <label key={p.id}><input type="radio" checked={choice === p.id} onChange={() => setChoice(p.id)} /> {p.name} ({p.sessionsLeft} left)</label>
          ))}
          {(requested || usable.length > 0)
            ? <label><input type="radio" checked={choice === 'none'} onChange={() => setChoice('none')} /> no package (bill the visit)</label>
            : <p>No usable package: the visit is billed normally.</p>}
        </div>
      )}
      <div className="inline">
        <button onClick={async () => { if (await act(attend)) onDone(); }}>Attend</button>
        <button onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

function Reschedule({ row, onDone }: { row: Row; onDone: () => void }) {
  const [startAt, setStartAt] = useState('');
  const [outside, setOutside] = useState(false);
  const [why, setWhy] = useState('');
  return (
    <div className="box">
      <h4>Reschedule {row.referenceCode} ({row.status}) — {row.patient.name} with {row.doctor.name} ({row.service.name})</h4>
      <label><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> outside schedule (past times too)</label>
      <SlotPicker doctorId={row.doctor.id} serviceId={row.service.id} outside={outside} value={startAt} onPick={setStartAt} />
      <input placeholder="reason (optional)" value={why} onChange={(e) => setWhy(e.target.value)} />
      <div className="inline">
        <button disabled={!startAt} onClick={async () => {
          if (await act(() => post(`/appointments/${row.id}/reschedule`, { startAt, reason: why || undefined, allowOutsideSchedule: outside || undefined }))) onDone();
        }}>Reschedule</button>
        <button onClick={onDone}>Close</button>
      </div>
      <small>Same doctor only here (the API also accepts another doctorId). The new appointment is CONFIRMED.</small>
    </div>
  );
}
