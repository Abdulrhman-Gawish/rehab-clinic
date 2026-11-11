// Nest answers an empty body when a handler returns null. For "nothing
// found" answers that clients branch on (`200 null`), return
// `orJsonNull(value)` instead: it serializes as the JSON literal `null`.
const JSON_NULL = { toJSON: () => null };

export function orJsonNull<T>(value: T | null): T | null {
  return value ?? (JSON_NULL as unknown as null);
}
