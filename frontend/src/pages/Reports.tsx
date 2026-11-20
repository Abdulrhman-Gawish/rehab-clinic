import { Fragment, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, getSession, PAYMENT_METHODS, qs } from '../api';
import { usePaged, type Page } from '../components';
import { fmtDate, fmtDateTime, fmtMoney, fmtMonth, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import { addDays, firstOfLastMonth, firstOfMonth, todayCairo } from '../time';
import { Ltr, useLoad, Values } from '../util';
import {
  Badge, Button, ButtonLink, Card, CellText, EmptyState, Field, Icon, IconButton, Input, Loading, PageHeader, Person,
  SectionTitle, Segmented, Select, Stat, Stats, StatusBadge, Table, Totals, TotalsRow, type IconName, type Tone,
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

// ---------- Outstanding (daily summary and reports) ----------

type ClinicOwesTotals = { owed: string; doctorSalaries: string; referralCommissions: string; advances: string; pendingCommissions: string };
/** GET /billing/daily-summary `outstanding`, GET /reports/money-flow: owed at the start, what moved it, owed at the end. */
interface OutstandingFlow {
  patientsOwe: { opening: string; invoiced: string; adjustments: string; cancelled: string; payments: string; refunds: string; closing: string; unpaidInvoices: number };
  clinicOwes: {
    opening: ClinicOwesTotals; salariesEarned: string; salaryAdjustments: string; commissionsEarned: string; salaryPayments: string; commissionPayouts: string;
    advancesChange: string; closing: ClinicOwesTotals;
  } | null;
}

const isZero = (amount: string) => Number(amount) === 0;

/**
 * The two balances side by side, as a ledger: owed at the start of `from`, each movement (amounts that lower the
 * balance are shown negative), owed at the end of `to`. What the clinic owes is null for a receptionist.
 */
function FlowCards({ flow, from, to }: { flow: OutstandingFlow; from: string; to: string }) {
  const { t } = useI18n();
  const ts = t.summary;
  const f = ts.flow;
  const p = flow.patientsOwe;
  const c = flow.clinicOwes;
  // `always`: shown even at 0.00 (the main movements); the rare ones only when they happened.
  const move = (name: string, amount: string, minus = false, always = false) =>
    always || !isZero(amount) ? <TotalsRow label={name} value={fmtMoney(amount, minus)} /> : null;
  return (
    <div className={c ? 'split split--even' : 'stack'}>
      <Card className="owner-flow" title={ts.patientsOwe} icon="receipt" description={f.patientsHint}>
        <Totals>
          <TotalsRow label={f.start(fmtDate(from))} value={fmtMoney(p.opening)} />
          {move(f.invoiced, p.invoiced, false, true)}
          {move(f.adjustments, p.adjustments)}
          {move(f.cancelled, p.cancelled, true)}
          {move(f.payments, p.payments, true, true)}
          {move(f.refunds, p.refunds)}
          <div className="totals__divider" />
          <TotalsRow label={f.end(fmtDate(to))} value={fmtMoney(p.closing)} strong />
          <TotalsRow label={ts.patientsOweHint(fmtNumber(p.unpaidInvoices))} value="" muted />
        </Totals>
      </Card>
      {c && (
        <Card className="owner-flow" title={ts.clinicOwes} icon="stethoscope" description={f.clinicHint}>
          <Totals>
            <TotalsRow label={f.start(fmtDate(from))} value={fmtMoney(c.opening.owed)} />
            {move(f.salariesEarned, c.salariesEarned, false, true)}
            {move(f.salaryAdjustments, c.salaryAdjustments)}
            {move(f.commissionsEarned, c.commissionsEarned, false, true)}
            {move(f.salaryPayments, c.salaryPayments, true, true)}
            {move(f.commissionPayouts, c.commissionPayouts, true, true)}
            {move(f.advancesChange, c.advancesChange)}
            <div className="totals__divider" />
            <TotalsRow label={f.end(fmtDate(to))} value={fmtMoney(c.closing.owed)} strong />
            <TotalsRow label={ts.clinicOwesHint(fmtMoney(c.closing.doctorSalaries), fmtMoney(c.closing.referralCommissions))} value="" muted />
            {!isZero(c.closing.advances) && <TotalsRow label={ts.advances} value={fmtMoney(c.closing.advances)} muted />}
          </Totals>
          {!isZero(c.advancesChange) && <p className="owner-note"><Icon name="info" />{f.advancesChangeHint}</p>}
          {!isZero(c.closing.pendingCommissions) && (
            <p className="owner-note"><Icon name="clock" />{ts.pending(fmtMoney(c.closing.pendingCommissions))}</p>
          )}
        </Card>
      )}
    </div>
  );
}

/** Daily summary: what was still owed when the day ended (headline figures), then how it moved during the day. */
function DayOutstanding({ o, date, showDetails }: { o: OutstandingFlow; date: string; showDetails: boolean }) {
  const { t } = useI18n();
  const ts = t.summary;
  const c = o.clinicOwes;
  return (
    <section className="stack" aria-label={ts.outstandingTitle(fmtDate(date))}>
      <SectionTitle
        actions={showDetails && (
          <ButtonLink to={`/owner/reports${qs({ from: date, to: date })}`} size="sm" icon="chart">{ts.details}</ButtonLink>
        )}
      >
        {ts.outstandingTitle(fmtDate(date))}
      </SectionTitle>
      <p className="text-muted owner-lead">{ts.outstandingHint}</p>
      <Stats>
        <Stat
          icon="receipt" tone="warning" label={ts.patientsOwe} value={fmtMoney(o.patientsOwe.closing)}
          hint={ts.patientsOweHint(fmtNumber(o.patientsOwe.unpaidInvoices))}
        />
        {c && (
          <Stat
            icon="stethoscope" tone="warning" label={ts.clinicOwes} value={fmtMoney(c.closing.owed)}
            hint={ts.clinicOwesHint(fmtMoney(c.closing.doctorSalaries), fmtMoney(c.closing.referralCommissions))}
          />
        )}
        {c && !isZero(c.closing.advances) && (
          <Stat icon="clock" tone="info" label={ts.advances} value={fmtMoney(c.closing.advances)} hint={ts.advancesHint} />
        )}
      </Stats>
      <h3 className="owner-subhead">{ts.flow.title}</h3>
      <FlowCards flow={o} from={date} to={date} />
    </section>
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

          <DayOutstanding o={s.outstanding} date={s.date} showDetails={!isReceptionist} />

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
              {s.salaryPayments.count > 0 && <MoneyRow name={ts.salaryPayments} m={s.salaryPayments} part />}
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

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function OwnerReports() {
  const { t } = useI18n();
  const tr = t.reports;
  // ?from=&to= (e.g. from the daily summary's "Full details"); otherwise last month to today.
  const [params] = useSearchParams();
  const [from, setFrom] = useState(() => {
    const f = params.get('from');
    const to = params.get('to');
    return isDate(f) && (!isDate(to) || f <= to) ? f : firstOfLastMonth();
  });
  const [to, setTo] = useState(() => {
    const v = params.get('to');
    return isDate(v) && v >= from ? v : todayCairo();
  });
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
        <FinanceReport range={range} />
        <RevenueReport range={range} />
        <AttendanceReport range={range} />
        <div className="split split--even">
          <DiscountsReport range={range} />
          <ExpensesReport range={range} />
        </div>
      </div>
    </>
  );
}

const useReport = (path: string, range: Range, extra: Record<string, string | number> = {}) =>
  useLoad(() => get(`/reports/${path}${qs({ ...range, ...extra })}`), [path, range.from, range.to, JSON.stringify(extra)])[0];

// Summary fields that are EGP amounts (the others are counts).
const MONEY_FIELDS = new Set([
  'collected', 'refunded', 'netCollected', 'expenses', 'commissionPayouts', 'salaryPayments', 'netAfterExpenses', 'invoiced',
  'patientsOwe', 'clinicOwes', 'discountsGiven',
]);
const FIELD_ICON: Record<string, IconName> = {
  collected: 'banknote', refunded: 'undo', netCollected: 'trending-up', expenses: 'wallet', commissionPayouts: 'users',
  salaryPayments: 'stethoscope', netAfterExpenses: 'chart', invoiced: 'receipt', patientsOwe: 'alert-circle', clinicOwes: 'clock',
  discountsGiven: 'percent', attendedVisits: 'user-check', noShows: 'user-x', cancellations: 'ban', newPatients: 'user-plus',
  unsignedNotes: 'note-pen',
};
const FIELD_TONE: Record<string, 'warning' | 'error' | 'info' | 'neutral' | 'highlight'> = {
  netAfterExpenses: 'highlight', refunded: 'neutral', expenses: 'neutral', commissionPayouts: 'neutral', salaryPayments: 'neutral',
  patientsOwe: 'warning', clinicOwes: 'warning', discountsGiven: 'info',
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
        + (Number(e.salaryPayments) > 0 ? ` · ${tr.salaryPart(fmtMoney(e.salaryPayments))}` : '')
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

/**
 * Money flow and what is owed over the range: the two balances at the start and end (same numbers as the daily
 * summary for a one-day range), every transaction, and who is owed what at the end of `to`.
 */
function FinanceReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const flow = useReport('money-flow', range) as OutstandingFlow | null;
  return (
    <section className="stack-lg" aria-label={tr.finance}>
      <div>
        <h2 className="section-title">{tr.finance}</h2>
        <p className="text-muted owner-lead">{tr.financeHint(fmtDate(range.from), fmtDate(range.to))}</p>
      </div>
      {!flow ? <Card><Loading /></Card> : <FlowCards flow={flow} from={range.from} to={range.to} />}
      <TransactionsReport range={range} />
      <ClinicOwesReport asOf={range.to} />
      <PatientsOweReport asOf={range.to} />
    </section>
  );
}

interface CountTotal { count: number; total: string }
interface TransactionRow {
  kind: 'PAYMENT' | 'REFUND' | 'EXPENSE'; id: string; number: string; date: string; recordedAt: string; method: string;
  amount: string; patient: { id: string; name: string } | null; invoice: { id: string; invoiceNumber: string } | null;
  expenseOrigin: string | null; category: { id: string; name: string } | null; description: string | null;
  payee: string | null; reason: string | null; recordedBy: { id: string; name: string };
}
type TransactionPage = Page<TransactionRow> & {
  totals: { payments: CountTotal; refunds: CountTotal; expenses: CountTotal; salaryPayments: CountTotal; commissionPayouts: CountTotal; net: string };
};

const TX_KINDS = ['', 'PAYMENT', 'REFUND', 'EXPENSE'];
const TX_TONE: Record<string, Tone> = { PAYMENT: 'success', REFUND: 'warning', EXPENSE: 'neutral' };

function TransactionsReport({ range }: { range: Range }) {
  const { t } = useI18n();
  const tr = t.reports;
  const c = tr.tcol;
  const [kind, setKind] = useState('');
  // Another range or kind is another list: the hook goes back to page 1.
  const { res, pager } = usePaged<TransactionPage>(`/reports/transactions${qs({ ...range, kind })}`, 20);
  const totals = res?.totals;
  const none = <span className="text-muted">{t.common.none}</span>;
  return (
    <Card
      flush title={tr.transactions} icon="list" description={tr.transactionsHint}
      actions={<Segmented label={tr.transactions} value={kind} onChange={setKind} options={TX_KINDS.map((k) => ({ value: k, label: label(tr.kinds, k) }))} />}
    >
      {!res || !totals ? <Loading /> : (
        <>
          <dl className="owner-methods owner-card-head" aria-label={tr.total}>
            <div><dt>{`${tr.kinds.PAYMENT} (${fmtNumber(totals.payments.count)})`}</dt><dd>{fmtMoney(totals.payments.total)}</dd></div>
            <div><dt>{`${tr.kinds.REFUND} (${fmtNumber(totals.refunds.count)})`}</dt><dd>{fmtMoney(totals.refunds.total, true)}</dd></div>
            <div>
              <dt>{`${tr.kinds.EXPENSE} (${fmtNumber(totals.expenses.count)})`}</dt><dd>{fmtMoney(totals.expenses.total, true)}</dd>
              {totals.salaryPayments.count > 0 && <dd className="owner-part">{tr.ofSalaries} {fmtMoney(totals.salaryPayments.total)}</dd>}
              {totals.commissionPayouts.count > 0 && <dd className="owner-part">{tr.ofCommissions} {fmtMoney(totals.commissionPayouts.total)}</dd>}
            </div>
            <div><dt>{tr.net}</dt><dd>{fmtMoney(totals.net)}</dd></div>
          </dl>
          <Table
            head={<>
              <th>{c.date}</th><th>{c.number}</th><th>{c.kind}</th><th>{c.party}</th><th>{c.details}</th><th>{c.method}</th>
              <th className="num">{c.amount}</th><th>{c.by}</th>
            </>}
            isEmpty={res.items.length === 0} empty={<EmptyState compact icon="list" title={tr.noTransactions} />}
          >
            {res.items.map((x) => (
              <tr key={`${x.kind}-${x.id}`}>
                <td className="nowrap">{x.kind === 'EXPENSE' ? fmtDate(x.date) : fmtDateTime(x.recordedAt)}</td>
                <td className="nowrap"><Ltr>{x.number}</Ltr></td>
                <td><Badge tone={TX_TONE[x.kind]}>{x.kind === 'EXPENSE' ? label(tr.origin, x.expenseOrigin) : label(tr.kind, x.kind)}</Badge></td>
                <td>{x.patient ? <Link to={`/patients/${x.patient.id}`}>{x.patient.name}</Link> : x.payee ?? none}</td>
                <td>
                  {x.invoice
                    ? <CellText sub={x.reason}><Link to={`/reception/invoices/${x.invoice.id}`}><Ltr>{x.invoice.invoiceNumber}</Ltr></Link></CellText>
                    : <CellText sub={x.description}>{x.category?.name ?? none}</CellText>}
                </td>
                <td>{label(t.enums.PaymentMethod, x.method)}</td>
                {/* Money out (refunds, expenses) is shown negative. */}
                <td className="num"><strong>{fmtMoney(x.amount, x.kind !== 'PAYMENT')}</strong></td>
                <td>{x.recordedBy.name}</td>
              </tr>
            ))}
          </Table>
          {pager}
        </>
      )}
    </Card>
  );
}

interface SalaryRow {
  doctor: { id: string; name: string }; month: string; fixedSalary: string; fixedDue: boolean; sessionCount: number;
  commissions: string; earned: string; paid: string; balance: string;
}
interface ReferralRow { referringDoctor: { id: string; name: string }; earned: string; paid: string; balance: string; pending: string }
interface ClinicOwesReport {
  asOf: string; owed: string; advances: string;
  doctorSalaries: { owed: string; advances: string; rows: SalaryRow[] };
  referralCommissions: { owed: string; advances: string; pending: string; rows: ReferralRow[] };
}

/** Who the clinic owes at the end of `asOf`: each doctor-month of salary, each referring doctor. */
function ClinicOwesReport({ asOf }: { asOf: string }) {
  const { t } = useI18n();
  const tr = t.reports;
  const s = tr.scol;
  const r = tr.rcol;
  const [o] = useLoad(() => get<ClinicOwesReport>(`/reports/clinic-owes${qs({ asOf })}`), [asOf]);
  // A negative balance was paid ahead (an advance): shown as a positive amount with a badge.
  const balance = (b: string) => Number(b) < 0
    ? <span className="owner-advance"><Badge tone="info">{tr.advanceBadge}</Badge> {fmtMoney(b, true)}</span>
    : <strong>{fmtMoney(b)}</strong>;
  return (
    <Card title={tr.clinicOwes} icon="stethoscope" description={tr.clinicOwesHint(fmtDate(asOf))}>
      {!o ? <Loading /> : (
        <div className="stack">
          <dl className="owner-methods">
            <div><dt>{tr.owedTotal}</dt><dd>{fmtMoney(o.owed)}</dd></div>
            <div><dt>{tr.salaries}</dt><dd>{fmtMoney(o.doctorSalaries.owed)}</dd></div>
            <div><dt>{tr.referralCommissions}</dt><dd>{fmtMoney(o.referralCommissions.owed)}</dd></div>
            {!isZero(o.advances) && <div><dt>{tr.advances}</dt><dd>{fmtMoney(o.advances)}</dd></div>}
            {!isZero(o.referralCommissions.pending) && <div><dt>{tr.pendingTotal}</dt><dd>{fmtMoney(o.referralCommissions.pending)}</dd></div>}
          </dl>
          {o.doctorSalaries.rows.length === 0 && o.referralCommissions.rows.length === 0 && (
            <EmptyState compact icon="check-circle" title={tr.noClinicOwes} />
          )}
          {o.doctorSalaries.rows.length > 0 && (
            <div>
              <h3 className="owner-subhead">{tr.salaries}</h3>
              <div className="table-card">
                <Table
                  dense caption={tr.salaries}
                  head={<>
                    <th>{s.doctor}</th><th>{s.month}</th><th className="num">{s.fixed}</th><th className="num">{s.sessions}</th>
                    <th className="num">{s.commissions}</th><th className="num">{s.earned}</th><th className="num">{s.paid}</th>
                    <th className="num">{s.balance}</th>
                  </>}
                >
                  {o.doctorSalaries.rows.map((row) => (
                    <tr key={`${row.doctor.id}-${row.month}`}>
                      <td><Link to={`/owner/salaries${qs({ month: row.month, doctor: row.doctor.id })}`}>{row.doctor.name}</Link></td>
                      <td className="nowrap">{fmtMonth(row.month)}</td>
                      <td className="num">{row.fixedDue ? fmtMoney(row.fixedSalary) : <span className="text-muted">{tr.dueAtMonthEnd}</span>}</td>
                      <td className="num">{fmtNumber(row.sessionCount)}</td>
                      <td className="num">{fmtMoney(row.commissions)}</td>
                      <td className="num">{fmtMoney(row.earned)}</td>
                      <td className="num">{fmtMoney(row.paid)}</td>
                      <td className="num">{balance(row.balance)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
          {o.referralCommissions.rows.length > 0 && (
            <div>
              <h3 className="owner-subhead">{tr.referralCommissions}</h3>
              <div className="table-card">
                <Table
                  dense caption={tr.referralCommissions}
                  head={<>
                    <th>{r.doctor}</th><th className="num">{r.earned}</th><th className="num">{r.paid}</th>
                    <th className="num">{r.pending}</th><th className="num">{r.balance}</th>
                  </>}
                >
                  {o.referralCommissions.rows.map((row) => (
                    <tr key={row.referringDoctor.id}>
                      <td><Link to={`/owner/referring-doctors/${row.referringDoctor.id}`}>{row.referringDoctor.name}</Link></td>
                      <td className="num">{fmtMoney(row.earned)}</td>
                      <td className="num">{fmtMoney(row.paid)}</td>
                      <td className="num">{fmtMoney(row.pending)}</td>
                      <td className="num">{balance(row.balance)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface UnpaidInvoice { id: string; invoiceNumber: string; issuedAt: string; total: string; paid: string; balance: string }
type PatientsOwePage = Page<{
  patient: { id: string; name: string; phone: string }; balance: string; oldestUnpaidInvoiceDate: string; invoices: UnpaidInvoice[];
}> & { asOf: string; totalBalance: string; unpaidInvoices: number };

/** Patients with a balance at the end of `asOf`, largest first, each with the invoices it comes from. */
function PatientsOweReport({ asOf }: { asOf: string }) {
  const { t } = useI18n();
  const tr = t.reports;
  const c = tr.ocol;
  // Another day is another list: the hook goes back to page 1.
  const { res: o, pager } = usePaged<PatientsOwePage>(`/reports/patients-owe${qs({ asOf })}`, 10);
  return (
    <Card
      flush title={tr.patientsOwe} icon="receipt"
      description={o ? tr.patientsOweHint(fmtDate(asOf), fmtNumber(o.unpaidInvoices), fmtMoney(o.totalBalance)) : undefined}
    >
      {!o ? <Loading /> : (
        <>
          <Table
            head={<><th>{c.patient}</th><th>{c.phone}</th><th>{c.invoices}</th><th>{c.oldest}</th><th className="num">{c.balance}</th></>}
            isEmpty={o.items.length === 0} empty={<EmptyState compact icon="check-circle" title={tr.noPatientsOwe} />}
          >
            {o.items.map((r) => (
              <tr key={r.patient.id}>
                <td><Person name={r.patient.name} to={`/patients/${r.patient.id}`} size={32} /></td>
                <td><Ltr>{r.patient.phone}</Ltr></td>
                <td>
                  <ul className="owner-invoices">
                    {r.invoices.map((i) => (
                      <li key={i.id}>
                        <Link to={`/reception/invoices/${i.id}`}><Ltr>{i.invoiceNumber}</Ltr></Link>
                        <span className="text-muted">{tr.invoiceLine(fmtMoney(i.total), fmtMoney(i.paid))}</span>
                        <strong className="tabular">{fmtMoney(i.balance)}</strong>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="nowrap">{fmtDate(r.oldestUnpaidInvoiceDate)}</td>
                <td className="num"><strong>{fmtMoney(r.balance)}</strong></td>
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
