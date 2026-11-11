// Tiny fetch wrapper: refreshes once on 401 (one shared refresh), publishes errors to the error bar.
// The tokens live in HttpOnly cookies that this code never sees. The browser sends them because the API is on the
// same origin (/api/v1, forwarded by Vite to the backend); X-Requested-With is the backend's CSRF check.
import { getLang, isLang, setLang, type Lang } from './i18n';

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export type Role = 'OWNER' | 'DOCTOR' | 'RECEPTIONIST';
export interface User { id: string; name: string; email: string; role: Role; doctorId: string | null; preferredLanguage?: Lang }
// Only who is logged in (for the UI), never a token.
interface Session { user: User }

const KEY = 'rehab-user';
try {
  // Before the rename to frontend/: carry the logged-in user over once; older versions kept the tokens here.
  const old = localStorage.getItem('playground-user');
  if (old && !localStorage.getItem(KEY)) localStorage.setItem(KEY, old);
  localStorage.removeItem('playground-user');
  localStorage.removeItem('playground-session');
} catch { /* private mode */ }

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
export function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('session'));
}

// ---- error bar (module-level, no state library)
export interface ShownError { status: number; code?: string; message: string; details?: unknown; path?: string }
let current: ShownError | null = null;
const listeners = new Set<(e: ShownError | null) => void>();
export function showError(e: ShownError | null) { current = e; listeners.forEach((l) => l(e)); }
export function subscribeErrors(l: (e: ShownError | null) => void) { listeners.add(l); l(current); return () => { listeners.delete(l); }; }

// ---- success notices (toasts), same pattern
export interface Notice { id: number; text: string; tone: 'success' | 'info' }
const noticeListeners = new Set<(n: Notice) => void>();
let noticeId = 0;
/** A short confirmation toast ("Payment recorded."). Errors never go here: they use showError. */
export function notify(text: string, tone: Notice['tone'] = 'success') {
  const n = { id: ++noticeId, text, tone };
  noticeListeners.forEach((l) => l(n));
}
export function subscribeNotices(l: (n: Notice) => void) { noticeListeners.add(l); return () => { noticeListeners.delete(l); }; }

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.message ?? `HTTP ${status}`); }
}

interface Opts { blob?: boolean; noAuth?: boolean }

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

// One refresh in flight per tab; every request that got a 401 waits for it.
let refreshing: Promise<boolean> | null = null;
let refreshes = 0; // successful refreshes in this tab
function refresh(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  if (!getSession()) return false;
  const res = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: CSRF });
  if (res.ok) { refreshes++; return true; }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body.code === 'REFRESH_RACE') {
    // Another tab rotated the token a moment ago; its response puts the new cookies in the shared jar. Retry once.
    await new Promise((r) => setTimeout(r, 1000));
    return true;
  }
  // Only a real 401 ends the session; 429 / 5xx just fail this request.
  if (res.status === 401) setSession(null);
  return false;
}

// Follow another tab logging in or out (they share localStorage and the cookies).
window.addEventListener('storage', (e) => { if (e.key === KEY) window.dispatchEvent(new Event('session')); });

export async function api<T = any>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  if (method !== 'GET') showError(null);
  let sentAfter = refreshes;
  const send = () => {
    const headers: Record<string, string> = { ...CSRF };
    sentAfter = refreshes;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(API + path, { method, headers, body: payload });
  };
  let res = await send();
  if (res.status === 401 && !opts.noAuth && getSession()) {
    // This tab already refreshed while this request was out: just resend with the new cookie.
    const fresh = refreshes !== sentAfter || (await refresh());
    if (fresh) res = await send();
  }
  if (!res.ok) {
    let data: any;
    try { data = await res.json(); } catch { data = { message: res.statusText }; }
    showError({ status: res.status, code: data.code, message: data.message, details: data.details, path: `${method} ${path}` });
    throw new ApiError(res.status, data);
  }
  if (opts.blob) return (await res.blob()) as T;
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const get = <T = any>(path: string, opts?: Opts) => api<T>('GET', path, undefined, opts);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const del = <T = any>(path: string, body?: unknown) => api<T>('DELETE', path, body);

/** Build a query string, dropping empty values. Arrays repeat the key (?status=A&status=B). */
export function qs(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => p.append(k, item));
    else if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Run an action; errors are already shown (error toast), so swallow them. Returns true on success.
 * `success`: a confirmation toast to show when it worked.
 */
export async function act(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) notify(success);
    return true;
  } catch (e) {
    if (!(e instanceof ApiError)) showError({ status: 0, message: String(e) });
    return false;
  }
}

/** Open a protected file (auth header needed, so no plain link). */
export async function openFile(path: string) {
  const w = window.open('', '_blank');
  try {
    const blob = await get<Blob>(path, { blob: true });
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch { w?.close(); }
}

export async function login(email: string, password: string): Promise<User> {
  // The response sets the token cookies; the body only says who logged in.
  const r = await api<any>('POST', '/auth/login', { email, password }, { noAuth: true });
  setSession({ user: r.user });
  // The account's language wins over whatever this browser showed before login (never the other way round).
  if (isLang(r.user.preferredLanguage)) setLang(r.user.preferredLanguage);
  return r.user;
}

function storeUser(user: User) {
  const s = getSession();
  if (s) setSession({ ...s, user: { ...s.user, ...user } });
}

/** App start with a session: re-read the account, whose language may have been changed on another device. */
export async function syncLanguageFromAccount(): Promise<void> {
  if (!getSession()) return;
  const me = await get<User>('/auth/me');
  storeUser(me);
  if (isLang(me.preferredLanguage)) setLang(me.preferredLanguage);
}

/** The switcher: apply at once; when logged in, save it on the account (PATCH /auth/me), and undo if that fails. */
export async function changeLanguage(lang: Lang): Promise<boolean> {
  const previous = getLang();
  setLang(lang);
  if (!getSession()) return true;
  try {
    storeUser(await patch<User>('/auth/me', { preferredLanguage: lang }));
    return true;
  } catch {
    setLang(previous);
    return false;
  }
}

export async function logout() {
  // Revokes the refresh token and clears both cookies.
  await api('POST', '/auth/logout', undefined, { noAuth: true }).catch(() => {});
  setSession(null);
}

export const PAYMENT_METHODS = ['CASH', 'CARD', 'WALLET', 'INSTAPAY'];
