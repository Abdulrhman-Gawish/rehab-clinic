import { useState } from 'react';
import { get, qs } from './api';
import { fmtTime, todayCairo } from './time';
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

export interface DoctorChoice { all: boolean; ids: string[] }
export const doctorBody = (c: DoctorChoice) => (c.all ? { allDoctors: true } : { doctorIds: c.ids });

/** "All doctors" or a checkbox per active doctor (services: all active now; packages: also doctors added later). */
export function DoctorPicker({ value, onChange, allLabel }: { value: DoctorChoice; onChange: (c: DoctorChoice) => void; allLabel: string }) {
  const [doctors] = useDoctors();
  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] });
  return (
    <div className="inline">
      <label style={{ display: 'inline', marginRight: 12 }}>
        <input type="checkbox" checked={value.all} onChange={(e) => onChange({ ...value, all: e.target.checked })} /> <b>{allLabel}</b>
      </label>
      {!value.all && doctors?.map((d) => (
        <label key={d.id} style={{ display: 'inline', marginRight: 12 }}>
          <input type="checkbox" checked={value.ids.includes(d.id)} onChange={() => toggle(d.id)} /> {d.name}
        </label>
      ))}
    </div>
  );
}

/** Staff slot picker. With `outside`, the whole day is listed, past dates and times included (back to BACKDATE_MAX_DAYS). */
export function SlotPicker({ doctorId, serviceId, outside, value, onPick }: {
  doctorId: string; serviceId: string; outside: boolean; value: string; onPick: (startAt: string) => void;
}) {
  const [date, setDate] = useState(todayCairo());
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
