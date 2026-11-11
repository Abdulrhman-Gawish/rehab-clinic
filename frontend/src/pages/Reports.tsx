import { Fragment, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, PAYMENT_METHODS, qs } from '../api';
import { usePaged, type Page } from '../components';
import { fmtDate, fmtDateTime, fmtMoney, fmtMonth, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import { addDays, firstOfLastMonth, firstOfMonth, todayCairo } from '../time';
import { Ltr, useLoad, Values } from '../util';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, Loading, PageHeader, Person, Segmented,
  Select, Stat, Stats, StatusBadge, Table, type IconName,
} from '../ui';
import '../styles/areas/owner.css';

/** Previous day / date / next day / today, for pages about one day. */
function DayPicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="input-group owner-day">
      <IconButton icon="chevron-left" label={t.ui.prevDay} variant="outline" size="md" onClick={() => onChange(addDays(date, -1))} />
      <Input type="date" aria-label={t.common.date} value={date} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <IconButton icon="chevron-right" label={t.ui.nextDay} variant="outline" size="md" onClick={() => onChange(addDays(date, 1))} />
      <Button onClick={() => onChange(todayCairo())}>{t.ui.today}</Button>
    </div>
  );
}

// ---------- Daily summary (desk and owner) ----------

export function Summary() {
  const { t } = useI18n();
  const ts = t.summary;
  const isReceptionist = getSession()?.user.role === 'RECEPTIONIST';
  const [date, setDate] = useState(todayCairo());
  const [s, , loading] = useLoad(() => get(`/billing/daily-summary${qs({ date })}`), [date]);
  const c = ts.col;
  // `part`: a share of the row above (already counted in it).
  const MoneyRow = ({ name, m, part }: { name: string; m: any; part?: boolean }) => (
    <tr>
      <td className={part ? 'text-muted' : 'cell-strong'}>{name}</td>
      <td className="num">{fmtNumber(m.count)}</td>
      <td className="num"><strong>{fmtMoney(m.total)}</strong></td>
      {PAYMENT_METHODS.map((method) => <td key={method} className="num">{fmtMoney(m.byMethod[method] ?? '0.00')}</td>)}
    </tr>
  );
  return (
    <>
      <PageHeader
        title={ts.title}
        description={<>{ts.subtitle}{isReceptionist && <span className="text-muted"> {ts.receptionistToday}</span>}</>}
        actions={<DayPicker date={date} onChange={setDate} />}
      />
      {!s ? (loading ? <Loading /> : null) : (
        <div className="stack-lg">
          <Stats>
            <Stat icon="banknote" label={ts.payments} value={fmtMoney(s.payments.total)} hint={ts.transactions(fmtNumber(s.payments.count))} />
            <Stat icon="undo" tone="warning" label={ts.refunds} value={fmtMoney(s.refunds.total)} hint={ts.transactions(fmtNumber(s.refunds.count))} />
            <Stat icon="wallet" tone="neutral" label={ts.expenses} value={fmtMoney(s.expenses.total)} hint={ts.transactions(fmtNumber(s.expenses.count))} />
            <Stat icon="check-circle" tone="highlight" label={ts.expectedCashLabel} value={fmtMoney(s.expectedCash)} hint={ts.expectedCashHint} />
          </Stats>

          <Card flush title={ts.byMethod} icon="credit-card" description={ts.period(t.common.range(fmtDateTime(s.from), fmtDateTime(s.to)))}>
            <Table
              head={<>
                <th><span className="visually-hidden">{t.ui.details}</span></th><th className="num">{c.count}</th><th className="num">{c.total}</th>
                {PAYMENT_METHODS.map((m) => <th key={m} className="num">{label(t.enums.PaymentMethod, m)}</th>)}
              </>}
            >
              <MoneyRow name={ts.payments} m={s.payments} />
              <MoneyRow name={ts.refunds} m={s.refunds} />
              <MoneyRow name={ts.expenses} m={s.expenses} />
              {s.commissionPayouts.count > 0 && <MoneyRow name={ts.commissionPayouts} m={s.commissionPayouts} part />}
            </Table>
            <div className="cluster owner-card-foot">
              <Badge tone="neutral" icon="ban">{ts.voided(fmtNumber(s.voided.count), fmtMoney(s.voided.amount))}</Badge>
              <Badge tone="info" icon="percent">{ts.discounts(fmtNumber(s.discounts.count), fmtMoney(s.discounts.amount))}</Badge>
            </div>
          </Card>

          {s.discounts.byUser.length > 0 && (
            <Card flush title={ts.discountsByUser} icon="percent">
              <Table head={<><th>{t.reports.byUser}</th><th className="num">{c.count}</th><th className="num">{t.reports.amount}</th></>}>
                {s.discounts.byUser.map((u: any) => (
                  <tr key={u.name}><td><Person name={u.name} size={32} /></td><td className="num">{fmtNumber(u.count)}</td><td className="num">{fmtMoney(u.amount)}</td></tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Attention (owner) ----------

export function Attention() {
  const { t } = useI18n();
  const ta = t.attention;
  // A page of the overdue invoices (items); the voided-visit invoices come whole with every page.
  const { res: a, pager } = usePaged<Page & { overdueDays: number; voidedVisitsWithPayments: any[] }>('/billing/attention', 20);
  return (
    <>
      <PageHeader title={ta.title} description={ta.subtitle} />
      {!a ? <Loading /> : (
        <div className="stack-lg">
          <AttentionCard icon="alert-triangle" title={ta.voidedHolding(fmtNumber(a.voidedVisitsWithPayments.length))} hint={ta.voidedHint} rows={a.voidedVisitsWithPayments} />
          <AttentionCard icon="clock" title={ta.overdue(fmtNumber(a.overdueDays), fmtNumber(a.meta.total))} hint={ta.overdueHint} rows={a.items} pager={pager} />
        </div>
      )}
    </>
  );
}

function AttentionCard({ icon, title, hint, rows, pager }: { icon: IconName; title: string; hint: string; rows: any[]; pager?: ReactNode }) {
  const { t } = useI18n();
  const c = t.attention.col;
  return (
    <Card flush title={title} icon={icon} description={hint}>
      <Table
        head={<>
          <th>{c.invoice}</th><th>{c.patient}</th><th>{c.status}</th><th className="num">{c.total}</th><th className="num">{c.paid}</th>
          <th className="num">{c.balance}</th><th>{c.issued}</th>
        </>}
        isEmpty={rows.length === 0}
        empty={<EmptyState compact icon="check-circle" title={t.attention.allClear} text={t.attention.allClearHint} />}
      >
        {rows.map((i) => (
          <tr key={i.id}>
            <td><Link to={`/reception/invoices/${i.id}`}><Ltr>{i.invoiceNumber}</Ltr></Link></td>
            <td>{i.patient.id ? <Link to={`/patients/${i.patient.id}`}>{i.patient.name}</Link> : i.patient.name}</td>
            <td><StatusBadge kind="InvoiceStatus" value={i.status} /></td>
            <td className="num">{fmtMoney(i.total)}</td>
            <td className="num">{fmtMoney(i.amountPaid)}</td>
            <td className="num"><strong>{fmtMoney(i.balance)}</strong></td>
            <td className="nowrap">{fmtDateTime(i.issuedAt)}</td>
          </tr>
        ))}
      </Table>
      {pager}
    </Card>
  );
}

// ---------- Owner reports (GET /reports/*, from/to inclusive local dates) ----------

type Range = { from: string; to: string };

const PRESETS = ['thisMonth', 'lastMonth', 'last30', 'thisYear'] as const;
function presetRange(name: (typeof PRESETS)[number]): Range {
  const today = todayCairo();
  if (name === 'thisMonth') return { from: firstOfMonth(today), to: today };
  if (name === 'lastMonth') {
    const end = addDays(firstOfMonth(today), -1);
    return { from: firstOfMonth(end), to: end };
  }
  if (name === 'last30') return { from: addDays(today, -29), to: today };
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function OwnerReports() {
  const { t } = useI18n();
  const tr = t.reports;
  const [from, setFrom] = useState(firstOfLastMonth());
  const [to, setTo] = useState(todayCairo());
  const range = { from, to };
  const pick = (r: Range) => { setFrom(r.from); setTo(r.to); };
  return (
    <>
      <PageHeader title={tr.title} description={tr.subtitle} />
      <div className="stack-lg">
        <Card>
          <div className="owner-range">
            <Field label={t.common.from}><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
            <Field label={t.common.to}><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
            <div className="cluster owner-presets" role="group" aria-label={tr.range}>
              {PRESETS.map((p) => {
                const r = presetRange(p);
                const on = r.from === from && r.to === to;
                return <Button key={p} size="sm" aria-pressed={on} onClick={() => pick(r)}>{label(tr.presets, p)}</Button>;
              })}
            </div>
          </div>
        </Card>
        <SummaryReport range={range} />
        <RevenueReport range={range} />
        <AttendanceReport range={range} />
        <div className="split split--even">
          <DiscountsReport range={range} />
          <ExpensesReport range={range} />
        </div>
        <OutstandingReport range={range} />
      </div>
    </>
  );
}

const useReport = (path: string, range: Range, extra: Record<string, string | number> = {}) =>
  useLoad(() => get(`/reports/${path}${qs({ ...range, ...extra })}`), [path, range.from, range.to, JSON.stringify(extra)])[0];

// Summary fields that are EGP amounts (the others are counts).
const MONEY_FIELDS = new Set([
  'collected', 'refunded', 'netCollected', 'expenses', 'commissionPayouts', 'netAfterExpenses', 'invoiced', 'outstanding',
  'discountsGiven',
]);
const FIELD_ICON: Record<string, IconName> = {
  collected: 'banknote', refunded: 'undo', netCollected: 'trending-up', expenses: 'wallet', commissionPayouts: 'users', netAfterExpenses: 'chart',
  invoiced: 'receipt', outstanding: 'alert-circle', discountsGiven: 'percent', attendedVisits: 'user-check', noShows: 'user-x',
  cancellations: 'ban', newPatients: 'user-plus', unsignedNotes: 'note-pen',
};
const FIELD_TONE: Record<string, 'warning' | 'error' | 'info' | 'neutral' | 'highlight'> = {
  netAfterExpenses: 'highlight', refunded: 'neutral', expenses: 'neutral', commissionPayouts: 'neutral', outstanding: 'warning',
  discountsGiven: 'info',
  noShows: 'error', cancellations: 'neutral', unsignedNotes: 'warning', newPatients: 'info',
};

function SummaryReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const s = useReport('summary', range);
  if (!s) return <Card title={tr.summary}><Loading /></Card>;
  const { from: _f, to: _t, ...fields } = s;
  const entries = Object.entries(fields);
  const stat = ([k, v]: [string, unknown]) => (
    <Stat
      key={k} icon={FIELD_ICON[k] ?? 'chart'} tone={FIELD_TONE[k]} label={label(tr.summaryFields, k)}
      value={MONEY_FIELDS.has(k) ? fmtMoney(String(v)) : fmtNumber(v as number)}
    />
  );
  return (
    <section className="stack" aria-label={tr.summary}>
      <h2 className="section-title">{tr.money}</h2>
      <Stats>{entries.filter(([k]) => MONEY_FIELDS.has(k)).map(stat)}</Stats>
      <h2 className="section-title">{tr.activity}</h2>
      <Stats>{entries.filter(([k]) => !MONEY_FIELDS.has(k)).map(stat)}</Stats>
    </section>
  );
}

interface ChartRow { key: string; label: string; value: number; text: string }

/** Time series (days, months): columns, oldest first, always left to right (a time axis is never mirrored). */
function ColumnChart({ rows }: { rows: ChartRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  const top = rows.find((r) => r.value === max);
  return (
    // The table under the chart has the same numbers for screen readers.
    <div className="owner-chart" aria-hidden="true">
      {top && max > 0 && <span className="owner-chart__max">{top.text}</span>}
      <div className="owner-columns">
        {rows.map((r) => (
          <div key={r.key} className="owner-columns__col" title={`${r.label}: ${r.text}`}>
            <span className="owner-columns__bar" style={{ height: `${max > 0 ? (Math.max(0, r.value) / max) * 100 : 0}%` }} />
          </div>
        ))}
      </div>
      {/* <bdi>: an Arabic date keeps its own order inside the left-to-right axis. */}
      <div className="owner-columns__axis"><bdi>{rows[0]?.label}</bdi><bdi>{rows.at(-1)?.label}</bdi></div>
    </div>
  );
}

/** Categories (doctor, service, method): labelled horizontal bars, largest first. */
function BarList({ rows }: { rows: ChartRow[] }) {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((r) => r.value), 0);
  return (
    <ul className="owner-bars" role="list">
      {sorted.map((r) => (
        <li key={r.key}>
          <span className="owner-bars__label" title={r.label}>{r.label}</span>
          <span className="owner-bars__track" aria-hidden="true">
            <span className="owner-bars__fill" style={{ width: `${max > 0 ? (Math.max(0, r.value) / max) * 100 : 0}%` }} />
          </span>
          <span className="tabular text-semibold">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

const GROUPS = ['day', 'month', 'doctor', 'service', 'method'];

function RevenueReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const [groupBy, setGroupBy] = useState('day');
  const r = useReport('revenue', range, { groupBy });
  // The group's name: dates and methods are translated here; doctors and services are names (no visit = manual invoices).
  const rowLabel = (row: any) => {
    if (row.key == null) return tr.manualInvoices;
    if (groupBy === 'day') return fmtDate(row.key);
    if (groupBy === 'month') return fmtMonth(row.key);
    if (groupBy === 'method') return label(t.enums.PaymentMethod, row.key);
    return row.label;
  };
  const chartRows: ChartRow[] = (r?.rows ?? []).map((row: any) => ({
    key: row.key ?? 'none', label: rowLabel(row), value: Number(row.collected), text: fmtMoney(row.collected),
  }));
  const timeSeries = groupBy === 'day' || groupBy === 'month';
  const dash = <span className="text-muted">{t.common.none}</span>;
  return (
    <Card
      title={tr.revenue} icon="trending-up" description={tr.revenueHint}
      actions={<Segmented label={tr.groupByLabel} value={groupBy} onChange={setGroupBy} options={GROUPS.map((g) => ({ value: g, label: label(tr.groupBy, g) }))} />}
    >
      {!r ? <Loading /> : r.rows.length === 0 ? <EmptyState compact icon="chart" title={tr.noData} /> : (
        <div className="stack-lg">
          {timeSeries ? <ColumnChart rows={chartRows} /> : <BarList rows={chartRows} />}
          <div className="table-card">
            <Table
              dense
              head={<><th>{label(tr.groupBy, groupBy)}</th><th className="num">{tr.col.collected}</th><th className="num">{tr.col.invoiced}</th><th className="num">{tr.col.visits}</th></>}
              foot={
                <tr>
                  <td>{tr.total}</td>
                  <td className="num">{fmtMoney(r.totals.collected)}</td>
                  <td className="num">{r.totals.invoiced ? fmtMoney(r.totals.invoiced) : t.common.none}</td>
                  <td className="num">{r.totals.visits != null ? fmtNumber(r.totals.visits) : t.common.none}</td>
                </tr>
              }
            >
              {r.rows.map((row: any) => (
                <tr key={row.key ?? 'none'}>
                  <td>{rowLabel(row)}</td>
                  <td className="num">{fmtMoney(row.collected)}</td>
                  <td className="num">{row.invoiced ? fmtMoney(row.invoiced) : dash}</td>
                  <td className="num">{row.visits != null ? fmtNumber(row.visits) : dash}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}

function AttendanceReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const a = useReport('attendance', range);
  const c = t.reports.acol;
  const cells = (n: any) => <>
    <td className="num">{fmtNumber(n.booked)}</td><td className="num">{fmtNumber(n.attended)}</td><td className="num">{fmtNumber(n.noShow)}</td>
    <td className="num">{fmtNumber(n.cancelled)}</td><td className="num">{n.noShowRate != null ? fmtPercent(n.noShowRate) : t.common.none}</td>
    <td className="num">{fmtNumber(n.walkIns)}</td><td className="num">{fmtNumber(n.onlineBookings)}</td><td className="num">{fmtNumber(n.receptionBookings)}</td>
  </>;
  return (
    <Card flush title={t.reports.attendance} icon="user-check" description={t.reports.attendanceHint}>
      {!a ? <Loading /> : (
        <Table
          head={<>
            <th>{c.doctor}</th><th className="num">{c.booked}</th><th className="num">{c.attended}</th><th className="num">{c.noShow}</th>
            <th className="num">{c.cancelled}</th><th className="num">{c.noShowRate}</th><th className="num">{c.walkIns}</th>
            <th className="num">{c.online}</th><th className="num">{c.reception}</th>
          </>}
          isEmpty={a.doctors.length === 0} empty={<EmptyState compact icon="user-check" title={t.reports.noData} />}
          foot={<tr><td>{t.reports.total}</td>{cells(a.totals)}</tr>}
        >
          {a.doctors.map((d: any) => <tr key={d.doctor.id}><td><Person name={d.doctor.name} size={32} /></td>{cells(d)}</tr>)}
        </Table>
      )}
    </Card>
  );
}

function DiscountsReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const d = useReport('discounts', range);
  return (
    <Card title={tr.discounts} icon="percent" description={d && tr.discountsLine(fmtNumber(d.count), fmtMoney(d.totalAmount), fmtNumber(d.repeats))}>
      {!d ? <Loading /> : d.count === 0 ? <EmptyState compact icon="percent" title={tr.noData} /> : (
        <div className="stack">
          <div className="table-card">
            <Table dense head={<><th>{tr.byUser}</th><th className="num">{tr.count}</th><th className="num">{tr.amount}</th></>}>
              {d.byUser.map((u: any) => <tr key={u.user.id}><td>{u.user.name}</td><td className="num">{fmtNumber(u.count)}</td><td className="num">{fmtMoney(u.amount)}</td></tr>)}
            </Table>
          </div>
          <div className="table-card">
            <Table dense head={<><th>{tr.topReasons}</th><th className="num">{tr.count}</th><th className="num">{tr.amount}</th></>}>
              {d.byReason.map((r: any) => <tr key={r.reason}><td>{r.reason}</td><td className="num">{fmtNumber(r.count)}</td><td className="num">{fmtMoney(r.amount)}</td></tr>)}
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}

function ExpensesReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const e = useReport('expenses', range);
  const methods = e ? Object.entries(e.byMethod as Record<string, string>) : [];
  return (
    <Card
      title={tr.expenses} icon="wallet"
      description={e && tr.expensesLine(fmtNumber(e.count), fmtMoney(e.total))
        + (Number(e.commissionPayouts) > 0 ? ` · ${tr.commissionPart(fmtMoney(e.commissionPayouts))}` : '')}
    >
      {!e ? <Loading /> : e.count === 0 ? <EmptyState compact icon="wallet" title={tr.noData} /> : (
        <div className="stack">
          {methods.length > 0 && (
            <dl className="owner-methods" aria-label={tr.byMethod}>
              {methods.map(([m, v]) => <div key={m}><dt>{label(t.enums.PaymentMethod, m)}</dt><dd>{fmtMoney(String(v))}</dd></div>)}
            </dl>
          )}
          <div className="table-card">
            <Table dense head={<><th>{tr.category}</th><th className="num">{tr.count}</th><th className="num">{t.summary.col.total}</th></>}>
              {e.byCategory.map((c: any) => <tr key={c.category.id}><td>{c.category.name}</td><td className="num">{fmtNumber(c.count)}</td><td className="num">{fmtMoney(c.total)}</td></tr>)}
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}

function OutstandingReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  // Another range is another list: the hook goes back to page 1.
  const { res: o, pager } = usePaged(`/reports/outstanding${qs({ ...range })}`, 10);
  const c = tr.ocol;
  return (
    <Card flush title={tr.outstanding} icon="alert-circle" description={tr.outstandingHint}>
      {!o ? <Loading /> : (
        <>
          <Table
            head={<><th>{c.patient}</th><th>{c.phone}</th><th className="num">{c.balance}</th><th>{c.oldest}</th></>}
            isEmpty={o.items.length === 0} empty={<EmptyState compact icon="check-circle" title={tr.noOutstanding} />}
          >
            {o.items.map((r: any) => (
              <tr key={r.patient.id}>
                <td><Person name={r.patient.name} to={`/patients/${r.patient.id}`} size={32} /></td>
                <td><Ltr>{r.patient.phone}</Ltr></td>
                <td className="num"><strong>{fmtMoney(r.balance)}</strong></td>
                <td className="nowrap">{fmtDate(r.oldestUnpaidInvoiceDate)}</td>
              </tr>
            ))}
          </Table>
          {pager}
        </>
      )}
    </Card>
  );
}

// ---------- Audit log (owner) ----------

const ENTITY_TYPES = ['USER', 'PATIENT', 'DOCTOR', 'CLINIC_SERVICE', 'DOCTOR_SCHEDULE', 'DOCTOR_TIME_OFF', 'APPOINTMENT', 'VISIT', 'INVOICE', 'PAYMENT', 'EXPENSE', 'EXPENSE_CATEGORY', 'CLINICAL_NOTE', 'PATIENT_ATTACHMENT', 'PACKAGE', 'PATIENT_PACKAGE'];
const NO_FILTERS = { entityType: '', action: '', userId: '', entityId: '', from: '', to: '' };

export function AuditLog() {
  const { t } = useI18n();
  const ta = t.audit;
  const [filters, setFilters] = useState(NO_FILTERS);
  const [entityId, setEntityId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Only for the "user" filter: rows carry user { id, name, role } themselves.
  const [users] = useLoad(() => get(`/users${qs({ limit: 100 })}`), []);
  // from / to are clinic local dates, both inclusive. Other filters are another list: the hook goes back to page 1.
  const { res, loading, pager } = usePaged(`/audit-logs${qs(filters)}`, 50);
  const update = (k: keyof typeof NO_FILTERS, v: string) => setFilters((old) => ({ ...old, [k]: v }));
  const set = (k: keyof typeof NO_FILTERS) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(k, e.target.value);
  // The id is typed: wait for a pause before asking the API.
  useEffect(() => {
    const timer = window.setTimeout(() => { if (entityId.trim() !== filters.entityId) update('entityId', entityId.trim()); }, 300);
    return () => window.clearTimeout(timer);
  }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = () => { setEntityId(''); setFilters(NO_FILTERS); };
  const filtered = Object.values(filters).some(Boolean) || entityId !== '';
  const c = ta.col;
  const values = (v: Record<string, unknown> | null): ReactNode => (v ? <Values value={v} /> : <span className="text-muted">{ta.noValues}</span>);

  return (
    <>
      <PageHeader title={ta.title} description={ta.subtitle} />
      <div className="stack-lg">
        <Card
          title={t.ui.filters} icon="filter"
          actions={<Button size="sm" variant="ghost" icon="x" disabled={!filtered} onClick={clear}>{t.ui.clearFilters}</Button>}
        >
          <div className="form-grid form-grid--3">
            <Field label={ta.entityType}>
              <Select value={filters.entityType} onChange={set('entityType')}>
                <option value="">{ta.anyEntity}</option>
                {ENTITY_TYPES.map((type) => <option key={type} value={type}>{label(t.enums.AuditEntityType, type)}</option>)}
              </Select>
            </Field>
            <Field label={ta.action}>
              <Select value={filters.action} onChange={set('action')}>
                <option value="">{ta.anyAction}</option>
                {Object.entries(t.enums.AuditAction).map(([action, text]) => <option key={action} value={action}>{text}</option>)}
              </Select>
            </Field>
            <Field label={ta.user}>
              <Select value={filters.userId} onChange={set('userId')}>
                <option value="">{ta.anyUser}</option>
                {users?.items.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label={ta.entityIdPh}><Input dir="ltr" autoComplete="off" value={entityId} onChange={(e) => setEntityId(e.target.value)} /></Field>
            <Field label={t.common.from}><Input type="date" value={filters.from} onChange={set('from')} /></Field>
            <Field label={t.common.to}><Input type="date" value={filters.to} onChange={set('to')} /></Field>
          </div>
        </Card>

        <Card flush>
          {!res ? (loading ? <Loading /> : null) : (
            <>
              <Table
                head={<><th>{c.when}</th><th>{c.user}</th><th>{c.action}</th>{<th className="actions"><span className="visually-hidden">{t.ui.details}</span></th>}</>}
                isEmpty={res.items.length === 0}
                empty={<EmptyState compact icon="history" title={ta.empty} text={filtered ? t.ui.noResultsHint : undefined} />}
              >
                {res.items.map((l: any) => {
                  const isOpen = open === l.id;
                  const hasValues = !!(l.oldValues || l.newValues);
                  return (
                    <Fragment key={l.id}>
                      <tr className={isOpen ? 'is-selected' : undefined}>
                        <td className="nowrap">{fmtDateTime(l.createdAt)}</td>
                        <td>
                          {l.user
                            ? <Person name={l.user.name} meta={label(t.enums.UserRole, l.user.role)} size={32} />
                            : <span className="text-muted">{t.common.publicSystem}</span>}
                        </td>
                        <td className="cell-strong">{label(t.enums.AuditAction, l.action)}</td>
                        <td className="actions">
                          {hasValues && (
                            <Button size="sm" variant="ghost" iconEnd={isOpen ? 'chevron-up' : 'chevron-down'} aria-expanded={isOpen}
                              onClick={() => setOpen(isOpen ? null : l.id)}>
                              {isOpen ? ta.hideValues : ta.showValues}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="owner-audit-detail">
                          <td colSpan={4}>
                            <div className="owner-values">
                              <div><h3>{c.old}</h3>{values(l.oldValues)}</div>
                              <div><h3>{c.new}</h3>{values(l.newValues)}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Table>
              {pager}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
