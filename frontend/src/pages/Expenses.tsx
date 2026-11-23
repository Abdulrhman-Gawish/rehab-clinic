import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { act, get, getSession, openFile, PAYMENT_METHODS, post, qs } from '../api';
import { usePaged, type Page } from '../components';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../format';
import { label, useI18n } from '../i18n';
import { todayCairo, addDays } from '../time';
import {
  askReason, Badge, Button, Card, CellText, Dialog, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader,
  Segmented, Select, Stat, StatusBadge, Table, type IconName,
} from '../ui';
import { Ltr, opt, useForm, useLoad } from '../util';
import '../styles/areas/billing.css';

const METHOD_ICONS: Record<string, IconName> = { CASH: 'banknote', CARD: 'credit-card', WALLET: 'wallet', INSTAPAY: 'phone' };
// GET /expenses?source=: regular expenses, or the payouts to referring doctors (an expense each).
const SOURCES = ['ALL', 'MANUAL', 'REFERRAL_PAYOUT'] as const;
type Source = (typeof SOURCES)[number];

export function Expenses() {
  const { t } = useI18n();
  const te = t.expenses;
  const isOwner = getSession()?.user.role === 'OWNER';
  const [range, setRange] = useState({ from: addDays(todayCairo(), -7), to: todayCairo() });
  const [source, setSource] = useState<Source>('ALL');
  const [method, setMethod] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const commissions = source === 'REFERRAL_PAYOUT';
  const [cats] = useLoad(() => get<any[]>('/expense-categories'), []);
  const [doctors] = useLoad(
    () => (commissions ? get<Page>('/referring-doctors?limit=100') : Promise.resolve(undefined)),
    [commissions],
  );
  const query = qs({
    ...range, source: commissions || source === 'MANUAL' ? source : undefined, method,
    referringDoctorId: commissions ? doctorId : undefined,
  });
  // One page of the filters; totalAmount and meta.total cover all pages. Other filters start on page 1.
  const { res: list, reload, loading, pager } = usePaged<Page & { totalAmount: string }>(`/expenses${query}`, 20);
  const f = useForm({ categoryId: '', description: '', amount: '', expenseDate: todayCairo(), paymentMethod: 'CASH', vendorName: '', reference: '' });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await act(async () => {
      const created = await post('/expenses', { ...f.v, vendorName: opt(f.v.vendorName), reference: opt(f.v.reference) });
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await post(`/expenses/${created.id}/receipt`, fd);
      }
      f.setV({ ...f.v, description: '', amount: '', vendorName: '', reference: '' });
      setFile(null);
      setFileKey((k) => k + 1);
    }, te.added);
    // Also after a failed receipt upload: the expense itself was created, so the list must show it.
    reload();
    setSaving(false);
    if (ok) setAdding(false);
  };
  const voidExpense = async (x: any) => {
    const reason = await askReason({ title: te.voidTitle(x.expenseNumber), message: te.voidMessage, tone: 'danger', confirmLabel: te.void, label: te.promptVoid });
    if (reason) await act(() => post(`/expenses/${x.id}/void`, { reason }), te.voided).then(reload);
  };
  const c = te.col;
  const items: any[] = list?.items ?? [];

  return (
    <>
      <PageHeader
        title={te.title} description={te.subtitle}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{te.add}</Button>}
      />

      <div className="stack-lg">
        <div className="split">
          <Card title={t.ui.filters} icon="filter">
            <div className="form-grid form-grid--2">
              <Field label={t.common.from}>
                <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </Field>
              <Field label={t.common.to}>
                <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </Field>
              <Field label={te.typeLabel} group className="span-all">
                <Segmented
                  label={te.typeLabel} value={source} onChange={setSource}
                  options={SOURCES.map((s) => ({ value: s, label: te.types[s], icon: s === 'REFERRAL_PAYOUT' ? 'users' as const : undefined }))}
                />
              </Field>
              <Field label={te.methodFilter}>
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">{te.allMethods}</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(t.enums.PaymentMethod, m)}</option>)}
                </Select>
              </Field>
              {commissions && (
                <Field label={te.doctorFilter}>
                  <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">{te.allDoctors}</option>
                    {doctors?.items.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          </Card>
          <Stat
            tone="highlight" icon="wallet" label={commissions ? te.commissionTotalLabel : te.totalLabel}
            value={list ? fmtMoney(list.totalAmount) : '…'}
            hint={list && te.countHint(fmtNumber(list.meta.total))}
          />
        </div>

        <Card flush>
          {!list && loading ? <Loading /> : (
            <Table
              head={<>
                <th>{c.number}</th><th>{c.date}</th><th>{c.category}</th><th>{c.description}</th><th className="num">{c.amount}</th>
                <th>{c.method}</th><th>{c.status}</th><th>{c.by}</th><th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
              </>}
              isEmpty={items.length === 0}
              empty={<EmptyState icon="wallet" title={te.empty} text={te.emptyHint} />}
            >
              {items.map((x) => {
                const voided = x.status === 'VOIDED';
                const payout = x.referralPayout;
                // A doctor's or employee's salary payment: changed only through the payment (Owner -> Salaries).
                const staffSalary = x.category.systemKey === 'EMPLOYEE_SALARY';
                const salary = x.category.systemKey === 'DOCTOR_SALARY' || staffSalary;
                const system = !!payout || salary;
                const doctor = payout && (isOwner
                  ? <Link to={`/owner/referring-doctors/${payout.referringDoctor.id}`}>{payout.referringDoctor.name}</Link>
                  : payout.referringDoctor.name);
                return (
                  <tr key={x.id} className={voided ? 'is-voided' : undefined}>
                    <td><Ltr>{x.expenseNumber}</Ltr></td>
                    <td className="nowrap">{fmtDate(x.expenseDate)}</td>
                    <td>
                      <CellText
                        sub={payout ? <Badge tone="info" icon="users">{te.commissionBadge}</Badge>
                          : salary && <Badge tone="info" icon={staffSalary ? 'id-card' : 'stethoscope'}>{staffSalary ? te.employeeSalaryBadge : te.salaryBadge}</Badge>}
                      >
                        {x.category.name}
                      </CellText>
                    </td>
                    <td>
                      {/* A payout's expense: labelled in the UI language, with the doctor it was paid to. */}
                      <CellText sub={payout ? payout.notes : !salary && x.vendorName && `${c.vendor}: ${x.vendorName}`}>
                        <span className="is-voidable">
                          {payout ? <>{te.commissionFor} <bdi>{doctor}</bdi></> : salary ? <>{te.salaryFor} <bdi>{x.vendorName}</bdi></> : x.description}
                        </span>
                      </CellText>
                    </td>
                    <td className="num"><span className="is-voidable">{fmtMoney(x.amount)}</span></td>
                    <td><CellText sub={x.reference && <bdi>{x.reference}</bdi>}>{label(t.enums.PaymentMethod, x.paymentMethod)}</CellText></td>
                    <td>
                      <CellText sub={x.voidReason && te.voidedBy(x.voidedBy?.name ?? '', x.voidReason)}>
                        <StatusBadge kind="ExpenseStatus" value={x.status} />
                      </CellText>
                    </td>
                    <td><CellText sub={fmtDateTime(x.createdAt)}>{x.createdBy.name}</CellText></td>
                    <td className="actions">
                      <div className="row-actions">
                        {x.hasReceipt && <IconButton icon="paperclip" label={te.openReceipt} onClick={() => openFile(`/expenses/${x.id}/receipt`)} />}
                        {x.status === 'VALID' && !system && <Button size="sm" variant="danger-outline" icon="ban" onClick={() => voidExpense(x)}>{te.void}</Button>}
                        {x.status === 'VALID' && system && <Badge tone="neutral" icon="lock" title={salary ? te.fromSalaryHint : te.fromPayoutHint}>{te.viaPayout}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          {pager}
        </Card>
      </div>

      <Dialog
        open={adding} onClose={() => setAdding(false)} title={te.add}
        footer={<>
          <Button variant="ghost" onClick={() => setAdding(false)}>{t.common.cancel}</Button>
          <Button type="submit" form="expense-form" variant="primary" icon="check" loading={saving}>{te.addBtn}</Button>
        </>}
      >
        <form id="expense-form" className="form-grid form-grid--2" onSubmit={add}>
          <Field label={te.category}>
            <Select required {...f.bind('categoryId')}>
              <option value="">{te.pickCategory}</option>
              {/* System categories (doctor commissions) are written by their payouts only. */}
              {cats?.filter((cat) => !cat.systemKey).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </Select>
          </Field>
          <Field label={te.date}>
            <Input type="date" max={todayCairo()} required {...f.bind('expenseDate')} />
          </Field>
          <Field label={te.descriptionPh} className="span-all">
            <Input required {...f.bind('description')} />
          </Field>
          <Field label={te.amountPh}>
            <NumberInput required {...f.bind('amount')} />
          </Field>
          <Field label={te.vendorPh} optional>
            <Input {...f.bind('vendorName')} />
          </Field>
          <Field label={te.method} group className="span-all">
            <Segmented
              label={te.method} value={f.v.paymentMethod} onChange={(paymentMethod) => f.setV({ ...f.v, paymentMethod })}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(t.enums.PaymentMethod, m), icon: METHOD_ICONS[m] }))}
            />
          </Field>
          <Field label={te.referencePh} optional>
            <Input {...f.bind('reference')} />
          </Field>
          <Field label={te.receiptFile} optional hint={te.fileHint}>
            <Input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
