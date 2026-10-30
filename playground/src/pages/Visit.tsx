import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { act, ApiError, get, getSession, openFile, patch, post, put } from '../api';
import { fmtDateTime } from '../time';
import { orNull, useLoad } from '../util';

const NOTE_FIELDS = ['chiefComplaint', 'assessment', 'treatmentDone', 'progress', 'plan'] as const;
const MED_FIELDS = ['allergies', 'chronicConditions', 'pastSurgeries', 'currentMedications', 'notes'] as const;

export function VisitPage() {
  const { id } = useParams();
  const [visit, reloadVisit] = useLoad(() => get(`/visits/${id}`), [id]);
  const pid = visit?.patient.id;
  const [history, reloadHistory] = useLoad(() => (pid ? get(`/patients/${pid}/clinical-history?limit=100`) : Promise.resolve(null)), [pid]);
  const reloadAll = () => { reloadVisit(); reloadHistory(); };
  if (!visit) return <p>Loading…</p>;
  return (
    <>
      <h2>Visit — {visit.patient.name} <small>{visit.patient.phone}</small></h2>
      <p>
        {visit.service.name} with {visit.doctor.name} · <b>{visit.status}</b> · checked in {fmtDateTime(visit.checkedInAt)}
        {visit.startedAt && ` · started ${fmtDateTime(visit.startedAt)}`}{visit.completedAt && ` · completed ${fmtDateTime(visit.completedAt)}`}
        {' '}· <Link to="/doctor">back to queue</Link>
      </p>
      <div className="inline">
        <button disabled={visit.status !== 'WAITING'} onClick={() => act(() => post(`/visits/${id}/start`)).then(reloadAll)}>Start session</button>
        <button disabled={visit.status !== 'IN_SESSION'} onClick={() => act(() => post(`/visits/${id}/complete`)).then(reloadAll)}>Complete visit</button>
        <small> (Complete is refused with VISIT_COMPLETION_BLOCKED until the note is signed — the error shows at the top.)</small>
      </div>
      <div className="cols">
        <div>
          <h3>Clinical history</h3>
          {history ? <History history={history} /> : <p>…</p>}
        </div>
        <div>
          <NoteForm visitId={id!} onChange={reloadAll} />
          <MedicalInfo patientId={visit.patient.id} current={history?.medicalInfo} onSaved={reloadHistory} />
          <Upload patientId={visit.patient.id} visitId={id!} onDone={reloadHistory} />
        </div>
      </div>
    </>
  );
}

function History({ history }: { history: any }) {
  const m = history.medicalInfo;
  return (
    <>
      <div className="box">
        <h4>Medical info <small>{m.updatedAt ? `updated ${fmtDateTime(m.updatedAt)}` : 'never saved'}</small></h4>
        {MED_FIELDS.map((f) => <div key={f}><b>{f}:</b> {m[f] ?? '-'}</div>)}
      </div>
      <h4>Signed notes ({history.notes.meta.total})</h4>
      {history.notes.items.map((n: any) => (
        <div className="box" key={n.id}>
          <b>{fmtDateTime(n.visit.date)}</b> — {n.visit.service.name} — {n.doctor.name} <small>signed {fmtDateTime(n.signedAt)}</small>
          {NOTE_FIELDS.map((f) => n[f] && <div key={f}><b>{f}:</b> {n[f]}</div>)}
          {n.painScore != null && <div><b>pain:</b> {n.painScore}/10</div>}
          {n.addenda.map((a: any) => <div key={a.id} style={{ marginLeft: 16 }}><i>Addendum by {a.doctor.name}, {fmtDateTime(a.createdAt)}:</i> {a.content}</div>)}
          <AddAddendum noteId={n.id} />
        </div>
      ))}
      <h4>Attachments</h4>
      <ul>
        {history.attachments.map((a: any) => (
          <li key={a.id}>
            <a href="#" onClick={(e) => { e.preventDefault(); openFile(`/attachments/${a.id}/file`); }}>{a.title}</a>{' '}
            <small>{a.mimeType}, {Math.round(a.sizeBytes / 1024)} KB, {fmtDateTime(a.createdAt)}{a.visitId && ', linked to a visit'}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

function AddAddendum({ noteId, onDone }: { noteId: string; onDone?: () => void }) {
  const [content, setContent] = useState('');
  if (getSession()?.user.role !== 'DOCTOR') return null;
  return (
    <div className="inline">
      <input placeholder="addendum" value={content} onChange={(e) => setContent(e.target.value)} />
      <button disabled={!content} onClick={async () => { if (await act(() => post(`/clinical-notes/${noteId}/addenda`, { content }))) { setContent(''); onDone?.(); } }}>add addendum</button>
      <small> (reload to see it)</small>
    </div>
  );
}

function NoteForm({ visitId, onChange }: { visitId: string; onChange: () => void }) {
  // 404 = no note yet (or someone else's draft — the API doesn't say which).
  const [note, reload] = useLoad(
    () => get(`/visits/${visitId}/note`, { quiet404: true }).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
    [visitId],
  );
  const empty = { chiefComplaint: '', assessment: '', treatmentDone: '', progress: '', plan: '', painScore: '' };
  const [v, setV] = useState<Record<string, string>>(empty);
  useEffect(() => {
    if (note) setV(Object.fromEntries(Object.keys(empty).map((k) => [k, note[k] == null ? '' : String(note[k])])));
  }, [note]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({
    ...Object.fromEntries(NOTE_FIELDS.map((f) => [f, orNull(v[f])])),
    painScore: v.painScore === '' ? null : Number(v.painScore),
  });
  const save = () => (note ? patch(`/visits/${visitId}/note`, body()) : post(`/visits/${visitId}/note`, body()));
  const done = () => { reload(); onChange(); };
  const signed = note?.status === 'SIGNED';

  return (
    <div className="box">
      <h3>Session note <small>{note ? `${note.status}${note.signedAt ? ' ' + fmtDateTime(note.signedAt) : ''}` : 'none yet'}</small></h3>
      {NOTE_FIELDS.map((f) => (
        <label key={f}>{f}<textarea rows={2} disabled={signed} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} /></label>
      ))}
      <label>painScore (0-10)<input type="number" min={0} max={10} disabled={signed} value={v.painScore} onChange={(e) => setV({ ...v, painScore: e.target.value })} /></label>
      {!signed && (
        <div className="inline">
          <button onClick={() => act(save).then(done)}>Save draft</button>
          <button onClick={() => act(async () => { await save(); await post(`/visits/${visitId}/note/sign`); }).then(done)}>Save + sign</button>
        </div>
      )}
      {signed && (
        <>
          {note.addenda.map((a: any) => <div key={a.id}><i>Addendum by {a.doctor.name}, {fmtDateTime(a.createdAt)}:</i> {a.content}</div>)}
          <AddAddendum noteId={note.id} onDone={done} />
        </>
      )}
    </div>
  );
}

function MedicalInfo({ patientId, current, onSaved }: { patientId: string; current: any; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  // PUT replaces the record: start from the current values and send every field back.
  const start = () => { setV(Object.fromEntries(MED_FIELDS.map((f) => [f, current?.[f] ?? '']))); setEditing(true); };
  if (getSession()?.user.role !== 'DOCTOR') return null;
  return (
    <div className="box">
      <h4>Medical info</h4>
      {!editing ? <button style={{ width: 'auto' }} onClick={start} disabled={!current}>Edit medical info</button> : (
        <>
          {MED_FIELDS.map((f) => <label key={f}>{f}<textarea rows={2} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} /></label>)}
          <div className="inline">
            <button onClick={async () => {
              if (await act(() => put(`/patients/${patientId}/medical-info`, Object.fromEntries(MED_FIELDS.map((f) => [f, orNull(v[f])]))))) { setEditing(false); onSaved(); }
            }}>Save</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Upload({ patientId, visitId, onDone }: { patientId: string; visitId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState(true);
  return (
    <div className="box">
      <h4>Upload attachment (JPG/PNG/WEBP/PDF ≤ 5 MB)</h4>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input placeholder="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label><input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> link to this visit</label>
      <button disabled={!file || !title} onClick={async () => {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('title', title);
        if (link) fd.append('visitId', visitId);
        if (await act(() => post(`/patients/${patientId}/attachments`, fd))) { setTitle(''); onDone(); }
      }}>Upload</button>
    </div>
  );
}
