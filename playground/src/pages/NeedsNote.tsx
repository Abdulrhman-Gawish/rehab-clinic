import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, qs } from '../api';
import { useDoctors } from '../components';
import { fmtDateTime } from '../time';
import { useLoad } from '../util';

/** ACTIVE visits without a signed note, oldest first. DOCTOR: own; OWNER: all, or one doctor's. */
export function NeedsNote() {
  const isOwner = getSession()?.user.role === 'OWNER';
  const [doctorId, setDoctorId] = useState('');
  const [doctors] = useDoctors();
  const [res, reload] = useLoad(
    () => get(`/clinical-notes/needs-attention${qs({ doctorId: doctorId || undefined, limit: 100 })}`),
    [doctorId],
  );
  return (
    <>
      <h2>Needs a note</h2>
      <div className="row">
        {isOwner && (
          <label>Doctor
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">all</option>{doctors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <button style={{ width: 'auto' }} onClick={reload}>Refresh</button>
      </div>
      <table>
        <thead><tr><th>Visit</th><th>Patient</th><th>Service</th><th>Doctor</th><th>Note</th></tr></thead>
        <tbody>
          {res?.items.map((v: any) => (
            <tr key={v.visitId}>
              <td><Link to={`/doctor/visits/${v.visitId}`}>{fmtDateTime(v.visitDate)}</Link></td>
              <td>{v.patient.name}</td><td>{v.service.name}</td><td>{v.doctor.name}</td>
              <td>{v.noteStatus ?? 'none yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {res && <small>{res.meta.total} visits</small>}
    </>
  );
}
