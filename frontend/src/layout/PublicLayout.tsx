// The public website frame (PublicLayout in FRONTEND_IMPLEMENTATION_GUIDE.md section 9.1): skip link, utility bar
// (>= lg), sticky header with the brand logo and the main menu, a drawer below lg, the green footer and the floating
// WhatsApp button. Staff with a session see "Dashboard" instead of "Staff login".
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { getSession } from '../api';
import { useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import { displayPhone, SITE } from '../site';
import { ButtonLink, Icon, IconButton, type IconName } from '../ui';
import { Ltr } from '../util';
import { LanguageSwitcher } from './LanguageSwitcher';
import { homeFor } from './StaffLayout';
import '../styles/areas/site.css';

const LINKS: { to: string; label: (t: Messages) => string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: (t) => t.site.home, icon: 'home', end: true },
  { to: '/book', label: (t) => t.site.book, icon: 'calendar-plus' },
  { to: '/blog', label: (t) => t.site.blog, icon: 'file-text' },
];

const SOCIAL: { key: keyof typeof SITE.social; icon: IconName }[] = [
  { key: 'facebook', icon: 'facebook' },
  { key: 'instagram', icon: 'instagram' },
  { key: 'tiktok', icon: 'tiktok' },
];

/** Browser tab title of a public page: "<page> · <short name>", or the full clinic name for the home page. */
export function usePageTitle(page: string | null | undefined) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = page ? `${page} · ${t.app.short}` : t.app.title;
  }, [page, t.app.short, t.app.title]);
}

function useSessionUser() {
  const [session, setSession] = useState(getSession());
  useEffect(() => {
    const h = () => setSession(getSession());
    window.addEventListener('session', h);
    return () => window.removeEventListener('session', h);
  }, []);
  return session?.user ?? null;
}

function Social({ t }: { t: Messages }) {
  return (
    <div className="site-social">
      {SOCIAL.map((s) => (
        <a key={s.key} href={SITE.social[s.key]} target="_blank" rel="noopener noreferrer" aria-label={t.site.social[s.key]} title={t.site.social[s.key]}>
          <Icon name={s.icon} />
        </a>
      ))}
    </div>
  );
}

export function PublicLayout() {
  const { t } = useI18n();
  const user = useSessionUser();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // The drawer closes on navigation.
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Drawer: focus inside on open, Escape closes, Tab stays inside, focus back to the menu button on close.
  useEffect(() => {
    if (!open) return;
    const panel = drawer.current;
    const opener = menuButton.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  const account = user
    ? <ButtonLink to={homeFor(user.role)} variant="secondary" icon="layout">{t.shell.dashboard}</ButtonLink>
    : <ButtonLink to="/login" variant="secondary" icon="log-in">{t.shell.staffLogin}</ButtonLink>;

  return (
    <div className="site">
      <a className="skip-link" href="#main">{t.shell.skipToContent}</a>

      <div className="site-utility">
        <div className="container-wide site-utility__inner">
          <div className="site-utility__info">
            {SITE.phones.slice(0, 2).map((p) => (
              <a key={p} className="site-utility__item" href={`tel:${p}`}><Icon name="phone" /><Ltr>{displayPhone(p)}</Ltr></a>
            ))}
            <span className="site-utility__item"><Icon name="map-pin" /><span className="site-utility__address" title={t.site.address}>{t.site.address}</span></span>
          </div>
          <Social t={t} />
        </div>
      </div>

      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="container-wide site-header__inner">
          <Link to="/" className="site-logo" aria-label={t.app.title}>
            <img src="/assets/branding/logo-primary.png" alt={t.app.title} width={55} height={44} />
          </Link>
          <nav className="site-nav" aria-label={t.site.primaryNav}>
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className="site-nav__link">{l.label(t)}</NavLink>)}
          </nav>
          <div className="site-header__actions">
            <div className="site-header__desktop">
              <LanguageSwitcher />
              {account}
            </div>
            <ButtonLink to="/book" variant="primary" icon="calendar" className="site-header__book">{t.site.bookNow}</ButtonLink>
            <IconButton
              ref={menuButton} className="site-header__menu" icon="menu" size="md" label={t.shell.openMenu}
              aria-expanded={open} aria-controls="site-drawer" onClick={() => setOpen(true)}
            />
          </div>
        </div>
      </header>

      {open && <div className="site-drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div id="site-drawer" className="site-drawer" ref={drawer} role="dialog" aria-modal="true" aria-label={t.site.primaryNav}>
          <div className="site-drawer__head">
            <img src="/assets/branding/logo-primary.png" alt="" width={45} height={36} />
            <IconButton icon="x" size="md" label={t.shell.closeMenu} onClick={() => setOpen(false)} />
          </div>
          <nav className="site-drawer__nav" aria-label={t.site.primaryNav}>
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="site-drawer__link"><Icon name={l.icon} />{l.label(t)}</NavLink>
            ))}
          </nav>
          <div className="site-drawer__foot">
            <LanguageSwitcher />
            {account}
            <ButtonLink to="/book" variant="primary" icon="calendar" block>{t.site.bookNow}</ButtonLink>
            <div className="site-drawer__contact">
              {SITE.phones.slice(0, 2).map((p) => (
                <a key={p} href={`tel:${p}`}><Icon name="phone" /><Ltr>{displayPhone(p)}</Ltr></a>
              ))}
              <a href={`mailto:${SITE.email}`}><Icon name="mail" /><Ltr>{SITE.email}</Ltr></a>
            </div>
          </div>
        </div>
      )}

      <main id="main" className="site-main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container-wide site-footer__grid">
          <div className="site-footer__brand">
            <img src="/assets/branding/logo-reversed.png" alt={t.app.title} width={88} height={87} loading="lazy" />
            <p className="site-footer__about">{t.site.about}</p>
            <Social t={t} />
          </div>
          <div>
            <h2 className="site-footer__title">{t.site.quickLinks}</h2>
            <ul className="site-footer__list">
              {LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label(t)}</Link></li>)}
              <li>{user ? <Link to={homeFor(user.role)}>{t.shell.dashboard}</Link> : <Link to="/login">{t.shell.staffLogin}</Link>}</li>
            </ul>
          </div>
          <div>
            <h2 className="site-footer__title">{t.site.contact}</h2>
            <ul className="site-footer__list">
              <li><span><Icon name="map-pin" />{t.site.address}</span></li>
              <li><a href={`mailto:${SITE.email}`}><Icon name="mail" /><Ltr>{SITE.email}</Ltr></a></li>
            </ul>
          </div>
          <div>
            <h2 className="site-footer__title">{t.site.phones}</h2>
            <ul className="site-footer__list">
              {SITE.phones.map((p) => (
                <li key={p}><a href={`tel:${p}`} aria-label={t.site.call(displayPhone(p))}><Icon name="phone" /><Ltr>{displayPhone(p)}</Ltr></a></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="site-footer__bottom">
          <div className="container-wide">{t.site.rights(String(new Date().getFullYear()))}</div>
        </div>
      </footer>

      <a className="whatsapp-fab" href={SITE.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={t.site.whatsapp} title={t.site.whatsapp}>
        <Icon name="message" />
      </a>
    </div>
  );
}
