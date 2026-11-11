// Navigation inside a page: tabs, pagination, "load more", stepper.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { fmtNumber } from '../format';
import { useI18n } from '../i18n';
import { Button, IconButton } from './controls';
import { Icon, type IconName } from './icons';

/** Tabs (WAI-ARIA tablist: arrow keys, Home/End). The parent renders the active panel. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: ReactNode; icon?: IconName; count?: number }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((x) => x.id === value);
    const rtl = document.documentElement.dir === 'rtl';
    let next = -1;
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (i + 1) % tabs.length;
    if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
      {tabs.map((x) => (
        <button
          key={x.id} type="button" role="tab" className="tabs__tab" aria-selected={x.id === value}
          tabIndex={x.id === value ? 0 : -1} onClick={() => onChange(x.id)}
        >
          {x.icon && <Icon name={x.icon} />}{x.label}
          {x.count != null && <span className="tabs__count">{fmtNumber(x.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Previous / next for a paginated list endpoint (meta.page, meta.totalPages, meta.total). */
export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  return (
    <nav className="pagination" aria-label={t.ui.pagination}>
      <span>{t.ui.totalCount(fmtNumber(total))}</span>
      <div className="pagination__controls">
        <IconButton icon="chevron-left" label={t.ui.prevPage} variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="pagination__page">{t.ui.pageOf(fmtNumber(page), fmtNumber(Math.max(pages, 1)))}</span>
        <IconButton icon="chevron-right" label={t.ui.nextPage} variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

/** Centered "load more" button (public lists, timelines). */
export function LoadMore({ onClick, loading, children }: { onClick: () => unknown; loading?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="load-more">
      <Button variant="secondary" loading={loading} onClick={onClick}>{children ?? t.ui.loadMore}</Button>
    </div>
  );
}

/** Wizard steps; completed steps can be clicked to go back. Compact "Step 2 of 4" + progress bar on small screens. */
export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (index: number) => void }) {
  const { t } = useI18n();
  return (
    <>
      <ol className="stepper">
        {steps.map((s, i) => {
          const state = i < current ? 'is-done' : i === current ? 'is-current' : '';
          const dot = i < current ? <Icon name="check" /> : fmtNumber(i + 1);
          return (
            <li key={s} className={`stepper__step ${state}`} aria-current={i === current ? 'step' : undefined}>
              {i < current && onStep
                ? <button type="button" className="stepper__dot" onClick={() => onStep(i)} aria-label={s}>{dot}</button>
                : <span className="stepper__dot">{dot}</span>}
              <span className="stepper__label">{s}</span>
            </li>
          );
        })}
      </ol>
      <div className="stepper-compact" aria-hidden="true">
        <span>{t.ui.step(fmtNumber(current + 1), fmtNumber(steps.length))}: {steps[current]}</span>
        <div className="progress"><span style={{ width: `${((current + 1) / steps.length) * 100}%` }} /></div>
      </div>
    </>
  );
}
