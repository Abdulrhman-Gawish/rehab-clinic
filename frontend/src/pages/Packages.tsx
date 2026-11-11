import { useState, type FormEvent } from 'react';
import { act, del, get, patch, post, qs, showError } from '../api';
import { doctorBody, DoctorPicker, type DoctorChoice } from '../components';
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '../format';
import { useI18n } from '../i18n';
import { useForm, useLoad } from '../util';
import {
  ActiveBadge, Badge, Button, Card, CellText, confirmAction, Dialog, EmptyState, Field, IconButton, Input,
  Loading, NumberInput, Segmented, Select, Switch, Table,
} from '../ui';
import '../styles/areas/owner.css';

const EMPTY = {
  name: '', serviceId: '', sessionsCount: '10', price: '', isPublic: true,
  offerType: '', offerValue: '', offerStartsOn: '', offerEndsOn: '',
};

/**
 * Owner: package catalog, shown under the services. Edit, deactivate (not sold for a while) / activate, and delete
 * for good. Patients who bought a package keep their sessions in every case.
 */
export function Packages({ services }: { services: any[] }) {
  const { t } = useI18n();
  const tp = t.packages;
  const [res, reload] = useLoad(() => get(`/packages${qs({ limit: 100 })}`), []);
  const f = useForm(EMPTY);
  const [docs, setDocs] = useState<DoctorChoice>({ all: true, ids: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    showError(null);
    f.setV(EMPTY);
    setDocs({ all: true, ids: [] });
    setEditingId(null);
    setOpen(true);
  };
  const edit = (p: any) => {
    showError(null);
    setEditingId(p.id);
    setDocs({ all: p.allDoctors, ids: p.doctors.map((d: any) => d.id) });
    f.setV({
      name: p.name, serviceId: p.service.id, sessionsCount: String(p.sessionsCount), price: p.price, isPublic: p.isPublic,
      offerType: p.offer?.type ?? '', offerValue: p.offer?.value ?? '',
      offerStartsOn: p.offer?.startsOn ?? '', offerEndsOn: p.offer?.endsOn ?? '',
    });
    setOpen(true);
  };
  const body = () => ({
    name: f.v.name, serviceId: f.v.serviceId, sessionsCount: Number(f.v.sessionsCount), price: f.v.price, isPublic: f.v.isPublic,
    ...doctorBody(docs),
    offer: f.v.offerType
      ? { type: f.v.offerType, value: f.v.offerValue, startsOn: f.v.offerStartsOn || null, endsOn: f.v.offerEndsOn || null }
      : null,
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await act(() => (editingId ? patch(`/packages/${editingId}`, body()) : post('/packages', body())), tp.saved);
    setSaving(false);
    if (ok) { setOpen(false); setEditingId(null); }
    reload();
  };
  const toggle = (p: any) => act(() => patch(`/packages/${p.id}/${p.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload);
  const remove = async (p: any) => {
    if (!(await confirmAction({ title: tp.deleteTitle, message: tp.confirmDelete(p.name), tone: 'danger', confirmLabel: t.common.delete }))) return;
    await act(() => del(`/packages/${p.id}`), tp.deleted);
    reload();
  };

  const offerValue = (o: any) => (o.type === 'PERCENT' ? fmtPercent(o.value) : fmtMoney(o.value));
  const offerPeriod = (o: any) => tp.offerPeriod(o.startsOn ? fmtDate(o.startsOn) : '…', o.endsOn ? fmtDate(o.endsOn) : '…');
  const rows: any[] = res?.items ?? [];
  const c = tp.col;

  return (
    <>
      <Card
        flush title={tp.title} icon="package" description={tp.subtitle}
        actions={
          <Button variant="secondary" icon="plus" disabled={services.length === 0} title={services.length === 0 ? tp.needsService : undefined} onClick={openNew}>
            {tp.new}
          </Button>
        }
      >
        {!res ? <Loading /> : (
          <Table
            head={<>
              <th>{c.name}</th><th>{c.service}</th><th className="num">{c.sessions}</th><th className="num">{c.price}</th>
              <th>{c.offer}</th><th className="num">{c.selling}</th><th>{c.doctors}</th><th>{c.status}</th>
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
            isEmpty={rows.length === 0}
            empty={<EmptyState compact icon="package" title={tp.empty} text={tp.emptyHint} />}
          >
            {rows.map((p) => (
              <tr key={p.id} className={p.isActive ? undefined : 'is-muted'}>
                <td className="cell-strong">{p.name}</td>
                <td>{p.service.name}</td>
                <td className="num">{fmtNumber(p.sessionsCount)}</td>
                <td className="num">{fmtMoney(p.price)}</td>
                <td>
                  {p.offer ? (
                    <CellText sub={offerPeriod(p.offer)}>
                      <span className="cluster">
                        <span className="tabular">{offerValue(p.offer)}</span>
                        {p.offerActive && <Badge tone="success" dot>{tp.offerActiveBadge}</Badge>}
                      </span>
                    </CellText>
                  ) : <span className="text-muted">{t.common.none}</span>}
                </td>
                <td className="num"><strong>{fmtMoney(p.sellingPrice)}</strong></td>
                <td>
                  {p.allDoctors ? <Badge tone="outline">{tp.allDoctorsShort}</Badge> : (
                    <span className="owner-badges">{p.doctors.map((d: any) => <Badge key={d.id} tone="outline">{d.name}</Badge>)}</span>
                  )}
                </td>
                <td>
                  <span className="owner-badges">
                    <ActiveBadge active={p.isActive} inactiveLabel={t.common.hidden} />
                    <Badge tone={p.isPublic ? 'info' : 'neutral'} icon="globe">{p.isPublic ? tp.isPublic : tp.notPublic}</Badge>
                  </span>
                </td>
                <td className="actions">
                  <div className="row-actions">
                    <Button size="sm" icon="pencil" onClick={() => edit(p)}>{t.common.edit}</Button>
                    <Button size="sm" variant={p.isActive ? 'ghost' : 'secondary'} onClick={() => toggle(p)}>
                      {p.isActive ? t.common.deactivate : t.common.activate}
                    </Button>
                    <IconButton icon="trash" variant="danger" label={`${t.common.delete}: ${p.name}`} onClick={() => remove(p)} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog
        open={open} onClose={() => setOpen(false)} size="lg" title={editingId ? tp.edit : tp.new} description={tp.hint} dismissible={!saving}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button type="submit" form="package-form" variant="primary" icon="check" loading={saving}
            disabled={!f.v.name.trim() || !f.v.serviceId || !f.v.price.trim()}>
            {editingId ? t.common.save : t.common.create}
          </Button>
        </>}
      >
        <form id="package-form" className="stack-lg" onSubmit={save}>
          <div className="form-grid form-grid--2">
            <Field label={tp.namePh}><Input autoFocus {...f.bind('name')} /></Field>
            <Field label={c.service}>
              <Select {...f.bind('serviceId')}>
                <option value="">{tp.pickService}</option>
                {services.map((s: any) => <option key={s.id} value={s.id}>{tp.perSession(s.name, fmtMoney(s.basePrice))}</option>)}
              </Select>
            </Field>
            <Field label={tp.sessionsPh}><NumberInput inputMode="numeric" {...f.bind('sessionsCount')} /></Field>
            <Field label={tp.pricePh}><NumberInput placeholder={tp.pricePlaceholder} {...f.bind('price')} /></Field>
          </div>
          <Switch label={tp.public} checked={f.v.isPublic} onChange={(isPublic) => f.setV({ ...f.v, isPublic })} />
          <Field group label={tp.doctorsLabel}>
            <DoctorPicker value={docs} onChange={setDocs} allLabel={tp.allDoctors} />
          </Field>
          <Field group label={tp.offer}>
            <Segmented
              label={tp.offer} value={f.v.offerType} onChange={(offerType) => f.setV({ ...f.v, offerType })}
              options={[
                { value: '', label: tp.noOffer },
                { value: 'PERCENT', label: t.enums.DiscountType.PERCENT, icon: 'percent' },
                { value: 'FIXED', label: t.enums.DiscountType.FIXED, icon: 'banknote' },
              ]}
            />
          </Field>
          {f.v.offerType && (
            <div className="form-grid form-grid--3">
              <Field label={f.v.offerType === 'PERCENT' ? tp.offerPercentPh : tp.offerFixedPh}>
                <NumberInput {...f.bind('offerValue')} />
              </Field>
              <Field label={tp.offerFrom} optional><Input type="date" {...f.bind('offerStartsOn')} /></Field>
              <Field label={tp.offerTo} optional><Input type="date" {...f.bind('offerEndsOn')} /></Field>
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}
