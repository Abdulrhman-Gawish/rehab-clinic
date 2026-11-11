import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { act, del, get, patch, post, put, qs, showError } from '../api';
import { Packages } from './Packages';
import { doctorBody, DoctorPicker, type Doctor, type DoctorChoice } from '../components';
import { fmtDateTime, fmtMoney, fmtNumber, fmtWallTime, fmtWeekday } from '../format';
import { useI18n } from '../i18n';
import { localInputToIso } from '../time';
import { Ltr, opt, useForm, useLoad } from '../util';
import {
  ActiveBadge, Alert, ask, Badge, Button, ButtonLink, Card, CellText, confirmAction, cx, Dialog, EmptyState, Field, Icon,
  IconButton, Input, Loading, NumberInput, PageHeader, Person, Segmented, Select, StatusBadge, Switch, Table, Textarea,
} from '../ui';
import '../styles/areas/owner.css';

/** A muted note under a table. */
function Note({ children }: { children: ReactNode }) {
  return <p className="owner-note"><Icon name="info" />{children}</p>;
}

const actionsHead = (text: string) => <th className="actions"><span className="visually-hidden">{text}</span></th>;

// ---------- Users ----------

const EMPTY_USER = { name: '', email: '', phone: '', password: '', role: 'RECEPTIONIST' };

export function Users() {
  const { t } = useI18n();
  const tu = t.users;
  const [res, reload] = useLoad(() => get(`/users${qs({ limit: 100 })}`), []);
  const f = useForm(EMPTY_USER);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openNew = () => { showError(null); f.setV(EMPTY_USER); setOpen(true); };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await act(() => post('/users', { ...f.v, phone: opt(f.v.phone) }), tu.created);
    setSaving(false);
    if (ok) setOpen(false);
    reload();
  };
  const toggle = (u: any) => act(() => patch(`/users/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload);
  const resetPassword = async (u: any) => {
    const v = await ask({
      title: tu.resetTitle(u.name), message: tu.resetMessage, confirmLabel: tu.resetPassword, icon: 'lock',
      fields: [{ name: 'password', label: tu.promptPassword, type: 'password', minLength: 8, hint: tu.passwordHint }],
    });
    if (v) { await act(() => post(`/users/${u.id}/reset-password`, { newPassword: v.password }), tu.passwordReset); reload(); }
  };
  const items: any[] = res?.items ?? [];
  const c = tu.col;

  return (
    <>
      <PageHeader title={tu.title} description={tu.subtitle} actions={<Button variant="primary" icon="user-plus" onClick={openNew}>{tu.add}</Button>} />
      <Card flush>
        {!res ? <Loading /> : (
          <Table
            head={<><th>{c.name}</th><th>{c.email}</th><th>{c.role}</th><th>{c.active}</th><th>{c.lastLogin}</th>{actionsHead(t.ui.actions)}</>}
            isEmpty={items.length === 0} empty={<EmptyState compact icon="id-card" title={tu.empty} />}
          >
            {items.map((u) => (
              <tr key={u.id} className={u.isActive ? undefined : 'is-muted'}>
                <td><Person name={u.name} meta={u.phone ? <Ltr>{u.phone}</Ltr> : undefined} /></td>
                <td><Ltr>{u.email}</Ltr></td>
                <td><StatusBadge kind="UserRole" value={u.role} dot={false} /></td>
                <td><ActiveBadge active={u.isActive} /></td>
                <td className="nowrap">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-muted">{tu.never}</span>}</td>
                <td className="actions">
                  <div className="row-actions">
                    <Button size="sm" icon="lock" onClick={() => resetPassword(u)}>{tu.resetPassword}</Button>
                    <Button size="sm" variant={u.isActive ? 'ghost' : 'secondary'} onClick={() => toggle(u)}>
                      {u.isActive ? t.common.deactivate : t.common.activate}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Note>{tu.doctorsHint}</Note>

      <Dialog
        open={open} onClose={() => setOpen(false)} title={tu.add} dismissible={!saving}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button type="submit" form="user-form" variant="primary" icon="check" loading={saving}
            disabled={!f.v.name.trim() || !f.v.email.trim() || f.v.password.length < 8}>
            {tu.create}
          </Button>
        </>}
      >
        <form id="user-form" className="stack" onSubmit={create}>
          <div className="form-grid form-grid--2">
            <Field label={tu.namePh}><Input autoFocus autoComplete="off" {...f.bind('name')} /></Field>
            <Field label={tu.emailPh}><Input type="email" dir="ltr" autoComplete="off" {...f.bind('email')} /></Field>
            <Field label={tu.phonePh} optional><Input type="tel" dir="ltr" inputMode="tel" {...f.bind('phone')} /></Field>
            <Field label={tu.passwordPh} hint={tu.passwordHint}><Input type="password" dir="ltr" autoComplete="new-password" {...f.bind('password')} /></Field>
          </div>
          <Field group label={tu.roleLabel}>
            <Segmented
              label={tu.roleLabel} value={f.v.role} onChange={(role) => f.setV({ ...f.v, role })}
              options={[
                { value: 'RECEPTIONIST', label: t.enums.UserRole.RECEPTIONIST, icon: 'calendar-days' },
                { value: 'OWNER', label: t.enums.UserRole.OWNER, icon: 'id-card' },
              ]}
            />
          </Field>
          <Note>{tu.doctorsHint}</Note>
        </form>
      </Dialog>
    </>
  );
}

// ---------- Doctors ----------

const EMPTY_DOCTOR = { name: '', email: '', phone: '', password: '', specialty: '', bio: '', isPublic: true };

export function Doctors() {
  const { t } = useI18n();
  const td = t.doctors;
  const [res, reload] = useLoad(() => get<{ items: Doctor[] }>(`/doctors${qs({ limit: 100 })}`), []);
  const f = useForm(EMPTY_DOCTOR);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openNew = () => { showError(null); f.setV(EMPTY_DOCTOR); setOpen(true); };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await act(() => post('/doctors', { ...f.v, phone: opt(f.v.phone), bio: opt(f.v.bio) }), td.created);
    setSaving(false);
    if (ok) setOpen(false);
    reload();
  };
  const toggle = (d: Doctor) => act(() => patch(`/doctors/${d.id}/${d.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload);
  const remove = async (d: Doctor) => {
    if (!(await confirmAction({ title: td.deleteTitle, message: td.confirmDelete(d.name), tone: 'danger', confirmLabel: t.common.delete }))) return;
    await act(() => del(`/doctors/${d.id}`), td.deleted);
    reload();
  };
  const items = res?.items ?? [];
  const c = td.col;

  return (
    <>
      <PageHeader title={td.title} description={td.subtitle} actions={<Button variant="primary" icon="user-plus" onClick={openNew}>{td.add}</Button>} />
      <Card flush>
        {!res ? <Loading /> : (
          <Table
            head={<><th>{c.name}</th><th>{c.email}</th><th>{c.public}</th><th>{c.active}</th><th>{c.services}</th>{actionsHead(t.ui.actions)}</>}
            isEmpty={items.length === 0} empty={<EmptyState compact icon="stethoscope" title={td.empty} />}
          >
            {items.map((d) => (
              <tr key={d.id} className={d.isActive ? undefined : 'is-muted'}>
                <td><Person name={d.name} meta={d.specialty} to={`/owner/doctors/${d.id}`} /></td>
                <td><Ltr>{d.email}</Ltr></td>
                <td><Badge tone={d.isPublic ? 'info' : 'neutral'} icon="globe">{d.isPublic ? td.isPublic : td.notPublic}</Badge></td>
                <td><ActiveBadge active={d.isActive} /></td>
                <td>
                  {d.services.length === 0 ? <span className="text-muted">{td.noServices}</span> : (
                    <span className="owner-badges">
                      {d.services.map((s) => (
                        <Badge key={s.serviceId} tone="outline" title={s.priceOverride ? td.overrideTitle : undefined}>
                          {s.name} · <span className="tabular">{fmtMoney(s.price)}</span>{s.priceOverride ? ' *' : ''}
                        </Badge>
                      ))}
                    </span>
                  )}
                </td>
                <td className="actions">
                  <div className="row-actions">
                    <ButtonLink size="sm" icon="calendar-days" to={`/owner/doctors/${d.id}`}>{td.servicesSchedule}</ButtonLink>
                    <Button size="sm" variant={d.isActive ? 'ghost' : 'secondary'} onClick={() => toggle(d)}>
                      {d.isActive ? t.common.deactivate : t.common.activate}
                    </Button>
                    <IconButton icon="trash" variant="danger" label={`${t.common.delete}: ${d.name}`} onClick={() => remove(d)} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Note>{td.overrideHint}</Note>

      <Dialog
        open={open} onClose={() => setOpen(false)} title={td.add} dismissible={!saving}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button type="submit" form="doctor-form" variant="primary" icon="check" loading={saving}
            disabled={!f.v.name.trim() || !f.v.email.trim() || f.v.password.length < 8 || !f.v.specialty.trim()}>
            {td.create}
          </Button>
        </>}
      >
        <form id="doctor-form" className="stack" onSubmit={create}>
          <div className="form-grid form-grid--2">
            <Field label={t.users.namePh}><Input autoFocus autoComplete="off" {...f.bind('name')} /></Field>
            <Field label={td.specialtyPh}><Input {...f.bind('specialty')} /></Field>
            <Field label={t.users.emailPh}><Input type="email" dir="ltr" autoComplete="off" {...f.bind('email')} /></Field>
            <Field label={t.users.phonePh} optional><Input type="tel" dir="ltr" inputMode="tel" {...f.bind('phone')} /></Field>
            <Field label={t.users.passwordPh} hint={t.users.passwordHint} className="span-all">
              <Input type="password" dir="ltr" autoComplete="new-password" {...f.bind('password')} />
            </Field>
          </div>
          <Field label={td.bioPh} optional><Textarea rows={3} {...f.bind('bio')} /></Field>
          <Switch label={td.public} checked={f.v.isPublic} onChange={(isPublic) => f.setV({ ...f.v, isPublic })} />
        </form>
      </Dialog>
    </>
  );
}

// ---------- One doctor: services, weekly schedule, time off ----------

export function DoctorPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const [doctor, reloadDoctor] = useLoad(() => get<Doctor>(`/doctors/${id}`), [id]);
  const tp = t.doctorPage;
  return (
    <>
      <PageHeader
        back={{ to: '/owner/doctors', label: tp.back }}
        title={doctor?.name ?? t.common.loading}
        badges={doctor && <ActiveBadge active={doctor.isActive} />}
        description={doctor?.specialty}
      />
      {!doctor ? <Loading /> : (
        <div className="stack-lg">
          <DoctorServices doctorId={id!} doctor={doctor} onChange={reloadDoctor} />
          <div className="split split--even">
            <WeeklySchedule doctorId={id!} />
            <TimeOff doctorId={id!} />
          </div>
        </div>
      )}
    </>
  );
}

function DoctorServices({ doctorId, doctor, onChange }: { doctorId: string; doctor: Doctor; onChange: () => void }) {
  const { t } = useI18n();
  const tp = t.doctorPage;
  const [services] = useLoad(() => get(`/clinic-services${qs({ limit: 100 })}`), []);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const assigned = new Map(doctor.services.map((s) => [s.serviceId, s]));
  const save = async (serviceId: string) => {
    const ok = await act(() => put(`/doctors/${doctorId}/services/${serviceId}`, { priceOverride: overrides[serviceId] ? overrides[serviceId] : null }), tp.saved);
    if (ok) setOverrides((old) => { const next = { ...old }; delete next[serviceId]; return next; });
    onChange();
  };
  const unassign = (serviceId: string) => act(() => del(`/doctors/${doctorId}/services/${serviceId}`), tp.saved).then(onChange);
  const items: any[] = services?.items ?? [];
  const c = tp.col;
  return (
    <Card flush title={tp.services} icon="briefcase-medical" description={tp.servicesHint}>
      {!services ? <Loading /> : (
        <Table
          head={<><th>{c.service}</th><th className="num">{c.basePrice}</th><th>{c.assigned}</th><th>{c.override}</th>{actionsHead(t.ui.actions)}</>}
          isEmpty={items.length === 0} empty={<EmptyState compact icon="briefcase-medical" title={t.services.empty} />}
        >
          {items.map((s) => {
            const a = assigned.get(s.id);
            return (
              <tr key={s.id} className={s.isActive ? undefined : 'is-muted'}>
                <td>
                  <span className="cell-strong">{s.name}</span>
                  {!s.isActive && <span className="cell-sub">{tp.inactiveService}</span>}
                </td>
                <td className="num">{fmtMoney(s.basePrice)}</td>
                <td>{a ? <Badge tone="success" icon="check">{tp.assignedYes(fmtMoney(a.price))}</Badge> : <Badge>{tp.notAssigned}</Badge>}</td>
                <td>
                  <NumberInput
                    dense className="owner-override" aria-label={tp.overrideFor(s.name)}
                    placeholder={a?.priceOverride ?? tp.overrideNone} value={overrides[s.id] ?? ''}
                    onChange={(e) => setOverrides({ ...overrides, [s.id]: e.target.value })}
                  />
                </td>
                <td className="actions">
                  <div className="row-actions">
                    <Button size="sm" variant={a ? 'outline' : 'secondary'} icon={a ? 'check' : 'plus'} onClick={() => save(s.id)}>
                      {a ? tp.update : tp.assign}
                    </Button>
                    {a && <Button size="sm" variant="ghost" onClick={() => unassign(s.id)}>{tp.unassign}</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

const WEEK = [0, 1, 2, 3, 4, 5, 6];

function WeeklySchedule({ doctorId }: { doctorId: string }) {
  const { t } = useI18n();
  const tp = t.doctorPage;
  const [schedules, reload] = useLoad(() => get<any[]>(`/doctors/${doctorId}/schedules?includeInactive=true`), [doctorId]);
  const sf = useForm({ dayOfWeek: '0', startTime: '10:00', endTime: '14:00' });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await act(() => post(`/doctors/${doctorId}/schedules`, { ...sf.v, dayOfWeek: Number(sf.v.dayOfWeek) }), tp.rangeAdded);
    reload();
  };
  const toggle = (s: any) =>
    act(() => patch(`/doctors/${doctorId}/schedules/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload);
  const sorted = (schedules ?? []).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

  return (
    <Card title={tp.schedule} icon="calendar-days" description={tp.scheduleHint}>
      {!schedules ? <Loading /> : (
        <>
          {sorted.length === 0 && <EmptyState compact icon="clock" title={tp.noSchedule} />}
          {sorted.length > 0 && (
            <ul className="owner-week" role="list">
              {WEEK.map((day) => {
                const ranges = sorted.filter((s) => s.dayOfWeek === day);
                return (
                  <li key={day}>
                    <span className="owner-week__day">{fmtWeekday(day)}</span>
                    <span className="owner-week__ranges">
                      {ranges.length === 0 && <span className="text-muted text-body-sm">{tp.notWorking}</span>}
                      {ranges.map((s) => (
                        <span key={s.id} className={cx('owner-slot', !s.isActive && 'is-inactive')}>
                          <bdi dir="ltr">{fmtWallTime(s.startTime)}–{fmtWallTime(s.endTime)}</bdi>
                          <IconButton
                            icon={s.isActive ? 'ban' : 'refresh'} onClick={() => toggle(s)}
                            label={`${s.isActive ? t.common.deactivate : t.common.activate}: ${fmtWeekday(day)} ${fmtWallTime(s.startTime)}–${fmtWallTime(s.endTime)}`}
                          />
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <form className="card__footer owner-inline-form" onSubmit={add}>
            <Field label={t.fields.dayOfWeek}>
              <Select {...sf.bind('dayOfWeek')}>{WEEK.map((d) => <option key={d} value={d}>{fmtWeekday(d)}</option>)}</Select>
            </Field>
            <Field label={t.fields.startTime}><Input type="time" {...sf.bind('startTime')} /></Field>
            <Field label={t.fields.endTime}><Input type="time" {...sf.bind('endTime')} /></Field>
            <div className="owner-submit"><Button type="submit" variant="secondary" icon="plus">{tp.addRange}</Button></div>
          </form>
        </>
      )}
    </Card>
  );
}

function TimeOff({ doctorId }: { doctorId: string }) {
  const { t } = useI18n();
  const tp = t.doctorPage;
  const [timeOff, reload] = useLoad(() => get<any[]>(`/doctors/${doctorId}/time-off`), [doctorId]);
  const tf = useForm({ startAt: '', endAt: '', reason: '' });
  const [conflicts, setConflicts] = useState<any[]>([]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(async () => {
      const r = await post(`/doctors/${doctorId}/time-off`, { startAt: localInputToIso(tf.v.startAt), endAt: localInputToIso(tf.v.endAt), reason: opt(tf.v.reason) });
      setConflicts(r.conflictingAppointments);
    }, tp.timeOffAdded);
    if (ok) tf.setV({ startAt: '', endAt: '', reason: '' });
    reload();
  };
  const remove = async (o: any) => {
    const range = t.common.range(fmtDateTime(o.startAt), fmtDateTime(o.endAt));
    if (!(await confirmAction({ title: tp.deleteTimeOff, message: tp.confirmDeleteTimeOff(range), tone: 'danger', confirmLabel: t.common.delete }))) return;
    await act(() => del(`/doctors/${doctorId}/time-off/${o.id}`), tp.timeOffDeleted);
    reload();
  };
  const items = timeOff ?? [];

  return (
    <Card title={tp.timeOff} icon="calendar" description={tp.timeOffHint}>
      <div className="stack">
        {conflicts.length > 0 && (
          <Alert tone="warning" title={tp.overlapping}>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id ?? c.referenceCode}>
                  <Ltr>{c.referenceCode}</Ltr> · {c.patientName} · {fmtDateTime(c.startAt)} · <StatusBadge kind="AppointmentStatus" value={c.status} />
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {!timeOff ? <Loading /> : items.length === 0 ? <EmptyState compact icon="calendar" title={tp.noTimeOff} /> : (
          <div className="table-card">
            <Table dense head={<><th>{tp.col2.period}</th><th>{tp.col2.reason}</th>{actionsHead(t.ui.actions)}</>}>
              {items.map((o) => (
                <tr key={o.id}>
                  <td><CellText sub={fmtDateTime(o.endAt)}>{fmtDateTime(o.startAt)}</CellText></td>
                  <td>{o.reason ?? <span className="text-muted">{t.common.none}</span>}</td>
                  <td className="actions"><IconButton icon="trash" variant="danger" label={tp.deleteTimeOff} onClick={() => remove(o)} /></td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </div>
      <form className="card__footer owner-inline-form" onSubmit={add}>
        <Field label={t.common.from}><Input type="datetime-local" {...tf.bind('startAt')} /></Field>
        <Field label={t.common.to}><Input type="datetime-local" {...tf.bind('endAt')} /></Field>
        <Field label={tp.reasonPh} optional><Input {...tf.bind('reason')} /></Field>
        <div className="owner-submit">
          <Button type="submit" variant="secondary" icon="plus" disabled={!tf.v.startAt || !tf.v.endAt}>{tp.addTimeOff}</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------- Services (+ packages underneath) ----------

const EMPTY_SERVICE = { name: '', description: '', durationMinutes: '30', basePrice: '' };

/**
 * Services, with their packages underneath. Deactivate hides a service for a while (not bookable, not public) and
 * activate brings it back; delete removes it for good (DELETE /clinic-services/:id).
 */
export function Services() {
  const { t } = useI18n();
  const ts = t.services;
  const [res, reload] = useLoad(() => get(`/clinic-services${qs({ limit: 100 })}`), []);
  const f = useForm(EMPTY_SERVICE);
  const [docs, setDocs] = useState<DoctorChoice>({ all: false, ids: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    showError(null);
    f.setV(EMPTY_SERVICE);
    setDocs({ all: false, ids: [] });
    setEditingId(null);
    setOpen(true);
  };
  const edit = (s: any) => {
    showError(null);
    setEditingId(s.id);
    f.setV({ name: s.name, description: s.description ?? '', durationMinutes: String(s.durationMinutes), basePrice: s.basePrice });
    setDocs({ all: false, ids: s.doctors.map((d: any) => d.id) });
    setOpen(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.v.name, durationMinutes: Number(f.v.durationMinutes), basePrice: f.v.basePrice,
      // On edit the doctor list is always sent (it replaces the current one); on create only when chosen.
      ...(editingId || docs.all || docs.ids.length ? doctorBody(docs) : {}),
    };
    setSaving(true);
    const ok = await act(() => (editingId
      ? patch(`/clinic-services/${editingId}`, { ...body, description: f.v.description.trim() || null })
      : post('/clinic-services', { ...body, description: opt(f.v.description) })), ts.saved);
    setSaving(false);
    if (ok) { setOpen(false); setEditingId(null); }
    reload();
  };
  const toggle = (s: any) => act(() => patch(`/clinic-services/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`), t.ui.saved).then(reload);
  const remove = async (s: any) => {
    if (!(await confirmAction({ title: ts.deleteTitle, message: ts.confirmDelete(s.name), tone: 'danger', confirmLabel: t.common.delete }))) return;
    await act(() => del(`/clinic-services/${s.id}`), ts.deleted);
    reload();
  };
  const rows: any[] = res?.items ?? [];
  const c = ts.col;

  return (
    <>
      <PageHeader title={t.nav.services} description={ts.subtitle} />
      <div className="stack-lg">
        <Card
          flush title={ts.title} icon="briefcase-medical" description={ts.footnote}
          actions={<Button variant="primary" icon="plus" onClick={openNew}>{ts.new}</Button>}
        >
          {!res ? <Loading /> : (
            <Table
              head={<><th>{c.name}</th><th className="num">{c.duration}</th><th className="num">{c.basePrice}</th><th>{c.doctors}</th><th>{c.status}</th>{actionsHead(t.ui.actions)}</>}
              isEmpty={rows.length === 0}
              empty={<EmptyState compact icon="briefcase-medical" title={ts.empty} text={ts.emptyHint} action={<Button variant="primary" icon="plus" onClick={openNew}>{ts.new}</Button>} />}
            >
              {rows.map((s) => (
                <tr key={s.id} className={s.isActive ? undefined : 'is-muted'}>
                  <td><CellText sub={s.description}><span className="cell-strong">{s.name}</span></CellText></td>
                  <td className="num">{t.common.minutes(fmtNumber(s.durationMinutes))}</td>
                  <td className="num">{fmtMoney(s.basePrice)}</td>
                  <td>
                    {s.doctors.length === 0 ? <span className="text-muted">{ts.noDoctors}</span> : (
                      <span className="owner-badges">{s.doctors.map((d: any) => <Badge key={d.id} tone="outline">{d.name}</Badge>)}</span>
                    )}
                  </td>
                  <td><ActiveBadge active={s.isActive} inactiveLabel={t.common.hidden} /></td>
                  <td className="actions">
                    <div className="row-actions">
                      <Button size="sm" icon="pencil" onClick={() => edit(s)}>{t.common.edit}</Button>
                      <Button size="sm" variant={s.isActive ? 'ghost' : 'secondary'} onClick={() => toggle(s)}>
                        {s.isActive ? t.common.deactivate : t.common.activate}
                      </Button>
                      <IconButton icon="trash" variant="danger" label={`${t.common.delete}: ${s.name}`} onClick={() => remove(s)} />
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Packages services={rows.filter((s) => s.isActive)} />
      </div>

      <Dialog
        open={open} onClose={() => setOpen(false)} title={editingId ? ts.edit : ts.new} description={ts.hint} dismissible={!saving}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button type="submit" form="service-form" variant="primary" icon="check" loading={saving}
            disabled={!f.v.name.trim() || !f.v.durationMinutes.trim() || !f.v.basePrice.trim()}>
            {editingId ? t.common.save : t.common.create}
          </Button>
        </>}
      >
        <form id="service-form" className="stack-lg" onSubmit={save}>
          <Field label={ts.namePh}><Input autoFocus {...f.bind('name')} /></Field>
          <Field label={ts.descriptionPh} optional><Textarea rows={2} {...f.bind('description')} /></Field>
          <div className="form-grid form-grid--2">
            <Field label={ts.durationPh}><NumberInput inputMode="numeric" {...f.bind('durationMinutes')} /></Field>
            <Field label={ts.pricePh}><NumberInput placeholder={ts.pricePlaceholder} {...f.bind('basePrice')} /></Field>
          </div>
          <Field group label={ts.doctorsLabel}>
            <DoctorPicker value={docs} onChange={setDocs} allLabel={ts.allDoctors} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
