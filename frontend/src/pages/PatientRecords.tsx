// The patient page tabs beyond the overview. Each tab is offered only to the
// roles whose API calls it makes (no buttons or tabs the backend would refuse).
// MedicalInfoView, NoteView and AttachmentList are also used by the visit page; AuditHistory by the referring
// doctor page.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { get, getSession, openFile, qs, type Role } from '../api';
import { usePaged } from '../components';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import {
  Badge, Button, ButtonLink, Card, CellText, cx, DescriptionList, Dialog, EmptyState, Icon, Loading,
  Stat, Stats, StatusBadge, Table, type IconName,
} from '../ui';
import { Ltr, useLoad, Values } from '../util';
import '../styles/areas/desk.css';

const NOTE_FIELDS = ['chiefComplaint', 'assessment', 'treatmentDone', 'progress', 'plan'] as const;
export const MED_FIELDS = ['allergies', 'chronicConditions', 'pastSurgeries', 'currentMedications', 'notes'] as const;

export type Tab =
  | 'overview' | 'personal' | 'appointments' | 'visits' | 'clinical' | 'invoices'
  | 'payments' | 'discounts' | 'packages' | 'acquisition' | 'timeline' | 'audit';

const ALL: Role[] = ['OWNER', 'RECEPTIONIST', 'DOCTOR'];
const DESK: Role[] = ['OWNER', 'RECEPTIONIST'];

// Mirrors the API permissions (backend/README.md, "API overview"), except that the OWNER gets no appointments tab
// (the API still allows it). Labels: t.patients.tabs.
export const TABS: { tab: Tab; roles: Role[] }[] = [
  { tab: 'overview', roles: ALL },
  { tab: 'personal', roles: ALL },
  { tab: 'appointments', roles: ['RECEPTIONIST', 'DOCTOR'] },
  { tab: 'visits', roles: ALL },
  { tab: 'clinical', roles: ['OWNER', 'DOCTOR'] },
  { tab: 'invoices', roles: DESK },
  { tab: 'payments', roles: DESK },
  { tab: 'discounts', roles: DESK },
  { tab: 'packages', roles: ALL },
  { tab: 'acquisition', roles: DESK },
  { tab: 'timeline', roles: ALL },
  { tab: 'audit', roles: ['OWNER'] },
];

/** The visit page reads clinical data: the OWNER any visit, a doctor their own. */
export function canOpenVisit(visit: { doctor: { id: string } }): boolean {
  const user = getSession()?.user;
  return user?.role === 'OWNER' || (user?.role === 'DOCTOR' && user.doctorId === visit.doctor.id);
}

/** A paginated list endpoint as a table card with pagination. `head` holds the <th> cells. */
function Paged({ path, head, row, empty, emptyIcon = 'list', title, description, icon }: {
  path: string; head: ReactNode; row: (item: any) => ReactNode; empty: string; emptyIcon?: IconName;
  title?: ReactNode; description?: ReactNode; icon?: IconName;
}) {
  const { res, pager } = usePaged(path);
  return (
    <Card flush title={title} description={description} icon={icon}>
      {!res ? <Loading /> : (
        <>
          <Table head={head} isEmpty={res.items.length === 0} empty={<EmptyState compact icon={emptyIcon} title={empty} />}>
            {res.items.map(row)}
          </Table>
          {pager}
        </>
      )}
    </Card>
  );
}

const None = () => {
  const { t } = useI18n();
  return <span className="text-muted">{t.common.none}</span>;
};

export function PersonalInfo({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const [p] = useLoad(() => get(`/patients/${patientId}`), [patientId]);
  if (!p) return <Loading />;
  const tp = t.records.personal;
  return (
    <Card title={t.patients.tabs.personal} icon="user">
      <DescriptionList
        columns={2}
        items={[
          [t.fields.name, p.name],
          [t.fields.phone, <Ltr>{p.phone}</Ltr>],
          [tp.dob, p.dateOfBirth ? fmtDate(p.dateOfBirth) : <None />],
          [tp.gender, p.gender ? label(t.enums.Gender, p.gender) : <None />],
          [tp.source, (
            <span className="cluster">
              <StatusBadge kind="PatientSource" value={p.createdSource} />
              <span className="text-muted text-body-sm">{tp.registered(fmtDateTime(p.createdAt))}{p.createdBy && t.common.by(p.createdBy.name)}</span>
            </span>
          )],
          [tp.notes, p.notes ?? <None />],
        ]}
      />
    </Card>
  );
}

export function Appointments({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const [history, setHistory] = useState<{ id: string; ref: string; rows: any[] } | null>(null);
  const showHistory = async (a: any) =>
    setHistory({ id: a.id, ref: a.referenceCode, rows: await get<any[]>(`/appointments/${a.id}/history`) });
  const tr = t.records;
  return (
    <>
      <Paged
        path={`/patients/${patientId}/appointments`}
        title={t.patients.tabs.appointments} description={tr.appointmentsHint} icon="calendar"
        emptyIcon="calendar"
        head={<>
          <th>{tr.acol.start}</th><th>{tr.acol.doctor}</th><th>{tr.acol.service}</th><th>{tr.acol.status}</th>
          <th>{tr.acol.source}</th><th>{tr.acol.ref}</th><th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
        </>}
        empty={tr.noAppointments}
        row={(a) => (
          <tr key={a.id}>
            <td className="nowrap tabular">{fmtDateTime(a.startAt)}</td>
            <td>{a.doctor.name}</td>
            <td>{a.service.name}</td>
            <td><StatusBadge kind="AppointmentStatus" value={a.status} />{a.rescheduledFromId && <span className="cell-sub">{tr.rescheduledSuffix.trim()}</span>}</td>
            <td>{label(t.enums.AppointmentSource, a.source)}</td>
            <td><Ltr>{a.referenceCode}</Ltr></td>
            <td className="actions"><Button size="sm" variant="ghost" icon="history" onClick={() => showHistory(a)}>{tr.statusHistory}</Button></td>
          </tr>
        )}
      />
      <Dialog
        open={!!history} onClose={() => setHistory(null)} size="lg" title={tr.statusHistoryTitle}
        description={history && <Ltr>{history.ref}</Ltr>}
        footer={<Button onClick={() => setHistory(null)}>{t.common.close}</Button>}
      >
        {history && (
          <Table dense head={<><th>{tr.hcol.when}</th><th>{tr.hcol.change}</th><th>{tr.hcol.by}</th><th>{tr.hcol.reason}</th></>}>
            {history.rows.map((h, i) => (
              <tr key={i}>
                <td className="nowrap tabular">{fmtDateTime(h.changedAt)}</td>
                <td>
                  <span className="cluster">
                    {h.fromStatus ? <StatusBadge kind="AppointmentStatus" value={h.fromStatus} dot={false} /> : <None />}
                    <Icon name="arrow-right" size={16} />
                    <StatusBadge kind="AppointmentStatus" value={h.toStatus} dot={false} />
                  </span>
                </td>
                <td>{h.changedBy?.name ?? <em className="text-muted">{t.common.online}</em>}</td>
                <td>{h.reason ?? <None />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Dialog>
    </>
  );
}

export function Visits({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const tr = t.records;
  return (
    <Paged
      path={`/patients/${patientId}/visits`}
      title={t.patients.tabs.visits} icon="stethoscope" emptyIcon="stethoscope"
      head={<>
        <th>{tr.vcol.attended}</th><th>{tr.vcol.doctor}</th><th>{tr.vcol.service}</th><th>{tr.vcol.status}</th>
        <th>{tr.vcol.sentInBy}</th><th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
      </>}
      empty={tr.noVisits}
      row={(v) => (
        <tr key={v.id} className={v.status === 'VOIDED' ? 'is-muted' : undefined}>
          <td className="nowrap tabular"><CellText sub={v.isWalkIn && t.booking.walkIn}>{fmtDateTime(v.attendedAt)}</CellText></td>
          <td>{v.doctor.name}</td>
          <td>{v.service.name}</td>
          <td><StatusBadge kind="VisitStatus" value={v.status} />{v.voidReason && <span className="cell-sub">{v.voidReason}</span>}</td>
          <td>{v.attendedBy.name}</td>
          <td className="actions">{canOpenVisit(v) && <ButtonLink size="sm" variant="ghost" icon="eye" to={`/visits/${v.id}`}>{t.common.open}</ButtonLink>}</td>
        </tr>
      )}
    />
  );
}

/**
 * Medical info, then the notes (the OWNER also gets drafts, read-only) with addenda and the attachments, each paged
 * on its own by the API.
 */
export function Clinical({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const [info] = useLoad(() => get(`/patients/${patientId}/medical-info`), [patientId]);
  const notes = usePaged(`/patients/${patientId}/clinical-notes`, 10);
  const files = usePaged(`/patients/${patientId}/attachments`, 10);
  if (!info || !notes.res || !files.res) return <Loading />;
  const tr = t.records;
  return (
    <div className="stack-lg">
      <MedicalInfoView info={info} />
      <Card title={tr.notesCount(fmtNumber(notes.res.meta.total))} icon="clipboard-check" footer={notes.pager}>
        {notes.res.items.length === 0 ? <EmptyState compact icon="clipboard" title={tr.noNotes} /> : (
          <div className={cx('note-list', notes.loading && 'is-busy')} aria-busy={notes.loading}>
            {notes.res.items.map((n: any) => <NoteView key={n.id} note={n} />)}
          </div>
        )}
      </Card>
      <Card title={tr.attachmentsCount(fmtNumber(files.res.meta.total))} icon="paperclip" footer={files.pager}>
        <div className={cx(files.loading && 'is-busy')} aria-busy={files.loading}>
          <AttachmentList attachments={files.res.items} />
        </div>
      </Card>
    </div>
  );
}

export function MedicalInfoView({ info }: { info: any }) {
  const { t } = useI18n();
  const tr = t.records;
  return (
    <Card
      title={tr.medicalInfo} icon="heart-pulse"
      description={info.updatedAt ? tr.updated(fmtDateTime(info.updatedAt), info.updatedBy?.name ?? '') : tr.neverSaved}
    >
      <DescriptionList columns={2} items={MED_FIELDS.map((f) => [label(t.fields, f), info[f] ?? <None />])} />
    </Card>
  );
}

/** Files of the patient; each opens in a new tab (the request needs the session cookie). */
export function AttachmentList({ attachments }: { attachments: any[] }) {
  const { t } = useI18n();
  if (attachments.length === 0) return <EmptyState compact icon="paperclip" title={t.records.noAttachments} />;
  return (
    <ul className="file-list" role="list">
      {attachments.map((a) => (
        <li key={a.id} className="file-row">
          <span className="file-row__icon"><Icon name={a.mimeType?.startsWith('image/') ? 'image' : 'file-text'} /></span>
          <span className="file-row__text">
            <span className="file-row__title">{a.title}</span>
            <span className="file-row__meta">
              {t.records.attachmentMeta(a.mimeType, fmtNumber(Math.round(a.sizeBytes / 1024)), fmtDateTime(a.createdAt), a.uploadedBy.name)}
              {a.visitId && t.records.linkedToVisit}
            </span>
          </span>
          <Button size="sm" variant="ghost" icon="external-link" onClick={() => openFile(`/attachments/${a.id}/file`)}>{t.common.open}</Button>
        </li>
      ))}
    </ul>
  );
}

/** A note as read-only text (signed, or a draft shown to the OWNER). */
export function NoteView({ note }: { note: any }) {
  const { t } = useI18n();
  const tr = t.records;
  const draft = note.status === 'DRAFT';
  const fields = NOTE_FIELDS.filter((f) => note[f]);
  return (
    <article className={cx('note-card', draft && 'note-card--draft')}>
      <header className="note-card__head">
        <div>
          <span className="note-card__when tabular">{fmtDateTime(note.visit.date)}</span>
          <span className="text-muted text-body-sm"> · {note.visit.service.name} · {note.doctor.name}</span>
        </div>
        {draft ? <Badge tone="warning" dot>{tr.draft}</Badge> : <Badge tone="success" icon="check">{tr.signedAt(fmtDateTime(note.signedAt))}</Badge>}
      </header>
      {(fields.length > 0 || note.painScore != null) && (
        <DescriptionList
          items={[
            ...fields.map((f) => [label(t.fields, f), note[f]] as [ReactNode, ReactNode]),
            note.painScore != null && [t.fields.painScore, tr.pain(fmtNumber(note.painScore))],
          ]}
        />
      )}
      {note.addenda.map((a: any) => (
        <blockquote key={a.id} className="addendum">
          <span className="addendum__by">{tr.addendumBy(a.doctor.name, fmtDateTime(a.createdAt))}</span>
          {a.content}
        </blockquote>
      ))}
    </article>
  );
}

export function Invoices({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const [balance] = useLoad(() => get(`/patients/${patientId}/balance`), [patientId]);
  const tr = t.records;
  return (
    <div className="stack-lg">
      {balance && (
        <Stats>
          <Stat
            icon="wallet" tone={Number(balance.balance) > 0 ? 'warning' : undefined} label={tr.outstanding}
            value={fmtMoney(balance.balance)} hint={tr.outstandingDetail(fmtMoney(balance.totalInvoiced), fmtMoney(balance.totalPaid))}
          />
        </Stats>
      )}
      <Paged
        path={`/patients/${patientId}/invoices`}
        title={t.patients.tabs.invoices} icon="receipt" emptyIcon="receipt"
        head={<>
          <th>{tr.icol.number}</th><th>{tr.icol.issued}</th><th>{tr.icol.status}</th>
          <th className="num">{tr.icol.total}</th><th className="num">{tr.icol.paid}</th><th className="num">{tr.icol.balance}</th>
        </>}
        empty={tr.noInvoices}
        row={(i) => (
          <tr key={i.id} className={i.status === 'CANCELLED' ? 'is-muted' : undefined}>
            <td><Link to={`/reception/invoices/${i.id}`}><Ltr>{i.invoiceNumber}</Ltr></Link></td>
            <td className="nowrap tabular">{fmtDateTime(i.issuedAt)}</td>
            <td><StatusBadge kind="InvoiceStatus" value={i.status} /></td>
            <td className="num">{fmtMoney(i.total)}</td>
            <td className="num">{fmtMoney(i.amountPaid)}</td>
            <td className="num cell-strong">{fmtMoney(i.balance)}</td>
          </tr>
        )}
      />
    </div>
  );
}

export function Payments({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const c = t.records.pcol;
  return (
    <Paged
      path={`/payments${qs({ patientId })}`}
      title={t.patients.tabs.payments} icon="banknote" emptyIcon="banknote"
      head={<>
        <th>{c.receipt}</th><th>{c.received}</th><th>{c.type}</th><th className="num">{c.amount}</th>
        <th>{c.method}</th><th>{c.status}</th><th>{c.by}</th><th>{c.invoice}</th>
      </>}
      empty={t.records.noPayments}
      row={(p) => (
        <tr key={p.id} className={p.status === 'VOIDED' ? 'is-muted' : undefined}>
          <td><Link to={`/reception/receipts/${p.id}`}><Ltr>{p.receiptNumber}</Ltr></Link></td>
          <td className="nowrap tabular">{fmtDateTime(p.receivedAt)}</td>
          <td><StatusBadge kind="PaymentType" value={p.type} dot={false} />{p.reason && <span className="cell-sub">{p.reason}</span>}</td>
          <td className={cx('num', p.status === 'VOIDED' && 'strike')}>{fmtMoney(p.amount)}</td>
          <td>{label(t.enums.PaymentMethod, p.method)}</td>
          <td><StatusBadge kind="PaymentStatus" value={p.status} />{p.voidReason && <span className="cell-sub">{p.voidReason}</span>}</td>
          <td>{p.receivedBy.name}</td>
          <td><Link to={`/reception/invoices/${p.invoice.id}`}><Ltr>{p.invoice.invoiceNumber}</Ltr></Link></td>
        </tr>
      )}
    />
  );
}

export function Discounts({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const tr = t.records;
  return (
    <Paged
      path={`/patients/${patientId}/discounts`}
      title={t.patients.tabs.discounts} icon="percent" emptyIcon="percent"
      head={<>
        <th>{tr.dcol.applied}</th><th>{tr.dcol.invoice}</th><th>{tr.dcol.discount}</th><th className="num">{tr.dcol.amount}</th>
        <th>{tr.dcol.reason}</th><th>{tr.dcol.by}</th><th>{tr.dcol.removed}</th>
      </>}
      empty={tr.noDiscounts}
      row={(d) => (
        <tr key={d.id} className={d.removedAt ? 'is-muted' : undefined}>
          <td className="nowrap tabular">{fmtDateTime(d.appliedAt)}</td>
          <td>
            <Link to={`/reception/invoices/${d.invoiceId}`}><Ltr>{d.invoiceNumber}</Ltr></Link>
            {d.invoiceStatus === 'CANCELLED' && <span className="cell-sub">{tr.cancelledSuffix.trim()}</span>}
          </td>
          <td>{d.type === 'PERCENT' ? fmtPercent(d.value) : fmtMoney(d.value)}</td>
          <td className="num">{fmtMoney(d.amount)}</td>
          <td>{d.reason}</td>
          <td>{d.appliedBy.name}</td>
          <td>
            {d.removedAt
              ? <span className="text-body-sm">{tr.removedBy(fmtDateTime(d.removedAt), d.removedBy?.name ?? '', d.removalReason ?? '')}</span>
              : <Badge tone="success" dot>{tr.discountActive}</Badge>}
          </td>
        </tr>
      )}
    />
  );
}

/** A patient's audit trail (patientId), or one entity's (entityId, e.g. a referring doctor). */
export function AuditHistory({ patientId, entityId }: { patientId?: string; entityId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<any | null>(null);
  const tr = t.records;
  return (
    <>
      <Paged
        path={`/audit-logs${qs({ patientId, entityId })}`}
        title={patientId ? t.patients.tabs.audit : undefined} description={patientId ? tr.auditHint : undefined}
        icon={patientId ? 'history' : undefined} emptyIcon="history"
        head={<>
          <th>{tr.aucol.when}</th><th>{tr.aucol.action}</th><th>{tr.aucol.entity}</th><th>{tr.aucol.by}</th>
          <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
        </>}
        empty={tr.noAudit}
        row={(l) => (
          <tr key={l.id}>
            <td className="nowrap tabular">{fmtDateTime(l.createdAt)}</td>
            <td className="cell-strong">{label(t.enums.AuditAction, l.action)}</td>
            <td>{label(t.enums.AuditEntityType, l.entityType)}</td>
            <td>{l.user?.name ?? <em className="text-muted">{t.common.publicSystem}</em>}</td>
            <td className="actions">
              {(l.oldValues || l.newValues) && <Button size="sm" variant="ghost" icon="eye" onClick={() => setOpen(l)}>{tr.values}</Button>}
            </td>
          </tr>
        )}
      />
      <Dialog
        open={!!open} onClose={() => setOpen(null)} size="lg" title={tr.valuesTitle}
        description={open && `${label(t.enums.AuditAction, open.action)} · ${fmtDateTime(open.createdAt)}${open.user ? t.common.by(open.user.name) : ''}`}
        footer={<Button onClick={() => setOpen(null)}>{t.common.close}</Button>}
      >
        {open && (
          <div className="values-compare">
            <div><h3>{tr.old}</h3>{open.oldValues ? <Values value={open.oldValues} /> : <None />}</div>
            <div><h3>{tr.new}</h3>{open.newValues ? <Values value={open.newValues} /> : <None />}</div>
          </div>
        )}
      </Dialog>
    </>
  );
}
