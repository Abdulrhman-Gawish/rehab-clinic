// The staff app frame: grouped sidebar (by role), top bar (language, account) and the page outlet.
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getSession, logout, type Role, type User } from '../api';
import { label, useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import { Avatar, Icon, IconButton, Loading, type IconName } from '../ui';
import { LanguageSwitcher } from './LanguageSwitcher';

export const homeFor = (role: Role) => (role === 'DOCTOR' ? '/doctor' : role === 'OWNER' ? '/owner/summary' : '/reception');

interface NavItem { to: string; label: (t: Messages) => string; icon: IconName; roles: Role[]; end?: boolean }
type Group = keyof Messages['shell']['groups'];

const DESK: Role[] = ['OWNER', 'RECEPTIONIST'];

const NAV: { group: Group; items: NavItem[] }[] = [
  {
    group: 'desk',
    items: [
      { to: '/reception', label: (t) => t.nav.dayList, icon: 'calendar-days', roles: DESK, end: true },
      { to: '/reception/book', label: (t) => t.nav.book, icon: 'calendar-plus', roles: DESK },
      { to: '/reception/patients', label: (t) => t.nav.patients, icon: 'users', roles: DESK },
      { to: '/reception/expenses', label: (t) => t.nav.expenses, icon: 'wallet', roles: DESK },
      { to: '/reception/summary', label: (t) => t.nav.dailySummary, icon: 'receipt', roles: ['RECEPTIONIST'] },
      { to: '/owner/summary', label: (t) => t.nav.dailySummary, icon: 'receipt', roles: ['OWNER'] },
    ],
  },
  {
    group: 'clinical',
    items: [
      { to: '/doctor', label: (t) => t.nav.myDay, icon: 'stethoscope', roles: ['DOCTOR'], end: true },
      { to: '/doctor/needs-note', label: (t) => t.nav.needsNote, icon: 'clipboard-check', roles: ['DOCTOR', 'OWNER'] },
    ],
  },
  {
    group: 'management',
    items: [
      { to: '/owner/users', label: (t) => t.nav.users, icon: 'id-card', roles: ['OWNER'] },
      { to: '/owner/doctors', label: (t) => t.nav.doctors, icon: 'stethoscope', roles: ['OWNER'] },
      { to: '/owner/services', label: (t) => t.nav.services, icon: 'package', roles: ['OWNER'] },
      { to: '/owner/salaries', label: (t) => t.nav.salaries, icon: 'wallet', roles: ['OWNER'] },
      { to: '/owner/employees', label: (t) => t.nav.employees, icon: 'briefcase-medical', roles: ['OWNER'] },
      { to: '/owner/referring-doctors', label: (t) => t.nav.referringDoctors, icon: 'share', roles: ['OWNER'] },
    ],
  },
  {
    group: 'insights',
    items: [
      { to: '/owner/reports', label: (t) => t.nav.reports, icon: 'chart', roles: ['OWNER'] },
      { to: '/owner/marketing', label: (t) => t.nav.marketing, icon: 'megaphone', roles: ['OWNER'] },
      { to: '/owner/attention', label: (t) => t.nav.attention, icon: 'alert-triangle', roles: ['OWNER'] },
      { to: '/owner/audit', label: (t) => t.nav.audit, icon: 'history', roles: ['OWNER'] },
    ],
  },
  {
    group: 'website',
    items: [
      { to: '/owner/blog', label: (t) => t.nav.blog, icon: 'file-text', roles: ['OWNER'] },
      { to: '/owner/reviews', label: (t) => t.nav.clientReviews, icon: 'message', roles: ['OWNER'] },
    ],
  },
];

function useSession() {
  const [session, setSession] = useState(getSession());
  useEffect(() => {
    const h = () => setSession(getSession());
    window.addEventListener('session', h);
    return () => window.removeEventListener('session', h);
  }, []);
  return session;
}

export function StaffLayout() {
  const { t } = useI18n();
  const session = useSession();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  // The drawer closes on navigation and on Escape.
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!session) return null;
  const { user } = session;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter((g) => g.items.length);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">{t.shell.skipToContent}</a>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label={t.shell.mainNav}>
        <div className="sidebar__brand">
          <Link to={homeFor(user.role)}>
            <img src="/assets/branding/logo-primary.png" alt={t.app.title} width={55} height={44} />
          </Link>
          <IconButton className="sidebar__close" icon="x" label={t.shell.closeMenu} onClick={() => setOpen(false)} />
        </div>
        <nav className="sidebar__nav">
          {groups.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group__title">{t.shell.groups[g.group]}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className="nav-item">
                  <Icon name={i.icon} />{i.label(t)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="nav-group__title">{t.shell.publicSite}</div>
          <NavLink to="/book" className="nav-item"><Icon name="globe" />{t.nav.publicBooking}</NavLink>
          <NavLink to="/blog" className="nav-item"><Icon name="file-text" />{t.nav.publicBlog}</NavLink>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <IconButton className="topbar__menu" icon="menu" size="md" label={t.shell.openMenu} onClick={() => setOpen(true)} />
          <Link className="topbar__brand" to={homeFor(user.role)}><img src="/assets/branding/logo-primary.png" alt={t.app.title} width={45} height={36} /></Link>
          <span className="topbar__spacer" />
          <LanguageSwitcher />
          <UserMenu user={user} />
        </header>
        <main id="main" className="app-main" tabIndex={-1}>
          <Suspense fallback={<Loading />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const role = label(t.enums.UserRole, user.role);
  return (
    <div className="user-menu" ref={box}>
      <button type="button" className="user-menu__trigger" aria-haspopup="menu" aria-expanded={open} aria-label={t.shell.account} onClick={() => setOpen(!open)}>
        <Avatar name={user.name} size={36} />
        <span className="user-menu__who"><span className="user-menu__name">{user.name}</span><span className="user-menu__role">{role}</span></span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__header">
            <strong>{user.name}</strong>
            <span className="text-muted text-body-sm"><bdi dir="ltr">{user.email}</bdi> · {role}</span>
          </div>
          <Link role="menuitem" className="menu__item" to="/" onClick={() => setOpen(false)}><Icon name="globe" />{t.shell.publicSite}</Link>
          <button
            type="button" role="menuitem" className="menu__item menu__item--danger"
            onClick={async () => { setOpen(false); await logout(); nav('/login'); }}
          >
            <Icon name="log-out" />{t.nav.logout}
          </button>
        </div>
      )}
    </div>
  );
}
