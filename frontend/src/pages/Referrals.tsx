import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { act, get, patch, PAYMENT_METHODS, post, qs } from '../api';
import { fmtDate, fmtDateTime, fmtMoney, fmtMonth, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import { addDays, firstOfLastMonth, firstOfMonth, todayCairo } from '../time';
import {
  ActiveBadge, Alert, askReason, Badge, Button, Card, CellText, confirmAction, Dialog, EmptyState, Field, Input, Loading,
  NumberInput, PageHeader, Person, SearchInput, SectionTitle, Select, Stat, StatusBadge, Table, Textarea,
} from '../ui';
import { downloadCsv, Ltr, opt, useLoad } from '../util';
import { usePaged } from '../components';
import {
  CHANNELS, CommissionTable, RateInput, rateText, toBody, toForm, type RateForm,
} from './PatientReferral';
import { AuditHistory } from './PatientRecords';
import '../styles/areas/referral.css';

const NO_RATE: RateForm = { type: 'NONE', value: '' };

/** OWNER: outside doctors who refer patients, with their default agreement. */
export function ReferringDoctors() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  // A new search starts again on page 1 (usePaged).
  const { res, reload, pager } = usePaged(`/referring-doctors${qs({ search })}`);
  const [adding, setAdding] = useState(false);
  const tr = t.referringDoctors;
  const c = tr.col;
  const rows: any[] = res?.items ?? [];

  return (
    <div className="ref-page">
      <PageHeader
        title={tr.title} description={tr.hint}
        actions={<Button variant="primary" icon="user-plus" onClick={() => setAdding(true)}>{tr.new}</Button>}
      />
      <Card flush>
        <div className="ref-toolbar">
          <form role="search" className="input-group" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
            <SearchInput placeholder={tr.searchPh} aria-label={tr.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit">{t.common.search}</Button>
          </form>
        </div>
        {!res ? <Loading /> : (
          <Table
            head={<>
              <th>{c.name}</th><th>{c.phone}</th><th>{c.workplace}</th><th>{c.commission}</th><th>{c.discount}</th><th>{c.status}</th>
              <th className="actions"><span className="visually-hidden">{c.actions}</span></th>
            </>}
            isEmpty={rows.length === 0}
            empty={search
              ? <EmptyState compact icon="search" title={t.ui.noResults} text={t.ui.noResultsHint} />
              : <EmptyState icon="share" title={tr.none} text={tr.noneHint}
                  action={<Button variant="primary" icon="user-plus" onClick={() => setAdding(true)}>{tr.new}</Button>} />}
          >
            {rows.map((d) => (
              <tr key={d.id} className={d.isActive ? undefined : 'is-muted'}>
                <td><Person name={d.name} meta={d.specialty} to={`/owner/referring-doctors/${d.id}`} /></td>
                <td>{d.phone ? <Ltr>{d.phone}</Ltr> : <span className="text-muted">{t.common.none}</span>}</td>
                <td>{d.workplace ?? <span className="text-muted">{t.common.none}</span>}</td>
                <td>{rateText(t, d.currentAgreement?.commission)}</td>
                <td>
                  <CellText sub={d.upcomingAgreement && tr.upcoming(fmtDate(d.upcomingAgreement.effectiveFrom))}>
                    {rateText(t, d.currentAgreement?.discount)}
                  </CellText>
                </td>
                <td><ActiveBadge active={d.isActive} /></td>
                <td className="actions">
                  <Button
                    size="sm" variant={d.isActive ? 'ghost' : 'secondary'}
                    onClick={() => act(() => patch(`/referring-doctors/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload)}
                  >
                    {d.isActive ? t.common.deactivate : t.common.activate}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {pager}
      </Card>
      {adding && <DoctorDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} onFailed={reload} />}
    </div>
  );
}

/** Create (with the default agreement) or edit the details of a referring doctor. */
function DoctorDialog({ doctor, onClose, onSaved, onFailed }: { doctor?: any; onClose: () => void; onSaved: () => void; onFailed?: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name: doctor?.name ?? '', phone: doctor?.phone ?? '', specialty: doctor?.specialty ?? '', workplace: doctor?.workplace ?? '', notes: doctor?.notes ?? '',
  });
  const [commission, setCommission] = useState<RateForm>(NO_RATE);
  const [discount, setDiscount] = useState<RateForm>(NO_RATE);
  const [busy, setBusy] = useState(false);
  const tr = t.referringDoctors;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !f.name.trim()) return;
    setBusy(true);
    const ok = await act(() => (doctor
      ? patch(`/referring-doctors/${doctor.id}`, {
        name: f.name, phone: f.phone.trim() || null, specialty: f.specialty, workplace: f.workplace, notes: f.notes,
      })
      : post('/referring-doctors', {
        name: f.name, phone: opt(f.phone), specialty: opt(f.specialty), workplace: opt(f.workplace), notes: opt(f.notes),
        commission: toBody(commission), discount: toBody(discount),
      })), doctor ? tr.saved : tr.created);
    setBusy(false);
    if (ok) onSaved(); else onFailed?.();
  };

  return (
    <Dialog
      open onClose={onClose} title={doctor ? tr.editTitle : tr.newTitle} description={doctor ? undefined : tr.hint} size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button type="submit" form="referring-doctor-form" variant="primary" icon="check" loading={busy} disabled={!f.name.trim()}>
          {doctor ? t.common.save : t.common.create}
        </Button>
      </>}
    >
      <form id="referring-doctor-form" className="stack-lg" onSubmit={submit}>
        <div className="form-grid form-grid--2">
          <Field label={tr.namePh}><Input required autoFocus value={f.name} onChange={set('name')} /></Field>
          <Field label={tr.phonePh} optional><Input dir="ltr" inputMode="tel" autoComplete="off" value={f.phone} onChange={set('phone')} /></Field>
          <Field label={tr.specialtyPh} optional><Input value={f.specialty} onChange={set('specialty')} /></Field>
          <Field label={tr.workplacePh} optional><Input value={f.workplace} onChange={set('workplace')} /></Field>
          <Field label={tr.notesPh} optional className="span-all"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {!doctor && (
          <section>
            <h3 className="section-title">{tr.defaultsTitle}</h3>
            <div className="form-grid form-grid--2">
              <Field label={t.referrals.commission}><RateInput label={t.referrals.commission} value={commission} onChange={setCommission} /></Field>
              <Field label={t.referrals.discount}><RateInput label={t.referrals.discount} value={discount} onChange={setDiscount} /></Field>
            </div>
          </section>
        )}
      </form>
    </Dialog>
  );
}

/** OWNER: one referring doctor: details, agreement versions, patients, commission ledger, payouts, history. */
export function ReferringDoctorPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const [doctor, reloadDoctor] = useLoad(() => get(`/referring-doctors/${id}`), [id]);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const refresh = () => { reloadDoctor(); setTick((n) => n + 1); };
  const tr = t.referringDoctors;
  if (!doctor) return <Loading />;
  const meta = [doctor.specialty, doctor.workplace].filter(Boolean).join(' · ');
  return (
    <div className="ref-page">
      <PageHeader
        back={{ to: '/owner/referring-doctors', label: tr.title }}
        title={doctor.name} badges={<ActiveBadge active={doctor.isActive} />}
        description={(meta || doctor.phone || doctor.notes) && (
          <div className="ref-meta">
            {meta && <span>{meta}</span>}
            {doctor.phone && <Ltr>{doctor.phone}</Ltr>}
            {doctor.notes && <span className="text-muted">{doctor.notes}</span>}
          </div>
        )}
        actions={<>
          <Button icon="pencil" onClick={() => setEditing(true)}>{tr.details}</Button>
          <Button
            variant={doctor.isActive ? 'danger-outline' : 'secondary'} icon={doctor.isActive ? 'ban' : 'check-circle'}
            onClick={() => act(() => patch(`/referring-doctors/${doctor.id}/${doctor.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(refresh)}
          >
            {doctor.isActive ? t.common.deactivate : t.common.activate}
          </Button>
        </>}
      />
      {!doctor.isActive && <Alert tone="warning">{tr.inactiveHint}</Alert>}
      <Balance doctorId={doctor.id} doctorName={doctor.name} tick={tick} onChange={refresh} />
      <Agreements doctorId={doctor.id} tick={tick} onChange={refresh} />
      <ReferredPatients doctorId={doctor.id} tick={tick} />
      <Ledger doctorId={doctor.id} tick={tick} onChange={refresh} />
      <Payouts doctorId={doctor.id} tick={tick} onChange={refresh} />
      <section>
        <SectionTitle>{tr.auditTitle}</SectionTitle>
        <AuditHistory key={tick} entityId={doctor.id} />
      </section>
      {editing && <DoctorDialog doctor={doctor} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
    </div>
  );
}

const NEW_PAYOUT = () => ({ amount: '', payoutDate: todayCairo(), method: 'CASH', reference: '', notes: '' });

/** The balance (now, or at the end of a past day) and the payout form: all or part of what is owed now. */
function Balance({ doctorId, doctorName, tick, onChange }: { doctorId: string; doctorName: string; tick: number; onChange: () => void }) {
  const { t } = useI18n();
  const today = todayCairo();
  const [asOf, setAsOf] = useState(today);
  const past = asOf < today;
  const [current] = useLoad(() => get(`/referring-doctors/${doctorId}/commission-balance`), [doctorId, tick]);
  const [then] = useLoad(
    () => (past ? get(`/referring-doctors/${doctorId}/commission-balance${qs({ asOf })}`) : Promise.resolve(undefined)),
    [doctorId, tick, asOf],
  );
  const [pay, setPay] = useState(NEW_PAYOUT);
  const [busy, setBusy] = useState(false);
  const tr = t.referringDoctors;
  const b = past ? then : current;
  if (!current) return <Loading />;
  const owed = current.outstanding;
  const canPay = Number(owed) > 0;
  const amount = pay.amount.trim();
  const tooMuch = amount !== '' && Number(amount) > Number(owed);
  const valid = amount !== '' && Number(amount) > 0 && !tooMuch;
  const record = async () => {
    if (!valid) return;
    const money = fmtMoney(amount);
    if (!(await confirmAction({
      title: tr.confirmPayoutTitle, message: tr.confirmPayout(money, doctorName, fmtDate(pay.payoutDate)), confirmLabel: tr.payOutstanding(money),
    }))) return;
    setBusy(true);
    const ok = await act(() => post(`/referring-doctors/${doctorId}/payouts`, {
      amount, payoutDate: pay.payoutDate, method: pay.method, reference: opt(pay.reference), notes: opt(pay.notes),
    }), tr.payoutRecorded);
    setBusy(false);
    if (ok) setPay(NEW_PAYOUT());
    onChange();
  };
  return (
    <div className="split">
      <section className="stack">
        <SectionTitle actions={
          <Input type="date" aria-label={tr.asOf} title={tr.asOf} value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} />
        }>
          {tr.balance}
        </SectionTitle>
        {!b ? <Loading /> : (
          <div className="stats">
            <Stat label={tr.outstanding} value={fmtMoney(b.outstanding)} icon="wallet" tone="highlight" />
            <Stat label={tr.paid} value={fmtMoney(b.paid)} icon="check-circle" />
            <Stat label={tr.earned} value={fmtMoney(b.earned)} icon="trending-up" tone="info" />
            <Stat label={tr.reversed} value={fmtMoney(b.reversed)} icon="undo" tone="warning" />
            <Stat label={tr.adjustments} value={fmtMoney(b.adjustments)} icon="pencil" tone="neutral" />
            <Stat label={tr.pending} value={fmtMoney(b.pending)} icon="clock" tone="neutral" />
          </div>
        )}
        <p className="ref-hint">{past ? tr.asOfHint(fmtDate(asOf)) : tr.pendingHint}</p>
      </section>
      <Card title={tr.recordPayout} icon="banknote" description={canPay ? tr.payoutHint : tr.nothingToPay}>
        <div className="stack">
          <Field
            label={tr.payAmount} hint={canPay && tr.payAmountHint(fmtMoney(owed))}
            error={tooMuch && tr.tooMuch(fmtMoney(owed))}
          >
            <div className="input-group">
              <NumberInput disabled={!canPay} value={pay.amount} placeholder={owed} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              <Button disabled={!canPay} onClick={() => setPay({ ...pay, amount: owed })}>{tr.payAll(fmtMoney(owed))}</Button>
            </div>
          </Field>
          <Field label={tr.payoutDate}>
            <Input type="date" disabled={!canPay} value={pay.payoutDate} max={today} onChange={(e) => setPay({ ...pay, payoutDate: e.target.value })} />
          </Field>
          <Field label={t.fields.method}>
            <Select value={pay.method} disabled={!canPay} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(t.enums.PaymentMethod, m)}</option>)}
            </Select>
          </Field>
          <Field label={tr.reference} optional>
            <Input disabled={!canPay} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          </Field>
          <Field label={tr.notesPh} optional>
            <Input disabled={!canPay} value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} />
          </Field>
          <Button variant="primary" icon="banknote" block loading={busy} disabled={!valid || busy} onClick={() => { void record(); }}>
            {valid ? tr.payOutstanding(fmtMoney(amount)) : tr.recordPayout}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Agreements({ doctorId, tick, onChange }: { doctorId: string; tick: number; onChange: () => void }) {
  const { t } = useI18n();
  const [list] = useLoad(() => get<any[]>(`/referring-doctors/${doctorId}/agreements`), [doctorId, tick]);
  const [commission, setCommission] = useState<RateForm | null>(null);
  const [discount, setDiscount] = useState<RateForm | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayCairo());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const tr = t.referringDoctors;
  if (!list) return <Loading />;
  const today = todayCairo();
  const current = list.find((a) => a.effectiveFrom <= today);
  const c = commission ?? toForm(current?.commission);
  const d = discount ?? toForm(current?.discount);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!(await confirmAction({
      title: tr.confirmAgreementTitle, message: tr.confirmAgreement(rateText(t, c), rateText(t, d), fmtDate(effectiveFrom)), confirmLabel: t.common.save,
    }))) return;
    setBusy(true);
    const ok = await act(() => post(`/referring-doctors/${doctorId}/agreements`, {
      commission: toBody(c), discount: toBody(d), effectiveFrom, notes: opt(notes),
    }), tr.agreementSaved);
    setBusy(false);
    if (ok) { setCommission(null); setDiscount(null); setNotes(''); onChange(); }
  };
  const col = tr.acol;
  return (
    <Card
      flush title={tr.agreements} icon="file-text" description={tr.agreementsDesc}
      footer={
        <form onSubmit={save}>
          <h3 className="ref-form-title">{tr.newAgreement}</h3>
          <div className="form-grid form-grid--4">
            <Field label={t.referrals.commission}><RateInput label={t.referrals.commission} value={c} onChange={setCommission} /></Field>
            <Field label={t.referrals.discount}><RateInput label={t.referrals.discount} value={d} onChange={setDiscount} /></Field>
            <Field label={tr.effectiveFrom}><Input type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
            <Field label={tr.agreementNotes} optional><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="spread" style={{ marginBlockStart: 'var(--space-4)' }}>
            <span className="ref-hint" style={{ margin: 0 }}>{tr.agreementHint}</span>
            <Button type="submit" variant="primary" icon="check" loading={busy}>{t.common.save}</Button>
          </div>
        </form>
      }
    >
      <Table head={<>
        <th>{col.version}</th><th>{col.effective}</th><th>{col.commission}</th><th>{col.discount}</th><th>{col.notes}</th><th>{col.by}</th>
      </>}>
        {list.map((a) => {
          const isCurrent = a.id === current?.id;
          const upcoming = a.effectiveFrom > today;
          return (
            <tr key={a.id} className={isCurrent ? 'is-selected' : upcoming ? undefined : 'is-muted'}>
              <td>
                <div className="cluster">
                  <span className="cell-strong tabular">{fmtNumber(a.version)}</span>
                  {isCurrent && <Badge tone="success" dot>{tr.current}</Badge>}
                  {upcoming && <Badge tone="info" dot>{tr.upcomingShort}</Badge>}
                </div>
              </td>
              <td className="nowrap">{fmtDate(a.effectiveFrom)}</td>
              <td>{rateText(t, a.commission)}</td>
              <td>{rateText(t, a.discount)}</td>
              <td>{a.notes ?? <span className="text-muted">{t.common.none}</span>}</td>
              <td><CellText sub={a.createdBy.name}>{fmtDateTime(a.recordedAt)}</CellText></td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function ReferredPatients({ doctorId, tick }: { doctorId: string; tick: number }) {
  const { t } = useI18n();
  const { res, pager } = usePaged(`/referring-doctors/${doctorId}/patients`, 20, [tick]);
  const tr = t.referringDoctors;
  if (!res) return <Loading />;
  const rows: any[] = res.items;
  const c = tr.pcol;
  return (
    <Card flush title={tr.patients(fmtNumber(res.meta.total))} icon="users">
      <Table
        head={<>
          <th>{c.patient}</th><th>{c.status}</th><th>{c.terms}</th><th className="num">{c.covered}</th><th className="num">{c.collected}</th>
          <th className="num">{c.discounts}</th><th className="num">{c.commission}</th><th className="num">{c.outstanding}</th>
        </>}
        isEmpty={rows.length === 0}
        empty={<EmptyState compact icon="users" title={tr.noPatients} />}
      >
        {rows.map((r) => (
          <tr key={r.referralId}>
            <td>
              <CellText sub={<><Ltr>{r.patient.phone}</Ltr> · {fmtDateTime(r.assignedAt)}</>}>
                <Link to={`/patients/${r.patient.id}`}>{r.patient.name}</Link>
              </CellText>
            </td>
            <td><StatusBadge kind="PatientReferralStatus" value={r.status} /></td>
            <td>
              <div className="cluster">
                {t.referrals.version(fmtNumber(r.termsVersion))}
                {r.isOverride && <Badge tone="warning">{t.referrals.overridden}</Badge>}
              </div>
            </td>
            <td className="num">{fmtNumber(r.coveredSessions)}</td>
            <td className="num">{fmtMoney(r.collected)}</td>
            <td className="num">{fmtMoney(r.discounts)}</td>
            <td className="num">{fmtMoney(r.commission)}</td>
            <td className="num"><strong>{fmtMoney(r.outstanding)}</strong></td>
          </tr>
        ))}
      </Table>
      {pager}
    </Card>
  );
}

function Ledger({ doctorId, tick, onChange }: { doctorId: string; tick: number; onChange: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  // Another status filter starts again on page 1 (usePaged).
  const { res, pager } = usePaged(`/referring-doctors/${doctorId}/commissions${qs({ status })}`, 25, [tick]);
  const [adj, setAdj] = useState({ amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const tr = t.referringDoctors;
  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !adj.amount.trim() || adj.reason.trim().length < 3) return;
    if (!(await confirmAction({ title: tr.confirmAdjustmentTitle, message: tr.confirmAdjustment(fmtMoney(adj.amount)), confirmLabel: tr.addAdjustment }))) return;
    setBusy(true);
    const ok = await act(() => post(`/referring-doctors/${doctorId}/commission-adjustments`, { amount: adj.amount.trim(), reason: adj.reason }), tr.adjustmentAdded);
    setBusy(false);
    if (ok) { setAdj({ amount: '', reason: '' }); onChange(); }
  };
  return (
    <Card
      flush title={tr.ledger} icon="list"
      actions={
        <Select dense aria-label={tr.statusFilter} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{`${tr.statusFilter}: ${t.common.all}`}</option>
          {['PENDING', 'ELIGIBLE', 'PAID'].map((s) => <option key={s} value={s}>{label(t.enums.CommissionStatus, s)}</option>)}
        </Select>
      }
      footer={
        <form onSubmit={adjust}>
          <h3 className="ref-form-title">{tr.adjustment}</h3>
          <div className="form-grid form-grid--3">
            <Field label={tr.adjustmentAmount}>
              <NumberInput placeholder={tr.adjustmentAmountPh} value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
            </Field>
            <Field label={tr.adjustmentReason} hint={t.ui.minChars(fmtNumber(3))}>
              <Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
            </Field>
            <div className="field" style={{ alignSelf: 'end' }}>
              <Button type="submit" icon="plus" loading={busy} disabled={!adj.amount.trim() || adj.reason.trim().length < 3}>{tr.addAdjustment}</Button>
            </div>
          </div>
        </form>
      }
    >
      {!res ? <Loading /> : <>
        <CommissionTable rows={res.items} showPatient />
        {pager}
      </>}
    </Card>
  );
}

function Payouts({ doctorId, tick, onChange }: { doctorId: string; tick: number; onChange: () => void }) {
  const { t } = useI18n();
  const [list] = useLoad(() => get<any[]>(`/referring-doctors/${doctorId}/payouts`), [doctorId, tick]);
  const tr = t.referringDoctors;
  if (!list) return <Loading />;
  const voidPayout = async (p: any) => {
    const reason = await askReason({ title: tr.voidTitle, label: tr.promptVoid, tone: 'danger', confirmLabel: tr.void });
    if (reason) await act(() => post(`/referral-payouts/${p.id}/void`, { reason }), tr.payoutVoided).then(onChange);
  };
  const c = tr.ocol;
  return (
    <Card flush title={tr.payouts} icon="banknote">
      <Table
        head={<>
          <th>{c.when}</th><th className="num">{c.amount}</th><th>{c.method}</th><th>{c.expense}</th><th className="num">{c.rows}</th>
          <th>{c.status}</th><th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
        </>}
        isEmpty={list.length === 0}
        empty={<EmptyState compact icon="banknote" title={tr.noPayouts} />}
      >
        {list.map((p) => (
          <tr key={p.id} className={p.status === 'VALID' ? undefined : 'is-muted'}>
            <td>
              <CellText sub={<>{tr.recorded(fmtDateTime(p.paidAt), p.paidBy.name)}{p.notes && ` · ${p.notes}`}</>}>
                {fmtDate(p.payoutDate)}
              </CellText>
            </td>
            <td className="num"><strong>{fmtMoney(p.amount)}</strong></td>
            <td><CellText sub={p.reference && <bdi>{p.reference}</bdi>}>{label(t.enums.PaymentMethod, p.method)}</CellText></td>
            <td><Ltr>{p.expense.expenseNumber}</Ltr></td>
            <td className="num">{fmtNumber(p.commissionCount)}</td>
            <td>
              <CellText sub={p.voidReason && tr.voidedBy(p.voidedBy?.name ?? '', p.voidReason)}>
                <StatusBadge kind="PaymentStatus" value={p.status} />
              </CellText>
            </td>
            <td className="actions">
              {p.status === 'VALID' && <Button size="sm" variant="danger-outline" onClick={() => { void voidPayout(p); }}>{tr.void}</Button>}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

// ---------- marketing and referral reports ----------

/** OWNER: patients by acquisition source, campaigns (utm_*), and referring doctors, over one date range. */
export function MarketingReports() {
  const { t } = useI18n();
  const [from, setFrom] = useState(firstOfLastMonth());
  const [to, setTo] = useState(todayCairo());
  const tm = t.marketing;
  const today = todayCairo();
  const thisMonthStart = firstOfMonth(today);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const presets = [
    { key: 'thisMonth', label: tm.thisMonth, from: thisMonthStart, to: today },
    { key: 'lastMonth', label: tm.lastMonth, from: firstOfMonth(lastMonthEnd), to: lastMonthEnd },
    { key: 'last30', label: tm.last30, from: addDays(today, -29), to: today },
  ];
  return (
    <div className="ref-page">
      <PageHeader title={tm.title} description={tm.description} />
      <Card>
        <div className="ref-range">
          <Field label={t.common.from}><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t.common.to}><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="ref-presets" role="group" aria-label={tm.range}>
            {presets.map((p) => (
              <Button
                key={p.key} size="sm" variant="outline" aria-pressed={from === p.from && to === p.to}
                onClick={() => { setFrom(p.from); setTo(p.to); }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>
      <AcquisitionReport from={from} to={to} />
      <CampaignReport from={from} to={to} />
      <ReferralReport from={from} to={to} />
    </div>
  );
}

const pctOf = (part: number, whole: number) => (whole ? fmtPercent((part / whole) * 100) : '');

function AcquisitionReport({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const [channel, setChannel] = useState('');
  const [r] = useLoad(() => get(`/reports/acquisition${qs({ from, to, channel })}`), [from, to, channel]);
  const tm = t.marketing;
  if (!r) return <Card title={tm.acquisition} icon="users"><Loading /></Card>;
  const months: string[] = [...new Set<string>(r.byMonth.map((m: any) => m.month))];
  const monthChannels: (string | null)[] = [...new Set<string | null>(r.byMonth.map((m: any) => m.channel))];
  const cell = (month: string, ch: string | null) => r.byMonth.find((m: any) => m.month === month && m.channel === ch)?.patients ?? 0;
  const channelName = (ch: string | null) => (ch ? label(t.enums.AcquisitionChannel, ch) : tm.noSource);
  const csv = () => downloadCsv(`acquisition-${from}-${to}.csv`,
    [tm.col.channel, tm.col.category, tm.col.patients, tm.col.mentions, tm.col.attended, tm.col.paying, tm.col.collected],
    r.channels.map((c: any) => [label(t.enums.AcquisitionChannel, c.channel), label(t.enums.AcquisitionCategory, c.category), c.patients, c.mentions, c.attendedPatients, c.payingPatients, c.collected]));
  const c = tm.col;
  return (
    <Card
      title={tm.acquisition} icon="users" description={tm.acquisitionHint}
      actions={<>
        <Select dense aria-label={tm.channelFilter} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">{`${tm.channelFilter}: ${t.common.all}`}</option>
          {CHANNELS.map((ch) => <option key={ch} value={ch}>{label(t.enums.AcquisitionChannel, ch)}</option>)}
        </Select>
        <Button size="sm" icon="download" onClick={csv}>{tm.export}</Button>
      </>}
    >
      <div className="stack-lg">
        <div className="stats">
          <Stat label={tm.newPatientsLabel} value={fmtNumber(r.newPatients)} icon="user-plus" />
          <Stat label={tm.withoutSource} value={fmtNumber(r.withoutSource)} icon="alert-circle" tone="warning" />
        </div>
        <div className="table-card">
          <Table
            head={<>
              <th>{c.channel}</th><th className="num">{c.patients}</th><th className="num">{c.mentions}</th>
              <th className="num">{c.attended}</th><th className="num">{c.paying}</th><th className="num">{c.collected}</th>
            </>}
            isEmpty={r.channels.length === 0}
            empty={<EmptyState compact icon="megaphone" title={tm.noData} />}
          >
            {r.channels.map((ch: any) => (
              <tr key={ch.channel}>
                <td><CellText sub={label(t.enums.AcquisitionCategory, ch.category)}><span className="cell-strong">{label(t.enums.AcquisitionChannel, ch.channel)}</span></CellText></td>
                <td className="num"><strong>{fmtNumber(ch.patients)}</strong></td>
                <td className="num">{fmtNumber(ch.mentions)}</td>
                <td className="num">{fmtNumber(ch.attendedPatients)}<span className="ref-pct">{pctOf(ch.attendedPatients, ch.patients)}</span></td>
                <td className="num">{fmtNumber(ch.payingPatients)}<span className="ref-pct">{pctOf(ch.payingPatients, ch.patients)}</span></td>
                <td className="num">{fmtMoney(ch.collected)}</td>
              </tr>
            ))}
          </Table>
        </div>
        {r.categories.length > 0 && (
          <div className="ref-categories">
            <span>{tm.byCategory}:</span>
            {r.categories.map((cat: any) => (
              <Badge key={cat.category} tone="outline">{label(t.enums.AcquisitionCategory, cat.category)} · {fmtNumber(cat.patients)}</Badge>
            ))}
          </div>
        )}
        {months.length > 0 && (
          <section>
            <h3 className="section-title">{tm.overTime}</h3>
            <div className="table-card">
              <Table head={<><th>{c.month}</th>{monthChannels.map((ch) => <th key={ch ?? 'none'} className="num">{channelName(ch)}</th>)}</>}>
                {months.map((m) => (
                  <tr key={m}>
                    <td className="nowrap">{fmtMonth(m)}</td>
                    {monthChannels.map((ch) => <td key={ch ?? 'none'} className="num">{fmtNumber(cell(m, ch))}</td>)}
                  </tr>
                ))}
              </Table>
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}

function CampaignReport({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const [r] = useLoad(() => get(`/reports/campaigns${qs({ from, to })}`), [from, to]);
  const tm = t.marketing;
  if (!r) return <Card title={tm.campaigns} icon="megaphone"><Loading /></Card>;
  const csv = () => downloadCsv(`campaigns-${from}-${to}.csv`,
    ['utm_source', 'utm_medium', 'utm_campaign', tm.col.bookings, tm.col.attended, tm.col.patients, tm.col.newPatients, tm.col.paying, tm.col.collected],
    r.rows.map((c: any) => [c.source, c.medium, c.campaign, c.bookings, c.attended, c.patients, c.newPatients, c.payingPatients, c.collected]));
  const c = tm.col;
  return (
    <Card
      flush title={tm.campaigns} icon="megaphone" description={tm.campaignsHint}
      actions={<Button size="sm" icon="download" onClick={csv}>{tm.export}</Button>}
    >
      <Table
        head={<>
          <th>{c.campaign}</th><th className="num">{c.bookings}</th><th className="num">{c.attended}</th><th className="num">{c.patients}</th>
          <th className="num">{c.newPatients}</th><th className="num">{c.paying}</th><th className="num">{c.collected}</th>
        </>}
        isEmpty={r.rows.length === 0}
        empty={<EmptyState compact icon="trending-up" title={tm.noCampaigns} />}
      >
        {r.rows.map((row: any) => (
          <tr key={`${row.source}|${row.medium}|${row.campaign}`}>
            <td><Ltr>{[row.source, row.medium, row.campaign].map((v) => v ?? '—').join(' / ')}</Ltr></td>
            <td className="num"><strong>{fmtNumber(row.bookings)}</strong></td>
            <td className="num">{fmtNumber(row.attended)}<span className="ref-pct">{pctOf(row.attended, row.bookings)}</span></td>
            <td className="num">{fmtNumber(row.patients)}</td>
            <td className="num">{fmtNumber(row.newPatients)}</td>
            <td className="num">{fmtNumber(row.payingPatients)}</td>
            <td className="num">{fmtMoney(row.collected)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function ReferralReport({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const [r] = useLoad(() => get(`/reports/referrals${qs({ from, to })}`), [from, to]);
  const tm = t.marketing;
  if (!r) return <Card title={tm.referrals} icon="share"><Loading /></Card>;
  const c = tm.rcol;
  const csv = () => downloadCsv(`referrals-${from}-${to}.csv`,
    [c.doctor, c.referred, c.bookings, c.attended, c.covered, c.collected, c.discounts, c.earned, c.reversed, c.adjustments, c.paid, c.outstanding, c.pending],
    r.rows.map((x: any) => [x.referringDoctor.name, x.referredPatients, x.bookings, x.attendedSessions, x.coveredSessions, x.collected, x.discounts,
      x.commissionEarned, x.commissionReversed, x.adjustments, x.commissionPaid, x.outstanding, x.pending]));
  return (
    <Card
      flush title={tm.referrals} icon="share" description={tm.referralsHint}
      actions={<Button size="sm" icon="download" onClick={csv}>{tm.export}</Button>}
    >
      <Table
        head={<>
          <th>{c.doctor}</th><th className="num">{c.referred}</th><th className="num">{c.bookings}</th><th className="num">{c.attended}</th>
          <th className="num">{c.covered}</th><th className="num">{c.collected}</th><th className="num">{c.discounts}</th><th className="num">{c.earned}</th>
          <th className="num">{c.reversed}</th><th className="num">{c.adjustments}</th><th className="num">{c.paid}</th><th className="num">{c.outstanding}</th>
          <th className="num">{c.pending}</th>
        </>}
        isEmpty={r.rows.length === 0}
        empty={<EmptyState compact icon="share" title={tm.noDoctors} />}
      >
        {r.rows.map((x: any) => (
          <tr key={x.referringDoctor.id} className={x.referringDoctor.isActive ? undefined : 'is-muted'}>
            <td><Link to={`/owner/referring-doctors/${x.referringDoctor.id}`}>{x.referringDoctor.name}</Link></td>
            <td className="num">{fmtNumber(x.referredPatients)}</td>
            <td className="num">{fmtNumber(x.bookings)}</td>
            <td className="num">{fmtNumber(x.attendedSessions)}</td>
            <td className="num">{fmtNumber(x.coveredSessions)}</td>
            <td className="num">{fmtMoney(x.collected)}</td>
            <td className="num">{fmtMoney(x.discounts)}</td>
            <td className="num">{fmtMoney(x.commissionEarned)}</td>
            <td className="num">{fmtMoney(x.commissionReversed)}</td>
            <td className="num">{fmtMoney(x.adjustments)}</td>
            <td className="num">{fmtMoney(x.commissionPaid)}</td>
            <td className="num"><strong>{fmtMoney(x.outstanding)}</strong></td>
            <td className="num">{fmtMoney(x.pending)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
