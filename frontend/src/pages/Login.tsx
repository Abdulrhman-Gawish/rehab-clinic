// Staff login (AuthLayout in FRONTEND_IMPLEMENTATION_GUIDE.md section 9.1): a form panel and a green brand panel.
// Patients never log in; the OWNER quick-login button is compiled out when QUICK_LOGIN=false.
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { act, login } from '../api';
import { label, useI18n } from '../i18n';
import { LanguageSwitcher } from '../layout/LanguageSwitcher';
import { usePageTitle } from '../layout/PublicLayout';
import { homeFor } from '../layout/StaffLayout';
import { Avatar, Badge, Button, Field, Icon, IconButton, Input, type Tone } from '../ui';
import '../styles/areas/site.css';

// Set by vite.config.ts. QUICK_LOGIN=false (before sharing through a tunnel): the buttons and every credential are compiled out.
declare const __QUICK_LOGIN__: boolean;
declare const __OWNER_EMAIL__: string;
declare const __OWNER_PASSWORD__: string;

const ROLE_TONE: Record<string, Tone> = { OWNER: 'brand', DOCTOR: 'info', RECEPTIONIST: 'neutral' };

export function Login() {
  const { t } = useI18n();
  const tl = t.login;
  usePageTitle(tl.docTitle);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const go = async (e: string, p: string, who: string) => {
    setBusy(who);
    await act(async () => {
      const user = await login(e, p);
      nav(from && from !== '/login' ? from : homeFor(user.role), { replace: true });
    });
    setBusy(null);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void go(email, password, 'form'); };

  const quick = __QUICK_LOGIN__
    ? [{ role: 'OWNER', name: __OWNER_EMAIL__ || tl.ownerMissing, email: __OWNER_EMAIL__, password: __OWNER_PASSWORD__ }]
    : [];

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__form">
          <div className="auth__top">
            <Link to="/" aria-label={t.app.title}>
              <img src="/assets/branding/logo-primary.png" alt={t.app.title} width={60} height={48} />
            </Link>
            <LanguageSwitcher />
          </div>

          <div>
            <h1 className="auth__title">{tl.title}</h1>
            <p className="auth__subtitle">{tl.subtitle}</p>
          </div>

          <form className="stack" onSubmit={submit}>
            <Field label={tl.email}>
              <span className="input-wrap">
                <Icon name="mail" />
                <Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </span>
            </Field>
            <Field label={tl.password}>
              <span className="input-wrap">
                <Icon name="lock" />
                <Input
                  type={show ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <span className="input-wrap__end">
                  <IconButton icon={show ? 'eye-off' : 'eye'} label={show ? tl.hidePassword : tl.showPassword} onClick={() => setShow(!show)} />
                </span>
              </span>
            </Field>
            <Button type="submit" variant="primary" size="lg" block icon="log-in" loading={busy === 'form'} disabled={!!busy && busy !== 'form'}>
              {tl.submit}
            </Button>
          </form>

          <Link className="auth__back" to="/"><Icon name="arrow-left" />{tl.backToSite}</Link>

          {quick.length > 0 && (
            <section className="demo-accounts" aria-labelledby="demo-title">
              <div>
                <h2 className="demo-accounts__title" id="demo-title">{tl.quick}</h2>
              </div>
              <ul className="demo-accounts__list">
                {quick.map((q) => (
                  <li key={q.email || q.role}>
                    <button type="button" className="demo-account" disabled={!q.email || !!busy} onClick={() => go(q.email, q.password, q.email)}>
                      <span className="person">
                        <Avatar name={q.name} size={36} />
                        <span className="person__text">
                          <bdi className="person__name">{q.name}</bdi>
                          {q.email && <span className="person__meta"><bdi dir="ltr">{q.email}</bdi></span>}
                        </span>
                      </span>
                      {busy === q.email
                        ? <span className="spinner spinner--brand" style={{ ['--spinner-size' as string]: '18px' }} aria-hidden="true" />
                        : <Badge tone={ROLE_TONE[q.role] ?? 'neutral'}>{label(t.enums.UserRole, q.role)}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="auth__brand" aria-hidden="true">
          <img src="/assets/branding/logo-reversed.png" alt="" width={120} height={119} />
          <div>
            <h2>{tl.brandTitle}</h2>
            <p>{tl.brandText}</p>
          </div>
          <ul className="auth__brand-list">
            <li><Icon name="calendar-days" />{t.nav.dayList}</li>
            <li><Icon name="users" />{t.nav.patients}</li>
            <li><Icon name="receipt" />{t.nav.dailySummary}</li>
            <li><Icon name="clipboard-check" />{t.nav.needsNote}</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
