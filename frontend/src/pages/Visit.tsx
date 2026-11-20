import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { act, get, getSession, post, put } from '../api';
import { TypeBadge, usePaged } from '../components';
import { fmtDateTime, fmtNumber } from '../format';
import { label, useI18n } from '../i18n';
import { NOTE_FIELDS, noteFieldsFor, otherFilledFields, showsAttachments } from '../noteFields';
import {
  Alert, Badge, Button, ButtonLink, Card, Checkbox, confirmAction, cx, DescriptionList, EmptyState, Field, Icon, Input, Loading,
  NumberInput, PageHeader, SectionTitle, StatusBadge, Textarea,
} from '../ui';
import { Ltr, useLoad } from '../util';
import { AttachmentList, MED_FIELDS, MedicalInfoView, NoteView } from './PatientRecords';
import '../styles/areas/billing.css';
import '../styles/areas/desk.css';

export function VisitPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const [visit, reloadVisit] = useLoad(() => get(`/visits/${id}`), [id]);
  const isDoctor = getSession()?.user.role === 'DOCTOR';
  if (!visit) return <Loading />;
  const tv = t.visit;
  return (
    <>
      <PageHeader
        back={{ to: `/patients/${visit.patient.id}`, label: tv.patientFile }}
        title={tv.pageTitle(visit.patient.name)}
        badges={<><TypeBadge type={visit.type} /><StatusBadge kind="VisitStatus" value={visit.status} /></>}
        description={
          <div className="visit-meta">
            <span><Icon name="stethoscope" />{tv.withDoctor(visit.service.name, visit.doctor.name)}</span>
            <span><Icon name="clock" />{tv.attendedAt}: {fmtDateTime(visit.attendedAt)}</span>
            <span><Icon name="user" />{tv.sentInBy}: {visit.attendedBy.name}</span>
            <span><Icon name="phone" /><Ltr>{visit.patient.phone}</Ltr></span>
          </div>
        }
        actions={<>
          {isDoctor && <ButtonLink to="/doctor" icon="stethoscope">{tv.myDay}</ButtonLink>}
          <ButtonLink to="/doctor/needs-note" icon="clipboard-check">{tv.needsNote}</ButtonLink>
        </>}
      />

      <VisitBody visit={visit} visitId={id!} reloadVisit={reloadVisit} />
    </>
  );
}

/**
 * The note, the doctor's forms and the patient's clinical history. Medical info, notes and attachments load on
 * their own, and notes and attachments are paged by the API (a long-treated patient has many sessions).
 */
function VisitBody({ visit, visitId, reloadVisit }: { visit: any; visitId: string; reloadVisit: () => void }) {
  const { t } = useI18n();
  const pid: string = visit.patient.id;
  const [info, reloadInfo] = useLoad(() => get(`/patients/${pid}/medical-info`), [pid]);
  const notes = usePaged(`/patients/${pid}/clinical-notes`, 10);
  const files = usePaged(`/patients/${pid}/attachments`, 10);
  const reloadAll = () => { reloadVisit(); reloadInfo(); notes.reload(); files.reload(); };
  // Only the visit's doctor writes; the OWNER reads everything (drafts too)
  // and may upload attachments, nothing else.
  const isDoctor = getSession()?.user.role === 'DOCTOR';
  const tv = t.visit;
  return (
    <div className="stack-lg">
      {visit.voidedAt && <Alert tone="error" title={tv.voidedTitle}>{tv.voidedBy(visit.voidedBy?.name ?? '', visit.voidReason ?? '')}</Alert>}
      <Alert tone="info">{tv.hint}</Alert>

      <div className="split split--even">
        <div className="stack-lg">
          {isDoctor
            ? <NoteForm visitId={visitId} patientId={pid} type={visit.type} onChange={reloadAll} onFailed={reloadVisit} />
            : <VisitNote visitId={visitId} />}
          <MedicalInfoForm patientId={pid} current={info} onSaved={reloadInfo} />
          <Upload patientId={pid} visitId={visitId} onDone={files.reload} />
        </div>
        <section className="stack" aria-labelledby="clinical-history">
          <SectionTitle><span id="clinical-history" className="cluster"><Icon name="history" />{tv.clinicalHistory}</span></SectionTitle>
          {info && notes.res && files.res ? <History info={info} notes={notes} files={files} /> : <Loading />}
        </section>
      </div>
    </div>
  );
}

/** Read-only note of the visit (the OWNER: signed or draft). */
function VisitNote({ visitId }: { visitId: string }) {
  const { t } = useI18n();
  const [note, , loading] = useLoad(() => get(`/visits/${visitId}/note`), [visitId]);
  return (
    <Card title={t.visit.sessionNote} icon="note-pen" actions={<Badge tone="outline" icon="lock">{t.visit.readOnly}</Badge>}>
      {note ? <NoteView note={note} /> : loading ? <Loading /> : <EmptyState compact icon="note-pen" title={t.visit.noNoteYet} />}
    </Card>
  );
}

type PagedList = ReturnType<typeof usePaged>;

function History({ info, notes, files }: { info: any; notes: PagedList; files: PagedList }) {
  const { t } = useI18n();
  const tv = t.visit;
  const noteItems: any[] = notes.res?.items ?? [];
  const fileItems: any[] = files.res?.items ?? [];
  return (
    <>
      <MedicalInfoView info={info} />
      {/* Doctors get signed notes only; the OWNER also drafts (marked). */}
      <h3 className="section-title">{tv.notes(fmtNumber(notes.res?.meta.total ?? 0))}</h3>
      {noteItems.length === 0 && <EmptyState compact icon="note-pen" title={tv.noNotes} />}
      {noteItems.length > 0 && (
        <div className={cx('stack', notes.loading && 'is-busy')} aria-busy={notes.loading}>
          {noteItems.map((n) => (
            <div key={n.id} className="stack-sm">
              <NoteView note={n} />
              {n.status === 'SIGNED' && <AddAddendum noteId={n.id} onDone={notes.reload} />}
            </div>
          ))}
        </div>
      )}
      {notes.pager}
      <Card title={tv.attachments} icon="paperclip" footer={files.pager}>
        {fileItems.length === 0 ? <EmptyState compact icon="paperclip" title={tv.noAttachments} /> : (
          <div className={cx(files.loading && 'is-busy')} aria-busy={files.loading}>
            <AttachmentList attachments={fileItems} />
          </div>
        )}
      </Card>
    </>
  );
}

function AddAddendum({ noteId, onDone }: { noteId: string; onDone?: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  if (getSession()?.user.role !== 'DOCTOR') return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => post(`/clinical-notes/${noteId}/addenda`, { content }), t.visit.addendumAdded);
    setBusy(false);
    if (ok) { setContent(''); onDone?.(); }
  };
  return (
    <form className="input-group" onSubmit={submit}>
      <Input dense placeholder={t.visit.addendumPh} aria-label={t.visit.addendumPh} value={content} onChange={(e) => setContent(e.target.value)} />
      <Button type="submit" size="sm" icon="plus" loading={busy} disabled={!content.trim()}>{t.visit.addAddendum}</Button>
    </form>
  );
}

/**
 * The visit's doctor writes the note: only the fields of the visit's appointment type (all of them when the type is
 * not set), any time, also after signing (every change is audited). Values written under another type stay visible,
 * read-only. Examination notes also hold the visit's attachments.
 */
function NoteForm({ visitId, patientId, type, onChange, onFailed }: {
  visitId: string; patientId: string; type: string | null; onChange: () => void; onFailed: () => void;
}) {
  const { t } = useI18n();
  const tv = t.visit;
  // null = no note yet. Another doctor's draft is 404 NOTE_NOT_VISIBLE (shown as an error toast).
  const [note, reload] = useLoad(() => get(`/visits/${visitId}/note`), [visitId]);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(NOTE_FIELDS.map((f) => [f, ''])));
  useEffect(() => {
    if (note) setV(Object.fromEntries(NOTE_FIELDS.map((f) => [f, note[f] == null ? '' : String(note[f])])));
  }, [note]);

  const editable = noteFieldsFor(type);
  const textFields = editable.filter((f) => f !== 'painScore');
  const other = note ? otherFilledFields(type, note) : [];
  // Only the type's fields are sent (the API refuses the others). Blank text is sent as is: the API makes it null.
  const body = () => Object.fromEntries(editable.map((f) => [f, f === 'painScore' ? (v.painScore === '' ? null : Number(v.painScore)) : v[f]]));
  // On success everything reloads. On failure the typed text stays; the visit reloads in case reception changed its
  // type meanwhile (NOTE_FIELDS_NOT_IN_TYPE), so the form shows the new type's fields.
  const save = async (send: () => Promise<unknown>, success: string) => {
    if (await act(send, success)) { reload(); onChange(); } else onFailed();
  };
  // PUT creates the draft on the first save and replaces the type's fields after (signed notes stay signed).
  const saveNote = (success: string) => save(() => put(`/visits/${visitId}/note`, body()), success);
  const sign = async () => {
    if (!(await confirmAction({ title: tv.signTitle, message: tv.signMessage, confirmLabel: tv.saveSign, icon: 'check-circle' }))) return;
    await save(() => post(`/visits/${visitId}/note/sign`, body()), tv.signed);
  };
  const signed = note?.status === 'SIGNED';

  return (
    <Card
      title={tv.sessionNote} icon="note-pen"
      description={signed ? `${tv.signedOn(fmtDateTime(note.signedAt))}. ${tv.signedEditHint}` : tv.draftHint}
      actions={<span className="note-card__badges">
        <TypeBadge type={type} />
        {note ? <StatusBadge kind="NoteStatus" value={note.status} /> : <Badge tone="neutral" dot>{tv.noneYet}</Badge>}
      </span>}
      footer={
        <div className="form-actions form-actions--end">
          {signed ? <Button variant="primary" icon="check" onClick={() => saveNote(tv.changesSaved)}>{tv.saveChanges}</Button> : <>
            <Button icon="file" onClick={() => saveNote(tv.draftSaved)}>{tv.saveDraft}</Button>
            <Button variant="primary" icon="check" onClick={sign}>{tv.saveSign}</Button>
          </>}
        </div>
      }
    >
      <div className="stack">
        {!type && <Alert tone="info">{tv.typeNotSetHint}</Alert>}
        {textFields.map((f) => (
          <Field key={f} label={label(t.fields, f)}>
            <Textarea rows={3} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
          </Field>
        ))}
        <Field label={tv.painScore} hint={tv.painHint}>
          <NumberInput inputMode="numeric" type="number" min={0} max={10} step={1} style={{ maxWidth: 160 }}
            value={v.painScore} onChange={(e) => setV({ ...v, painScore: e.target.value })} />
        </Field>
        {other.length > 0 && (
          <section className="note-card__part note-card__part--other">
            <h4 className="note-card__subtitle">{t.records.otherFields}</h4>
            <p className="field__help">{tv.otherFieldsHint}</p>
            <DescriptionList items={other.map((f) => [label(t.fields, f), f === 'painScore' ? t.records.pain(fmtNumber(note.painScore)) : <span className="pre-line">{note[f]}</span>])} />
          </section>
        )}
        {showsAttachments(type) && <NoteAttachments patientId={patientId} visitId={visitId} onUploaded={onChange} />}
        {signed && (
          <>
            {note.addenda.map((a: any) => (
              <div key={a.id} className="note-addendum">
                <span className="note-addendum__by">{t.records.addendumBy(a.doctor.name, fmtDateTime(a.createdAt))}</span>
                {a.content}
              </div>
            ))}
            <p className="field__help">{tv.addendumHint}</p>
            <AddAddendum noteId={note.id} onDone={() => { reload(); onChange(); }} />
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * An examination note's attachments: the patient attachments linked to this visit, and an upload linked to it (the
 * same files, rules and endpoint as the attachment card below).
 */
function NoteAttachments({ patientId, visitId, onUploaded }: { patientId: string; visitId: string; onUploaded: () => void }) {
  const { t } = useI18n();
  const tv = t.visit;
  const files = usePaged(`/patients/${patientId}/attachments?visitId=${visitId}`, 10);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('visitId', visitId);
    setBusy(true);
    const ok = await act(() => post(`/patients/${patientId}/attachments`, fd), tv.uploaded);
    setBusy(false);
    if (ok) { setTitle(''); setFile(null); setFileKey((k) => k + 1); files.reload(); onUploaded(); }
  };
  const items: any[] = files.res?.items ?? [];
  return (
    <section className="note-card__part" aria-labelledby={`note-files-${visitId}`}>
      <h4 id={`note-files-${visitId}`} className="note-card__subtitle">{t.records.noteAttachments}</h4>
      {!files.res ? <Loading /> : items.length > 0 && (
        <div className={cx(files.loading && 'is-busy')} aria-busy={files.loading}><AttachmentList attachments={items} /></div>
      )}
      {files.pager}
      <form className="stack-sm" onSubmit={submit}>
        <Field label={tv.file} hint={tv.noteAttachmentsHint}>
          <Input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={tv.titlePh}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="form-actions">
          <Button type="submit" size="sm" icon="paperclip" loading={busy} disabled={!file || !title.trim()}>{tv.addAttachment}</Button>
        </div>
      </form>
    </section>
  );
}

function MedicalInfoForm({ patientId, current, onSaved }: { patientId: string; current: any; onSaved: () => void }) {
  const { t } = useI18n();
  const tv = t.visit;
  const [v, setV] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  // PUT replaces the record: start from the current values and send every field back.
  const start = () => { setV(Object.fromEntries(MED_FIELDS.map((f) => [f, current?.[f] ?? '']))); setEditing(true); };
  if (getSession()?.user.role !== 'DOCTOR') return null;
  const save = async () => {
    if (await act(() => put(`/patients/${patientId}/medical-info`, Object.fromEntries(MED_FIELDS.map((f) => [f, v[f]]))), tv.medicalSaved)) {
      setEditing(false);
      onSaved();
    }
  };
  return (
    <Card
      title={t.records.medicalInfo} icon="heart-pulse"
      description={editing ? tv.medicalHint : undefined}
      actions={!editing && <Button size="sm" icon="pencil" onClick={start} disabled={!current}>{tv.editMedical}</Button>}
      footer={editing && (
        <div className="form-actions form-actions--end">
          <Button variant="ghost" onClick={() => setEditing(false)}>{t.common.cancel}</Button>
          <Button variant="primary" icon="check" onClick={save}>{t.common.save}</Button>
        </div>
      )}
    >
      {editing && (
        <div className="stack">
          {MED_FIELDS.map((f) => (
            <Field key={f} label={label(t.fields, f)}>
              <Textarea rows={2} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            </Field>
          ))}
        </div>
      )}
    </Card>
  );
}

function Upload({ patientId, visitId, onDone }: { patientId: string; visitId: string; onDone: () => void }) {
  const { t } = useI18n();
  const tv = t.visit;
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    if (link) fd.append('visitId', visitId);
    setBusy(true);
    const ok = await act(() => post(`/patients/${patientId}/attachments`, fd), tv.uploaded);
    setBusy(false);
    if (ok) { setTitle(''); setFile(null); setFileKey((k) => k + 1); onDone(); }
  };
  return (
    <Card title={tv.uploadTitle} icon="upload">
      <form className="stack" onSubmit={submit}>
        <Field label={tv.file} hint={tv.fileHint}>
          <Input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={tv.titlePh}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Checkbox label={tv.linkToVisit} checked={link} onChange={setLink} />
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!file || !title.trim()}>{tv.uploadBtn}</Button>
        </div>
      </form>
    </Card>
  );
}
