// OWNER: the clinic's employees (not doctors), each paid a fixed monthly salary (set and paid in Salaries). A login
// account is optional: an employee can be linked to an OWNER or RECEPTIONIST account, never a doctor's.
import { useState, type FormEvent } from 'react';
import { act, get, patch, post, put, qs } from '../api';
import { usePaged, type Page } from '../components';
import { fmtMoney, fmtMonth } from '../format';
import { label, useI18n } from '../i18n';
import { todayCairo } from '../time';
import {
  ActiveBadge, Alert, Badge, Button, ButtonLink, Card, CellText, Checkbox, Dialog, EmptyState, Field, Input, Loading,
  NumberInput, PageHeader, Person, SearchInput, Select, Table, Textarea,
} from '../ui';
import { Ltr, opt, useLoad } from '../util';
import '../styles/areas/owner.css';

interface SalaryVersion { effectiveMonth: string; fixedSalary: string }
interface Employee {
  id: string; name: string; jobTitle: string; phone: string | null; notes: string | null; isActive: boolean;
  user: { id: string; name: string; email: string; role: string; isActive: boolean } | null;
  currentSalary: SalaryVersion | null; upcomingSalary: SalaryVersion | null;
}
interface UserRow { id: string; name: string; email: string; role: string; isActive: boolean }

const thisMonth = () => todayCairo().slice(0, 7);
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function Employees() {
  const { t } = useI18n();
  const te = t.employees;
  const c = te.col;
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  // A new search starts again on page 1 (usePaged).
  const { res, reload, pager } = usePaged<Page<Employee>>(`/employees${qs({ search })}`);
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [leaving, setLeaving] = useState<Employee | null>(null);
  const rows = res?.items ?? [];
  const none = <span className="text-muted">{t.common.none}</span>;
  const activate = (e: Employee) => act(() => patch(`/employees/${e.id}/activate`), t.ui.saved).then(reload);

  return (
    <>
      <PageHeader
        title={te.title} description={te.subtitle}
        actions={<Button variant="primary" icon="user-plus" onClick={() => setEditing('new')}>{te.add}</Button>}
      />
      <Card flush>
        <div className="staff-toolbar">
          <form role="search" className="input-group" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
            <SearchInput placeholder={te.searchPh} aria-label={te.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit">{t.common.search}</Button>
          </form>
        </div>
        {!res ? <Loading /> : (
          <Table
            head={<>
              <th>{c.name}</th><th>{c.phone}</th><th>{c.login}</th><th className="num">{c.salary}</th><th>{c.status}</th>
              <th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
            </>}
            isEmpty={rows.length === 0}
            empty={search
              ? <EmptyState compact icon="search" title={t.ui.noResults} text={t.ui.noResultsHint} />
              : <EmptyState icon="briefcase-medical" title={te.none} text={te.noneHint}
                  action={<Button variant="primary" icon="user-plus" onClick={() => setEditing('new')}>{te.add}</Button>} />}
          >
            {rows.map((e) => (
              <tr key={e.id} className={e.isActive ? undefined : 'is-muted'}>
                <td><Person name={e.name} meta={e.jobTitle} /></td>
                <td>{e.phone ? <Ltr>{e.phone}</Ltr> : none}</td>
                <td>
                  {e.user
                    ? <CellText sub={label(t.enums.UserRole, e.user.role)}><Ltr>{e.user.email}</Ltr></CellText>
                    : <span className="text-muted">{te.noLogin}</span>}
                </td>
                <td className="num">
                  <CellText sub={e.upcomingSalary && te.upcoming(fmtMoney(e.upcomingSalary.fixedSalary), fmtMonth(e.upcomingSalary.effectiveMonth))}>
                    {e.currentSalary ? <strong>{fmtMoney(e.currentSalary.fixedSalary)}</strong> : <Badge tone="warning">{t.salaries.noSalary}</Badge>}
                  </CellText>
                </td>
                <td><ActiveBadge active={e.isActive} /></td>
                <td className="actions">
                  <div className="row-actions">
                    <Button size="sm" icon="pencil" onClick={() => setEditing(e)}>{te.edit}</Button>
                    <ButtonLink size="sm" icon="wallet" to={`/owner/salaries${qs({ staff: 'employees', employee: e.id })}`}>{te.salaryLink}</ButtonLink>
                    {e.isActive
                      ? <Button size="sm" variant="ghost" onClick={() => setLeaving(e)}>{t.common.deactivate}</Button>
                      : <Button size="sm" variant="secondary" onClick={() => activate(e)}>{t.common.activate}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {pager}
      </Card>
      {editing && (
        <EmployeeDialog
          employee={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {leaving && <DeactivateDialog employee={leaving} onClose={() => setLeaving(null)} onDone={() => { setLeaving(null); reload(); }} />}
    </>
  );
}

/** Add (with an optional first salary) or edit an employee; the login account is optional. */
function EmployeeDialog({ employee, onClose, onSaved }: { employee?: Employee; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const te = t.employees;
  const [f, setF] = useState({
    name: employee?.name ?? '', jobTitle: employee?.jobTitle ?? '', phone: employee?.phone ?? '', notes: employee?.notes ?? '',
    userId: employee?.user?.id ?? '', fixedSalary: '', salaryFrom: thisMonth(),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);
  // Accounts that can be linked (never a doctor's), and who already has which (the API refuses a taken one too).
  const [users] = useLoad(() => get<Page<UserRow>>(`/users${qs({ limit: 100 })}`), []);
  const [all] = useLoad(() => get<Page<Employee>>(`/employees${qs({ limit: 100 })}`), []);
  const takenBy = new Map((all?.items ?? []).filter((e) => e.user && e.id !== employee?.id).map((e) => [e.user!.id, e.name]));
  const accounts = (users?.items ?? []).filter((u) => u.role !== 'DOCTOR');
  const salary = f.fixedSalary.trim();
  const salaryValid = salary === '' || (Number(salary) >= 0 && isMonth(f.salaryFrom));
  const valid = f.name.trim().length >= 2 && f.jobTitle.trim().length >= 2 && salaryValid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    const ok = await act(() => (employee
      ? patch(`/employees/${employee.id}`, {
        name: f.name, jobTitle: f.jobTitle, phone: f.phone.trim() || null, notes: f.notes, userId: f.userId || null,
      })
      : post('/employees', {
        name: f.name, jobTitle: f.jobTitle, phone: opt(f.phone), notes: opt(f.notes), userId: f.userId || undefined,
        salary: salary ? { effectiveMonth: f.salaryFrom, fixedSalary: Number(salary).toFixed(2) } : undefined,
      })), employee ? te.saved : te.created);
    setBusy(false);
    if (ok) onSaved();
  };

  return (
    <Dialog
      open onClose={onClose} size="lg" title={employee ? te.editTitle : te.newTitle} description={employee ? employee.name : te.subtitle}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button type="submit" form="employee-form" variant="primary" icon="check" loading={busy} disabled={!valid}>
          {employee ? t.common.save : t.common.create}
        </Button>
      </>}
    >
      <form id="employee-form" className="stack-lg" onSubmit={submit}>
        <div className="form-grid form-grid--2">
          <Field label={te.name}><Input required autoFocus autoComplete="off" value={f.name} onChange={set('name')} /></Field>
          <Field label={te.jobTitle}>
            <Input required list="employee-job-titles" autoComplete="off" value={f.jobTitle} onChange={set('jobTitle')} />
            <datalist id="employee-job-titles">{te.jobTitles.map((j) => <option key={j} value={j} />)}</datalist>
          </Field>
          <Field label={te.phone} optional><Input dir="ltr" inputMode="tel" autoComplete="off" value={f.phone} onChange={set('phone')} /></Field>
          <Field label={te.login} optional hint={te.loginHint}>
            <Select value={f.userId} onChange={set('userId')}>
              <option value="">{te.noLogin}</option>
              {accounts.map((u) => {
                const owner = takenBy.get(u.id);
                return (
                  <option key={u.id} value={u.id} disabled={!!owner}>
                    {`${u.name} · ${label(t.enums.UserRole, u.role)}${owner ? ` (${te.takenBy(owner)})` : ''}`}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label={te.notes} optional className="span-all"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {!employee && (
          <section>
            <h3 className="section-title">{te.firstSalary}</h3>
            <div className="form-grid form-grid--2">
              <Field label={t.salaries.amount} optional hint={te.firstSalaryHint}>
                <NumberInput value={f.fixedSalary} onChange={set('fixedSalary')} />
              </Field>
              <Field label={te.salaryFrom}>
                <Input type="month" value={f.salaryFrom} onChange={set('salaryFrom')} disabled={!salary} />
              </Field>
            </div>
          </section>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Deactivate an employee who left. Deactivating is a status only; the salary is stopped (0 from a month on) only if
 * the owner keeps "Also stop the salary" checked: it is a new salary version, so earlier months stay owed.
 */
function DeactivateDialog({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const te = t.employees;
  const paid = (v: SalaryVersion | null) => !!v && Number(v.fixedSalary) > 0;
  const [stop, setStop] = useState(paid(employee.currentSalary) || paid(employee.upcomingSalary));
  const [from, setFrom] = useState(addMonths(thisMonth(), 1));
  const [busy, setBusy] = useState(false);
  const upcoming = employee.upcomingSalary;
  const laterRaise = stop && upcoming && paid(upcoming) && upcoming.effectiveMonth > from;
  const valid = !stop || isMonth(from);

  const confirm = async () => {
    setBusy(true);
    const ok = await act(async () => {
      if (stop) await put(`/employees/${employee.id}/salary/terms`, { effectiveMonth: from, fixedSalary: '0.00' });
      await patch(`/employees/${employee.id}/deactivate`);
    }, te.deactivated);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <Dialog
      open onClose={onClose} title={te.deactivateTitle(employee.name)} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="danger" icon="ban" loading={busy} disabled={!valid} onClick={confirm}>{t.common.deactivate}</Button>
      </>}
    >
      <div className="stack">
        <p>{te.deactivateMessage}</p>
        <Checkbox label={te.stopSalary} checked={stop} onChange={setStop} />
        {stop && (
          <Field label={te.stopSalaryFrom} hint={te.stopSalaryHint}>
            <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        )}
        {laterRaise && (
          <Alert tone="warning">{te.upcomingWarning(fmtMoney(upcoming.fixedSalary), fmtMonth(upcoming.effectiveMonth))}</Alert>
        )}
      </div>
    </Dialog>
  );
}
