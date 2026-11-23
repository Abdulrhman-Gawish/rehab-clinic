// Layout and display components: cards, page headers, badges, alerts, empty/loading states, stats, tables.
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { label as enumLabel, useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import { cx } from './controls';
import { Icon, type IconName } from './icons';

// ---------- Card ----------

export function Card({ title, description, icon, actions, footer, flush, variant, className, id, children }: {
  title?: ReactNode; description?: ReactNode; icon?: IconName; actions?: ReactNode; footer?: ReactNode;
  /** No padding (tables touch the edges). */
  flush?: boolean;
  variant?: 'muted' | 'brand' | 'marketing' | 'interactive';
  className?: string; id?: string; children?: ReactNode;
}) {
  return (
    <section id={id} className={cx('card', flush && 'card--flush', variant && `card--${variant}`, className)}>
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title && <h2 className="card__title">{icon && <Icon name={icon} />}{title}</h2>}
            {description && <p className="card__desc">{description}</p>}
          </div>
          {actions && <div className="cluster">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  );
}

// ---------- Page header ----------

/** The page's h1 (one per page), optional back link, description and actions. Also sets the browser tab title. */
export function PageHeader({ title, description, back, actions, badges, tabTitle }: {
  title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode;
  /** Shown next to the title (status badges). */
  badges?: ReactNode;
  /** Browser tab title when `title` is not plain text. */
  tabTitle?: string;
}) {
  const { t } = useI18n();
  const text = tabTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (text) document.title = `${text} · ${t.app.short}`;
  }, [text, t.app.short]);
  return (
    <header className="page-header">
      <div className="page-header__main">
        {back && <Link className="page-header__back" to={back.to}><Icon name="arrow-left" />{back.label}</Link>}
        <h1 className="page-header__title">{title}{badges}</h1>
        {description && <div className="page-header__desc">{description}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="spread" style={{ marginBlockEnd: 'var(--space-3)' }}>
      <h2 className="section-title" style={{ margin: 0 }}>{children}</h2>
      {actions && <div className="cluster">{actions}</div>}
    </div>
  );
}

// ---------- Badges ----------

export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent' | 'brand' | 'outline';

export function Badge({ tone = 'neutral', dot, icon, title, children }: { tone?: Tone; dot?: boolean; icon?: IconName; title?: string; children: ReactNode }) {
  return <span className={cx('badge', `badge--${tone}`, dot && 'badge--dot')} title={title}>{icon && <Icon name={icon} />}{children}</span>;
}

type EnumName = keyof Messages['enums'];

// Status colour by enum value. Status never relies on colour alone: the badge always has its text label.
export const STATUS_TONES: Partial<Record<EnumName, Record<string, Tone>>> = {
  AppointmentStatus: { PENDING: 'warning', CONFIRMED: 'info', ATTENDED: 'success', NO_SHOW: 'error', CANCELLED: 'neutral', RESCHEDULED: 'neutral' },
  VisitStatus: { ACTIVE: 'success', VOIDED: 'error' },
  NoteStatus: { DRAFT: 'warning', SIGNED: 'success' },
  InvoiceStatus: { ISSUED: 'warning', PARTIALLY_PAID: 'info', PAID: 'success', CANCELLED: 'neutral' },
  DayPaymentStatus: { NOT_INVOICED: 'neutral', UNPAID: 'warning', PARTIAL: 'info', PAID: 'success' },
  PaymentStatus: { VALID: 'success', VOIDED: 'neutral' },
  PaymentType: { PAYMENT: 'neutral', REFUND: 'warning' },
  ExpenseStatus: { VALID: 'success', VOIDED: 'neutral' },
  PatientPackageStatus: { ACTIVE: 'success', FINISHED: 'neutral', CANCELLED: 'error' },
  PackageUsageReason: { ATTENDED: 'success', NO_SHOW: 'error' },
  CommissionStatus: { PENDING: 'neutral', ELIGIBLE: 'warning', PAID: 'success' },
  PatientReferralStatus: { ACTIVE: 'success', ENDED: 'neutral' },
  UserRole: { OWNER: 'brand', DOCTOR: 'info', RECEPTIONIST: 'neutral' },
  ClientReviewType: { TEXT: 'neutral', IMAGE: 'info', GALLERY: 'accent' },
  AppointmentSource: { ONLINE: 'info', RECEPTION: 'neutral' },
  AppointmentType: { EXAMINATION: 'accent', FOLLOW_UP: 'info', SESSION: 'brand' },
  PatientSource: { ONLINE: 'info', RECEPTION: 'neutral' },
};

/** An API enum value as a coloured badge with its translated label. */
export function StatusBadge({ kind, value, dot = true }: { kind: EnumName; value: string | null | undefined; dot?: boolean }) {
  const { t } = useI18n();
  if (!value) return <span className="text-muted">{t.common.none}</span>;
  const map = t.enums[kind] as Record<string, string>;
  return <Badge tone={STATUS_TONES[kind]?.[value] ?? 'neutral'} dot={dot}>{enumLabel(map, value)}</Badge>;
}

/** Active / inactive (or hidden) flag. */
export function ActiveBadge({ active, inactiveLabel }: { active: boolean; inactiveLabel?: string }) {
  const { t } = useI18n();
  return <Badge tone={active ? 'success' : 'neutral'} dot>{active ? t.common.active : inactiveLabel ?? t.common.inactive}</Badge>;
}

// ---------- Alert ----------

const ALERT_ICON: Record<string, IconName> = { success: 'check-circle', warning: 'alert-triangle', error: 'alert-circle', info: 'info' };

export function Alert({ tone = 'info', title, children, actions, icon, className }: {
  tone?: 'success' | 'warning' | 'error' | 'info'; title?: ReactNode; children?: ReactNode; actions?: ReactNode; icon?: IconName; className?: string;
}) {
  return (
    <div className={cx('alert', `alert--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon ?? ALERT_ICON[tone]} />
      <div className="alert__body">
        {title && <div className="alert__title">{title}</div>}
        {children && <div className="alert__text">{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

// ---------- Empty and loading ----------

export function EmptyState({ icon = 'list', title, text, action, compact }: {
  icon?: IconName; title: ReactNode; text?: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cx('empty', compact && 'empty--compact')}>
      <div className="empty__icon"><Icon name={icon} /></div>
      <div className="empty__title">{title}</div>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="loading" role="status"><span className="spinner spinner--brand" aria-hidden="true" />{label ?? t.common.loading}</div>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

// ---------- Stats ----------

export function Stat({ label, value, icon, tone, hint }: {
  label: ReactNode; value: ReactNode; icon?: IconName; tone?: 'warning' | 'error' | 'info' | 'neutral' | 'highlight'; hint?: ReactNode;
}) {
  // Visible length of a text figure (direction marks have no width): long amounts shrink to fit (components.css).
  const chars = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\u200e\u200f\u061c]/g, '').length : 0;
  return (
    <div className={cx('stat', tone && `stat--${tone}`)}>
      {icon && <span className="stat__icon"><Icon name={icon} /></span>}
      <div className="stat__body">
        <span className="stat__label">{label}</span>
        <span className="stat__value" style={chars ? { ['--stat-chars' as string]: chars } : undefined}>{value}</span>
        {hint && <span className="stat__hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>;
}

// ---------- Description list and totals ----------

/** Term / value pairs; falsy items are skipped. */
export function DescriptionList({ items, columns = 1, inline }: {
  items: ([ReactNode, ReactNode] | false | null | undefined)[]; columns?: 1 | 2 | 3; inline?: boolean;
}) {
  return (
    <dl className={cx('dl', columns > 1 && `dl--${columns}`, inline && 'dl--inline')}>
      {items.filter((x): x is [ReactNode, ReactNode] => !!x).map(([term, value], i) => (
        <div key={i}><dt>{term}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function Totals({ children }: { children: ReactNode }) {
  return <div className="totals">{children}</div>;
}

export function TotalsRow({ label, value, strong, muted, className }: {
  label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; className?: string;
}) {
  return <div className={cx('totals__row', strong && 'totals__row--strong', muted && 'totals__row--muted', className)}><span>{label}</span><span>{value}</span></div>;
}

// ---------- Table ----------

/**
 * A data table. `head` is the header row's cells (<th>…</th>); rows go in children. `empty` (e.g. an EmptyState) is
 * shown as one full-width row when `isEmpty` is true. Put it inside <Card flush> for the standard look.
 * Cells: className "num" for amounts and counts (end-aligned, tabular), "actions" for the row buttons.
 */
export function Table({ head, children, empty, isEmpty, foot, dense, caption, className }: {
  head: ReactNode; children?: ReactNode; empty?: ReactNode; isEmpty?: boolean; foot?: ReactNode; dense?: boolean; caption?: string; className?: string;
}) {
  // The empty state sits below the table, not in a full-width row, so on a phone it is centred on the screen
  // rather than on the table's scroll width.
  return (
    <>
      <div className="table-wrap">
        <table className={cx('table', dense && 'table--dense', className)}>
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead><tr>{head}</tr></thead>
          <tbody>{children}</tbody>
          {foot && <tfoot>{foot}</tfoot>}
        </table>
      </div>
      {isEmpty && empty && <div className="table-empty">{empty}</div>}
    </>
  );
}

/** Cell content: main line + small grey second line. */
export function CellText({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <>{children}{sub && <span className="cell-sub">{sub}</span>}</>;
}

// ---------- People ----------

const initials = (name: string) =>
  name.replace(/^(dr\.?|د\.?\/?)\s*/i, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return <span className="avatar" style={{ ['--avatar-size' as string]: `${size}px` }} aria-hidden="true">{initials(name)}</span>;
}

/** Avatar + name (+ a meta line), optionally a link. */
export function Person({ name, meta, to, size = 36 }: { name: string; meta?: ReactNode; to?: string; size?: number }) {
  return (
    <span className="person">
      <Avatar name={name} size={size} />
      <span className="person__text">
        {to ? <Link className="person__name" to={to}>{name}</Link> : <span className="person__name">{name}</span>}
        {meta && <span className="person__meta">{meta}</span>}
      </span>
    </span>
  );
}

// ---------- Brand patterns (public pages) ----------

export function SectionHeading({ kicker, title, description, center, as: Tag = 'h2' }: {
  kicker?: ReactNode; title: ReactNode; description?: ReactNode; center?: boolean; as?: 'h1' | 'h2';
}) {
  return (
    <div className={cx('section-heading', center && 'section-heading--center')}>
      {kicker && <span className="section-heading__kicker">{kicker}</span>}
      <Tag className="section-heading__title">{title}</Tag>
      {description && <p className="section-heading__desc">{description}</p>}
    </div>
  );
}

/** Photo banner with the green tint; the title is the page's h1. */
export function PageBanner({ image, title, text, crumbs }: {
  image?: string; title: ReactNode; text?: ReactNode; crumbs?: { to?: string; label: string }[];
}) {
  return (
    <section className="page-banner">
      {image && <img src={image} alt="" />}
      <div className="page-banner__inner">
        {crumbs && (
          <nav className="page-banner__crumbs" aria-label="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="cluster">
                {i > 0 && <Icon name="chevron-right" />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-banner__title">{title}</h1>
        {text && <p className="page-banner__text">{text}</p>}
      </div>
    </section>
  );
}

export function IconCircle({ icon, size = 56, solid }: { icon: IconName; size?: number; solid?: boolean }) {
  return <span className={cx('icon-circle', solid && 'icon-circle--solid')} style={{ ['--circle' as string]: `${size}px` }}><Icon name={icon} /></span>;
}
