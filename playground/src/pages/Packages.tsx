import { useState } from 'react';
import { act, get, patch, post, qs } from '../api';
import { doctorBody, DoctorPicker, type DoctorChoice } from '../components';
import { useForm, useLoad } from '../util';

const EMPTY = {
  name: '', serviceId: '', sessionsCount: '10', price: '', isPublic: true,
  offerType: '', offerValue: '', offerStartsOn: '', offerEndsOn: '',
};

/** Owner: package catalog (create / edit / doctors / offer / deactivate). */
export function Packages() {
  const [res, reload] = useLoad(() => get(`/packages${qs({ limit: 100 })}`), []);
  const [services] = useLoad(() => get(`/clinic-services${qs({ limit: 100, isActive: true })}`), []);
  const f = useForm(EMPTY);
  const [docs, setDocs] = useState<DoctorChoice>({ all: true, ids: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => act(fn).then(reload);

  const reset = () => { f.setV(EMPTY); setDocs({ all: true, ids: [] }); setEditingId(null); };
  const edit = (p: any) => {
    setEditingId(p.id);
    setDocs({ all: p.allDoctors, ids: p.doctors.map((d: any) => d.id) });
    f.setV({
      name: p.name, serviceId: p.service.id, sessionsCount: String(p.sessionsCount), price: p.price, isPublic: p.isPublic,
      offerType: p.offer?.type ?? '', offerValue: p.offer?.value ?? '',
      offerStartsOn: p.offer?.startsOn ?? '', offerEndsOn: p.offer?.endsOn ?? '',
    });
  };
  const body = () => ({
    name: f.v.name, serviceId: f.v.serviceId, sessionsCount: Number(f.v.sessionsCount), price: f.v.price, isPublic: f.v.isPublic,
    ...doctorBody(docs),
    offer: f.v.offerType
      ? { type: f.v.offerType, value: f.v.offerValue, startsOn: f.v.offerStartsOn || null, endsOn: f.v.offerEndsOn || null }
      : null,
  });
  const save = () => act(() => (editingId ? patch(`/packages/${editingId}`, body()) : post('/packages', body())))
    .then((ok) => { if (ok) reset(); reload(); });

  return (
    <>
      <h2>Packages</h2>
      <div className="box">
        <h4>{editingId ? 'Edit package' : 'New package'}</h4>
        <div className="row">
          <input placeholder="name" {...f.bind('name')} />
          <select {...f.bind('serviceId')}>
            <option value="">-- service --</option>
            {services?.items.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.basePrice} / session)</option>)}
          </select>
          <input placeholder="sessions" {...f.bind('sessionsCount')} />
          <input placeholder="total price e.g. 2700.00" {...f.bind('price')} />
          <label><input type="checkbox" {...f.bind('isPublic')} checked={f.v.isPublic} /> public</label>
        </div>
        <DoctorPicker value={docs} onChange={setDocs} allLabel="all doctors (also doctors added later)" />
        <div className="row">
          <select {...f.bind('offerType')}><option value="">no offer</option><option>PERCENT</option><option>FIXED</option></select>
          {f.v.offerType && <>
            <input placeholder={f.v.offerType === 'PERCENT' ? '% e.g. 10' : 'EGP off e.g. 300.00'} {...f.bind('offerValue')} />
            <label>from <input type="date" {...f.bind('offerStartsOn')} /></label>
            <label>to <input type="date" {...f.bind('offerEndsOn')} /></label>
          </>}
        </div>
        <div className="inline">
          <button onClick={save}>{editingId ? 'Save' : 'Create'}</button>
          {editingId && <button onClick={reset}>Cancel edit</button>}
        </div>
        <small>Sold packages keep their name, sessions and prices; they follow the doctor list as it is now.</small>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Service</th><th>Sessions</th><th>Price</th><th>Offer</th><th>Selling today</th><th>Doctors</th><th>Public</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {res?.items.map((p: any) => (
            <tr key={p.id} style={p.isActive ? {} : { opacity: 0.5 }}>
              <td>{p.name}</td><td>{p.service.name}</td><td>{p.sessionsCount}</td><td>{p.price}</td>
              <td>{p.offer ? `${p.offer.value}${p.offer.type === 'PERCENT' ? '%' : ' EGP'} ${p.offer.startsOn ?? '…'} → ${p.offer.endsOn ?? '…'}${p.offerActive ? ' (active)' : ''}` : '-'}</td>
              <td><b>{p.sellingPrice}</b></td>
              <td>{p.allDoctors ? <i>all</i> : p.doctors.map((d: any) => d.name).join(', ')}</td>
              <td>{String(p.isPublic)}</td><td>{String(p.isActive)}</td>
              <td>
                <button onClick={() => edit(p)}>edit</button>
                <button onClick={() => run(() => patch(`/packages/${p.id}/${p.isActive ? 'deactivate' : 'activate'}`))}>{p.isActive ? 'deactivate' : 'activate'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
