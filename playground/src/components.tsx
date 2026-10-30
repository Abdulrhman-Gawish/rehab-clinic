import { useState } from 'react';
import { get, qs } from './api';
import { cairoIso, fmtTime, todayCairo } from './time';
import { useLoad } from './util';

export interface Doctor {
  id: string; name: string; specialty: string; isActive: boolean; isPublic: boolean; email: string; phone: string | null;
  services: { serviceId: string; name: string; durationMinutes: number; price: string; basePrice: string; priceOverride: string | null; isActive: boolean }[];
}

export function useDoctors(activeOnly = true) {
  return useLoad(() => get<{ items: Doctor[] }>(`/doctors${qs({ limit: 100, isActive: activeOnly ? true : undefined })}`).then((r) => r.items), []);
}

/** Doctor select + service select (services of that doctor). */
export function DoctorService({ doctorId, serviceId, onChange }: {
  doctorId: string; serviceId: string; onChange: (doctorId: string, serviceId: string) => void;
}) {
  const [doctors] = useDoctors();
  const doctor = doctors?.find((d) => d.id === doctorId);
  return (
    <div className="row">
      <label>Doctor
        <select value={doctorId} onChange={(e) => onChange(e.target.value, '')}>
          <option value="">-- doctor --</option>
          {doctors?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>)}
        </select>
      </label>
      <label>Service
        <select value={serviceId} onChange={(e) => onChange(doctorId, e.target.value)}>
          <option value="">-- service --</option>
          {doctor?.services.filter((s) => s.isActive).map((s) => (
            <option key={s.serviceId} value={s.serviceId}>{s.name} ({s.durationMinutes} min, {s.price})</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Staff slot picker. With `outside`, reception may also type any time (availability never returns past times). */
export function SlotPicker({ doctorId, serviceId, outside, value, onPick }: {
  doctorId: string; serviceId: string; outside: boolean; value: string; onPick: (startAt: string) => void;
}) {
  const [date, setDate] = useState(todayCairo());
  const [manual, setManual] = useState('');
  const [slots] = useLoad(
    () => (doctorId && serviceId && date
      ? get<{ startAt: string; endAt: string }[]>(`/appointments/availability${qs({ doctorId, serviceId, date, includeOutsideSchedule: outside || undefined })}`)
      : Promise.resolve([])),
    [doctorId, serviceId, date, outside],
  );
  return (
    <div>
      <div className="row">
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {outside && (
          <label>Or any time (outside schedule / past)
            <span className="inline">
              <input type="time" value={manual} onChange={(e) => setManual(e.target.value)} />
              <button type="button" disabled={!manual} onClick={() => onPick(cairoIso(date, manual))}>use</button>
            </span>
          </label>
        )}
      </div>
      <div className="slots">
        {!doctorId || !serviceId ? <small>Pick doctor and service first.</small> : slots?.length === 0 ? <small>No slots.</small> : null}
        {slots?.map((s) => (
          <button type="button" key={s.startAt} className={value === s.startAt ? 'picked' : ''} onClick={() => onPick(s.startAt)}>
            {fmtTime(s.startAt)}
          </button>
        ))}
      </div>
      {value && <p>Picked: <b>{value}</b></p>}
    </div>
  );
}
