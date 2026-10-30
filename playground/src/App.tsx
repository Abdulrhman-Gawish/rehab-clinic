import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getSession, logout, showError, subscribeErrors, type Role, type ShownError } from './api';
import { Login } from './pages/Login';
import { DayList } from './pages/DayList';
import { Booking } from './pages/Booking';
import { Patients, PatientPage } from './pages/Patients';
import { InvoicePage, ReceiptPage } from './pages/Invoice';
import { Expenses } from './pages/Expenses';
import { Queue } from './pages/Queue';
import { VisitPage } from './pages/Visit';
import { Users, Doctors, DoctorPage, Services } from './pages/Owner';
import { Summary, Attention, AuditLog } from './pages/Reports';
import { PublicBooking } from './pages/PublicBooking';

export const homeFor = (role: Role) => (role === 'DOCTOR' ? '/doctor' : role === 'OWNER' ? '/owner/summary' : '/reception');

function ErrorBar() {
  const [e, setE] = useState<ShownError | null>(null);
  useEffect(() => subscribeErrors(setE), []);
  if (!e) return null;
  return (
    <div className="error">
      <b>{e.status}</b> {e.code && <b>[{e.code}]</b>} {e.message} <small>({e.path})</small>
      {e.details != null && <div><small>{JSON.stringify(e.details)}</small></div>}
      <button style={{ width: 'auto', float: 'right', padding: '0 0.5rem' }} onClick={() => showError(null)}>x</button>
    </div>
  );
}

function Header() {
  const [session, setS] = useState(getSession());
  const nav = useNavigate();
  useEffect(() => {
    const h = () => setS(getSession());
    window.addEventListener('session', h);
    return () => window.removeEventListener('session', h);
  }, []);
  if (!session) return <header><nav><Link to="/login">Login</Link><Link to="/book">Public booking</Link></nav></header>;
  const role = session.user.role;
  const desk = role === 'OWNER' || role === 'RECEPTIONIST';
  return (
    <header>
      <nav>
        <span>
          <b>{session.user.name}</b> ({role}){' '}
          <button style={{ width: 'auto', padding: '0.1rem 0.6rem' }} onClick={async () => { await logout(); nav('/login'); }}>Logout</button>
        </span>
      </nav>
      <nav>
        {desk && <>
          <Link to="/reception">Day list</Link>
          <Link to="/reception/book">Book / walk-in</Link>
          <Link to="/reception/patients">Patients</Link>
          <Link to="/reception/expenses">Expenses</Link>
          <Link to="/reception/summary">Daily summary</Link>
        </>}
        {(role === 'DOCTOR' || role === 'OWNER') && <Link to="/doctor">Queue</Link>}
        {role === 'OWNER' && <>
          <Link to="/owner/users">Users</Link>
          <Link to="/owner/doctors">Doctors</Link>
          <Link to="/owner/services">Services</Link>
          <Link to="/owner/attention">Attention</Link>
          <Link to="/owner/audit">Audit log</Link>
        </>}
        <Link to="/book">Public booking</Link>
      </nav>
    </header>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return getSession() ? <>{children}</> : <Navigate to="/login" />;
}

export function App() {
  const loc = useLocation();
  useEffect(() => showError(null), [loc.pathname]);
  const s = getSession();
  return (
    <div>
      <Header />
      <ErrorBar />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to={s ? homeFor(s.user.role) : '/login'} />} />
          <Route path="/login" element={<Login />} />
          <Route path="/book" element={<PublicBooking />} />
          <Route path="/reception" element={<Protected><DayList /></Protected>} />
          <Route path="/reception/book" element={<Protected><Booking /></Protected>} />
          <Route path="/reception/patients" element={<Protected><Patients /></Protected>} />
          <Route path="/reception/patients/:id" element={<Protected><PatientPage /></Protected>} />
          <Route path="/reception/invoices/:id" element={<Protected><InvoicePage /></Protected>} />
          <Route path="/reception/receipts/:id" element={<Protected><ReceiptPage /></Protected>} />
          <Route path="/reception/expenses" element={<Protected><Expenses /></Protected>} />
          <Route path="/reception/summary" element={<Protected><Summary /></Protected>} />
          <Route path="/doctor" element={<Protected><Queue /></Protected>} />
          <Route path="/doctor/visits/:id" element={<Protected><VisitPage /></Protected>} />
          <Route path="/owner/summary" element={<Protected><Summary /></Protected>} />
          <Route path="/owner/users" element={<Protected><Users /></Protected>} />
          <Route path="/owner/doctors" element={<Protected><Doctors /></Protected>} />
          <Route path="/owner/doctors/:id" element={<Protected><DoctorPage /></Protected>} />
          <Route path="/owner/services" element={<Protected><Services /></Protected>} />
          <Route path="/owner/attention" element={<Protected><Attention /></Protected>} />
          <Route path="/owner/audit" element={<Protected><AuditLog /></Protected>} />
          <Route path="*" element={<p>Not found. <Link to="/">Home</Link></p>} />
        </Routes>
      </main>
    </div>
  );
}
