// Form controls and buttons. Native elements with the design-system classes (styles/components.css), so keyboard,
// forms and screen readers work as the browser intends.
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './icons';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export type ButtonVariant =
  | 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'danger-outline' | 'inverse' | 'inverse-outline' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const btnClass = (variant: ButtonVariant, size: ButtonSize, block?: boolean, className?: string) =>
  cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className);

/** Runs onClick; when it returns a promise, shows a spinner and blocks double clicks until it settles. */
function useBusy<E>(onClick?: (e: E) => unknown) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const handle = (e: E) => {
    const result = onClick?.(e);
    if (result instanceof Promise) {
      setBusy(true);
      const done = () => { if (alive.current) setBusy(false); };
      result.then(done, done);
    }
  };
  return [busy, handle] as const;
}

type ButtonProps = Omit<ComponentProps<'button'>, 'onClick'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  block?: boolean;
  /** Forces the loading state (otherwise automatic while an async onClick runs). */
  loading?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
};

/** Default type="button": pass type="submit" for form submit buttons. */
export function Button({
  variant = 'outline', size = 'md', icon, iconEnd, block, loading, className, children, onClick, type = 'button', ...rest
}: ButtonProps) {
  const [busy, handle] = useBusy(onClick);
  const isBusy = loading || busy;
  return (
    <button type={type} className={btnClass(variant, size, block, className)} aria-busy={isBusy || undefined} onClick={handle} {...rest}>
      {isBusy ? <span className="spinner" style={{ ['--spinner-size' as string]: size === 'sm' ? '14px' : '18px' }} aria-hidden="true" />
        : icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </button>
  );
}

/** A router link that looks like a button. */
export function ButtonLink({ variant = 'outline', size = 'md', icon, iconEnd, block, className, children, ...rest }: LinkProps & {
  variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconEnd?: IconName; block?: boolean;
}) {
  return (
    <Link className={btnClass(variant, size, block, className)} {...rest}>
      {icon && <Icon name={icon} />}{children}{iconEnd && <Icon name={iconEnd} />}
    </Link>
  );
}

/** Icon-only button: the label is the accessible name and the tooltip. */
export function IconButton({ icon, label, variant = 'ghost', size = 'sm', className, onClick, type = 'button', ...rest }: Omit<ComponentProps<'button'>, 'onClick'> & {
  icon: IconName; label: string; variant?: 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md';
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
}) {
  const [busy, handle] = useBusy(onClick);
  return (
    <button
      type={type} className={cx('icon-btn', size === 'md' && 'icon-btn--md', variant !== 'ghost' && `icon-btn--${variant}`, className)}
      aria-label={label} title={label} aria-busy={busy || undefined} onClick={handle} {...rest}
    >
      {busy ? <span className="spinner" style={{ ['--spinner-size' as string]: '16px' }} aria-hidden="true" /> : <Icon name={icon} />}
    </button>
  );
}

/**
 * Label above the control, optional marker, help or error below. The control goes in `children`.
 * `group`: several controls (checkboxes, radios, chips) -> fieldset + legend instead of a label.
 */
export function Field({ label, hint, error, optional, group, className, children }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; optional?: boolean; group?: boolean; className?: string; children: ReactNode;
}) {
  const { t } = useI18n();
  const head = <>{label}{optional && <span className="field__optional">{t.ui.optional}</span>}</>;
  const foot = <>
    {hint && <span className="field__help">{hint}</span>}
    {error && <span className="field__error" role="alert"><Icon name="alert-circle" />{error}</span>}
  </>;
  if (group) {
    return <fieldset className={cx('field', className)}><legend className="field__label">{head}</legend>{children}{foot}</fieldset>;
  }
  return <label className={cx('field', className)}><span className="field__label">{head}</span>{children}{foot}</label>;
}

export function Input({ className, dense, ...rest }: ComponentProps<'input'> & { dense?: boolean }) {
  return <input className={cx('input', dense && 'input--dense', className)} {...rest} />;
}

/** Money, counts, percentages: decimal keyboard on phones, digits left to right. */
export function NumberInput(props: ComponentProps<'input'> & { dense?: boolean }) {
  return <Input inputMode="decimal" dir="ltr" autoComplete="off" {...props} />;
}

export function Select({ className, dense, ...rest }: ComponentProps<'select'> & { dense?: boolean }) {
  return <select className={cx('select', dense && 'select--dense', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('textarea', className)} {...rest} />;
}

/** Input with a leading icon (search fields). */
export function SearchInput({ className, icon = 'search', ...rest }: ComponentProps<'input'> & { icon?: IconName }) {
  return (
    <span className={cx('input-wrap', className)}>
      <Icon name={icon} />
      <input className="input" type="search" {...rest} />
    </span>
  );
}

export function Checkbox({ label, checked, onChange, disabled, small, className }: {
  label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; small?: boolean; className?: string;
}) {
  return (
    <label className={cx('check', small && 'check--sm', className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({ label, checked, onChange, name, disabled }: {
  label: ReactNode; checked: boolean; onChange: () => void; name?: string; disabled?: boolean;
}) {
  return (
    <label className="check">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }: {
  label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/** A radio (default) or checkbox shown as a selectable card. Put the content in children. */
export function ChoiceCard({ checked, onChange, name, type = 'radio', disabled, className, children }: {
  checked: boolean; onChange: () => void; name?: string; type?: 'radio' | 'checkbox'; disabled?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <label className={cx('choice', className)}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <div className="choice__body">{children}</div>
      <span className="choice__check" aria-hidden="true"><Icon name="check" /></span>
    </label>
  );
}

/** Toggle chip for filters (several can be on). */
export function FilterChip({ pressed, onClick, icon, children }: { pressed: boolean; onClick: () => void; icon?: IconName; children: ReactNode }) {
  return (
    <button type="button" className="filter-chip" aria-pressed={pressed} onClick={onClick}>
      {pressed ? <Icon name="check" /> : icon && <Icon name={icon} />}{children}
    </button>
  );
}

/** 2-5 exclusive options (payment method, group by, …). */
export function Segmented<T extends string>({ options, value, onChange, label, block, className }: {
  options: { value: T; label: ReactNode; icon?: IconName }[]; value: T; onChange: (value: T) => void; label: string; block?: boolean; className?: string;
}) {
  // Radio-group keyboard model: one tab stop (the checked item); arrow keys move and select, mirrored in RTL.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let step = keys[e.key];
    if (e.key === 'Home' || e.key === 'End') step = 0;
    if (step === undefined) return;
    e.preventDefault();
    if (getComputedStyle(e.currentTarget).direction === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) step = -step;
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (at + step + options.length) % options.length;
    onChange(options[next].value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('.segmented__item')[next]?.focus();
  };
  const checked = options.some((o) => o.value === value) ? value : options[0]?.value;
  return (
    <div className={cx('segmented', block && 'segmented--block', className)} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={o.value === value} className="segmented__item"
          tabIndex={o.value === checked ? 0 : -1} onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} />}{o.label}
        </button>
      ))}
    </div>
  );
}
