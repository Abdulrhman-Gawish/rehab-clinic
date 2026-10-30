import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, qs } from '../api';
import { useDoctors } from '../components';
import { dayRange, fmtTime, todayCairo } from '../time';
import { useLoad } from '../util';

export function Queue() {
  const isOwner = getSession()?.user.role === 'OWNER';
  const [date, setDate] = useState(todayCairo());
  const [doctorId, setDoctorId] = useState('');
  const [doctors] = useDoctors();
  const [rows, reload] = useLoad(() => get<any[]>(`/visits/queue${qs({ date, doctorId: doctorId || undefined })}`), [date, doctorId]);
  return (
    <>
      <h2>Queue</h2>
      <div className="row">
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
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
        <thead><tr><th>Patient</th><th>Service</th><th>Booked</th><th>Checked in</th><th>Status</th><th>Waiting (min)</th><th>Note</th><th>Doctor</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.visitId}>
              <td><Link to={`/doctor/visits/${r.visitId}`}>{r.patient.name}</Link></td>
              <td>{r.service.name}</td>
              <td>{r.isWalkIn ? 'walk-in' : fmtTime(r.appointmentStartAt)}</td>
              <td>{fmtTime(r.checkedInAt)}</td>
              <td>{r.status}</td>
              <td>{r.waitingMinutes}</td>
              <td>{r.noteStatus ?? 'none'}</td>
              <td>{r.doctor.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p>Nobody waiting.</p>}
      <DayVisits date={date} doctorId={doctorId} />
    </>
  );
}

// The queue drops COMPLETED visits, so list the whole day separately to reach them (addenda, attachments).
function DayVisits({ date, doctorId }: { date: string; doctorId: string }) {
  const [res] = useLoad(() => get(`/visits${qs({ ...dayRange(date), doctorId: doctorId || undefined, limit: 100 })}`), [date, doctorId]);
  return (
    <>
      <h4>All visits that day</h4>
      <table>
        <tbody>
          {res?.items.map((v: any) => (
            <tr key={v.id}>
              <td><Link to={`/doctor/visits/${v.id}`}>{v.patient.name}</Link></td><td>{v.service.name}</td><td>{v.status}</td>
              <td>{fmtTime(v.checkedInAt)}</td><td>{v.doctor.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
