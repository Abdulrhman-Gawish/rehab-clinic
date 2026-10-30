import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

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

export function Json({ value }: { value: unknown }) {
  return <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
}
