import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, qs } from '../api';
import { dayRange, fmtDateTime, todayCairo } from '../time';
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
      <h3>Cancelled visits still holding money ({a.cancelledVisitsWithPayments.length})</h3>
      <Table rows={a.cancelledVisitsWithPayments} />
      <h3>Overdue (balance, older than {a.overdueDays} days) ({a.overdue.length})</h3>
      <Table rows={a.overdue} />
    </>
  );
}

const ENTITY_TYPES = ['USER', 'PATIENT', 'DOCTOR', 'CLINIC_SERVICE', 'DOCTOR_SCHEDULE', 'DOCTOR_TIME_OFF', 'APPOINTMENT', 'VISIT', 'INVOICE', 'PAYMENT', 'EXPENSE', 'EXPENSE_CATEGORY', 'CLINICAL_NOTE', 'PATIENT_ATTACHMENT'];

export function AuditLog() {
  const [filters, setFilters] = useState({ entityType: '', action: '', userId: '', entityId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [users] = useLoad(() => get(`/users${qs({ limit: 100 })}`), []);
  const names = new Map<string, string>(users?.items.map((u: any) => [u.id, u.name]) ?? []);
  const [res] = useLoad(() => get(`/audit-logs${qs({
    ...filters,
    from: filters.from ? dayRange(filters.from).from : undefined,
    to: filters.to ? dayRange(filters.to).to : undefined,
    page, limit: 50,
  })}`), [JSON.stringify(filters), page]);
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
              <td>{fmtDateTime(l.createdAt)}</td><td>{l.userId ? names.get(l.userId) ?? l.userId.slice(0, 8) : <i>public/system</i>}</td>
              <td>{l.action}</td><td>{l.entityType}<br /><small>{l.entityId}</small></td>
              <td>{l.oldValues && <Json value={l.oldValues} />}</td><td>{l.newValues && <Json value={l.newValues} />}</td><td>{l.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
