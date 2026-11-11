import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getSession, qs } from '../api';
import { useDoctors, usePaged } from '../components';
import { fmtDateTime, fmtNumber } from '../format';
import { useI18n } from '../i18n';
import { Badge, Button, ButtonLink, Card, EmptyState, Field, Loading, PageHeader, Person, Select, StatusBadge, Table } from '../ui';

/** ACTIVE visits without a signed note, oldest first. DOCTOR: own; OWNER: all, or one doctor's. */
export function NeedsNote() {
  const { t } = useI18n();
  const tn = t.needsNote;
  const isOwner = getSession()?.user.role === 'OWNER';
  const [doctorId, setDoctorId] = useState('');
  const [doctors] = useDoctors();
  // Another doctor filter is another list: back to page 1.
  const { res, reload, loading, pager } = usePaged(`/clinical-notes/needs-attention${qs({ doctorId: doctorId || undefined })}`, 20);
  const c = tn.col;
  const items: any[] = res?.items ?? [];
  return (
    <>
      <PageHeader
        title={tn.title} description={tn.subtitle}
        badges={res && <Badge tone={res.meta.total ? 'warning' : 'success'}>{tn.count(fmtNumber(res.meta.total))}</Badge>}
        actions={<Button icon="refresh" loading={loading && !!res} onClick={reload}>{t.common.refresh}</Button>}
      />
      <Card flush>
        {isOwner && (
          <div className="card__header">
            <Field label={tn.doctor}>
              <Select dense value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">{t.common.all}</option>
                {doctors?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {!res ? <Loading /> : (<>
          <Table
            head={<>
              <th>{c.visit}</th><th>{c.patient}</th><th>{c.service}</th>{isOwner && <th>{c.doctor}</th>}<th>{c.note}</th>
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
            isEmpty={items.length === 0}
            empty={<EmptyState icon="check-circle" title={tn.allDone} text={tn.allDoneText} />}
          >
            {items.map((v) => (
              <tr key={v.visitId}>
                <td className="nowrap"><Link to={`/visits/${v.visitId}`}>{fmtDateTime(v.visitDate)}</Link></td>
                <td><Person name={v.patient.name} size={32} /></td>
                <td>{v.service.name}</td>
                {isOwner && <td>{v.doctor.name}</td>}
                <td>{v.noteStatus ? <StatusBadge kind="NoteStatus" value={v.noteStatus} /> : <Badge tone="neutral" dot>{tn.noneYet}</Badge>}</td>
                <td className="actions">
                  <ButtonLink size="sm" variant={isOwner ? 'outline' : 'primary'} icon={isOwner ? 'eye' : 'note-pen'} to={`/visits/${v.visitId}`}>
                    {isOwner ? t.common.open : tn.write}
                  </ButtonLink>
                </td>
              </tr>
            ))}
          </Table>
          {pager}
        </>)}
      </Card>
    </>
  );
}
