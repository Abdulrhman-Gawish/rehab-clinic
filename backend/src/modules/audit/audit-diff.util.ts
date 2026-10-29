import type { AuditValues } from './entities/audit-log.entity.js';

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

// Old/new values of only the given keys that actually changed.
// Returns null when nothing changed.
export function diffValues<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[],
): { oldValues: AuditValues; newValues: AuditValues } | null {
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  for (const key of keys) {
    const previous = comparable(before[key]);
    const next = comparable(after[key]);
    if (previous !== next) {
      oldValues[key] = previous;
      newValues[key] = next;
    }
  }
  return Object.keys(newValues).length ? { oldValues, newValues } : null;
}

// Snapshot of the given keys, for "created" entries.
export function pickValues<T extends object>(
  source: T,
  keys: readonly (keyof T & string)[],
): AuditValues {
  return Object.fromEntries(keys.map((key) => [key, comparable(source[key])]));
}
