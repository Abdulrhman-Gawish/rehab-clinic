// The current UI language: Arabic by default (first visit, before login), English optional.
// The account's preferredLanguage is the source of truth (applied at login and on app start, saved by the
// switcher); localStorage only caches it so the first paint is right. See docs/FRONTEND_LOCALIZATION.md.
import { useSyncExternalStore } from 'react';
import { ar } from './ar';
import { en, type Messages } from './en';

export type Lang = 'ar' | 'en';
export const LANGS: Lang[] = ['ar', 'en'];
export const DEFAULT_LANG: Lang = 'ar';

const CATALOGS: Record<Lang, Messages> = { ar, en };
// Display formatting only; values sent to the API never follow the locale. Arabic keeps Western digits (0-9), as the
// clinic's website always did (DESIGN_SYSTEM_PROPOSAL.md section 3.2).
const LOCALES: Record<Lang, string> = { ar: 'ar-EG-u-nu-latn', en: 'en-GB' };
const KEY = 'rehab-lang';
try {
  // Before the rename to frontend/.
  const old = localStorage.getItem('playground-lang');
  if (old && !localStorage.getItem(KEY)) localStorage.setItem(KEY, old);
  localStorage.removeItem('playground-lang');
} catch { /* private mode */ }

export const isLang = (value: unknown): value is Lang => value === 'ar' || value === 'en';

function cached(): Lang | null {
  try {
    const value = localStorage.getItem(KEY);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

let current: Lang = cached() ?? DEFAULT_LANG;
const listeners = new Set<() => void>();

function applyToDocument() {
  const html = document.documentElement;
  html.lang = current;
  html.dir = current === 'ar' ? 'rtl' : 'ltr';
  document.title = CATALOGS[current].app.title;
}
applyToDocument();

export const getLang = (): Lang => current;
export const locale = (): string => LOCALES[current];
/** The current catalog, for code outside React render (prompts, confirms). */
export const msg = (): Messages => CATALOGS[current];

/** Switches the UI (and caches the choice). Saving it on the account is the caller's job (see language.ts). */
export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* private mode: the account still has it */ }
  applyToDocument();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders the component when the language changes. */
export function useI18n(): { t: Messages; lang: Lang } {
  const lang = useSyncExternalStore(subscribe, getLang);
  return { t: CATALOGS[lang], lang };
}

/** Label of an API value (enum, code, field), or the value itself when there is no translation. */
export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (value == null) return '';
  return map[value] ?? value;
}

// Another tab switched: follow it.
window.addEventListener('storage', (e) => {
  if (e.key === KEY && isLang(e.newValue)) setLang(e.newValue);
});
