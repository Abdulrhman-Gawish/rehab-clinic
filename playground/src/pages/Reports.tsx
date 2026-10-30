import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, qs } from '../api';
import { fmtDateTime, todayCairo } from '../time';
import { Json, useLoad } from '../util';

export function Summary() {
  const [date, setDate] = useState(todayCairo());
  const [s] = useLoad(() => get(`/billing/daily-summary${qs({ date })}`), [date]);
  const Money = ({ label, m }: { label: string; m: any }) => (
    <tr><td>{label}</td><td>{m.count}</td><td>{m.total}</td>{Object.values(m.byMethod).map((v: any, i) => <td key={i}>{v}</td>)}</tr>
  );
  return (
    <>
      <h2>Daily summary</h2>
      <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {getSession()?.user.role === 'RECEPTIONIST' && <small>Receptionists can only see today.</small>}
      {s && (
        <>
          <table>
            <thead><tr><th></th><th>Count</th><th>Total</th><th>CASH</th><th>CARD</th><th>WALLET</th><th>INSTAPAY</th></tr></thead>
            <tbody>
              <Money label="Payments" m={s.payments} />
              <Money label="Refunds" m={s.refunds} />
              <Money label="Expenses" m={s.expenses} />
            </tbody>
          </table>
          <p>Voided: {s.voided.count} ({s.voided.amount}) · Discounts: {s.discounts.count} ({s.discounts.amount})
            {s.discounts.byUser.map((u: any) => ` · ${u.name}: ${u.count} = ${u.amount}`)}</p>
          <h3>Expected cash in drawer: {s.expectedCash}</h3>
          <small>{fmtDateTime(s.from)} → {fmtDateTime(s.to)}</small>
        </>
      )}
    </>
  );
}

export function Attention() {
  const [a] = useLoad(() => get('/billing/attention'), []);
  const Table = ({ rows }: { rows: any[] }) => (
    <table>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id}><td><Link to={`/reception/invoices/${i.id}`}>{i.invoiceNumber}</Link></td><td>{i.patient.name}</td><td>{i.status}</td>
            <td>total {i.total}</td><td>paid {i.amountPaid}</td><td>balance {i.balance}</td><td>{fmtDateTime(i.issuedAt)}</td></tr>
        ))}
      </tbody>
    </table>
  );
  if (!a) return <p>Loading…</p>;
  return (
    <>
      <h2>Attention</h2>
      <h3>Voided visits still holding money ({a.voidedVisitsWithPayments.length})</h3>
      <Table rows={a.voidedVisitsWithPayments} />
      <h3>Overdue (balance, older than {a.overdueDays} days) ({a.overdue.length})</h3>
      <Table rows={a.overdue} />
    </>
  );
}

// ---------- Owner reports (GET /reports/*, from/to inclusive local dates)

const firstOfLastMonth = () => {
  const [y, m] = todayCairo().split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};

export function OwnerReports() {
  const [from, setFrom] = useState(firstOfLastMonth());
  const [to, setTo] = useState(todayCairo());
  const range = { from, to };
  return (
    <>
      <h2>Reports</h2>
      <div className="row">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <SummaryReport range={range} />
      <RevenueReport range={range} />
      <AttendanceReport range={range} />
      <DiscountsReport range={range} />
      <ExpensesReport range={range} />
      <OutstandingReport range={range} />
    </>
  );
}

type Range = { from: string; to: string };
const useReport = (path: string, range: Range, extra: Record<string, string | number> = {}) =>
  useLoad(() => get(`/reports/${path}${qs({ ...range, ...extra })}`), [path, range.from, range.to, JSON.stringify(extra)])[0];

function SummaryReport({ range }: { range: Range }) {
  const s = useReport('summary', range);
  if (!s) return null;
  const { from: _f, to: _t, ...fields } = s;
  return (
    <>
      <h3>Summary</h3>
      <table><tbody>
        {Object.entries(fields).map(([k, v]) => <tr key={k}><td>{k}</td><td><b>{String(v)}</b></td></tr>)}
      </tbody></table>
    </>
  );
}

function RevenueReport({ range }: { range: Range }) {
  const [groupBy, setGroupBy] = useState('day');
  const r = useReport('revenue', range, { groupBy });
  return (
    <>
      <h3>Revenue</h3>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        {['day', 'month', 'doctor', 'service', 'method'].map((g) => <option key={g}>{g}</option>)}
      </select>
      {r && (
        <table>
          <thead><tr><th>{groupBy}</th><th>Collected</th><th>Invoiced</th><th>Visits</th></tr></thead>
          <tbody>
            {r.rows.map((row: any) => (
              <tr key={row.key ?? 'none'}><td>{row.label}</td><td>{row.collected}</td><td>{row.invoiced ?? '-'}</td><td>{row.visits ?? '-'}</td></tr>
            ))}
            <tr><td><b>Total</b></td><td><b>{r.totals.collected}</b></td><td><b>{r.totals.invoiced ?? '-'}</b></td><td><b>{r.totals.visits ?? '-'}</b></td></tr>
          </tbody>
        </table>
      )}
    </>
  );
}

function AttendanceReport({ range }: { range: Range }) {
  const a = useReport('attendance', range);
  if (!a) return null;
  const Row = ({ label, c }: { label: string; c: any }) => (
    <tr><td>{label}</td><td>{c.booked}</td><td>{c.attended}</td><td>{c.noShow}</td><td>{c.cancelled}</td>
      <td>{c.noShowRate ?? '-'}%</td><td>{c.walkIns}</td><td>{c.onlineBookings}</td><td>{c.receptionBookings}</td></tr>
  );
  return (
    <>
      <h3>Attendance</h3>
      <table>
        <thead><tr><th>Doctor</th><th>Booked</th><th>Attended</th><th>No-show</th><th>Cancelled</th><th>No-show rate</th><th>Walk-ins</th><th>Online</th><th>Reception</th></tr></thead>
        <tbody>
          {a.doctors.map((d: any) => <Row key={d.doctor.id} label={d.doctor.name} c={d} />)}
          <Row label="Total" c={a.totals} />
        </tbody>
      </table>
    </>
  );
}

function DiscountsReport({ range }: { range: Range }) {
  const d = useReport('discounts', range);
  if (!d) return null;
  return (
    <>
      <h3>Discounts</h3>
      <p>{d.count} discounts, {d.totalAmount} in total, {d.repeats} repeated</p>
      <div className="cols">
        <table>
          <thead><tr><th>By user</th><th>Count</th><th>Amount</th></tr></thead>
          <tbody>{d.byUser.map((u: any) => <tr key={u.user.id}><td>{u.user.name}</td><td>{u.count}</td><td>{u.amount}</td></tr>)}</tbody>
        </table>
        <table>
          <thead><tr><th>Top reasons</th><th>Count</th><th>Amount</th></tr></thead>
          <tbody>{d.byReason.map((r: any) => <tr key={r.reason}><td>{r.reason}</td><td>{r.count}</td><td>{r.amount}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function ExpensesReport({ range }: { range: Range }) {
  const e = useReport('expenses', range);
  if (!e) return null;
  return (
    <>
      <h3>Expenses</h3>
      <p>{e.count} expenses, {e.total} in total · {Object.entries(e.byMethod).map(([m, v]) => `${m} ${v}`).join(' · ')}</p>
      <table>
        <thead><tr><th>Category</th><th>Count</th><th>Total</th></tr></thead>
        <tbody>{e.byCategory.map((c: any) => <tr key={c.category.id}><td>{c.category.name}</td><td>{c.count}</td><td>{c.total}</td></tr>)}</tbody>
      </table>
    </>
  );
}

function OutstandingReport({ range }: { range: Range }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range.from, range.to]);
  const o = useReport('outstanding', range, { page, limit: 10 });
  if (!o) return null;
  return (
    <>
      <h3>Outstanding</h3>
      <table>
        <thead><tr><th>Patient</th><th>Phone</th><th>Balance</th><th>Oldest unpaid invoice</th></tr></thead>
        <tbody>
          {o.items.map((r: any) => (
            <tr key={r.patient.id}><td><Link to={`/reception/patients/${r.patient.id}`}>{r.patient.name}</Link></td><td>{r.patient.phone}</td><td>{r.balance}</td><td>{r.oldestUnpaidInvoiceDate}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="inline">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>prev</button> page {page} / {o.meta.totalPages || 1} ({o.meta.total})
        <button disabled={page >= o.meta.totalPages} onClick={() => setPage(page + 1)}>next</button>
      </div>
    </>
  );
}

const ENTITY_TYPES = ['USER', 'PATIENT', 'DOCTOR', 'CLINIC_SERVICE', 'DOCTOR_SCHEDULE', 'DOCTOR_TIME_OFF', 'APPOINTMENT', 'VISIT', 'INVOICE', 'PAYMENT', 'EXPENSE', 'EXPENSE_CATEGORY', 'CLINICAL_NOTE', 'PATIENT_ATTACHMENT'];

export function AuditLog() {
  const [filters, setFilters] = useState({ entityType: '', action: '', userId: '', entityId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  // Only for the "user" filter: rows carry user { id, name, role } themselves.
  const [users] = useLoad(() => get(`/users${qs({ limit: 100 })}`), []);
  // from / to are clinic local dates, both inclusive.
  const [res] = useLoad(() => get(`/audit-logs${qs({ ...filters, page, limit: 50 })}`), [JSON.stringify(filters), page]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };
  return (
    <>
      <h2>Audit log</h2>
      <div className="row">
        <select value={filters.entityType} onChange={set('entityType')}><option value="">any entity</option>{ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input placeholder="action e.g. PAYMENT_RECORDED" value={filters.action} onChange={set('action')} />
        <select value={filters.userId} onChange={set('userId')}><option value="">any user</option>{users?.items.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <input placeholder="entity id" value={filters.entityId} onChange={set('entityId')} />
        <input type="date" value={filters.from} onChange={set('from')} />
        <input type="date" value={filters.to} onChange={set('to')} />
      </div>
      <div className="inline">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>prev</button> page {page} / {res?.meta.totalPages} ({res?.meta.total})
        <button disabled={!res || page >= res.meta.totalPages} onClick={() => setPage(page + 1)}>next</button>
      </div>
      <table>
        <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Old</th><th>New</th><th>IP</th></tr></thead>
        <tbody>
          {res?.items.map((l: any) => (
            <tr key={l.id}>
              <td>{fmtDateTime(l.createdAt)}</td><td>{l.user ? `${l.user.name} (${l.user.role})` : <i>public/system</i>}</td>
              <td>{l.action}</td><td>{l.entityType}<br /><small>{l.entityId}</small></td>
              <td>{l.oldValues && <Json value={l.oldValues} />}</td><td>{l.newValues && <Json value={l.newValues} />}</td><td>{l.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
