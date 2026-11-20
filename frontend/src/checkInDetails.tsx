// The patient details reception collects before the patient enters the doctor: identity document (National ID,
// or passport for a non-Egyptian), gender, date of birth, administrative notes and, if the patient has none yet,
// how they found the clinic (a doctor referral with its referring doctor and terms, as on the patient page). Used
// by the attend dialog (day list, calendar), the walk-in form and the patient page. The rules are in
// patientIdentity.ts (shared with the tests); the API checks them again.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, qs } from './api';
import { label, useI18n } from './i18n';
import {
  defaultsOf, doctorLabel, termsBody, termsFrom, TermsFields, termsReady, type TermsDefaults, type TermsInit,
} from './pages/PatientReferral';
import {
  ageOn, checkForm, detailsPayload, DOCTOR_REFERRAL, formFromPatient, isComplete, normalizeNationalId, parseNationalId,
  withIdNumber, type DetailsForm, type IdType, type PatientDetails, type Problems,
} from './patientIdentity';
import { todayCairo } from './time';
import { Badge, Field, Input, Loading, Segmented, Select, Textarea } from './ui';
import { Ltr, useLoad } from './util';
import './styles/areas/checkin.css';

// How a patient can find the clinic; a doctor referral comes with its referring doctor and terms.
const CHANNELS = [
  'FACEBOOK', 'INSTAGRAM', 'OTHER_SOCIAL_MEDIA', 'GOOGLE', 'GOOGLE_ADS', 'ADVERTISEMENT',
  'FRIENDS_FAMILY', 'EXISTING_PATIENT', 'WEBSITE', DOCTOR_REFERRAL, 'OTHER',
];

interface ReferringDoctor { id: string; name: string; specialty: string | null; workplace: string | null; currentAgreement: any | null }
interface DoctorReferral { doctorId: string; terms: TermsInit | null }

export interface CheckInDetails {
  loading: boolean;
  patient: PatientDetails | null;
  // The patient has no referral source yet: the form asks for one.
  needsSource: boolean;
  // Nothing to collect: the patient can enter the doctor as is.
  complete: boolean;
  // A receptionist can't change the identity document of a patient who has a code.
  locked: boolean;
  form: DetailsForm;
  setForm: (form: DetailsForm) => void;
  problems: Problems;
  // The source is a doctor referral: the referring doctor and the terms are asked for.
  byDoctor: boolean;
  doctors: ReferringDoctor[] | undefined;
  referral: DoctorReferral;
  setReferral: (referral: DoctorReferral) => void;
  // The chosen doctor's current agreement (the terms' defaults).
  defaults: TermsDefaults | null;
  // Problems are shown once the user tried to send.
  showProblems: boolean;
  /** Shows the problems; true when the form can be sent. */
  validate: () => boolean;
  /** The body to send (only what changed); undefined when the patient is complete. */
  payload: () => Record<string, unknown> | undefined;
}

/**
 * The details of `patientId` (null: a patient not registered yet). `mode` 'checkIn' requires everything check-in
 * needs; 'edit' (patient page) only checks what is filled in. `resetKey` starts a fresh form.
 */
export function useCheckInDetails(patientId: string | null | undefined, mode: 'checkIn' | 'edit' = 'checkIn', resetKey: unknown = 0): CheckInDetails {
  const [patient, , loadingPatient] = useLoad(
    () => (patientId ? get<PatientDetails>(`/patients/${patientId}`) : Promise.resolve(null)), [patientId, resetKey],
  );
  const [acquisition, , loadingSources] = useLoad(
    () => (patientId ? get<{ sources: unknown[] }>(`/patients/${patientId}/acquisition`) : Promise.resolve({ sources: [] })),
    [patientId, resetKey],
  );
  const loading = loadingPatient || loadingSources || patient === undefined || acquisition === undefined;
  const [form, setForm] = useState<DetailsForm>(formFromPatient(null));
  const [referral, setReferral] = useState<DoctorReferral>({ doctorId: '', terms: null });
  const [showProblems, setShowProblems] = useState(false);
  useEffect(() => {
    if (loading) return;
    setForm(formFromPatient(patient ?? null));
    setReferral({ doctorId: '', terms: null });
    setShowProblems(false);
  }, [loading, patient]);

  const current = patient ?? null;
  const needsSource = mode === 'checkIn' && (acquisition?.sources.length ?? 0) === 0;
  const complete = mode === 'checkIn' && isComplete(current, !needsSource);
  const byDoctor = needsSource && !complete && form.channel === DOCTOR_REFERRAL;
  // The active referring doctors, loaded when a doctor referral is picked.
  const [directory] = useLoad(
    () => (byDoctor ? get<{ items: ReferringDoctor[] }>(`/referring-doctors${qs({ isActive: true, limit: 100 })}`) : Promise.resolve(null)),
    [byDoctor],
  );
  const doctor = directory?.items.find((d) => d.id === referral.doctorId);
  const defaults = doctor?.currentAgreement ? defaultsOf(doctor.currentAgreement) : null;

  const all: Problems = complete ? {} : checkForm(form, needsSource, todayCairo());
  if (byDoctor && !referral.doctorId) all.referringDoctor = 'required';
  // Editing: an empty field is fine (the API keeps it empty); only wrong values block.
  const problems = mode === 'edit'
    ? Object.fromEntries(Object.entries(all).filter(([field, p]) => p !== 'required' || field === 'idNumber' && !!current?.patientCode)) as Problems
    : all;
  const termsOk = !byDoctor || (!!defaults && !!referral.terms && termsReady(referral.terms, defaults));
  const locked = !!current?.patientCode && getSession()?.user.role !== 'OWNER';
  return {
    loading, patient: current, needsSource, complete, locked, form, setForm, problems, showProblems,
    byDoctor, doctors: directory?.items, referral, setReferral, defaults,
    validate: () => { setShowProblems(true); return !loading && Object.keys(problems).length === 0 && termsOk; },
    payload: () => {
      if (complete) return undefined;
      const body = detailsPayload(form, current, needsSource);
      if (mode === 'edit' && !form.idNumber.trim()) { delete body.nationalId; delete body.passportNumber; }
      if (byDoctor && defaults && referral.terms) {
        body.referral = { referringDoctorId: referral.doctorId, ...termsBody(referral.terms, defaults) };
      }
      return body;
    },
  };
}

/** The patient code, or a hint that it comes with the identity document. */
export function PatientCode({ code }: { code: string | null | undefined }) {
  const { t } = useI18n();
  return code
    ? <Badge tone="brand" icon="id-card"><Ltr>{code}</Ltr></Badge>
    : <span className="text-muted">{t.checkIn.noCode}</span>;
}

/** The form fields (no buttons): the caller sends `state.payload()` after `state.validate()`. */
export function CheckInDetailsFields({ state }: { state: CheckInDetails }) {
  const { t } = useI18n();
  const tc = t.checkIn;
  const tr = t.referrals;
  const { form, setForm, problems, showProblems, locked, needsSource, byDoctor, doctors, referral, setReferral, defaults } = state;
  const today = todayCairo();
  // "Required" waits for a send attempt; a wrong value shows at once.
  const error = (field: keyof Problems) => {
    const p = problems[field];
    if (!p || (p === 'required' && !showProblems)) return undefined;
    return label(tc.problems, p);
  };
  const national = form.idType === 'NATIONAL_ID';
  // Birth date and gender come from a valid National ID; the age from the birth date.
  const fromId = national && !!parseNationalId(normalizeNationalId(form.idNumber), today);
  const years = ageOn(form.dateOfBirth, today);
  const age = years && tc.ageText(years.years, years.months);
  const pickDoctor = (doctorId: string) => {
    const d = doctors?.find((x) => x.id === doctorId);
    setReferral({ doctorId, terms: d?.currentAgreement ? termsFrom(null, defaultsOf(d.currentAgreement)) : null });
  };
  return (
    <div className="stack">
      <div className="checkin-grid">
        <Field group label={tc.idType} hint={locked ? tc.locked : undefined}>
          <Segmented<IdType>
            label={tc.idType} value={form.idType}
            onChange={(idType) => { if (!locked) setForm({ ...form, idType, idNumber: '' }); }}
            options={(['NATIONAL_ID', 'PASSPORT'] as IdType[]).map((v) => ({ value: v, label: label(tc.idTypes, v) }))}
          />
        </Field>
        <Field label={national ? tc.nationalId : tc.passport} hint={national ? tc.nationalIdHint : tc.passportHint} error={error('idNumber')}>
          <Input
            dir="ltr" autoComplete="off" inputMode={national ? 'numeric' : 'text'} readOnly={locked}
            maxLength={national ? 20 : 30} value={form.idNumber}
            onChange={(e) => setForm(withIdNumber(form, e.target.value, today))}
          />
        </Field>
        {fromId ? (
          // A valid National ID states them: shown, not typed.
          <Field label={tc.gender} hint={tc.fromNationalId}>
            <Input readOnly value={form.gender ? label(t.enums.Gender, form.gender) : ''} />
          </Field>
        ) : (
          <Field group label={tc.gender} error={error('gender')}>
            <Segmented<string>
              label={tc.gender} value={form.gender}
              onChange={(gender) => setForm({ ...form, gender: gender as DetailsForm['gender'] })}
              options={['MALE', 'FEMALE'].map((g) => ({ value: g, label: label(t.enums.Gender, g) }))}
            />
          </Field>
        )}
        <Field
          label={tc.dob} error={fromId ? undefined : error('dateOfBirth')}
          hint={[fromId && tc.fromNationalId, age && tc.ageHint(age)].filter(Boolean).join(' ') || undefined}
        >
          <Input type="date" max={today} readOnly={fromId} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
        </Field>
        {needsSource && (
          <>
            <Field label={tc.source} hint={tc.sourceHint} error={error('channel')}>
              <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="">{tc.pickSource}</option>
                {CHANNELS.map((ch) => <option key={ch} value={ch}>{label(t.enums.AcquisitionChannel, ch)}</option>)}
              </Select>
            </Field>
            {byDoctor ? (
              // Picked from the directory (never typed): its default terms load at once.
              <Field
                label={tr.referringDoctor} error={error('referringDoctor')}
                hint={getSession()?.user.role === 'OWNER'
                  ? <>{tr.missingDoctorOwner} <Link to="/owner/referring-doctors">{tr.addDoctor}</Link></>
                  : tr.missingDoctorDesk}
              >
                {!doctors ? <Loading /> : (
                  <Select value={referral.doctorId} onChange={(e) => pickDoctor(e.target.value)}>
                    <option value="">{doctors.length === 0 ? tr.noDoctorsYet : tr.pickDoctor}</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{doctorLabel(d)}</option>)}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label={tc.sourceDetails} optional>
                <Input autoComplete="off" maxLength={255} placeholder={tc.sourceDetailsPh} value={form.channelDetails}
                  onChange={(e) => setForm({ ...form, channelDetails: e.target.value })} />
              </Field>
            )}
          </>
        )}
      </div>
      {byDoctor && defaults && referral.terms && (
        <TermsFields key={referral.doctorId} defaults={defaults} value={referral.terms} onChange={(terms) => setReferral({ ...referral, terms })} />
      )}
      <Field label={tc.notes} hint={tc.notesHint} optional>
        <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </div>
  );
}
