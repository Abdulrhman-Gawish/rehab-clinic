import { useState } from 'react';
import { Link } from 'react-router-dom';
import { act, get, post, qs } from '../api';
import { DoctorService, SlotPicker } from '../components';
import { fmtDateTime } from '../time';

interface Patient { id: string; name: string; phone: string }

/** phone -> lookup; found = use patientId, not found = ask for a name. */
function PatientByPhone({ onChange }: { onChange: (p: { patientId?: string; name?: string; phone?: string }) => void }) {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Patient | null | undefined>(undefined);
  const [name, setName] = useState('');
  // { patient: null } = unknown phone: ask for a name (find-or-create on submit).
  const lookup = () => act(async () => {
    const { patient } = await get<{ patient: Patient | null }>(`/patients/lookup${qs({ phone })}`);
    setFound(patient);
    onChange(patient ? { patientId: patient.id } : { name, phone });
  });
  return (
    <div className="row">
      <label>Phone <input value={phone} onChange={(e) => { setPhone(e.target.value); setFound(undefined); onChange({}); }} onBlur={lookup} placeholder="010..." /></label>
      <button type="button" style={{ width: 'auto' }} onClick={lookup}>Look up</button>
      {found && <p className="ok">Found: <b>{found.name}</b> ({found.phone})</p>}
      {found === null && (
        <label>New patient name <input value={name} onChange={(e) => { setName(e.target.value); onChange({ name: e.target.value, phone }); }} /></label>
      )}
    </div>
  );
}

export function Booking() {
  return (
    <>
      <NewBooking />
      <hr />
      <WalkIn />
    </>
  );
}

function NewBooking() {
  const [patient, setPatient] = useState<{ patientId?: string; name?: string; phone?: string }>({});
  const [ds, setDs] = useState({ doctorId: '', serviceId: '' });
  const [outside, setOutside] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<any>(null);
  const [key, setKey] = useState(0);
  const book = () => act(async () => {
    const r = await post('/appointments', { ...patient, ...ds, startAt, notes: notes || undefined, allowOutsideSchedule: outside || undefined });
    setResult(r);
    setStartAt('');
    setKey((k) => k + 1);
  });
  return (
    <div>
      <h2>New booking</h2>
      <PatientByPhone key={key} onChange={setPatient} />
      <DoctorService doctorId={ds.doctorId} serviceId={ds.serviceId} onChange={(doctorId, serviceId) => { setDs({ doctorId, serviceId }); setStartAt(''); }} />
      <label><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> outside schedule</label>
      <SlotPicker doctorId={ds.doctorId} serviceId={ds.serviceId} outside={outside} value={startAt} onPick={setStartAt} />
      <input placeholder="notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button disabled={!startAt || !(patient.patientId || patient.name)} onClick={book}>Book</button>
      {result && (
        <p className="ok">
          Booked <b>{result.referenceCode}</b> — {result.patient.name}, {result.doctor.name}, {result.service.name}, {fmtDateTime(result.startAt)} ({result.status})
          {result.nameMismatch && <span className="warn"> ⚠ name mismatch: stored "{result.patient.name}", booked "{result.bookedName}"</span>}
          {' '}<Link to={`/reception?date=${result.startAt.slice(0, 10)}`}>day list</Link>
        </p>
      )}
    </div>
  );
}

function WalkIn() {
  const [patient, setPatient] = useState<{ patientId?: string; name?: string; phone?: string }>({});
  const [ds, setDs] = useState({ doctorId: '', serviceId: '' });
  const [result, setResult] = useState<any>(null);
  const [key, setKey] = useState(0);
  return (
    <div>
      <h2>Walk-in</h2>
      <PatientByPhone key={key} onChange={setPatient} />
      <DoctorService doctorId={ds.doctorId} serviceId={ds.serviceId} onChange={(doctorId, serviceId) => setDs({ doctorId, serviceId })} />
      <button disabled={!ds.serviceId || !(patient.patientId || patient.name)} onClick={() => act(async () => {
        setResult(await post('/visits/walk-in', { ...patient, ...ds }));
        setKey((k) => k + 1);
      })}>Create walk-in</button>
      {result && (
        <p className="ok">
          Walk-in attended: {result.patient.name} → {result.doctor.name}.{' '}
          <Link to={`/reception/invoices/${result.invoiceId}`}>invoice</Link> · <Link to="/reception">day list</Link>
        </p>
      )}
    </div>
  );
}
