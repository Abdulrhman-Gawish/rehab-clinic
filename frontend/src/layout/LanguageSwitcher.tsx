import { useState } from 'react';
import { changeLanguage, showError } from '../api';
import { LANGS, useI18n, type Lang } from '../i18n';

const SHORT: Record<Lang, string> = { ar: 'ع', en: 'EN' };

/** Arabic / English. Saved on the account when logged in, so every device gets it (docs/FRONTEND_LOCALIZATION.md). */
export function LanguageSwitcher({ inverse }: { inverse?: boolean }) {
  const { t, lang } = useI18n();
  const [saving, setSaving] = useState(false);
  const pick = async (next: Lang) => {
    if (next === lang || saving) return;
    setSaving(true);
    if (!(await changeLanguage(next))) showError({ status: 0, message: t.language.saveFailed });
    setSaving(false);
  };
  return (
    <div className={`lang-switch${inverse ? ' lang-switch--inverse' : ''}`} role="group" aria-label={t.language.label}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={l === lang} disabled={saving} title={t.language[l]} onClick={() => pick(l)}>
          <span aria-hidden="true">{SHORT[l]}</span><span className="visually-hidden">{t.language[l]}</span>
        </button>
      ))}
    </div>
  );
}
