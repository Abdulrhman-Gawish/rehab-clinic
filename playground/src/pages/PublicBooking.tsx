import { useState } from 'react';
import { act, api, get, qs } from '../api';
import { addDays, fmtDateTime, fmtTime, todayCairo } from '../time';
import { useLoad } from '../util';

export function PublicBooking() {
  const [doctors] = useLoad(() => get<any[]>('/public/doctors', { noAuth: true }), []);
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(addDays(todayCairo(), 1));
  const [startAt, setStartAt] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState<any>(null);
  // '' = no package (pay per session).
  const [packageId, setPackageId] = useState('');
  const [packages] = useLoad(() => get<any[]>('/public/packages', { noAuth: true }), []);
  const doctor = doctors?.find((d) => d.id === doctorId);
  // Packages this doctor offers (for a service the doctor offers), listed right under the services.
  const offered = (packages ?? []).filter((p) => (p.allDoctors || p.doctors.some((d: any) => d.id === doctorId))
    && doctor?.services.some((s: any) => s.id === p.service.id));
  // Picking a service clears the package; picking a package also picks its service.
  const pick = (nextServiceId: string, nextPackageId: string) => {
    setServiceId(nextServiceId); setPackageId(nextPackageId); setStartAt('');
  };
  const [slots] = useLoad(
    () => (doctorId && serviceId ? get<any[]>(`/public/doctors/${doctorId}/slots${qs({ serviceId, date })}`, { noAuth: true }) : Promise.resolve([])),
    [doctorId, serviceId, date],
  );

  if (done) {
    return (
      <>
        <h2>Booked!</h2>
        <p>Your reference code: <b style={{ fontSize: 28 }}>{done.referenceCode}</b></p>
        <p>{done.doctorName} — {done.serviceName}<br />{fmtDateTime(done.startAt)} – {fmtTime(done.endAt)}<br />Status: {done.status} (the clinic will confirm)</p>
        {done.packageName && <p>Package requested: <b>{done.packageName}</b>. You buy it at reception; this visit is its first session.</p>}
        <button style={{ width: 'auto' }} onClick={() => { setDone(null); setStartAt(''); setPackageId(''); }}>Book another</button>
      </>
    );
  }
  return (
    <>
      <h2>Book an appointment (public, no login)</h2>
      <h4>1. Doctor</h4>
      {doctors?.map((d) => (
        <label key={d.id}><input type="radio" checked={doctorId === d.id} onChange={() => { setDoctorId(d.id); setServiceId(''); setStartAt(''); setPackageId(''); }} /> <b>{d.name}</b> — {d.specialty} {d.bio && <small>({d.bio})</small>}</label>
      ))}
      {doctor && <>
        <h4>2. Service</h4>
        {doctor.services.map((s: any) => (
          <label key={s.id}><input type="radio" checked={serviceId === s.id && !packageId} onChange={() => pick(s.id, '')} /> {s.name} — {s.durationMinutes} min — {s.price} EGP</label>
        ))}
        {offered.map((p) => (
          <label key={p.id}>
            <input type="radio" checked={packageId === p.id} onChange={() => pick(p.service.id, p.id)} />{' '}
            <b>Package ({p.name})</b>: {p.sessionsCount} sessions {p.service.name} for <b>{p.sellingPrice} EGP</b>
            {p.sellingPrice !== p.price && <> <s>{p.price}</s>{p.offerEndsOn && <small> (offer until {p.offerEndsOn})</small>}</>}
          </label>
        ))}
        {packageId && <small>You pay for the package at the clinic; this visit is your first session.</small>}
      </>}
      {serviceId && <>
        <h4>3. Date and time</h4>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStartAt(''); }} />
        <div className="slots">
          {slots?.length === 0 && <small>No free slots this day.</small>}
          {slots?.map((s) => <button key={s.startAt} className={startAt === s.startAt ? 'picked' : ''} onClick={() => setStartAt(s.startAt)}>{fmtTime(s.startAt)}</button>)}
        </div>
      </>}
      {startAt && <>
        <h4>4. Your details</h4>
        <div className="row">
          <input placeholder="full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="mobile 01xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button onClick={() => act(async () => setDone(await api('POST', '/public/appointments', { name, phone, doctorId, serviceId, startAt, packageId: packageId || undefined }, { noAuth: true })))}>Book</button>
      </>}
    </>
  );
}
