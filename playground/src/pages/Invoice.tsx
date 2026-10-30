import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { act, ApiError, del, get, getSession, PAYMENT_METHODS, post } from '../api';
import { fmtDateTime } from '../time';
import { useLoad } from '../util';

export function InvoicePage() {
  const { id } = useParams();
  const isOwner = getSession()?.user.role === 'OWNER';
  const [inv, reload] = useLoad(() => get(`/invoices/${id}`), [id]);
  // 404 NO_PREVIOUS_DISCOUNT is a normal answer here.
  const [last, reloadLast] = useLoad(
    () => (inv ? get(`/patients/${inv.patient.id}/last-discount`, { quiet404: true }).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))) : Promise.resolve(null)),
    [inv?.patient.id, inv?.discount?.id],
  );
  const [disc, setDisc] = useState({ type: 'PERCENT', value: '', reason: '' });
  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '' });
  const run = async (fn: () => Promise<unknown>) => { const ok = await act(fn); reload(); reloadLast(); return ok; };

  if (!inv) return <p>Loading…</p>;
  const locked = inv.payments.some((p: any) => p.type === 'PAYMENT' && p.status === 'VALID') || inv.status === 'CANCELLED';
  return (
    <>
      <h2>Invoice {inv.invoiceNumber} <small>{inv.status}</small></h2>
      <p>
        Patient <Link to={`/reception/patients/${inv.patient.id}`}>{inv.patient.name}</Link> {inv.patient.phone} · issued {fmtDateTime(inv.issuedAt)}
        {inv.cancelReason && <span className="warn"> · cancelled: {inv.cancelReason}</span>}
      </p>
      <table>
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Line</th></tr></thead>
        <tbody>
          {inv.items.map((i: any) => <tr key={i.id}><td>{i.description}</td><td>{i.unitPrice}</td><td>{i.quantity}</td><td>{i.lineTotal}</td></tr>)}
          <tr><td colSpan={3}>Subtotal</td><td>{inv.subtotal}</td></tr>
          <tr><td colSpan={3}>Discount {inv.discount && `(${inv.discount.type} ${inv.discount.value} — ${inv.discount.reason})`}</td><td>-{inv.discountTotal}</td></tr>
          <tr><td colSpan={3}><b>Total</b></td><td><b>{inv.total}</b></td></tr>
          <tr><td colSpan={3}>Paid</td><td>{inv.amountPaid}</td></tr>
          <tr><td colSpan={3}><b>Balance</b></td><td><b>{inv.balance}</b></td></tr>
        </tbody>
      </table>

      <div className="cols">
        <div className="box">
          <h4>Discount {locked && <small>(locked: invoice has payments)</small>}</h4>
          {inv.discount && (
            <p>Current: {inv.discount.type} {inv.discount.value} = {inv.discount.amount} ({inv.discount.reason}){inv.discount.repeatedFromId && ' [repeated]'}{' '}
              <button style={{ width: 'auto' }} onClick={() => { const reason = prompt('Reason to remove the discount'); if (reason) run(() => del(`/invoices/${inv.id}/discount`, { reason })); }}>remove</button>
            </p>
          )}
          {last && last.invoiceId !== inv.id && (
            <p>Previous discount: <b>{last.type} {last.value}</b> ({last.reason}) on {last.invoiceNumber}, {fmtDateTime(last.appliedAt)}{' '}
              <button style={{ width: 'auto' }} onClick={() => run(() => post(`/invoices/${inv.id}/discount`, { repeatFromDiscountId: last.id }))}>repeat last discount</button>
            </p>
          )}
          {last === null && <p><small>No previous discount for this patient.</small></p>}
          <div className="row">
            <select value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value })}><option>PERCENT</option><option>FIXED</option></select>
            <input placeholder={disc.type === 'PERCENT' ? 'percent e.g. 10' : 'amount e.g. 50.00'} value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} />
            <input placeholder="reason" value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />
          </div>
          <button onClick={async () => { if (await run(() => post(`/invoices/${inv.id}/discount`, disc))) setDisc({ ...disc, value: '', reason: '' }); }}>Apply new discount</button>
        </div>

        <div className="box">
          <h4>Record payment</h4>
          <div className="row">
            <input placeholder={`amount (balance ${inv.balance})`} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <input placeholder="reference (optional)" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          </div>
          <div className="inline">
            <button onClick={() => setPay({ ...pay, amount: inv.balance })}>fill balance</button>
            <button onClick={async () => {
              if (await run(() => post(`/invoices/${inv.id}/payments`, { amount: pay.amount, method: pay.method, reference: pay.reference || undefined }))) setPay({ ...pay, amount: '', reference: '' });
            }}>Record payment</button>
          </div>
        </div>
      </div>

      <h3>Payments</h3>
      <table>
        <thead><tr><th>Receipt</th><th>Type</th><th>Status</th><th>Amount</th><th>Method</th><th>Reference</th><th>When</th><th>By (id)</th><th></th></tr></thead>
        <tbody>
          {inv.payments.map((p: any) => (
            <tr key={p.id}>
              <td><Link to={`/reception/receipts/${p.id}`}>{p.receiptNumber}</Link></td>
              <td>{p.type}{p.refundOfId && ' (refund)'}</td><td>{p.status}</td><td>{p.amount}</td><td>{p.method}</td><td>{p.reference}</td>
              <td>{fmtDateTime(p.receivedAt)}</td><td><small>{p.receivedById.slice(0, 8)}</small></td>
              <td>
                {p.status === 'VALID' && <button onClick={() => { const reason = prompt('Void reason (a mistake, same day only)'); if (reason) run(() => post(`/payments/${p.id}/void`, { reason })); }}>void</button>}
                {isOwner && p.status === 'VALID' && p.type === 'PAYMENT' && (
                  <button onClick={() => {
                    const amount = prompt('Refund amount', p.amount); if (!amount) return;
                    const reason = prompt('Refund reason'); if (!reason) return;
                    run(() => post(`/payments/${p.id}/refund`, { amount, reason }));
                  }}>refund</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {inv.status !== 'CANCELLED' && (
        <button style={{ width: 'auto' }} onClick={() => { const reason = prompt('Reason to cancel the invoice'); if (reason) run(() => post(`/invoices/${inv.id}/cancel`, { reason })); }}>Cancel invoice</button>
      )}
    </>
  );
}

export function ReceiptPage() {
  const { id } = useParams();
  const [r] = useLoad(() => get(`/payments/${id}/receipt`), [id]);
  if (!r) return <p>Loading…</p>;
  return (
    <div style={{ maxWidth: 420, fontFamily: 'monospace', fontSize: 13 }}>
      <button className="noprint" style={{ width: 'auto' }} onClick={() => window.print()}>Print</button>
      <h3 style={{ textAlign: 'center' }}>{r.clinicName}</h3>
      {r.clinicPhone && <p style={{ textAlign: 'center' }}>{r.clinicPhone}</p>}
      <p>{r.type === 'REFUND' ? 'REFUND' : 'RECEIPT'} {r.receiptNumber} {r.status !== 'VALID' && `[${r.status}]`}<br />
        Invoice {r.invoiceNumber}<br />{fmtDateTime(r.receivedAt)}<br />Patient: {r.patient.name} {r.patient.phone}</p>
      <hr />
      {r.items.map((i: any, n: number) => <div key={n}>{i.description} x{i.quantity} ..... {i.lineTotal}</div>)}
      <hr />
      <div>Subtotal ..... {r.subtotal}</div>
      {r.discount && <div>Discount ({r.discount.type} {r.discount.value}, {r.discount.reason}) ..... -{r.discount.amount}</div>}
      <div><b>Total ..... {r.total}</b></div>
      <hr />
      <div>This {r.type === 'REFUND' ? 'refund' : 'payment'} ({r.method}{r.reference ? `, ref ${r.reference}` : ''}) ..... {r.amount}</div>
      <div>Total paid ..... {r.totalPaid}</div>
      <div><b>Remaining ..... {r.remainingBalance}</b></div>
      <hr />
      <div>Received by {r.receivedBy}</div>
    </div>
  );
}
