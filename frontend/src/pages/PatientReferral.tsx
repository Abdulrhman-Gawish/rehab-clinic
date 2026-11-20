import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { act, get, patch, post, qs } from '../api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import {
  Alert, ask, askReason, Badge, Button, Card, CellText, Checkbox, confirmAction, EmptyState, Field, Icon, IconButton, Input,
  Loading, NumberInput, Select, StatusBadge, Table,
} from '../ui';
import { Ltr, opt, useLoad } from '../util';
import '../styles/areas/referral.css';

// ---------- shared by the patient tab and the owner pages ----------

export type RateType = 'NONE' | 'PERCENT' | 'FIXED';
export interface Rate { type: RateType; value: string | null }
// Form state: value '' while NONE.
export interface RateForm { type: RateType; value: string }

export const CHANNELS = [
  'FACEBOOK', 'INSTAGRAM', 'OTHER_SOCIAL_MEDIA', 'GOOGLE', 'GOOGLE_ADS', 'ADVERTISEMENT',
  'FRIENDS_FAMILY', 'EXISTING_PATIENT', 'WEBSITE', 'DOCTOR_REFERRAL', 'OTHER',
];
const APPLICABILITY = ['FIRST_SESSION', 'ALL_SESSIONS', 'SESSION_COUNT', 'DATE_RANGE'];

export const toForm = (r: Rate | null | undefined): RateForm => ({ type: r?.type ?? 'NONE', value: r?.value ?? '' });
export const toBody = (r: RateForm) => (r.type === 'NONE' ? { type: r.type } : { type: r.type, value: r.value.trim() });
/** Same type and the same amount ("10" = "10.00"). */
export const sameRate = (a: RateForm | Rate, b: RateForm | Rate) =>
  a.type === b.type && (a.type === 'NONE' || Number(a.value ?? '') === Number(b.value ?? ''));

/** "10%", "150.00 EGP" or "none". */
export function rateText(t: Messages, r: Rate | RateForm | null | undefined): string {
  if (!r || r.type === 'NONE') return t.referrals.rateNone;
  return r.type === 'PERCENT' ? fmtPercent(r.value ?? '') : fmtMoney(r.value ?? '');
}

export function applicabilityText(t: Messages, a: { type: string; maxSessions: number | null; validFrom: string | null; validTo: string | null }): string {
  const tr = t.referrals;
  if (a.type === 'SESSION_COUNT') return tr.countSessions(fmtNumber(a.maxSessions ?? 0));
  if (a.type === 'DATE_RANGE') return tr.dateRange(fmtDate(a.validFrom), fmtDate(a.validTo));
  return label(t.enums.ReferralApplicability, a.type);
}

/** Type select + amount (hidden for NONE). `label` names both controls for screen readers. */
export function RateInput({ value, onChange, label: name }: { value: RateForm; onChange: (r: RateForm) => void; label?: string }) {
  const { t } = useI18n();
  const tr = t.referrals;
  const prefix = name ? `${name}: ` : '';
  return (
    <span className="input-group rate-input">
      <Select
        dense aria-label={prefix + tr.rateType} value={value.type}
        onChange={(e) => onChange({ type: e.target.value as RateType, value: e.target.value === 'NONE' ? '' : value.value })}
      >
        {(['NONE', 'PERCENT', 'FIXED'] as RateType[]).map((r) => <option key={r} value={r}>{label(t.enums.ReferralRateType, r)}</option>)}
      </Select>
      {value.type !== 'NONE' && (
        <NumberInput
          dense aria-label={prefix + tr.rateValue} placeholder={value.type === 'PERCENT' ? tr.percentPh : tr.amountPh}
          value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      )}
    </span>
  );
}

// ---------- the patient tab ----------

/** Sources reception records, the doctor referral with its terms, and (OWNER) the money behind it. */
export function PatientAcquisition({ patientId, role }: { patientId: string; role: string }) {
  const [tick, setTick] = useState(0);
  const changed = () => setTick((n) => n + 1);
  // Shared: the source form records a doctor referral, the referral part shows it.
  const [referrals] = useLoad(() => get<any[]>(`/patients/${patientId}/referrals`), [patientId, tick]);
  const active = referrals?.find((r) => r.status === 'ACTIVE') ?? null;
  return (
    <div className="ref-page">
      <Sources patientId={patientId} role={role} active={active} tick={tick} onChange={changed} />
      {referrals && <Referral list={referrals} active={active} onChange={changed} />}
      {role === 'OWNER' && <Statement patientId={patientId} tick={tick} />}
    </div>
  );
}

const EMPTY_SOURCE = { channel: '', details: '', isPrimary: false };

function Sources({ patientId, role, active, tick, onChange }: {
  patientId: string; role: string; active: any | null; tick: number; onChange: () => void;
}) {
  const { t } = useI18n();
  const [data] = useLoad(() => get(`/patients/${patientId}/acquisition`), [patientId, tick]);
  const [form, setForm] = useState(EMPTY_SOURCE);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    const ok = await act(fn, success);
    setBusy(false);
    if (ok) onChange();
    return ok;
  };
  const ta = t.acquisition;
  // A doctor referral is picked from the referring doctors list (with its terms), never typed.
  const doctorReferral = form.channel === 'DOCTOR_REFERRAL';

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.channel || doctorReferral || busy) return;
    const ok = await run(() => post(`/patients/${patientId}/acquisition-sources`, { channel: form.channel, details: opt(form.details), isPrimary: form.isPrimary }), ta.added);
    if (ok) setForm(EMPTY_SOURCE);
  };
  const editDetails = async (s: any) => {
    const values = await ask({
      title: ta.editTitle, message: label(t.enums.AcquisitionChannel, s.channel), confirmLabel: t.common.save,
      fields: [{ name: 'details', label: ta.promptDetails, initial: s.details ?? '', placeholder: ta.detailsPh, optional: true }],
    });
    if (values) await run(() => patch(`/acquisition-sources/${s.id}`, { details: values.details }), t.ui.saved);
  };
  const remove = async (s: any) => {
    const reason = await askReason({
      title: ta.removeTitle(label(t.enums.AcquisitionChannel, s.channel)), label: ta.promptRemove, tone: 'danger', confirmLabel: ta.remove,
    });
    if (reason) await run(() => post(`/acquisition-sources/${s.id}/remove`, { reason }), ta.removed);
  };

  if (!data) return <Card title={ta.sources} icon="megaphone"><Loading /></Card>;
  const c = ta.col;
  return (
    <Card title={ta.sources} icon="megaphone" description={ta.sourcesDesc}>
      <form className="stack" onSubmit={add}>
        <div className="form-grid form-grid--2">
          <Field label={ta.channel}>
            <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="">{ta.pickChannel}</option>
              {CHANNELS.map((ch) => <option key={ch} value={ch}>{label(t.enums.AcquisitionChannel, ch)}</option>)}
            </Select>
          </Field>
          {!doctorReferral && (
            <Field label={ta.details} optional>
              <Input placeholder={ta.detailsPh} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
            </Field>
          )}
        </div>
        <div className="spread">
          <Checkbox label={ta.makePrimaryNew} checked={form.isPrimary} onChange={(isPrimary) => setForm({ ...form, isPrimary })} />
          {!doctorReferral && (
            <Button type="submit" variant="primary" icon="plus" loading={busy} disabled={!form.channel}>{ta.add}</Button>
          )}
        </div>
      </form>
      {doctorReferral && (
        <div className="ref-section">
          {active
            ? <Alert tone="info">{ta.alreadyReferred(active.referringDoctor.name)}</Alert>
            : <AssignReferral patientId={patientId} role={role} primarySource={form.isPrimary} onDone={() => { setForm(EMPTY_SOURCE); onChange(); }} />}
        </div>
      )}

      <div className="table-card ref-section">
        <Table
          head={<>
            <th>{c.channel}</th><th>{c.details}</th><th>{c.primary}</th><th>{c.recorded}</th>
            <th className="actions"><span className="visually-hidden">{c.actions}</span></th>
          </>}
          isEmpty={data.sources.length === 0}
          empty={<EmptyState compact icon="megaphone" title={ta.none} />}
        >
          {data.sources.map((s: any) => (
            <tr key={s.id}>
              <td><CellText sub={label(t.enums.AcquisitionCategory, s.category)}><span className="cell-strong">{label(t.enums.AcquisitionChannel, s.channel)}</span></CellText></td>
              <td>{s.details ?? <span className="text-muted">{t.common.none}</span>}</td>
              <td>
                {s.isPrimary
                  ? <Badge tone="success" icon="check">{ta.primary}</Badge>
                  : <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => patch(`/acquisition-sources/${s.id}`, { isPrimary: true }), t.ui.saved)}>{ta.makePrimary}</Button>}
              </td>
              <td><CellText sub={s.recordedBy.name}>{fmtDateTime(s.recordedAt)}</CellText></td>
              <td className="actions">
                <div className="row-actions">
                  <IconButton icon="pencil" label={ta.editDetails} disabled={busy} onClick={() => editDetails(s)} />
                  <IconButton icon="trash" label={ta.remove} variant="danger" disabled={busy} onClick={() => remove(s)} />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>

      {data.removed.length > 0 && (
        <details className="disclosure ref-section">
          <summary><Icon name="chevron-down" size={18} />{ta.removedTitle(fmtNumber(data.removed.length))}</summary>
          <div className="disclosure__body">
            <ul className="disclosure__list">
              {data.removed.map((s: any) => (
                <li key={s.id}>
                  <strong>{label(t.enums.AcquisitionChannel, s.channel)}</strong>{s.details && ` (${s.details})`}
                  <span className="text-muted"> · {ta.removedBy(fmtDateTime(s.removedAt), s.removedBy?.name ?? '', s.removalReason)}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <section className="ref-section">
        <h3 className="section-title">{ta.campaigns}</h3>
        <p className="ref-hint">{ta.campaignsHint}</p>
        <div className="table-card">
          <Table
            head={<><th>{c.booking}</th><th>{c.bookedAt}</th><th>{c.start}</th><th>{c.status}</th><th>{c.utm}</th></>}
            isEmpty={data.campaignBookings.length === 0}
            empty={<EmptyState compact icon="trending-up" title={ta.noCampaigns} />}
          >
            {data.campaignBookings.map((b: any) => (
              <tr key={b.appointmentId}>
                <td><Ltr>{b.referenceCode}</Ltr></td>
                <td>{fmtDateTime(b.bookedAt)}</td>
                <td>{fmtDateTime(b.startAt)}</td>
                <td><StatusBadge kind="AppointmentStatus" value={b.status} /></td>
                <td><Ltr>{[b.utm.source, b.utm.medium, b.utm.campaign, b.utm.content, b.utm.term].filter(Boolean).join(' / ')}</Ltr></td>
              </tr>
            ))}
          </Table>
        </div>
      </section>
    </Card>
  );
}

export interface TermsInit { commission: RateForm; discount: RateForm; applicability: { type: string; maxSessions: string; validFrom: string; validTo: string }; overrideReason: string }
export type TermsDefaults = { commission: Rate; discount: Rate; agreementVersion: number };

export const termsFrom = (terms: any | null, defaults: { commission: Rate; discount: Rate }): TermsInit => ({
  commission: toForm(terms?.commission ?? defaults.commission),
  discount: toForm(terms?.discount ?? defaults.discount),
  applicability: {
    type: terms?.applicability.type ?? '',
    maxSessions: terms?.applicability.maxSessions ? String(terms.applicability.maxSessions) : '',
    validFrom: terms?.applicability.validFrom ?? '',
    validTo: terms?.applicability.validTo ?? '',
  },
  overrideReason: terms?.isOverride ? terms.overrideReason ?? '' : '',
});

/** The commission or the discount differs from the doctor's default: a reason is required. */
export const termsOverridden = (f: TermsInit, defaults: TermsDefaults) =>
  !sameRate(f.commission, defaults.commission) || !sameRate(f.discount, defaults.discount);

/** The terms can be sent: an applicability, and a reason (3+ characters) for an override. */
export const termsReady = (f: TermsInit, defaults: TermsDefaults) =>
  !!f.applicability.type && (!termsOverridden(f, defaults) || f.overrideReason.trim().length >= 3);

/** The body of the terms (POST /patients/:id/referrals, terms versions, check-in `referral`). */
export function termsBody(f: TermsInit, defaults: TermsDefaults) {
  const a = f.applicability;
  return {
    commission: toBody(f.commission),
    discount: toBody(f.discount),
    applicability: {
      type: a.type,
      ...(a.type === 'SESSION_COUNT' && { maxSessions: Number(a.maxSessions) }),
      ...(a.type === 'DATE_RANGE' && { validFrom: a.validFrom, validTo: a.validTo }),
    },
    overrideReason: termsOverridden(f, defaults) ? f.overrideReason.trim() : undefined,
  };
}

/**
 * The terms fields (controlled, no button): the doctor's default next to the applied values, which sessions are
 * covered, and the reason for an override. Changing a value marks it as overridden; "use default" puts it back.
 * Used by TermsForm (patient page) and the check-in details (a doctor referral recorded at the desk).
 */
export function TermsFields({ defaults, value: f, onChange: setF }: {
  defaults: TermsDefaults; value: TermsInit; onChange: (terms: TermsInit) => void;
}) {
  const { t } = useI18n();
  const tr = t.referrals;
  const commissionChanged = !sameRate(f.commission, defaults.commission);
  const discountChanged = !sameRate(f.discount, defaults.discount);
  const overridden = commissionChanged || discountChanged;
  const a = f.applicability;
  const missingReason = overridden && f.overrideReason.trim().length < 3;

  // A plain function, not a component: a component declared here would remount (and lose input focus) on each key.
  const line = (name: string, which: 'commission' | 'discount', changed: boolean) => (
    <tr key={which} className={changed ? 'is-warning' : undefined}>
      <td className="cell-strong">{name}</td>
      <td>{rateText(t, defaults[which])}</td>
      <td><RateInput label={name} value={f[which]} onChange={(r) => setF({ ...f, [which]: r })} /></td>
      <td>{changed
        ? <div className="cluster"><Badge tone="warning" icon="alert-triangle">{tr.overridden}</Badge>
            <Button size="sm" variant="ghost" icon="undo" onClick={() => setF({ ...f, [which]: toForm(defaults[which]) })}>{tr.useDefault}</Button></div>
        : <span className="text-muted text-body-sm">{tr.asDefault}</span>}</td>
    </tr>
  );

  return (
    <div className="stack">
      <div className="table-card">
        <Table head={<><th><span className="visually-hidden">{tr.col.version}</span></th><th>{tr.defaults(fmtNumber(defaults.agreementVersion))}</th><th>{tr.applied}</th><th><span className="visually-hidden">{tr.col.override}</span></th></>}>
          {line(tr.commission, 'commission', commissionChanged)}
          {line(tr.discount, 'discount', discountChanged)}
        </Table>
      </div>
      <div className="form-grid form-grid--3">
        <Field label={tr.applicability}>
          <Select value={a.type} onChange={(e) => setF({ ...f, applicability: { ...a, type: e.target.value } })}>
            <option value="">{tr.pickApplicability}</option>
            {APPLICABILITY.map((x) => <option key={x} value={x}>{label(t.enums.ReferralApplicability, x)}</option>)}
          </Select>
        </Field>
        {a.type === 'SESSION_COUNT' && (
          <Field label={tr.maxSessions}>
            <NumberInput inputMode="numeric" value={a.maxSessions} onChange={(e) => setF({ ...f, applicability: { ...a, maxSessions: e.target.value } })} />
          </Field>
        )}
        {a.type === 'DATE_RANGE' && <>
          <Field label={t.common.from}>
            <Input type="date" value={a.validFrom} onChange={(e) => setF({ ...f, applicability: { ...a, validFrom: e.target.value } })} />
          </Field>
          <Field label={t.common.to}>
            <Input type="date" value={a.validTo} onChange={(e) => setF({ ...f, applicability: { ...a, validTo: e.target.value } })} />
          </Field>
        </>}
      </div>
      {overridden && <>
        <Alert tone="warning">{tr.overrideHint}</Alert>
        <Field label={tr.overrideReason} hint={t.ui.minChars(fmtNumber(3))}>
          <Input value={f.overrideReason} aria-invalid={missingReason || undefined} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} />
        </Field>
      </>}
    </div>
  );
}

/** TermsFields with its save button; an override asks for confirmation first. */
function TermsForm({ defaults, initial, submitLabel, onSubmit }: {
  defaults: TermsDefaults;
  initial: TermsInit;
  submitLabel: string;
  onSubmit: (body: object) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<TermsInit>(initial);
  const [busy, setBusy] = useState(false);
  const tr = t.referrals;
  const commissionChanged = !sameRate(f.commission, defaults.commission);
  const discountChanged = !sameRate(f.discount, defaults.discount);

  const save = async () => {
    if (commissionChanged || discountChanged) {
      const lines = [
        commissionChanged && `${tr.commission}: ${rateText(t, defaults.commission)} → ${rateText(t, f.commission)}`,
        discountChanged && `${tr.discount}: ${rateText(t, defaults.discount)} → ${rateText(t, f.discount)}`,
      ].filter(Boolean).join('\n');
      if (!(await confirmAction({ title: tr.overrideTitle, message: tr.confirmOverride(lines), tone: 'warning', confirmLabel: submitLabel }))) return;
    }
    setBusy(true);
    await onSubmit(termsBody(f, defaults));
    setBusy(false);
  };

  return (
    <div className="stack">
      <TermsFields defaults={defaults} value={f} onChange={setF} />
      <div className="form-actions form-actions--end">
        <Button variant="primary" icon="check" loading={busy} disabled={busy || !termsReady(f, defaults)} onClick={() => { void save(); }}>{submitLabel}</Button>
      </div>
    </div>
  );
}

// "Dr. Hany Samir (Orthopedics · Kasr Al Ainy)": enough to tell two doctors apart in the list.
export const doctorLabel = (d: { name: string; specialty: string | null; workplace: string | null }) => {
  const extra = [d.specialty, d.workplace].filter(Boolean).join(' · ');
  return extra ? `${d.name} (${extra})` : d.name;
};

export const defaultsOf = (agreement: any): TermsDefaults =>
  ({ commission: agreement.commission, discount: agreement.discount, agreementVersion: agreement.version });

/**
 * The referring doctor is picked from the directory (OWNER and RECEPTIONIST), never typed: its default terms load
 * at once. Saving records the referral with the patient's terms and the Doctor referral source.
 */
function AssignReferral({ patientId, role, primarySource, onDone }: {
  patientId: string; role: string; primarySource: boolean; onDone: () => void;
}) {
  const { t } = useI18n();
  const [doctors] = useLoad(() => get(`/referring-doctors${qs({ isActive: true, limit: 100 })}`), []);
  const [doctorId, setDoctorId] = useState('');
  const doctor = doctors?.items.find((d: any) => d.id === doctorId);
  const tr = t.referrals;
  if (!doctors) return <Loading />;
  return (
    <Card variant="muted">
      <div className="stack">
        <Field
          label={tr.referringDoctor}
          hint={role === 'OWNER'
            ? <>{tr.missingDoctorOwner} <Link to="/owner/referring-doctors">{tr.addDoctor}</Link></>
            : tr.missingDoctorDesk}
        >
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">{doctors.items.length === 0 ? tr.noDoctorsYet : tr.pickDoctor}</option>
            {doctors.items.map((d: any) => <option key={d.id} value={d.id}>{doctorLabel(d)}</option>)}
          </Select>
        </Field>
        {doctor?.currentAgreement && (
          <TermsForm key={doctor.id} defaults={defaultsOf(doctor.currentAgreement)} initial={termsFrom(null, defaultsOf(doctor.currentAgreement))}
            submitLabel={tr.save}
            onSubmit={async (body) => {
              const ok = await act(() => post(`/patients/${patientId}/referrals`, { referringDoctorId: doctor.id, primarySource: primarySource || undefined, ...body }), tr.savedToast);
              if (ok) { setDoctorId(''); onDone(); }
              return ok;
            }} />
        )}
      </div>
    </Card>
  );
}

function Referral({ list, active, onChange }: { list: any[]; active: any | null; onChange: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  // The doctor's default in force today, next to the terms being changed.
  const [current] = useLoad(
    () => (active ? get(`/referring-doctors/${active.referringDoctor.id}`) : Promise.resolve(null)),
    [active?.referringDoctor.id],
  );
  const done = async (fn: () => Promise<unknown>, success: string) => {
    const ok = await act(fn, success);
    if (ok) { setEditing(false); onChange(); }
    return ok;
  };
  const tr = t.referrals;
  const defaults = current?.currentAgreement ? defaultsOf(current.currentAgreement) : null;
  const end = async () => {
    const reason = await askReason({ title: tr.endTitle, label: tr.promptEnd, tone: 'danger', confirmLabel: tr.end });
    if (reason) await done(() => post(`/patient-referrals/${active.id}/end`, { reason }), tr.endedToast);
  };

  return (
    <Card
      title={tr.title} icon="share"
      actions={active && <>
        <Button size="sm" icon={editing ? 'x' : 'pencil'} variant={editing ? 'ghost' : 'outline'} onClick={() => setEditing(!editing)}>
          {editing ? t.common.cancelEdit : tr.changeTerms}
        </Button>
        <Button size="sm" variant="danger-outline" icon="x-circle" onClick={() => { void end(); }}>{tr.end}</Button>
      </>}
    >
      {active ? (
        <div className="stack">
          <div className="ref-meta">
            <strong>{active.referringDoctor.name}</strong>
            {!active.referringDoctor.isActive && <Badge>{t.common.inactive}</Badge>}
            <span>{tr.since(fmtDateTime(active.assignedAt), active.assignedBy.name)}</span>
            <Badge tone="info" icon="calendar-check">{tr.covered(fmtNumber(active.coveredSessions))}</Badge>
          </div>
          <TermsTable terms={active.terms} />
          {editing && defaults && (
            <Card variant="muted" title={tr.changeTerms} description={tr.changeHint}>
              <TermsForm key={active.terms.id} defaults={defaults} initial={termsFrom(active.terms, defaults)} submitLabel={tr.saveTerms}
                onSubmit={(body) => done(() => post(`/patient-referrals/${active.id}/terms`, body), tr.termsSaved)} />
            </Card>
          )}
          {editing && !defaults && <Loading />}
        </div>
      ) : (
        <EmptyState compact icon="share" title={tr.noActiveTitle} text={tr.noActive} />
      )}

      {list.length > 0 && (
        <details className="disclosure ref-section">
          <summary><Icon name="chevron-down" size={18} />{tr.history(fmtNumber(list.length))}</summary>
          <div className="disclosure__body">
            {list.map((r) => (
              <div key={r.id} className="ref-history-item">
                <div className="ref-meta">
                  <strong>{r.referringDoctor.name}</strong>
                  <StatusBadge kind="PatientReferralStatus" value={r.status} />
                  <span>{tr.since(fmtDateTime(r.assignedAt), r.assignedBy.name)}</span>
                  {r.endedAt && <span>{tr.ended(fmtDateTime(r.endedAt), r.endedBy?.name ?? '', r.endReason)}</span>}
                </div>
                <div className="table-card">
                  <Table head={<>
                    <th>{tr.col.version}</th><th>{tr.col.defaults}</th><th>{tr.col.commission}</th><th>{tr.col.discount}</th>
                    <th>{tr.col.applicability}</th><th>{tr.col.override}</th><th>{tr.col.by}</th>
                  </>}>
                    {r.history.map((v: any) => (
                      <tr key={v.id} className={v.isOverride ? 'is-warning' : undefined}>
                        <td className="num">{fmtNumber(v.version)}</td>
                        <td>{tr.defaultsShort(fmtNumber(v.defaults.agreementVersion), rateText(t, v.defaults.commission), rateText(t, v.defaults.discount))}</td>
                        <td>{rateText(t, v.commission)}</td>
                        <td>{rateText(t, v.discount)}</td>
                        <td>{applicabilityText(t, v.applicability)}</td>
                        <td>{v.isOverride
                          ? <CellText sub={v.overrideReason}><Badge tone="warning">{tr.overridden}</Badge></CellText>
                          : <span className="text-muted">{t.common.no}</span>}</td>
                        <td><CellText sub={v.createdBy.name}>{fmtDateTime(v.recordedAt)}</CellText></td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

/** Current terms: doctor default vs applied, overrides highlighted. */
function TermsTable({ terms }: { terms: any }) {
  const { t } = useI18n();
  const tr = t.referrals;
  const row = (name: string, def: Rate, applied: Rate) => {
    const changed = !sameRate(def, applied);
    return (
      <tr className={changed ? 'is-warning' : undefined}>
        <td className="cell-strong">{name}</td>
        <td>{rateText(t, def)}</td>
        <td><strong>{rateText(t, applied)}</strong></td>
        <td>{changed ? <Badge tone="warning" icon="alert-triangle">{tr.overridden}</Badge> : <span className="text-muted text-body-sm">{tr.asDefault}</span>}</td>
      </tr>
    );
  };
  return (
    <div className="stack-sm">
      <div className="table-card">
        <Table head={<>
          <th>{tr.version(fmtNumber(terms.version))}</th><th>{tr.defaults(fmtNumber(terms.defaults.agreementVersion))}</th><th>{tr.applied}</th>
          <th><span className="visually-hidden">{tr.col.override}</span></th>
        </>}>
          {row(tr.commission, terms.defaults.commission, terms.commission)}
          {row(tr.discount, terms.defaults.discount, terms.discount)}
        </Table>
      </div>
      <div className="ref-meta">
        <span>{tr.applicability}: <strong>{applicabilityText(t, terms.applicability)}</strong></span>
        {terms.isOverride && <span>{tr.reason}: {terms.overrideReason}</span>}
        <span className="text-muted">{tr.recorded(fmtDateTime(terms.recordedAt), terms.createdBy.name)}</span>
      </div>
    </div>
  );
}

/** OWNER: covered invoices, every commission row and the payouts that settled them. */
function Statement({ patientId, tick }: { patientId: string; tick: number }) {
  const { t } = useI18n();
  const [s] = useLoad(() => get(`/patients/${patientId}/referral-statement`), [patientId, tick]);
  const tr = t.referrals;
  if (!s) return null;
  if (s.referrals.length === 0) return null;
  const c = tr.scol;
  return (
    <Card title={tr.statementTitle} icon="banknote" description={tr.statementDesc}>
      <h3 className="section-title">{tr.coveredInvoices}</h3>
      <div className="table-card">
        <Table
          head={<>
            <th>{c.invoice}</th><th>{c.terms}</th><th className="num">{c.subtotal}</th><th>{c.discount}</th>
            <th className="num">{c.total}</th><th className="num">{c.collected}</th><th>{c.payments}</th>
          </>}
          isEmpty={s.invoices.length === 0}
          empty={<EmptyState compact icon="receipt" title={tr.noCoveredInvoices} />}
        >
          {s.invoices.map((i: any) => (
            <tr key={i.invoice.id}>
              <td>
                <CellText sub={<>{fmtDateTime(i.issuedAt)} · {label(t.enums.InvoiceStatus, i.status)}</>}>
                  <Link to={`/reception/invoices/${i.invoice.id}`}><Ltr>{i.invoice.invoiceNumber}</Ltr></Link>
                  {i.isPackageSale && <> <Badge>{tr.packageSale}</Badge></>}
                </CellText>
              </td>
              <td>{tr.version(fmtNumber(i.termsVersion))}</td>
              <td className="num">{fmtMoney(i.subtotal)}</td>
              <td>{i.discount
                ? <CellText sub={`${i.discount.fromReferral ? tr.fromReferral : i.discount.reason} · ${i.discount.appliedBy.name}`}>
                    <span className="tabular">{fmtMoney(i.discount.amount)}</span>
                  </CellText>
                : <span className="text-muted">{t.common.none}</span>}</td>
              <td className="num">{fmtMoney(i.total)}</td>
              <td className="num">{fmtMoney(i.amountPaid)}</td>
              <td>{i.payments.map((p: any) => (
                <span key={p.id} className="cell-sub">
                  <Ltr>{p.receiptNumber}</Ltr> {label(t.enums.PaymentType, p.type)} <span className="tabular">{fmtMoney(p.amount)}</span>
                  {p.status !== 'VALID' && ` (${label(t.enums.PaymentStatus, p.status)})`}
                </span>
              ))}</td>
            </tr>
          ))}
        </Table>
      </div>

      <section className="ref-section">
        <h3 className="section-title">{tr.commissionRows}</h3>
        <div className="table-card"><CommissionTable rows={s.commissions} showDoctor /></div>
      </section>

      {s.payouts.length > 0 && (
        <section className="ref-section">
          <h3 className="section-title">{tr.payouts}</h3>
          <div className="table-card">
            <Table head={<>
              <th>{t.referringDoctors.ocol.when}</th><th>{tr.ccol.doctor}</th><th className="num">{t.referringDoctors.ocol.amount}</th><th>{t.referringDoctors.ocol.status}</th>
            </>}>
              {s.payouts.map((p: any) => (
                <tr key={p.id} className={p.status === 'VALID' ? undefined : 'is-muted'}>
                  <td>{fmtDate(p.payoutDate)}</td>
                  <td>{p.referringDoctor.name}</td>
                  <td className="num">{fmtMoney(p.amount)}</td>
                  <td><StatusBadge kind="PaymentStatus" value={p.status} /></td>
                </tr>
              ))}
            </Table>
          </div>
        </section>
      )}
    </Card>
  );
}

/** Commission ledger rows (patient statement and doctor page). Wrap it in a table card (or a flush Card). */
export function CommissionTable({ rows, showDoctor = false, showPatient = false }: { rows: any[]; showDoctor?: boolean; showPatient?: boolean }) {
  const { t } = useI18n();
  const tr = t.referrals;
  const c = tr.ccol;
  return (
    <Table
      head={<>
        <th>{c.when}</th>{showDoctor && <th>{c.doctor}</th>}{showPatient && <th>{c.patient}</th>}
        <th>{c.kind}</th><th>{c.source}</th><th className="num">{c.base}</th><th>{c.rate}</th><th className="num">{c.amount}</th><th>{c.status}</th>
      </>}
      isEmpty={rows.length === 0}
      empty={<EmptyState compact icon="banknote" title={tr.noCommissions} />}
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <td><CellText sub={r.recordedBy.name}>{fmtDateTime(r.recordedAt)}</CellText></td>
          {showDoctor && <td>{r.referringDoctor.name}</td>}
          {showPatient && <td>{r.patient ? <Link to={`/patients/${r.patient.id}`}>{r.patient.name}</Link> : <span className="text-muted">{t.common.none}</span>}</td>}
          <td><CellText sub={r.reason}>{label(t.enums.CommissionKind, r.kind)}</CellText></td>
          <td>
            {r.invoice && <Link to={`/reception/invoices/${r.invoice.id}`}><Ltr>{r.invoice.invoiceNumber}</Ltr></Link>}
            {r.sourcePayment && <span className="cell-sub"><Ltr>{r.sourcePayment.receiptNumber}</Ltr> {label(t.enums.PaymentType, r.sourcePayment.type)}</span>}
            {r.termsVersion && <span className="cell-sub">{tr.version(fmtNumber(r.termsVersion))}</span>}
            {!r.invoice && !r.sourcePayment && !r.termsVersion && <span className="text-muted">{t.common.none}</span>}
          </td>
          <td className="num">{fmtMoney(r.baseAmount)}</td>
          <td>{r.commissionType ? rateText(t, { type: r.commissionType, value: r.rate }) : <span className="text-muted">{t.common.none}</span>}</td>
          <td className="num"><strong>{fmtMoney(r.amount)}</strong></td>
          <td>
            {/* Partly settled by payouts (partial payments). */}
            <CellText sub={r.status !== 'PAID' && Number(r.paidAmount) !== 0 && tr.partlyPaid(fmtMoney(r.paidAmount))}>
              <StatusBadge kind="CommissionStatus" value={r.status} />
            </CellText>
          </td>
        </tr>
      ))}
    </Table>
  );
}
