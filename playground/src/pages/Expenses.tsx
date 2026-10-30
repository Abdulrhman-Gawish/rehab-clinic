import { useState } from 'react';
import { act, get, openFile, PAYMENT_METHODS, post, qs } from '../api';
import { addDays, fmtDateTime, todayCairo } from '../time';
import { opt, useForm, useLoad } from '../util';

export function Expenses() {
  const [range, setRange] = useState({ from: addDays(todayCairo(), -7), to: todayCairo() });
  const [cats] = useLoad(() => get<any[]>('/expense-categories'), []);
  const [list, reload] = useLoad(() => get(`/expenses${qs({ ...range, limit: 100 })}`), [range.from, range.to]);
  const f = useForm({ categoryId: '', description: '', amount: '', expenseDate: todayCairo(), paymentMethod: 'CASH', vendorName: '', reference: '' });
  const [file, setFile] = useState<File | null>(null);

  const add = () => act(async () => {
    const e = await post('/expenses', { ...f.v, vendorName: opt(f.v.vendorName), reference: opt(f.v.reference) });
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      await post(`/expenses/${e.id}/receipt`, fd);
    }
    f.setV({ ...f.v, description: '', amount: '', vendorName: '', reference: '' });
    reload();
  });

  return (
    <>
      <h2>Expenses</h2>
      <div className="box">
        <h4>Add expense</h4>
        <div className="row">
          <select {...f.bind('categoryId')}><option value="">-- category --</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="description" {...f.bind('description')} />
          <input placeholder="amount" {...f.bind('amount')} />
          <input type="date" {...f.bind('expenseDate')} />
        </div>
        <div className="row">
          <select {...f.bind('paymentMethod')}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          <input placeholder="vendor (optional)" {...f.bind('vendorName')} />
          <input placeholder="reference (optional)" {...f.bind('reference')} />
          <label>Receipt file (optional) <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <button onClick={add}>Add expense</button>
      </div>

      <div className="row">
        <label>From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label>To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      <p><b>Total (valid): {list?.totalAmount}</b> · {list?.meta.total} expenses</p>
      <table>
        <thead><tr><th>No.</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Vendor</th><th>Status</th><th>Created</th><th>By</th><th></th></tr></thead>
        <tbody>
          {list?.items.map((e: any) => (
            <tr key={e.id} style={e.status === 'VOIDED' ? { textDecoration: 'line-through' } : {}}>
              <td>{e.expenseNumber}</td><td>{e.expenseDate}</td><td>{e.category.name}</td><td>{e.description}</td><td>{e.amount}</td>
              <td>{e.paymentMethod}</td><td>{e.vendorName}</td><td>{e.status}{e.voidReason && ` (${e.voidReason}, ${e.voidedBy?.name})`}</td><td>{fmtDateTime(e.createdAt)}</td><td>{e.createdBy.name}</td>
              <td>
                {e.hasReceipt && <button onClick={() => openFile(`/expenses/${e.id}/receipt`)}>receipt</button>}
                {e.status === 'VALID' && <button onClick={() => { const reason = prompt('Void reason'); if (reason) act(() => post(`/expenses/${e.id}/void`, { reason })).then(reload); }}>void</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
