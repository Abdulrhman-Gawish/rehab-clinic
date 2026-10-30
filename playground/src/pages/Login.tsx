import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, login } from '../api';
import { DEMO_PASSWORD, DEMO_STAFF } from '../demo';
import { homeFor } from '../App';

declare const __OWNER_EMAIL__: string;
declare const __OWNER_PASSWORD__: string;

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const go = (e: string, p: string) => act(async () => nav(homeFor((await login(e, p)).role)));
  const quick = [
    { label: `OWNER (${__OWNER_EMAIL__ || 'set SEED_OWNER_* in backend/.env'})`, email: __OWNER_EMAIL__, password: __OWNER_PASSWORD__ },
    ...DEMO_STAFF.map((s) => ({ label: `${s.role}: ${s.name}`, email: s.email, password: DEMO_PASSWORD })),
  ];
  return (
    <>
      <h2>Login</h2>
      <form onSubmit={(e) => { e.preventDefault(); go(email, password); }}>
        <div className="row">
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button>Login</button>
        </div>
      </form>
      <h4>Quick login (demo accounts from seed:demo)</h4>
      {quick.map((q) => (
        <button key={q.email} style={{ width: 'auto', display: 'block', marginBottom: 6 }} onClick={() => go(q.email, q.password)}>{q.label}</button>
      ))}
    </>
  );
}
