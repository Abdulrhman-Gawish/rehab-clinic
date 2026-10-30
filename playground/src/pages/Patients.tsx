import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, getSession, qs } from '../api';
import { fmtDateTime } from '../time';
import { useLoad } from '../util';

export function Patients() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [res] = useLoad(() => get(`/patients${qs({ search: q, limit: 50 })}`), [q]);
  return (
    <>
      <h2>Patients</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(search); }}>
        <input placeholder="name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button style={{ width: 'auto' }}>Search</button>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Source</th><th>Created</th></tr></thead>
        <tbody>
          {res?.items.map((p: any) => (
            <tr key={p.id}><td><Link to={`/reception/patients/${p.id}`}>{p.name}</Link></td><td>{p.phone}</td><td>{p.createdSource}</td><td>{fmtDateTime(p.createdAt)}</td></tr>
          ))}
        </tbody>
      </table>
      <small>{res?.meta.total} patients</small>
    </>
  );
}

export function PatientPage() {
  const { id } = useParams();
  const desk = getSession()?.user.role !== 'DOCTOR';
  // One screen = 5 requests (see FINDINGS.md).
  const [data] = useLoad(async () => {
    const [patient, appointments, visits, invoices, balance] = await Promise.all([
      get(`/patients/${id}`),
      get(`/patients/${id}/appointments?limit=100`),
      get(`/patients/${id}/visits?limit=100`),
      desk ? get(`/patients/${id}/invoices?limit=100`) : Promise.resolve({ items: [] }),
      desk ? get(`/patients/${id}/balance`) : Promise.resolve(null),
    ]);
    return { patient, appointments, visits, invoices, balance };
  }, [id]);
  if (!data) return <p>Loading…</p>;
  const { patient, appointments, visits, invoices, balance } = data;
  return (
    <>
      <h2>{patient.name} <small>{patient.phone}</small></h2>
      <p>DOB {patient.dateOfBirth ?? '-'} · {patient.gender ?? '-'} · source {patient.createdSource}{patient.createdBy && ` by ${patient.createdBy.name}`} · notes: {patient.notes ?? '-'}</p>
      {balance && <p><b>Balance: {balance.balance}</b> (invoiced {balance.totalInvoiced}, paid {balance.totalPaid})</p>}

      <h3>Appointments</h3>
      <table>
        <thead><tr><th>Start</th><th>Ref</th><th>Doctor</th><th>Service</th><th>Status</th><th>Booked name</th></tr></thead>
        <tbody>
          {appointments.items.map((a: any) => (
            <tr key={a.id}>
              <td><Link to={`/reception?date=${a.startAt.slice(0, 10)}`}>{fmtDateTime(a.startAt)}</Link></td>
              <td>{a.referenceCode}</td><td>{a.doctor.name}</td><td>{a.service.name}</td><td>{a.status}</td>
              <td>{a.bookedName}{a.nameMismatch && <span className="warn"> ⚠</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Visits</h3>
      <table>
        <thead><tr><th>Attended</th><th>Doctor</th><th>Service</th><th>Status</th><th>Walk-in</th></tr></thead>
        <tbody>
          {visits.items.map((v: any) => (
            <tr key={v.id}><td>{fmtDateTime(v.attendedAt)}</td><td>{v.doctor.name}</td><td>{v.service.name}</td><td>{v.status}</td><td>{v.isWalkIn ? 'yes' : ''}</td></tr>
          ))}
        </tbody>
      </table>

      {desk && <>
        <h3>Invoices</h3>
        <table>
          <thead><tr><th>Number</th><th>Issued</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
          <tbody>
            {invoices.items.map((i: any) => (
              <tr key={i.id}>
                <td><Link to={`/reception/invoices/${i.id}`}>{i.invoiceNumber}</Link></td><td>{fmtDateTime(i.issuedAt)}</td>
                <td>{i.status}</td><td>{i.total}</td><td>{i.amountPaid}</td><td>{i.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
    </>
  );
}
