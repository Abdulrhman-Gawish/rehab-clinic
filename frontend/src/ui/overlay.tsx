// Dialogs (native <dialog>: focus trap, Escape and the top layer come from the browser) and toasts.
// Pages never call window.prompt / confirm / alert: they use confirmAction / askReason / ask below.
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { showError, subscribeErrors, subscribeNotices, type Notice, type ShownError } from '../api';
import { msg, useI18n } from '../i18n';
import type { Messages } from '../i18n/en';
import { Values } from '../util';
import { Button, cx, Field, Input, Textarea } from './controls';
import { Alert } from './display';
import { Icon, type IconName } from './icons';

// ---------- Dialog ----------

/**
 * A modal dialog, rendered only while `open`. Escape and a backdrop click call onClose (unless `dismissible` is false,
 * e.g. while a form has unsaved input). Put the form actions in `footer`; a <form> inside can use the `form` attribute.
 */
export function Dialog({ open, onClose, title, description, size = 'md', footer, dismissible = true, children }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode; dismissible?: boolean; children?: ReactNode;
}) {
  if (!open) return null;
  return <DialogPanel {...{ onClose, title, description, size, footer, dismissible }}>{children}</DialogPanel>;
}

function DialogPanel({ onClose, title, description, size, footer, dismissible, children }: {
  onClose: () => void; title: ReactNode; description?: ReactNode; size: 'sm' | 'md' | 'lg'; footer?: ReactNode; dismissible: boolean; children?: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // The modal sits in the top layer, above the error toast, so an API error raised while the dialog is open (a failed
  // save) is repeated inside it. Errors from before it opened are ignored.
  const [error, setError] = useState<ShownError | null>(null);
  useEffect(() => {
    let initial = true;
    return subscribeErrors((e) => { if (initial) { initial = false; return; } setError(e); });
  }, []);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    // The browser would focus the header's close button. Start in the first field instead, or, with no fields (a
    // confirm), on the first footer button: Cancel, the safe choice.
    const first = dialog.querySelector<HTMLElement>('.dialog__body :is(input:not([type="hidden"]), select, textarea):not(:disabled)')
      ?? dialog.querySelector<HTMLElement>('.dialog__footer button:not(:disabled)');
    first?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (dialog.open) dialog.close();
      opener?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref} className={cx('dialog', size !== 'md' && `dialog--${size}`)} aria-labelledby="dialog-title"
      onCancel={(e) => { e.preventDefault(); if (dismissible) close.current(); }}
      onMouseDown={(e) => { if (e.target === ref.current && dismissible) close.current(); }}
    >
      <header className="dialog__header">
        <div>
          <h2 className="dialog__title" id="dialog-title">{title}</h2>
          {description && <p className="dialog__desc">{description}</p>}
        </div>
        <button type="button" className="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={() => close.current()}>
          <Icon name="x" />
        </button>
      </header>
      <div className="dialog__body">
        {error && (
          <div ref={errorRef}>
            <Alert tone="error" title={errorText(t, error)}>{hasErrorDetails(error) && <ErrorDetails error={error} t={t} />}</Alert>
          </div>
        )}
        {children}
      </div>
      {footer && <footer className="dialog__footer">{footer}</footer>}
    </dialog>
  );
}

// ---------- confirm / ask (imperative, promise based) ----------

export interface AskField {
  name: string; label: string; initial?: string; placeholder?: string; hint?: string;
  /** Trimmed length needed before the confirm button is enabled (the API's reasons need 3). */
  minLength?: number; optional?: boolean; multiline?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric'; type?: 'text' | 'password';
}

export interface AskOptions {
  title: string; message?: ReactNode; fields?: AskField[];
  confirmLabel?: string; cancelLabel?: string;
  /** danger: red confirm button and an alert icon (deletes, cancels, voids). */
  tone?: 'primary' | 'danger' | 'warning';
  icon?: IconName;
}

interface Request extends AskOptions { id: number; resolve: (values: Record<string, string> | null) => void }
let requestId = 0;

let queue: Request[] = [];
const askListeners = new Set<() => void>();
const emit = () => askListeners.forEach((l) => l());

/** Opens a dialog; resolves with the field values (trimmed, except passwords), or null when cancelled. */
export function ask(options: AskOptions): Promise<Record<string, string> | null> {
  return new Promise((resolve) => { queue = [...queue, { ...options, id: ++requestId, resolve }]; emit(); });
}

/** Yes / no. Use tone "danger" for anything destructive. */
export async function confirmAction(options: Omit<AskOptions, 'fields'>): Promise<boolean> {
  return (await ask(options)) !== null;
}

/** One required reason (min 3 characters by default, as the API requires). Null when cancelled. */
export async function askReason(options: Omit<AskOptions, 'fields'> & { label?: string; minLength?: number; optional?: boolean; initial?: string }): Promise<string | null> {
  const { label, minLength = 3, optional, initial, ...rest } = options;
  const values = await ask({
    ...rest,
    fields: [{ name: 'reason', label: label ?? msg().ui.reason, minLength: optional ? 0 : minLength, optional, multiline: true, initial,
      hint: optional || !minLength ? undefined : msg().ui.minChars(String(minLength)) }],
  });
  return values ? values.reason : null;
}

/** Renders the dialogs requested with ask(). Mounted once, in App. */
export function DialogHost() {
  const current = useSyncExternalStore(
    (l) => { askListeners.add(l); return () => { askListeners.delete(l); }; },
    () => queue[0],
  );
  if (!current) return null;
  return <AskDialog key={current.id} request={current} />;
}

function AskDialog({ request }: { request: Request }) {
  const { t } = useI18n();
  const fields = request.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const finish = (result: Record<string, string> | null) => {
    queue = queue.slice(1);
    emit();
    request.resolve(result);
  };
  const valid = fields.every((f) => {
    const v = values[f.name]?.trim() ?? '';
    return (f.optional && !v) || v.length >= Math.max(f.minLength ?? 0, f.optional ? 0 : 1);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Passwords are returned exactly as typed; every other value is trimmed.
    const passwords = new Set(fields.filter((f) => f.type === 'password').map((f) => f.name));
    if (valid) finish(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, passwords.has(k) ? v : v.trim()])));
  };
  const tone = request.tone ?? 'primary';
  const icon = request.icon ?? (tone === 'danger' ? 'alert-triangle' : tone === 'warning' ? 'alert-circle' : undefined);
  return (
    <Dialog
      open onClose={() => finish(null)} title={request.title} size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => finish(null)}>{request.cancelLabel ?? t.common.cancel}</Button>
        <Button type="submit" form="ask-form" variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!valid}>
          {request.confirmLabel ?? t.ui.confirm}
        </Button>
      </>}
    >
      <form id="ask-form" className="stack" onSubmit={submit}>
        {icon && <span className={cx('dialog__icon', tone !== 'danger' && `dialog__icon--${tone === 'warning' ? 'warning' : 'info'}`)}><Icon name={icon} /></span>}
        {request.message && <div className="dialog__message">{request.message}</div>}
        {fields.map((f, i) => (
          <Field key={f.name} label={f.label} hint={f.hint} optional={f.optional}>
            {f.multiline
              ? <Textarea rows={3} autoFocus={i === 0} placeholder={f.placeholder} value={values[f.name]}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }} />
              : <Input autoFocus={i === 0} type={f.type ?? 'text'} inputMode={f.inputMode} placeholder={f.placeholder}
                  dir={f.inputMode === 'decimal' || f.inputMode === 'numeric' ? 'ltr' : undefined} value={values[f.name]}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />}
          </Field>
        ))}
      </form>
    </Dialog>
  );
}

// ---------- Toasts ----------

interface FieldError { field: string; errors?: string[]; constraints?: string[] }
const isFieldErrors = (d: unknown): d is FieldError[] =>
  Array.isArray(d) && d.every((x) => x && typeof x === 'object' && 'field' in x);

/** A field path like "items.0.unitPrice": label of the full path, else of its last part. */
function fieldLabel(t: Messages, field: string): string {
  return t.fields[field] ?? t.fields[field.split('.').pop() ?? field] ?? field;
}

/** The message a user reads: by error code, else by validation rule, else by HTTP status. Never the API's English text. */
export function errorText(t: Messages, e: ShownError): string {
  if (e.code && t.errors.codes[e.code]) return t.errors.codes[e.code];
  if (e.status === 400 && isFieldErrors(e.details)) return t.errors.validationTitle;
  // A 401 from the login form is a wrong password, not an ended session.
  if (e.status === 401 && e.path?.endsWith('/auth/login')) return t.errors.invalidCredentials;
  if (e.status === 0) return e.message && !e.path ? e.message : t.errors.network;
  return t.errors.http[String(e.status)] ?? t.errors.generic;
}

const hasErrorDetails = (e: ShownError) => isFieldErrors(e.details) || (e.details != null && typeof e.details === 'object') || !!e.path;

/** The parts of an API error below its title: the invalid fields, other details, and the technical line. */
function ErrorDetails({ error, t, textClass }: { error: ShownError; t: Messages; textClass?: string }) {
  const fields = isFieldErrors(error.details) ? error.details : null;
  return (
    <>
      {fields && (
        <ul className={textClass}>
          {fields.map((f) => (
            <li key={f.field}>
              {fieldLabel(t, f.field)}: {(f.constraints?.length ? f.constraints : ['fallback']).map((c) => t.validation[c] ?? t.validation.fallback).join(t.common.listSep)}
            </li>
          ))}
        </ul>
      )}
      {!fields && error.details != null && typeof error.details === 'object' && (
        <div className={textClass}><Values value={error.details as Record<string, unknown>} inline /></div>
      )}
      {error.path && (
        <details>
          <summary>{t.errors.technical}</summary>
          <small><bdi dir="ltr">{error.status} {error.code && `[${error.code}]`} {error.message} ({error.path})</bdi></small>
        </details>
      )}
    </>
  );
}

/** Success notices (auto-dismiss) and the current API error (stays until dismissed or the next action). */
export function Toasts() {
  const { t } = useI18n();
  const [error, setError] = useState<ShownError | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => subscribeErrors(setError), []);
  useEffect(() => subscribeNotices((n) => {
    setNotices((old) => [...old.slice(-2), n]);
    window.setTimeout(() => setNotices((old) => old.filter((x) => x.id !== n.id)), 5000);
  }), []);
  return (
    <div className="toasts" aria-live="polite">
      {error && (
        <div className="toast toast--error" role="alert">
          <Icon name="alert-circle" />
          <div className="toast__body">
            <div className="toast__title">{errorText(t, error)}</div>
            <ErrorDetails error={error} t={t} textClass="toast__text" />
          </div>
          <button type="button" className="icon-btn" aria-label={t.common.close} title={t.common.close} onClick={() => showError(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className={`toast toast--${n.tone}`} role="status">
          <Icon name={n.tone === 'success' ? 'check-circle' : 'info'} />
          <div className="toast__body"><div className="toast__title">{n.text}</div></div>
          <button type="button" className="icon-btn" aria-label={t.common.close} onClick={() => setNotices((old) => old.filter((x) => x.id !== n.id))}>
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
