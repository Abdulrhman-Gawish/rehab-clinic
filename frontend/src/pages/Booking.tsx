import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { act, get, post, qs } from '../api';
import { DoctorService, SlotPicker } from '../components';
import { fmtDateTime, fmtNumber } from '../format';
import { useI18n } from '../i18n';
import {
  Alert, Badge, Button, ButtonLink, Card, DescriptionList, Field, Input, PageHeader, Person, Segmented, StatusBadge, Switch, Textarea,
} from '../ui';
import { Ltr } from '../util';
import '../styles/areas/desk.css';

interface Patient { id: string; name: string; phone: string }
type PatientPick = { patientId?: string; name?: string; phone?: string };

/** A numbered part of a desk form ("1 Patient", "2 Doctor and service", …). */
function StepSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="step-section">
      <span className="step-section__num" aria-hidden="true">{fmtNumber(n)}</span>
      <h2 className="step-section__title">{title}</h2>
      <div className="step-section__body">{children}</div>
    </section>
  );
}

/** phone -> lookup; found = use patientId, not found = ask for a name (find-or-create on submit). */
function PatientByPhone({ initialPhone = '', onChange }: { initialPhone?: string; onChange: (p: PatientPick) => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(initialPhone);
  const [found, setFound] = useState<Patient | null | undefined>(undefined);
  const [name, setName] = useState('');
  // The number already looked up, so blur after a click on "Look up" doesn't ask twice.
  const looked = useRef('');
  // { patient: null } = unknown phone: ask for a name (find-or-create on submit).
  const lookup = () => {
    const value = phone.trim();
    if (!value || value === looked.current) return undefined;
    looked.current = value;
    return act(async () => {
      const { patient } = await get<{ patient: Patient | null }>(`/patients/lookup${qs({ phone: value })}`);
      setFound(patient);
      onChange(patient ? { patientId: patient.id } : { name, phone: value });
    });
  };
  // Opened from a patient record (?phone=): look the number up at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialPhone) void lookup(); }, []);
  const tb = t.booking;
  return (
    <div className="stack">
      <Field label={tb.phone} hint={tb.lookupHint}>
        <div className="input-group">
          <Input
            dir="ltr" type="tel" inputMode="tel" autoComplete="off" placeholder={tb.phonePh} value={phone}
            onChange={(e) => { setPhone(e.target.value); setFound(undefined); looked.current = ''; onChange({}); }}
            onBlur={lookup}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(); } }}
          />
          <Button icon="search" onClick={lookup}>{tb.lookUp}</Button>
        </div>
      </Field>
      {found && (
        <div className="found-patient">
          <Person name={found.name} meta={<Ltr>{found.phone}</Ltr>} />
          <Badge tone="success" icon="check">{tb.found}</Badge>
        </div>
      )}
      {found === null && (
        <>
          <Alert tone="info" icon="user-plus" title={tb.notFoundTitle}>{tb.notFoundText}</Alert>
          <Field label={tb.newPatientName}>
            <Input autoFocus autoComplete="off" value={name} onChange={(e) => { setName(e.target.value); onChange({ name: e.target.value, phone: phone.trim() }); }} />
          </Field>
        </>
      )}
    </div>
  );
}

/** Reception booking and walk-ins. ?phone= prefills the patient (link from the patient record). */
export function Booking() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const phone = params.get('phone') ?? '';
  const [mode, setMode] = useState<'appointment' | 'walkIn'>('appointment');
  const tb = t.booking;
  return (
    <>
      <PageHeader
        title={tb.pageTitle} description={tb.pageDesc}
        actions={<ButtonLink to="/reception" icon="calendar-days">{tb.dayList}</ButtonLink>}
      />
      <Segmented
        className="booking-mode" label={tb.pageTitle} value={mode} onChange={setMode}
        options={[
          { value: 'appointment', label: tb.tabAppointment, icon: 'calendar-plus' },
          { value: 'walkIn', label: tb.tabWalkIn, icon: 'log-in' },
        ]}
      />
      {/* Both stay mounted, so switching back keeps what was typed. */}
      <div hidden={mode !== 'appointment'}><NewBooking initialPhone={phone} /></div>
      <div hidden={mode !== 'walkIn'}><WalkIn initialPhone={phone} /></div>
    </>
  );
}

function useScrollTo(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (dep) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [dep]);
  return ref;
}

function NewBooking({ initialPhone }: { initialPhone: string }) {
  const { t } = useI18n();
  const [patient, setPatient] = useState<PatientPick>({});
  const [ds, setDs] = useState({ doctorId: '', serviceId: '' });
  const [outside, setOutside] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<any>(null);
  const [key, setKey] = useState(0);
  const resultRef = useScrollTo(result);
  const ready = !!startAt && !!(patient.patientId || patient.name);
  const book = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    await act(async () => {
      const r = await post('/appointments', { ...patient, ...ds, startAt, notes: notes || undefined, allowOutsideSchedule: outside || undefined });
      setResult(r);
      // A fresh form for the next patient; doctor and service stay (often the same).
      setPatient({});
      setStartAt('');
      setNotes('');
      setKey((k) => k + 1);
    });
  };
  const tb = t.booking;
  return (
    <div className="stack-lg">
      {result && (
        <div ref={resultRef} className="booking-result stack">
          <Alert
            tone="success" title={tb.booked}
            actions={<>
              <ButtonLink size="sm" variant="primary" icon="calendar-days" to={`/reception?date=${result.startAt.slice(0, 10)}`}>{tb.dayList}</ButtonLink>
              <ButtonLink size="sm" icon="user" to={`/patients/${result.patient.id}`}>{tb.openPatient}</ButtonLink>
            </>}
          >
            <DescriptionList
              columns={3}
              items={[
                [t.fields.referenceCode, <span className="ref-code"><Ltr>{result.referenceCode}</Ltr></span>],
                [t.fields.patientId, result.patient.name],
                [t.fields.startAt, <span className="tabular">{fmtDateTime(result.startAt)}</span>],
                [t.fields.doctorId, result.doctor.name],
                [t.fields.serviceId, result.service.name],
                [t.fields.status, <StatusBadge kind="AppointmentStatus" value={result.status} />],
              ]}
            />
          </Alert>
          {result.nameMismatch && <Alert tone="warning">{tb.nameMismatch(result.patient.name, result.bookedName)}</Alert>}
        </div>
      )}
      <Card title={tb.newBooking} icon="calendar-plus">
        <form className="stack-lg" onSubmit={book}>
          <StepSection n={1} title={tb.stepPatient}>
            <PatientByPhone key={key} initialPhone={key === 0 ? initialPhone : ''} onChange={setPatient} />
          </StepSection>
          <StepSection n={2} title={tb.stepService}>
            <DoctorService
              doctorId={ds.doctorId} serviceId={ds.serviceId}
              onChange={(doctorId, serviceId) => { setDs({ doctorId, serviceId }); setStartAt(''); }}
            />
          </StepSection>
          <StepSection n={3} title={tb.stepTime}>
            <div className="stack-sm">
              <Switch label={tb.outsideSchedule} checked={outside} onChange={(v) => { setOutside(v); setStartAt(''); }} />
              <span className="field__help">{tb.outsideHint}</span>
            </div>
            <SlotPicker doctorId={ds.doctorId} serviceId={ds.serviceId} outside={outside} value={startAt} onPick={setStartAt} />
          </StepSection>
          <StepSection n={4} title={tb.stepNotes}>
            <Field label={tb.notesPh} optional>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </StepSection>
          <div className="form-actions form-actions--end">
            <Button type="submit" variant="primary" size="lg" icon="calendar-check" disabled={!ready}>{tb.book}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function WalkIn({ initialPhone }: { initialPhone: string }) {
  const { t } = useI18n();
  const [patient, setPatient] = useState<PatientPick>({});
  const [ds, setDs] = useState({ doctorId: '', serviceId: '' });
  const [result, setResult] = useState<any>(null);
  const [key, setKey] = useState(0);
  const resultRef = useScrollTo(result);
  const ready = !!ds.serviceId && !!(patient.patientId || patient.name);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    await act(async () => {
      setResult(await post('/visits/walk-in', { ...patient, ...ds }));
      setPatient({});
      setKey((k) => k + 1);
    });
  };
  const tb = t.booking;
  return (
    <div className="stack-lg">
      {result && (
        <div ref={resultRef}>
          <Alert
            tone="success" title={tb.walkInDone(result.patient.name, result.doctor.name)}
            actions={<>
              <ButtonLink size="sm" variant="primary" icon="receipt" to={`/reception/invoices/${result.invoiceId}`}>{tb.openInvoice}</ButtonLink>
              <ButtonLink size="sm" icon="calendar-days" to="/reception">{tb.dayList}</ButtonLink>
            </>}
          />
        </div>
      )}
      <Card title={tb.walkInTitle} description={tb.walkInHint} icon="log-in">
        <form className="stack-lg" onSubmit={create}>
          <StepSection n={1} title={tb.stepPatient}>
            <PatientByPhone key={key} initialPhone={key === 0 ? initialPhone : ''} onChange={setPatient} />
          </StepSection>
          <StepSection n={2} title={tb.stepService}>
            <DoctorService doctorId={ds.doctorId} serviceId={ds.serviceId} onChange={(doctorId, serviceId) => setDs({ doctorId, serviceId })} />
          </StepSection>
          <div className="form-actions form-actions--end">
            <Button type="submit" variant="primary" size="lg" icon="user-check" disabled={!ready}>{tb.createWalkIn}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
