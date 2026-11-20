import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';
import { fmtDateTime, fmtMoney } from './format';
import { label, useI18n } from './i18n';
import type { Messages } from './i18n/en';

/** Load data on mount / when deps change; `reload()` re-runs it. Errors go to the error bar. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, () => void, boolean] {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => { if (!(e instanceof ApiError)) console.error(e); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [data, useCallback(() => setTick((t) => t + 1), []), loading];
}

/** Plain controlled-form helper. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const bind = (k: keyof T) => ({
    value: (v[k] ?? '') as any,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV((old) => ({ ...old, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })),
  });
  return { v, setV, bind };
}

/** Empty string -> undefined (so optional fields are left out). Blank strings sent anyway become null on the server. */
export const opt = (s: string | undefined | null) => (s && s.trim() ? s.trim() : undefined);

/** A table as a CSV file (UTF-8 with BOM so Excel shows Arabic). Values are written as shown on screen. */
export function downloadCsv(fileName: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Phone numbers, codes, emails, ids: always left-to-right, also inside Arabic text ("+2010…" not "…2010+"). */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

// Which translation map labels a value of these keys (audit values, timeline details).
const VALUE_ENUMS: Record<string, keyof Messages['enums']> = {
  method: 'PaymentMethod', paymentMethod: 'PaymentMethod', source: 'AppointmentSource', paymentType: 'PaymentType',
  status: 'AppointmentStatus', role: 'UserRole', gender: 'Gender', createdSource: 'PatientSource',
  channel: 'AcquisitionChannel', applicability: 'ReferralApplicability', kind: 'CommissionKind',
  commissionType: 'ReferralRateType', category: 'BlogCategory',
};
const MONEY_KEYS = new Set(['amount', 'total', 'price', 'listPrice', 'offerAmount', 'basePrice', 'priceOverride', 'unitPrice', 'subtotal', 'discountTotal', 'amountPaid', 'balance', 'lineTotal', 'invoiceAmountPaid', 'baseAmount', 'invoiceTotal', 'outstandingBefore']);

// Any other UPPER_CASE value (statuses of any entity, triggers, reasons): the first enum that knows it.
const FALLBACK_ENUMS: (keyof Messages['enums'])[] = [
  'AppointmentStatus', 'VisitStatus', 'InvoiceStatus', 'PaymentStatus', 'PaymentType', 'PaymentMethod', 'NoteStatus',
  'PatientPackageStatus', 'PackageUsageReason', 'DiscountType', 'ExpenseStatus', 'AppointmentSource', 'AppointmentType', 'AuditValue',
  'UserRole', 'Gender', 'PatientReferralStatus', 'CommissionStatus', 'CommissionKind', 'ReferralRateType',
  'ReferralApplicability', 'AcquisitionChannel',
];

/** One value of API data (audit values, timeline details) in the UI language. */
export function formatValue(t: Messages, key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return t.common.none;
  if (typeof value === 'boolean') return value ? t.common.yes : t.common.no;
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' && key === 'fields' ? label(t.fields, v) : formatValue(t, key, v))).join(t.common.listSep);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    // e.g. an invoice item: "Quantity: 1 · Unit price: 200.00 EGP"
    return Object.entries(record).map(([k, v]) => `${label(t.fields, k)}: ${formatValue(t, k, v)}`).join(' · ');
  }
  const text = String(value);
  if (key.endsWith('At') && /^\d{4}-\d\d-\d\dT/.test(text)) return fmtDateTime(text);
  if (MONEY_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(text)) return fmtMoney(text);
  if (key === 'preferredLanguage') return label({ ar: t.language.ar, en: t.language.en }, text);
  const map = VALUE_ENUMS[key];
  const enums = t.enums as unknown as Record<string, Record<string, string>>;
  if (map && enums[map][text]) return enums[map][text];
  if (key === 'type') return label({ ...t.enums.ReferralRateType, ...t.enums.DiscountType, ...t.enums.PaymentType }, text);
  if (/^[A-Z][A-Z_]+$/.test(text)) {
    for (const name of FALLBACK_ENUMS) if (enums[name][text]) return enums[name][text];
  }
  return text;
}

/** API data as "Field: value" lines, field names translated. */
export function Values({ value, inline = false }: { value: Record<string, unknown> | null | undefined; inline?: boolean }) {
  const { t } = useI18n();
  if (!value) return null;
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== '');
  if (inline) {
    return <>{entries.map(([k, v], i) => <span key={k}>{i > 0 && ' · '}{label(t.fields, k)}: <bdi>{formatValue(t, k, v)}</bdi></span>)}</>;
  }
  return (
    <div style={{ fontSize: 12 }}>
      {entries.map(([k, v]) => <div key={k}><b>{label(t.fields, k)}:</b> <bdi>{formatValue(t, k, v)}</bdi></div>)}
    </div>
  );
}
