// Tiny fetch wrapper: adds the access token, refreshes once on 401, publishes errors to the error bar.
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

export type Role = 'OWNER' | 'DOCTOR' | 'RECEPTIONIST';
export interface User { id: string; name: string; email: string; role: Role; doctorId: string | null }
interface Session { accessToken: string; refreshToken: string; user: User }

const KEY = 'playground-session';

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

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.message ?? `HTTP ${status}`); }
  get code(): string | undefined { return this.body?.code; }
}

interface Opts { blob?: boolean; noAuth?: boolean }

async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }),
  });
  if (!res.ok) { setSession(null); return false; }
  const t = await res.json();
  setSession({ ...s, accessToken: t.accessToken, refreshToken: t.refreshToken });
  return true;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  if (method !== 'GET') showError(null);
  const send = () => {
    const headers: Record<string, string> = {};
    const s = getSession();
    if (s && !opts.noAuth) headers.Authorization = `Bearer ${s.accessToken}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(API + path, { method, headers, body: payload });
  };
  let res = await send();
  if (res.status === 401 && !opts.noAuth && getSession() && (await refresh())) res = await send();
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

/** Run an action; errors are already shown in the error bar, so swallow them. Returns true on success. */
export async function act(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return true; } catch (e) { if (!(e instanceof ApiError)) showError({ status: 0, message: String(e) }); return false; }
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
  const r = await api<any>('POST', '/auth/login', { email, password }, { noAuth: true });
  setSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
  return r.user;
}

export async function logout() {
  const s = getSession();
  if (s) await api('POST', '/auth/logout', { refreshToken: s.refreshToken }, { noAuth: true }).catch(() => {});
  setSession(null);
}

export const PAYMENT_METHODS = ['CASH', 'CARD', 'WALLET', 'INSTAPAY'];
