import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { act, get, getSession, PAYMENT_METHODS, post, qs } from '../api';
import { replaceInvoice, type ReplacementAction } from '../components';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from '../format';
import { label, useI18n } from '../i18n';
import {
  Alert, ask, askReason, Badge, Button, Card, CellText, confirmAction, EmptyState, Field, Input, Loading, NumberInput,
  PageHeader, Segmented, StatusBadge, Table, Totals, TotalsRow, type IconName,
} from '../ui';
import { Ltr, useLoad } from '../util';
import '../styles/areas/billing.css';

// "10%" or an EGP amount.
const discountValue = (d: { type: string; value: string }) =>
  d.type === 'PERCENT' ? fmtPercent(d.value) : fmtMoney(d.value);

const METHOD_ICONS: Record<string, IconName> = { CASH: 'banknote', CARD: 'credit-card', WALLET: 'wallet', INSTAPAY: 'phone' };

export function InvoicePage() {
  const { t } = useI18n();
  const { id } = useParams();
  const nav = useNavigate();
  const isOwner = getSession()?.user.role === 'OWNER';
  const [inv, reload] = useLoad(() => get(`/invoices/${id}`), [id]);
  // The patient's previous discount (this invoice excluded), or null.
  const [last, reloadLast] = useLoad(
    () => (inv ? get(`/patients/${inv.patient.id}/last-discount${qs({ excludeInvoiceId: inv.id })}`) : Promise.resolve(undefined)),
    [inv?.patient.id, inv?.discount?.id],
  );
  // The patient's active doctor referral, to offer covering an invoice issued before it was recorded.
  const [referrals] = useLoad(
    () => (inv && !inv.referral && !inv.isLocked ? get<any[]>(`/patients/${inv.patient.id}/referrals`) : Promise.resolve(undefined)),
    [inv?.patient.id, inv?.referral?.termsId, inv?.isLocked],
  );
  const activeReferral = referrals?.find((r) => r.status === 'ACTIVE');
  const [disc, setDisc] = useState({ type: 'PERCENT', value: '', reason: '' });
  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '' });
  const [paying, setPaying] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    const ok = await act(fn, success);
    reload();
    reloadLast();
    return ok;
  };

  if (!inv) return <Loading />;
  const ti = t.invoice;
  const cancelled = inv.status === 'CANCELLED';
  const settled = Number(inv.balance) <= 0;

  const cancelInvoice = async () => {
    const reason = await askReason({ title: ti.cancelTitle(inv.invoiceNumber), message: ti.cancelMessage, tone: 'danger', confirmLabel: ti.cancelInvoice, label: ti.promptCancel });
    if (reason) await run(() => post(`/invoices/${inv.id}/cancel`, { reason }), ti.invoiceCancelled);
  };
  // Correct invoice / create invoice: on success, open the new invoice; when nothing was replaced, show the latest state.
  const replace = async (action: ReplacementAction) => {
    const replacement = await replaceInvoice(inv.id, action);
    if (replacement) nav(`/reception/invoices/${replacement.id}`);
    else if (replacement === null) { reload(); reloadLast(); }
  };
  const applyReferral = async () => {
    if (await confirmAction({ title: ti.applyReferral, message: ti.confirmApplyReferral, confirmLabel: ti.applyReferral, icon: 'share' })) {
      await run(() => post(`/invoices/${inv.id}/referral`), ti.referralApplied);
    }
  };
  const removeDiscount = async () => {
    const reason = await askReason({ title: ti.removeTitle, tone: 'danger', confirmLabel: ti.remove, label: ti.promptRemove });
    if (reason) await run(() => post(`/invoices/${inv.id}/discount/remove`, { reason }), ti.discountRemoved);
  };
  const voidPayment = async (p: any) => {
    const reason = await askReason({ title: ti.voidTitle(p.receiptNumber), message: ti.voidMessage, tone: 'danger', confirmLabel: ti.void, label: ti.promptVoid });
    if (reason) await run(() => post(`/payments/${p.id}/void`, { reason }), ti.paymentVoided);
  };
  const refund = async (p: any) => {
    const values = await ask({
      title: ti.refundTitle(p.receiptNumber), message: ti.refundMessage, tone: 'warning', icon: 'undo', confirmLabel: ti.refund,
      fields: [
        { name: 'amount', label: ti.promptRefundAmount, initial: p.amount, inputMode: 'decimal' },
        { name: 'reason', label: ti.promptRefundReason, minLength: 3, multiline: true, hint: t.ui.minChars(fmtNumber(3)) },
      ],
    });
    if (values) await run(() => post(`/payments/${p.id}/refund`, { amount: values.amount, reason: values.reason }), ti.refunded);
  };
  const recordPayment = async (e: FormEvent) => {
    e.preventDefault();
    setPaying(true);
    const ok = await run(
      () => post(`/invoices/${inv.id}/payments`, { amount: pay.amount, method: pay.method, reference: pay.reference || undefined }),
      ti.paymentRecorded,
    );
    setPaying(false);
    if (ok) setPay({ ...pay, amount: '', reference: '' });
  };
  const applyDiscount = async (e: FormEvent) => {
    e.preventDefault();
    setDiscounting(true);
    const ok = await run(() => post(`/invoices/${inv.id}/discount`, disc), ti.discountApplied);
    setDiscounting(false);
    if (ok) setDisc({ ...disc, value: '', reason: '' });
  };

  return (
    <>
      <PageHeader
        back={{ to: `/patients/${inv.patient.id}`, label: inv.patient.name }}
        title={<>{ti.heading} <Ltr>{inv.invoiceNumber}</Ltr></>}
        tabTitle={ti.title(inv.invoiceNumber)}
        badges={<StatusBadge kind="InvoiceStatus" value={inv.status} />}
        description={
          <span className="cluster">
            <Link to={`/patients/${inv.patient.id}`}>{inv.patient.name}</Link>
            <Ltr>{inv.patient.phone}</Ltr>
            <span aria-hidden="true">·</span>
            <span>{ti.issued(fmtDateTime(inv.issuedAt))}{inv.issuedBy && t.common.by(inv.issuedBy.name)}</span>
          </span>
        }
        actions={(inv.canCorrect || inv.canReissue || inv.canCancel) && <>
          {inv.canReissue && <Button variant="primary" icon="receipt" onClick={() => replace('REISSUE')}>{ti.reissueInvoice}</Button>}
          {inv.canCorrect && <Button variant="secondary" icon="switch-horizontal" onClick={() => replace('CORRECT')}>{ti.correctInvoice}</Button>}
          {inv.canCancel && <Button variant="danger-outline" icon="ban" onClick={cancelInvoice}>{ti.cancelInvoice}</Button>}
        </>}
      />

      <div className="stack-lg">
        {inv.cancelReason && (
          <Alert tone="warning" title={ti.cancelledTitle}>{ti.cancelledBy(inv.cancelledBy?.name ?? '', inv.cancelReason)}</Alert>
        )}
        {inv.replacedBy && (
          <Alert tone="info" icon="switch-horizontal"
            title={<>{ti.replacedByTitle} <Link to={`/reception/invoices/${inv.replacedBy.id}`}><Ltr>{inv.replacedBy.invoiceNumber}</Ltr></Link></>}>
            {ti.replacedByText}
          </Alert>
        )}
        {inv.replacesInvoice && (
          <Alert tone="info" icon="switch-horizontal"
            title={<>{ti.replacesTitle} <Link to={`/reception/invoices/${inv.replacesInvoice.id}`}><Ltr>{inv.replacesInvoice.invoiceNumber}</Ltr></Link></>}>
            {ti.replacesText}
          </Alert>
        )}
        {inv.referral && (
          <Alert tone="info" icon="share" title={ti.referralTitle}>
            {ti.referral(inv.referral.referringDoctor.name, fmtNumber(inv.referral.termsVersion))}
            {inv.referral.isOverride && <> <Badge tone="warning">{t.referrals.overridden}</Badge></>}
          </Alert>
        )}
        {activeReferral && (
          <Alert tone="warning" icon="share" title={ti.referralTitle}
            actions={<Button size="sm" variant="secondary" icon="check" onClick={applyReferral}>{ti.applyReferral}</Button>}>
            {ti.referralNotApplied(activeReferral.referringDoctor.name)}
          </Alert>
        )}

        <div className="split">
          <div className="stack-lg">
            <Card flush title={ti.items} icon="list">
              <Table head={<><th>{ti.col.item}</th><th className="num">{ti.col.unit}</th><th className="num">{ti.col.qty}</th><th className="num">{ti.col.line}</th></>}>
                {inv.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="cell-strong">{i.description}</td>
                    <td className="num">{fmtMoney(i.unitPrice)}</td>
                    <td className="num">{fmtNumber(i.quantity)}</td>
                    <td className="num">{fmtMoney(i.lineTotal)}</td>
                  </tr>
                ))}
              </Table>
              <div className="invoice-totals">
                <Totals>
                  <TotalsRow label={ti.subtotal} value={fmtMoney(inv.subtotal)} />
                  <TotalsRow
                    label={<span>{ti.discount}{inv.discount && (
                      <span className="totals__sub">
                        {label(t.enums.DiscountType, inv.discount.type)} {discountValue(inv.discount)} · {inv.discount.reason}
                        {inv.discount.referralTermsId && ` · ${ti.fromReferral}`}
                      </span>
                    )}</span>}
                    value={fmtMoney(inv.discountTotal, true)}
                  />
                  <div className="totals__divider" />
                  <TotalsRow label={ti.total} value={fmtMoney(inv.total)} strong />
                  <TotalsRow label={ti.paid} value={fmtMoney(inv.amountPaid)} muted />
                  <div className={`totals__row totals__row--strong totals__row--balance${settled ? ' is-settled' : ''}`}>
                    <span>{ti.balance}</span><span>{fmtMoney(inv.balance)}</span>
                  </div>
                </Totals>
              </div>
            </Card>

            <Card flush title={ti.payments} icon="receipt">
              <Table
                head={<>
                  <th>{ti.pcol.receipt}</th><th>{ti.pcol.type}</th><th>{ti.pcol.status}</th><th className="num">{ti.pcol.amount}</th>
                  <th>{ti.pcol.method}</th><th>{ti.pcol.by}</th><th className="actions"><span className="visually-hidden">{t.ui.actions}</span></th>
                </>}
                isEmpty={inv.payments.length === 0}
                empty={<EmptyState compact icon="banknote" title={ti.noPayments} />}
              >
                {inv.payments.map((p: any) => {
                  const voided = p.status !== 'VALID';
                  return (
                    <tr key={p.id} className={voided ? 'is-voided' : undefined}>
                      <td>
                        <CellText sub={fmtDateTime(p.receivedAt)}>
                          <Link to={`/reception/receipts/${p.id}`} title={ti.viewReceipt}><Ltr>{p.receiptNumber}</Ltr></Link>
                        </CellText>
                      </td>
                      <td><StatusBadge kind="PaymentType" value={p.type} dot={false} /></td>
                      <td><CellText sub={p.voidReason}><StatusBadge kind="PaymentStatus" value={p.status} /></CellText></td>
                      <td className="num"><span className="is-voidable">{fmtMoney(p.amount)}</span></td>
                      <td><CellText sub={p.reference && <bdi>{p.reference}</bdi>}>{label(t.enums.PaymentMethod, p.method)}</CellText></td>
                      <td>{p.receivedBy.name}</td>
                      <td className="actions">
                        <div className="row-actions">
                          {p.status === 'VALID' && (
                            <Button size="sm" variant="danger-outline" icon="ban" onClick={() => voidPayment(p)}>{ti.void}</Button>
                          )}
                          {isOwner && p.status === 'VALID' && p.type === 'PAYMENT' && (
                            <Button size="sm" icon="undo" onClick={() => refund(p)}>{ti.refund}</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          </div>

          <div className="stack-lg">
            {!cancelled && (
              <Card title={ti.recordPayment} icon="banknote">
                {settled ? (
                  <Alert tone="success" title={ti.paidInFull}>{ti.nothingToPay}</Alert>
                ) : (
                  <form className="stack" onSubmit={recordPayment}>
                    <div className="balance-due">
                      <span className="balance-due__label">{ti.balanceDue}</span>
                      <span className="balance-due__value">{fmtMoney(inv.balance)}</span>
                    </div>
                    <Field label={ti.amount}>
                      <div className="input-group">
                        <NumberInput placeholder={ti.payAmountPh(fmtMoney(inv.balance))} value={pay.amount} required
                          onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                        <Button onClick={() => setPay({ ...pay, amount: inv.balance })}>{ti.fillBalance}</Button>
                      </div>
                    </Field>
                    <Field label={ti.method} group>
                      <Segmented
                        label={ti.method} value={pay.method} onChange={(method) => setPay({ ...pay, method })}
                        options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(t.enums.PaymentMethod, m), icon: METHOD_ICONS[m] }))}
                      />
                    </Field>
                    <Field label={ti.referencePh} optional hint={ti.referenceHint}>
                      <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                    </Field>
                    <Button type="submit" variant="primary" icon="check" block loading={paying} disabled={!pay.amount.trim()}>{ti.record}</Button>
                  </form>
                )}
              </Card>
            )}

            <Card title={ti.discount} icon="percent">
              <div className="stack">
                {inv.isLocked && <Alert tone="info" icon="lock" title={ti.lockedTitle}>{ti.lockedText}</Alert>}
                {inv.discount ? (
                  <div className="discount-box">
                    <div className="spread">
                      <span className="discount-box__value">
                        {label(t.enums.DiscountType, inv.discount.type)} {discountValue(inv.discount)} = {fmtMoney(inv.discount.amount)}
                      </span>
                      {inv.discount.repeatedFromId && <Badge tone="info">{ti.repeatedBadge}</Badge>}
                    </div>
                    <span className="text-body-sm text-secondary">{inv.discount.reason}{t.common.by(inv.discount.appliedBy.name)}</span>
                    {!inv.isLocked && (
                      <div><Button size="sm" variant="danger-outline" icon="trash" onClick={removeDiscount}>{ti.remove}</Button></div>
                    )}
                  </div>
                ) : <p className="text-muted text-body-sm">{ti.noDiscount}</p>}

                {last && (
                  <div className="discount-box discount-box--muted">
                    <span className="text-body-sm text-semibold">{ti.previous}</span>
                    <span className="discount-box__value">{label(t.enums.DiscountType, last.type)} {discountValue(last)}</span>
                    <span className="text-body-sm text-secondary">{last.reason}</span>
                    <span className="text-caption text-muted">{ti.previousOn(last.invoiceNumber, fmtDateTime(last.appliedAt), last.appliedBy.name)}</span>
                    {!inv.isLocked && (
                      <div>
                        <Button size="sm" variant="secondary" icon="refresh"
                          onClick={() => run(() => post(`/invoices/${inv.id}/discount`, { repeatFromDiscountId: last.id }), ti.discountApplied)}>
                          {ti.repeatLast}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {last === null && <p className="text-muted text-body-sm">{ti.noPrevious}</p>}

                {!inv.isLocked && (
                  <form className="stack" onSubmit={applyDiscount}>
                    <Field label={ti.discountType} group>
                      <Segmented
                        label={ti.discountType} value={disc.type} onChange={(type) => setDisc({ ...disc, type })} block
                        options={[
                          { value: 'PERCENT', label: t.enums.DiscountType.PERCENT, icon: 'percent' },
                          { value: 'FIXED', label: t.enums.DiscountType.FIXED, icon: 'banknote' },
                        ]}
                      />
                    </Field>
                    <Field label={disc.type === 'PERCENT' ? ti.percentLabel : ti.fixedLabel}>
                      <NumberInput placeholder={disc.type === 'PERCENT' ? ti.percentPh : ti.amountPh} value={disc.value}
                        onChange={(e) => setDisc({ ...disc, value: e.target.value })} />
                    </Field>
                    <Field label={ti.reasonPh} hint={t.ui.minChars(fmtNumber(3))}>
                      <Input value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />
                    </Field>
                    <Button type="submit" variant="secondary" icon="percent" block loading={discounting} disabled={!disc.value.trim()}>{ti.apply}</Button>
                  </form>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

export function ReceiptPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const nav = useNavigate();
  const [r] = useLoad(() => get(`/payments/${id}/receipt`), [id]);
  if (!r) return <Loading />;
  const tr = t.receipt;
  const isRefund = r.type === 'REFUND';
  const kind = isRefund ? tr.refund : tr.receipt;
  const method = label(t.enums.PaymentMethod, r.method) + (r.reference ? `${t.common.listSep}${tr.ref(r.reference)}` : '');
  // Label on one side, amount on the other (flips with the page direction).
  const line = (text: string, amount: string, strong = false) => (
    <div className={`receipt__line${strong ? ' receipt__line--strong' : ''}`}><span>{text}</span><span>{amount}</span></div>
  );
  return (
    <div className="receipt-page">
      <div className="no-print" style={{ width: '100%' }}>
        <PageHeader
          title={<>{kind} <Ltr>{r.receiptNumber}</Ltr></>}
          tabTitle={`${kind} ${r.receiptNumber}`}
          badges={r.status !== 'VALID' && <StatusBadge kind="PaymentStatus" value={r.status} />}
          actions={<>
            <Button variant="ghost" icon="arrow-left" onClick={() => nav(-1)}>{t.ui.back}</Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>{tr.print}</Button>
          </>}
        />
      </div>

      <article className="receipt" aria-label={kind}>
        <header className="receipt__head">
          <img src="/assets/branding/logo-primary.png" alt="" width={70} height={56} />
          <div className="receipt__clinic">{r.clinicName}</div>
          {r.clinicPhone && <Ltr>{r.clinicPhone}</Ltr>}
          <div className="receipt__kind">{kind}</div>
          {r.status !== 'VALID' && <span className="receipt__stamp"><StatusBadge kind="PaymentStatus" value={r.status} /></span>}
        </header>
        <hr className="receipt__rule" />
        <dl className="receipt__meta">
          <div><dt>{tr.receiptNo}</dt><dd><Ltr>{r.receiptNumber}</Ltr></dd></div>
          <div><dt>{tr.invoiceNo}</dt><dd><Ltr>{r.invoiceNumber}</Ltr></dd></div>
          <div><dt>{tr.date}</dt><dd>{fmtDateTime(r.receivedAt)}</dd></div>
          <div><dt>{tr.patientLabel}</dt><dd>{r.patient.name}<br /><Ltr>{r.patient.phone}</Ltr></dd></div>
        </dl>
        <hr className="receipt__rule" />
        <div className="receipt__lines">
          {r.items.map((i: any, n: number) => <div key={n}>{line(`${i.description} × ${fmtNumber(i.quantity)}`, fmtMoney(i.lineTotal))}</div>)}
        </div>
        <hr className="receipt__rule" />
        <div className="receipt__lines">
          {line(tr.subtotal, fmtMoney(r.subtotal))}
          {r.discount && line(tr.discount(label(t.enums.DiscountType, r.discount.type), discountValue(r.discount), r.discount.reason), fmtMoney(r.discount.amount, true))}
          {line(tr.total, fmtMoney(r.total), true)}
        </div>
        <hr className="receipt__rule" />
        <div className="receipt__lines">
          {line(isRefund ? tr.thisRefund(method) : tr.thisPayment(method), fmtMoney(r.amount), true)}
          {line(tr.totalPaid, fmtMoney(r.totalPaid))}
          {line(tr.remaining, fmtMoney(r.remainingBalance), true)}
        </div>
        <hr className="receipt__rule" />
        <footer className="receipt__foot">
          <span>{tr.receivedBy(r.receivedBy)}</span>
          <span>{tr.thanks}</span>
        </footer>
      </article>
    </div>
  );
}
