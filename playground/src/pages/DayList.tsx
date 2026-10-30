import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { act, get, patch, post, qs } from '../api';
import { SlotPicker } from '../components';
import { fmtTime, todayCairo } from '../time';
import { useLoad } from '../util';

interface Row {
  isWalkIn: boolean; id: string | null; referenceCode: string | null; status: string | null; source: string | null;
  startAt: string | null; endAt: string | null; bookedName: string | null; nameMismatch: boolean;
  patient: { id: string; name: string; phone: string }; doctor: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number }; notes: string | null; cancelReason: string | null;
  visitId: string | null; visitStatus: string | null; checkedInAt: string | null;
  invoiceId: string | null; invoiceTotal: string | null; amountPaid: string | null; balance: string | null; paymentStatus: string;
}

const reason = (what: string) => window.prompt(`Reason to ${what} (min 3 chars)`) ?? '';
// Buttons follow appointment-state-machine.ts by hand (the API has no "allowed actions" per row, see FINDINGS.md).

export function DayList() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayCairo();
  const [rows, reload, loading] = useLoad(() => get<Row[]>(`/appointments/day${qs({ date })}`), [date]);
  const [resched, setResched] = useState<Row | null>(null);
  const run = async (fn: () => Promise<unknown>) => { await act(fn); reload(); };

  return (
    <>
      <h2>Reception day list</h2>
      <div className="row">
        <label>Date <input type="date" value={date} onChange={(e) => setParams({ date: e.target.value })} /></label>
        <button onClick={reload} style={{ width: 'auto' }}>{loading ? '...' : 'Refresh'}</button>
        <Link to="/reception/book">+ New booking / walk-in</Link>
      </div>
      <OpenVisits />
      <table>
        <thead>
          <tr><th>Time</th><th>Patient</th><th>Phone</th><th>Doctor</th><th>Service</th><th>Appt</th><th>Visit</th><th>Payment</th><th>Balance</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows?.map((r) => {
            const st = r.status;
            const canCheckIn = !r.isWalkIn && (st === 'PENDING' || st === 'CONFIRMED');
            return (
              <tr key={r.id ?? r.visitId!}>
                <td>{r.isWalkIn ? <i>walk-in {fmtTime(r.checkedInAt)}</i> : `${fmtTime(r.startAt)}-${fmtTime(r.endAt)}`}<br /><small>{r.referenceCode} {r.source}</small></td>
                <td>
                  <Link to={`/reception/patients/${r.patient.id}`}>{r.patient.name}</Link>
                  {r.nameMismatch && <div className="warn">⚠ booked as "{r.bookedName}"</div>}
                </td>
                <td>{r.patient.phone}</td>
                <td>{r.doctor.name}</td>
                <td>{r.service.name}</td>
                <td>{st ?? '-'}{r.cancelReason && <div><small>{r.cancelReason}</small></div>}</td>
                <td>{r.visitStatus ?? '-'}</td>
                <td>{r.paymentStatus}</td>
                <td>{r.balance ?? '-'}{r.invoiceTotal && <div><small>of {r.invoiceTotal}</small></div>}</td>
                <td>
                  {st === 'PENDING' && <button onClick={() => run(() => patch(`/appointments/${r.id}/confirm`))}>confirm</button>}
                  {(st === 'PENDING' || st === 'CONFIRMED') && <button onClick={() => run(() => patch(`/appointments/${r.id}/cancel`, { reason: reason('cancel') }))}>cancel</button>}
                  {st === 'CONFIRMED' && <button onClick={() => run(() => patch(`/appointments/${r.id}/no-show`))}>no-show</button>}
                  {canCheckIn && <button onClick={() => run(() => post(`/appointments/${r.id}/check-in`))}>check-in</button>}
                  {r.visitStatus === 'WAITING' && !r.isWalkIn && <button onClick={() => run(() => post(`/visits/${r.visitId}/undo-check-in`, { reason: reason('undo check-in') }))}>undo check-in</button>}
                  {r.visitStatus === 'WAITING' && <button onClick={() => run(() => post(`/visits/${r.visitId}/cancel`, { reason: reason('cancel the visit (patient left)') }))}>cancel visit</button>}
                  {st === 'CONFIRMED' && <button onClick={() => setResched(r)}>reschedule</button>}
                  {r.invoiceId && <Link role="button" to={`/reception/invoices/${r.invoiceId}`}>invoice</Link>}
                  {!r.invoiceId && r.visitId && r.visitStatus !== 'CANCELLED' && (
                    <button onClick={() => run(() => post(`/visits/${r.visitId}/invoice`))}>create invoice</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows?.length === 0 && <p>Nothing on this day.</p>}
      {resched && <Reschedule row={resched} onDone={() => { setResched(null); reload(); }} />}
    </>
  );
}

function Reschedule({ row, onDone }: { row: Row; onDone: () => void }) {
  const [startAt, setStartAt] = useState('');
  const [outside, setOutside] = useState(false);
  const [why, setWhy] = useState('');
  return (
    <div className="box">
      <h4>Reschedule {row.referenceCode} — {row.patient.name} with {row.doctor.name} ({row.service.name})</h4>
      <label><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> outside schedule</label>
      <SlotPicker doctorId={row.doctor.id} serviceId={row.service.id} outside={outside} value={startAt} onPick={setStartAt} />
      <input placeholder="reason (optional)" value={why} onChange={(e) => setWhy(e.target.value)} />
      <div className="inline">
        <button disabled={!startAt} onClick={async () => {
          if (await act(() => post(`/appointments/${row.id}/reschedule`, { startAt, reason: why || undefined, allowOutsideSchedule: outside || undefined }))) onDone();
        }}>Reschedule</button>
        <button onClick={onDone}>Close</button>
      </div>
      <small>Same doctor only here (the API also accepts another doctorId).</small>
    </div>
  );
}

function OpenVisits() {
  const [open] = useLoad(() => get<any[]>('/visits/open'), []);
  if (!open?.length) return null;
  return (
    <p className="warn">
      Forgotten open visits from previous days: {open.map((v) => `${v.patient.name} (${v.doctor.name}, ${v.status})`).join(', ')}
    </p>
  );
}
