import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { act, del, get, patch, post, put, qs } from '../api';
import { Packages } from './Packages';
import { doctorBody, DoctorPicker, type Doctor, type DoctorChoice } from '../components';
import { DAYS, fmtDateTime, localInputToIso } from '../time';
import { opt, useForm, useLoad } from '../util';

export function Users() {
  const [res, reload] = useLoad(() => get(`/users${qs({ limit: 100 })}`), []);
  const f = useForm({ name: '', email: '', phone: '', password: '', role: 'RECEPTIONIST' });
  const run = (fn: () => Promise<unknown>) => act(fn).then(reload);
  return (
    <>
      <h2>Users</h2>
      <div className="box">
        <div className="row">
          <input placeholder="name" {...f.bind('name')} /><input placeholder="email" {...f.bind('email')} />
          <input placeholder="phone (optional)" {...f.bind('phone')} /><input placeholder="password (8+)" {...f.bind('password')} />
          <select {...f.bind('role')}><option>RECEPTIONIST</option><option>OWNER</option></select>
          <button onClick={() => run(() => post('/users', { ...f.v, phone: opt(f.v.phone) }))}>Create user</button>
        </div>
        <small>Doctors are created on the Doctors page.</small>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th><th></th></tr></thead>
        <tbody>
          {res?.items.map((u: any) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{String(u.isActive)}</td><td>{fmtDateTime(u.lastLoginAt)}</td>
              <td>
                <button onClick={() => run(() => patch(`/users/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`))}>{u.isActive ? 'deactivate' : 'activate'}</button>
                <button onClick={() => { const p = prompt('New password (8+)'); if (p) run(() => post(`/users/${u.id}/reset-password`, { newPassword: p })); }}>reset password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Doctors() {
  const [res, reload] = useLoad(() => get<{ items: Doctor[] }>(`/doctors${qs({ limit: 100 })}`), []);
  const f = useForm({ name: '', email: '', phone: '', password: '', specialty: '', bio: '', isPublic: true });
  const run = (fn: () => Promise<unknown>) => act(fn).then(reload);
  return (
    <>
      <h2>Doctors</h2>
      <div className="box">
        <div className="row">
          <input placeholder="name" {...f.bind('name')} /><input placeholder="email" {...f.bind('email')} />
          <input placeholder="phone (optional)" {...f.bind('phone')} /><input placeholder="password (8+)" {...f.bind('password')} />
        </div>
        <div className="row">
          <input placeholder="specialty" {...f.bind('specialty')} /><input placeholder="bio (optional)" {...f.bind('bio')} />
          <label><input type="checkbox" checked={f.v.isPublic} onChange={(e) => f.setV({ ...f.v, isPublic: e.target.checked })} /> public</label>
          <button onClick={() => run(() => post('/doctors', { ...f.v, phone: opt(f.v.phone), bio: opt(f.v.bio) }))}>Create doctor</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Specialty</th><th>Public</th><th>Active</th><th>Services</th><th></th></tr></thead>
        <tbody>
          {res?.items.map((d) => (
            <tr key={d.id}>
              <td><Link to={`/owner/doctors/${d.id}`}>{d.name}</Link></td><td>{d.email}</td><td>{d.specialty}</td>
              <td>{String(d.isPublic)}</td><td>{String(d.isActive)}</td>
              <td>{d.services.map((s) => `${s.name} ${s.price}${s.priceOverride ? '*' : ''}`).join(', ')}</td>
              <td>
                <button onClick={() => run(() => patch(`/doctors/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`))}>{d.isActive ? 'deactivate' : 'activate'}</button>
                <Link role="button" to={`/owner/doctors/${d.id}`}>services / schedule</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>* = price override</small>
    </>
  );
}

export function DoctorPage() {
  const { id } = useParams();
  const [doctor, reloadDoctor] = useLoad(() => get<Doctor>(`/doctors/${id}`), [id]);
  const [services] = useLoad(() => get(`/clinic-services${qs({ limit: 100 })}`), []);
  const [schedules, reloadSchedules] = useLoad(() => get<any[]>(`/doctors/${id}/schedules?includeInactive=true`), [id]);
  const [timeOff, reloadTimeOff] = useLoad(() => get<any[]>(`/doctors/${id}/time-off`), [id]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const sf = useForm({ dayOfWeek: '0', startTime: '10:00', endTime: '14:00' });
  const tf = useForm({ startAt: '', endAt: '', reason: '' });
  const [conflicts, setConflicts] = useState<any[]>([]);
  if (!doctor) return <p>Loading…</p>;
  const assigned = new Map(doctor.services.map((s) => [s.serviceId, s]));
  return (
    <>
      <h2>{doctor.name} <small>{doctor.specialty} · {doctor.isActive ? 'active' : 'inactive'}</small></h2>

      <h3>Services</h3>
      <table>
        <thead><tr><th>Service</th><th>Base price</th><th>Assigned</th><th>Price override</th><th></th></tr></thead>
        <tbody>
          {services?.items.map((s: any) => {
            const a = assigned.get(s.id);
            return (
              <tr key={s.id}>
                <td>{s.name} {!s.isActive && '(inactive)'}</td><td>{s.basePrice}</td><td>{a ? `yes (${a.price})` : 'no'}</td>
                <td><input style={{ width: 120, marginBottom: 0 }} placeholder={a?.priceOverride ?? 'none'} value={overrides[s.id] ?? ''} onChange={(e) => setOverrides({ ...overrides, [s.id]: e.target.value })} /></td>
                <td>
                  <button onClick={() => act(() => put(`/doctors/${id}/services/${s.id}`, { priceOverride: overrides[s.id] ? overrides[s.id] : null })).then(reloadDoctor)}>{a ? 'update' : 'assign'}</button>
                  {a && <button onClick={() => act(() => del(`/doctors/${id}/services/${s.id}`)).then(reloadDoctor)}>unassign</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Weekly schedule</h3>
      <table>
        <tbody>
          {schedules?.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)).map((s) => (
            <tr key={s.id} style={s.isActive ? {} : { opacity: 0.5 }}>
              <td>{DAYS[s.dayOfWeek]}</td><td>{s.startTime}–{s.endTime}</td><td>{s.isActive ? 'active' : 'inactive'}</td>
              <td><button onClick={() => act(() => patch(`/doctors/${id}/schedules/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`)).then(reloadSchedules)}>{s.isActive ? 'deactivate' : 'activate'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <select {...sf.bind('dayOfWeek')}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
        <input type="time" {...sf.bind('startTime')} /><input type="time" {...sf.bind('endTime')} />
        <button onClick={() => act(() => post(`/doctors/${id}/schedules`, { ...sf.v, dayOfWeek: Number(sf.v.dayOfWeek) })).then(reloadSchedules)}>Add range</button>
      </div>

      <h3>Time off</h3>
      <table>
        <tbody>
          {timeOff?.map((t) => (
            <tr key={t.id}><td>{fmtDateTime(t.startAt)} → {fmtDateTime(t.endAt)}</td><td>{t.reason}</td>
              <td><button onClick={() => act(() => del(`/doctors/${id}/time-off/${t.id}`)).then(reloadTimeOff)}>delete</button></td></tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label>From <input type="datetime-local" {...tf.bind('startAt')} /></label>
        <label>To <input type="datetime-local" {...tf.bind('endAt')} /></label>
        <input placeholder="reason (optional)" {...tf.bind('reason')} />
        <button onClick={() => act(async () => {
          const r = await post(`/doctors/${id}/time-off`, { startAt: localInputToIso(tf.v.startAt), endAt: localInputToIso(tf.v.endAt), reason: opt(tf.v.reason) });
          setConflicts(r.conflictingAppointments);
        }).then(reloadTimeOff)}>Add time off</button>
      </div>
      {conflicts.length > 0 && (
        <p className="warn">Overlapping appointments (NOT cancelled, handle them at reception):{' '}
          {conflicts.map((c) => `${c.referenceCode} ${c.patientName} ${fmtDateTime(c.startAt)} ${c.status}`).join('; ')}</p>
      )}
    </>
  );
}

const EMPTY_SERVICE = { name: '', description: '', durationMinutes: '30', basePrice: '' };

/**
 * Services, with their packages underneath. "Delete" deactivates (nothing is ever hard deleted: visits, invoices
 * and sold packages point at it); deleted rows are hidden unless "show deleted" is ticked, and can be restored.
 */
export function Services() {
  const [res, reload] = useLoad(() => get(`/clinic-services${qs({ limit: 100 })}`), []);
  const f = useForm(EMPTY_SERVICE);
  const [docs, setDocs] = useState<DoctorChoice>({ all: false, ids: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const run = (fn: () => Promise<unknown>) => act(fn).then(reload);

  const reset = () => { f.setV(EMPTY_SERVICE); setDocs({ all: false, ids: [] }); setEditingId(null); };
  const edit = (s: any) => {
    setEditingId(s.id);
    f.setV({ name: s.name, description: s.description ?? '', durationMinutes: String(s.durationMinutes), basePrice: s.basePrice });
    setDocs({ all: false, ids: s.doctors.map((d: any) => d.id) });
    window.scrollTo(0, 0);
  };
  const save = () => {
    const body = {
      name: f.v.name, durationMinutes: Number(f.v.durationMinutes), basePrice: f.v.basePrice,
      // On edit the doctor list is always sent (it replaces the current one); on create only when chosen.
      ...(editingId || docs.all || docs.ids.length ? doctorBody(docs) : {}),
    };
    return act(() => (editingId
      ? patch(`/clinic-services/${editingId}`, { ...body, description: f.v.description.trim() || null })
      : post('/clinic-services', { ...body, description: opt(f.v.description) })))
      .then((ok) => { if (ok) reset(); reload(); });
  };
  const remove = (s: any) => {
    if (confirm(`Delete "${s.name}"? It is hidden and can't be booked any more; history keeps it. You can restore it.`)) {
      run(() => patch(`/clinic-services/${s.id}/deactivate`));
    }
  };
  const rows = (res?.items ?? []).filter((s: any) => showDeleted || s.isActive);

  return (
    <>
      <h2>Services</h2>
      <div className="box">
        <h4>{editingId ? 'Edit service' : 'New service'}</h4>
        <div className="row">
          <input placeholder="name" {...f.bind('name')} /><input placeholder="description (optional)" {...f.bind('description')} />
          <input placeholder="duration min" {...f.bind('durationMinutes')} /><input placeholder="price e.g. 300.00" {...f.bind('basePrice')} />
        </div>
        <DoctorPicker value={docs} onChange={setDocs} allLabel="all doctors active now" />
        <div className="inline">
          <button onClick={save}>{editingId ? 'Save' : 'Create'}</button>
          {editingId && <button onClick={reset}>Cancel edit</button>}
        </div>
        <small>Changing the price never changes old invoices. Doctors who stay keep their price override (doctor's page).</small>
      </div>
      <label><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> show deleted</label>
      <table>
        <thead><tr><th>Name</th><th>Duration</th><th>Base price</th><th>Doctors</th><th></th></tr></thead>
        <tbody>
          {rows.map((s: any) => (
            <tr key={s.id} style={s.isActive ? {} : { opacity: 0.5 }}>
              <td>{s.name}{s.description && <div><small>{s.description}</small></div>}</td>
              <td>{s.durationMinutes} min</td><td>{s.basePrice}</td>
              <td>{s.doctors.map((d: any) => d.name).join(', ') || '-'}</td>
              <td>
                {s.isActive ? <>
                  <button onClick={() => edit(s)}>edit</button>
                  <button onClick={() => remove(s)}>delete</button>
                </> : <button onClick={() => run(() => patch(`/clinic-services/${s.id}/activate`))}>restore</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Packages services={(res?.items ?? []).filter((s: any) => s.isActive)} />
    </>
  );
}
