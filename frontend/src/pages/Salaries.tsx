// OWNER: salaries of the clinic's doctors. A month's overview of every doctor; then one doctor (picked from the list
// or the dropdown): the terms in effect (fixed salary + commission per session or per service, versioned by month),
// the month's statement (computed by the API from attended sessions) and the payments (each also an expense).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { act, get, PAYMENT_METHODS, post, put, qs } from '../api';
import type { Doctor } from '../components';
import { fmtDate, fmtDateTime, fmtMoney, fmtMonth, fmtNumber } from '../format';
import { label, useI18n } from '../i18n';
import { todayCairo } from '../time';
import {
  askReason, Badge, Button, Card, CellText, Dialog, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader,
  Segmented, Select, StatusBadge, Table, Totals, TotalsRow,
} from '../ui';
import { Ltr, opt, useLoad } from '../util';
import { RateInput, rateText, type RateForm } from './PatientReferral';
import '../styles/areas/owner.css';

type Mode = 'NONE' | 'PER_SESSION' | 'PER_SERVICE';
interface Rate { type: 'FIXED' | 'PERCENT'; value: string }
interface Terms {
  id: string; effectiveMonth: string; fixedSalary: string; commissionMode: Mode; sessionRate: Rate | null;
  serviceRates: (Rate & { service: { id: string; name: string } })[]; setBy: { name: string }; setAt: string;
}
interface Payment {
  id: string; month: string; amount: string; paymentDate: string; method: string; reference: string | null; notes: string | null;
  status: string; expense: { id: string; expenseNumber: string }; paidBy: { name: string }; paidAt: string;
  voidedBy: { name: string } | null; voidReason: string | null;
}
interface Statement {
  doctor: { id: string; name: string }; month: string; terms: Terms | null; fixedSalary: string; sessionCount: number;
  commissionTotal: string; earned: string; paid: string; remaining: string; payments: Payment[];
  sessions: {
    visitId: string; attendedAt: string; patient: { name: string }; service: { name: string }; sessionValue: string;
    valueSource: string; rate: Rate | null; commission: string;
  }[];
}
interface OverviewRow {
  doctor: { id: string; name: string }; isActive: boolean; commissionMode: Mode | null; hasTerms: boolean; fixedSalary: string;
  sessionCount: number; commissionTotal: string; earned: string; paid: string; remaining: string;
}

const thisMonth = () => todayCairo().slice(0, 7);
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const sum = (values: string[]) => values.reduce((a, v) => a + Number(v), 0).toFixed(2);
const isMonth = (v: string | null): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** "Fixed 8,000 + commission per session", "Commission only, per service", "No terms set". */
function payText(t: ReturnType<typeof useI18n>['t'], hasTerms: boolean, fixed: string, mode: Mode | null): string {
  const ts = t.salaries;
  if (!hasTerms || !mode) return ts.noTerms;
  const modeText = label(t.enums.SalaryCommissionMode, mode).toLowerCase();
  if (mode === 'NONE') return ts.fixedOnly(fmtMoney(fixed));
  return Number(fixed) > 0 ? ts.fixedPlus(fmtMoney(fixed), modeText) : ts.commissionOnly(modeText);
}

export function Salaries() {
  const { t } = useI18n();
  const ts = t.salaries;
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get('month')) ? params.get('month')! : thisMonth();
  const doctorId = params.get('doctor') ?? '';
  const go = (next: { month?: string; doctor?: string }) => {
    const p = new URLSearchParams();
    p.set('month', next.month ?? month);
    const d = next.doctor ?? doctorId;
    if (d) p.set('doctor', d);
    setParams(p);
  };
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [rows] = useLoad(() => get<OverviewRow[]>(`/doctor-salaries${qs({ month })}`), [month, tick]);

  return (
    <>
      <PageHeader title={ts.title} description={ts.description} />
      <div className="stack-lg">
        <Card>
          <div className="salary-toolbar">
            <Field label={ts.month}>
              <div className="input-group">
                <IconButton icon="chevron-left" size="md" variant="outline" label={ts.prevMonth} onClick={() => go({ month: addMonths(month, -1) })} />
                <Input type="month" value={month} onChange={(e) => isMonth(e.target.value) && go({ month: e.target.value })} />
                <IconButton icon="chevron-right" size="md" variant="outline" label={ts.nextMonth} onClick={() => go({ month: addMonths(month, 1) })} />
                <Button disabled={month === thisMonth()} onClick={() => go({ month: thisMonth() })}>{ts.thisMonth}</Button>
              </div>
            </Field>
            <Field label={ts.doctor} className="salary-toolbar__doctor">
              <Select value={doctorId} onChange={(e) => go({ doctor: e.target.value })}>
                <option value="">{ts.allDoctors}</option>
                {rows?.map((r) => <option key={r.doctor.id} value={r.doctor.id}>{r.doctor.name}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        {doctorId
          ? <DoctorSalary key={doctorId} doctorId={doctorId} month={month} tick={tick} onChange={refresh} />
          : <Overview rows={rows} month={month} onOpen={(id) => go({ doctor: id })} />}
      </div>
    </>
  );
}

function Overview({ rows, month, onOpen }: { rows: OverviewRow[] | undefined; month: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const ts = t.salaries;
  const c = ts.col;
  if (!rows) return <Loading />;
  return (
    <Card flush title={`${ts.overview} · ${fmtMonth(month)}`} icon="users" description={ts.overviewHint}>
      <Table
        caption={ts.overview}
        head={<>
          <th>{c.doctor}</th><th>{c.pay}</th><th className="num">{c.sessions}</th><th className="num">{c.commission}</th>
          <th className="num">{c.earned}</th><th className="num">{c.paid}</th><th className="num">{c.remaining}</th>
          <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
        </>}
        isEmpty={rows.length === 0}
        empty={<EmptyState compact icon="stethoscope" title={ts.noDoctors} />}
        foot={rows.length > 1 && (
          <tr>
            <th scope="row" colSpan={3}>{ts.total}</th>
            <td className="num">{fmtMoney(sum(rows.map((r) => r.commissionTotal)))}</td>
            <td className="num">{fmtMoney(sum(rows.map((r) => r.earned)))}</td>
            <td className="num">{fmtMoney(sum(rows.map((r) => r.paid)))}</td>
            <td className="num">{fmtMoney(sum(rows.map((r) => r.remaining)))}</td>
            <td />
          </tr>
        )}
      >
        {rows.map((r) => (
          <tr key={r.doctor.id} className={r.isActive ? undefined : 'is-muted'}>
            <td><Button variant="link" onClick={() => onOpen(r.doctor.id)}>{r.doctor.name}</Button></td>
            <td>{r.hasTerms ? payText(t, true, r.fixedSalary, r.commissionMode) : <Badge tone="warning">{ts.noTerms}</Badge>}</td>
            <td className="num">{fmtNumber(r.sessionCount)}</td>
            <td className="num">{fmtMoney(r.commissionTotal)}</td>
            <td className="num"><strong>{fmtMoney(r.earned)}</strong></td>
            <td className="num">{fmtMoney(r.paid)}</td>
            <td className="num"><Remaining value={r.remaining} /></td>
            <td className="actions"><Button size="sm" variant="outline" iconEnd="chevron-right" onClick={() => onOpen(r.doctor.id)}>{ts.open}</Button></td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Remaining({ value }: { value: string }) {
  const { t } = useI18n();
  const n = Number(value);
  if (n < 0) return <span title={t.salaries.overpaid}><Badge tone="warning">{t.salaries.overpaid}</Badge> {fmtMoney(String(-n))}</span>;
  return n > 0 ? <strong>{fmtMoney(value)}</strong> : <span className="text-muted">{fmtMoney(value)}</span>;
}

function DoctorSalary({ doctorId, month, tick, onChange }: { doctorId: string; month: string; tick: number; onChange: () => void }) {
  const { t } = useI18n();
  const ts = t.salaries;
  const c = ts.col;
  const [s] = useLoad(() => get<Statement>(`/doctors/${doctorId}/salary/statement${qs({ month })}`), [doctorId, month, tick]);
  const [versions] = useLoad(() => get<Terms[]>(`/doctors/${doctorId}/salary/terms`), [doctorId, tick]);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  if (!s || s.doctor.id !== doctorId) return <Loading />;
  const terms = s.terms;
  const canPay = month <= thisMonth();
  const voidPayment = async (p: Payment) => {
    const reason = await askReason({ title: ts.voidTitle, label: ts.voidLabel, tone: 'danger', confirmLabel: ts.void, message: `${fmtMoney(p.amount)} · ${fmtDate(p.paymentDate)}` });
    if (reason && await act(() => post(`/doctor-salaries/payments/${p.id}/void`, { reason }), ts.paymentVoided)) onChange();
  };
  const older = (versions ?? []).filter((v) => v.id !== terms?.id);

  return (
    <>
      <div className="split split--even">
        <Card
          title={ts.terms} icon="id-card" description={terms ? ts.termsFor(fmtMonth(month)) : undefined}
          actions={<Button size="sm" variant="outline" icon="pencil" onClick={() => setEditing(true)}>{ts.editTerms}</Button>}
        >
          {!terms ? <EmptyState compact icon="alert-circle" title={ts.noTerms} text={ts.noTermsHint} /> : (
            <div className="stack">
              <Totals>
                <TotalsRow label={ts.fixedSalary} value={fmtMoney(terms.fixedSalary)} />
                <TotalsRow label={ts.commissionMode} value={label(t.enums.SalaryCommissionMode, terms.commissionMode)} />
                {terms.commissionMode === 'PER_SESSION' && <TotalsRow label={ts.sessionRate} value={rateText(t, terms.sessionRate)} />}
                {terms.commissionMode === 'PER_SERVICE' && terms.serviceRates.map((r) => (
                  <TotalsRow key={r.service.id} label={r.service.name} value={rateText(t, r)} muted />
                ))}
              </Totals>
              <p className="text-muted text-body-sm">{ts.termsFrom(fmtMonth(terms.effectiveMonth))} · {ts.recorded(fmtDateTime(terms.setAt), terms.setBy.name)}</p>
              {older.length > 0 && (
                <details>
                  <summary>{ts.history}</summary>
                  <ul className="salary-history">
                    {older.map((v) => (
                      <li key={v.id}>
                        <strong>{ts.termsFrom(fmtMonth(v.effectiveMonth))}</strong>{' '}
                        {payText(t, true, v.fixedSalary, v.commissionMode)}
                        {v.commissionMode === 'PER_SESSION' && ` (${rateText(t, v.sessionRate)})`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </Card>

        <Card
          title={`${ts.statement} · ${fmtMonth(month)}`} icon="receipt"
          actions={canPay && <Button size="sm" variant="primary" icon="banknote" onClick={() => setPaying(true)}>{ts.recordPayment}</Button>}
        >
          <Totals>
            <TotalsRow label={ts.fixed} value={fmtMoney(s.fixedSalary)} />
            <TotalsRow label={ts.commissionTotal(fmtNumber(s.sessionCount))} value={fmtMoney(s.commissionTotal)} />
            <TotalsRow label={ts.earned} value={fmtMoney(s.earned)} strong />
            <TotalsRow label={ts.paid} value={fmtMoney(s.paid, true)} />
            <TotalsRow label={Number(s.remaining) < 0 ? ts.overpaid : ts.remaining} value={fmtMoney(String(Math.abs(Number(s.remaining))))} strong />
          </Totals>
        </Card>
      </div>

      <Card flush title={ts.sessions} icon="user-check" description={ts.sessionsHint}>
        <Table
          caption={ts.sessions}
          head={<>
            <th>{c.date}</th><th>{c.patient}</th><th>{c.service}</th><th className="num">{c.value}</th><th>{c.rate}</th>
            <th className="num">{c.commission}</th>
          </>}
          isEmpty={s.sessions.length === 0}
          empty={<EmptyState compact icon="calendar" title={ts.noSessions} />}
        >
          {s.sessions.map((x) => (
            <tr key={x.visitId}>
              <td className="nowrap tabular">{fmtDateTime(x.attendedAt)}</td>
              <td>{x.patient.name}</td>
              <td>{x.service.name}</td>
              <td className="num"><CellText sub={label(t.enums.SessionValueSource, x.valueSource)}>{fmtMoney(x.sessionValue)}</CellText></td>
              <td>{x.rate ? rateText(t, x.rate) : <span className="text-muted">{ts.rateNone}</span>}</td>
              <td className="num"><strong>{fmtMoney(x.commission)}</strong></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card flush title={ts.payments} icon="banknote">
        <Table
          caption={ts.payments}
          head={<>
            <th>{c.date}</th><th className="num">{c.amount}</th><th>{c.method}</th><th>{c.expense}</th><th>{c.status}</th>
            <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
          </>}
          isEmpty={s.payments.length === 0}
          empty={<EmptyState compact icon="banknote" title={ts.noPayments} />}
        >
          {s.payments.map((p) => (
            <tr key={p.id} className={p.status === 'VALID' ? undefined : 'is-muted'}>
              <td><CellText sub={<>{ts.recorded(fmtDateTime(p.paidAt), p.paidBy.name)}{p.notes && ` · ${p.notes}`}</>}>{fmtDate(p.paymentDate)}</CellText></td>
              <td className="num"><strong>{fmtMoney(p.amount)}</strong></td>
              <td><CellText sub={p.reference && <bdi>{p.reference}</bdi>}>{label(t.enums.PaymentMethod, p.method)}</CellText></td>
              <td><Ltr>{p.expense.expenseNumber}</Ltr></td>
              <td>
                <CellText sub={p.voidReason && ts.voidedBy(p.voidedBy?.name ?? '', p.voidReason)}>
                  <StatusBadge kind="PaymentStatus" value={p.status} />
                </CellText>
              </td>
              <td className="actions">
                {p.status === 'VALID' && <Button size="sm" variant="danger-outline" icon="ban" onClick={() => voidPayment(p)}>{ts.void}</Button>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {editing && (
        <TermsDialog
          doctorId={doctorId} doctorName={s.doctor.name} month={month} current={terms}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }}
        />
      )}
      {paying && (
        <PaymentDialog
          doctorId={doctorId} doctorName={s.doctor.name} month={month} remaining={s.remaining}
          onClose={() => setPaying(false)} onSaved={() => { setPaying(false); onChange(); }}
        />
      )}
    </>
  );
}

const toRateForm = (r: Rate | null | undefined): RateForm => (r ? { type: r.type, value: r.value } : { type: 'NONE', value: '' });

/** Fixed salary + commission mode + rates, from a month on. Prefilled with the terms in effect. */
function TermsDialog({ doctorId, doctorName, month, current, onClose, onSaved }: {
  doctorId: string; doctorName: string; month: string; current: Terms | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const ts = t.salaries;
  const [doctor] = useLoad(() => get<Doctor>(`/doctors/${doctorId}`), [doctorId]);
  const [effectiveMonth, setEffectiveMonth] = useState(month);
  const [fixed, setFixed] = useState(current?.fixedSalary ?? '0.00');
  const [mode, setMode] = useState<Mode>(current?.commissionMode ?? 'NONE');
  const [sessionRate, setSessionRate] = useState<RateForm>(toRateForm(current?.sessionRate));
  const [serviceRates, setServiceRates] = useState<Record<string, RateForm>>(
    Object.fromEntries((current?.serviceRates ?? []).map((r) => [r.service.id, toRateForm(r)])),
  );
  const rateError = (r: RateForm, required: boolean) => {
    if (r.type === 'NONE') return required ? ts.rateNeeded : null;
    if (r.value.trim() === '' || Number.isNaN(Number(r.value))) return ts.rateNeeded;
    if (r.type === 'PERCENT' && Number(r.value) > 100) return ts.percentMax;
    return null;
  };
  // Services the doctor offers, plus any that already has a rate (e.g. no longer assigned).
  const services = [
    ...(doctor?.services ?? []).map((x) => ({ id: x.serviceId, name: x.name })),
    ...(current?.serviceRates ?? []).filter((r) => !doctor?.services.some((x) => x.serviceId === r.service.id)).map((r) => r.service),
  ];
  const chosen = Object.entries(serviceRates).filter(([, r]) => r.type !== 'NONE');
  const sessionError = mode === 'PER_SESSION' ? rateError(sessionRate, true) : null;
  const serviceError = mode === 'PER_SERVICE'
    ? (chosen.length === 0 ? ts.oneServiceNeeded : chosen.map(([, r]) => rateError(r, false)).find(Boolean) ?? null)
    : null;
  const fixedValid = fixed.trim() !== '' && Number(fixed) >= 0;
  const valid = fixedValid && isMonth(effectiveMonth) && !sessionError && !serviceError;
  const save = async () => {
    const body = {
      effectiveMonth,
      fixedSalary: Number(fixed).toFixed(2),
      commissionMode: mode,
      ...(mode === 'PER_SESSION' && { sessionRate: { type: sessionRate.type, value: sessionRate.value.trim() } }),
      ...(mode === 'PER_SERVICE' && { serviceRates: chosen.map(([serviceId, r]) => ({ serviceId, type: r.type, value: r.value.trim() })) }),
    };
    if (await act(() => put(`/doctors/${doctorId}/salary/terms`, body), ts.termsSaved)) onSaved();
  };
  return (
    <Dialog
      open onClose={onClose} size="lg" title={ts.editTerms} description={doctorName}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="check" disabled={!valid} onClick={save}>{ts.saveTerms}</Button>
      </>}
    >
      <div className="stack">
        <div className="form-grid form-grid--2">
          <Field label={ts.effectiveMonth} hint={ts.effectiveHint}>
            <Input type="month" value={effectiveMonth} onChange={(e) => setEffectiveMonth(e.target.value)} />
          </Field>
          <Field label={ts.fixedSalary} hint={ts.fixedHint} error={!fixedValid && ts.fixedHint}>
            <NumberInput value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </Field>
        </div>
        <Field group label={ts.commissionMode}>
          <Segmented
            label={ts.commissionMode} value={mode} onChange={setMode}
            options={(['NONE', 'PER_SESSION', 'PER_SERVICE'] as Mode[]).map((m) => ({ value: m, label: label(t.enums.SalaryCommissionMode, m) }))}
          />
        </Field>
        {mode === 'PER_SESSION' && (
          <Field group label={ts.sessionRate} hint={ts.sessionRateHint} error={sessionError}>
            <RateInput value={sessionRate} onChange={setSessionRate} label={ts.sessionRate} />
          </Field>
        )}
        {mode === 'PER_SERVICE' && (
          <Field group label={ts.serviceRates} hint={ts.serviceRatesHint} error={serviceError}>
            {!doctor ? <Loading /> : services.length === 0 ? <p className="text-muted">{ts.noServices}</p> : (
              <ul className="salary-rates">
                {services.map((x) => (
                  <li key={x.id}>
                    <span>{x.name}</span>
                    <RateInput
                      label={x.name} value={serviceRates[x.id] ?? { type: 'NONE', value: '' }}
                      onChange={(r) => setServiceRates({ ...serviceRates, [x.id]: r })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** A payment for the month: any amount (advances and parts allowed), also recorded as an expense. */
function PaymentDialog({ doctorId, doctorName, month, remaining, onClose, onSaved }: {
  doctorId: string; doctorName: string; month: string; remaining: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const ts = t.salaries;
  const today = todayCairo();
  const owed = Number(remaining) > 0 ? remaining : '';
  const [form, setForm] = useState({ amount: owed, paymentDate: today, method: 'CASH', reference: '', notes: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const amount = form.amount.trim();
  const valid = amount !== '' && Number(amount) > 0 && !!form.paymentDate && form.paymentDate <= today;
  const save = async () => {
    const ok = await act(() => post(`/doctors/${doctorId}/salary/payments`, {
      month, amount: Number(amount).toFixed(2), paymentDate: form.paymentDate, method: form.method,
      reference: opt(form.reference), notes: opt(form.notes),
    }), ts.paymentRecorded);
    if (ok) onSaved();
  };
  return (
    <Dialog
      open onClose={onClose} title={ts.recordPayment} description={ts.paymentFor(doctorName, fmtMonth(month))}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="banknote" disabled={!valid} onClick={save}>{valid ? ts.pay(fmtMoney(amount)) : ts.recordPayment}</Button>
      </>}
    >
      <div className="stack">
        <p className="text-muted text-body-sm">{ts.paymentHint}</p>
        <Field label={ts.amount} hint={owed && ts.payRemaining(fmtMoney(owed))}>
          <NumberInput value={form.amount} onChange={set('amount')} />
        </Field>
        <div className="form-grid form-grid--2">
          <Field label={ts.paymentDate}><Input type="date" value={form.paymentDate} max={today} onChange={set('paymentDate')} /></Field>
          <Field label={t.fields.method}>
            <Select value={form.method} onChange={set('method')}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(t.enums.PaymentMethod, m)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={ts.reference} optional><Input value={form.reference} onChange={set('reference')} /></Field>
        <Field label={ts.notes} optional><Input value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Dialog>
  );
}
