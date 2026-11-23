import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';
import { normalizePersonName } from '../utils/person-name.util.js';

// Like @IsOptional() but only for `undefined`: an explicit null is still
// validated (and rejected) by the other decorators. Use for PATCH fields
// backed by NOT NULL columns.
export const OptionalNotNull = () =>
  ValidateIf((_object, value) => value !== undefined);

// Skips the other validators when the value is undefined or null. Use for
// PATCH fields backed by nullable columns (null clears the field).
export const NullableOptional = () =>
  ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  );

// Trims strings and collapses inner whitespace ("  Ahmed   Ali " -> "Ahmed Ali").
export const TrimAndCollapse = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizePersonName(value) : value,
  );

export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

// Optional text: trimmed, and a blank string becomes null, so clearing a
// textarea clears the field. `collapse` also collapses inner whitespace.
// Use on every optional (nullable) text field, with @IsOptional().
export const TrimOrNull = ({ collapse = false } = {}) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const text = collapse ? normalizePersonName(value) : value.trim();
    return text === '' ? null : text;
  });

export const ToLowerCaseTrimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

// Query arrays: ?status=A&status=B or ?status=A,B -> ['A', 'B'].
export const ToArray = () =>
  Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).flatMap((item: unknown) =>
      typeof item === 'string' ? item.split(',').map((s) => s.trim()) : [item],
    ),
  );

// Multipart lists: one field per item (or `name[]`); a single item arrives as
// a plain string. Each item is trimmed. `dropEmpty` removes blank items, so a
// single empty field sends an empty list (multipart cannot send `[]`).
export const ToTrimmedList = ({ dropEmpty = false } = {}) =>
  Transform(({ value }: { value: unknown }) => {
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list)) return list;
    const items = list.map((item: unknown) =>
      typeof item === 'string' ? item.trim() : item,
    );
    return dropEmpty ? items.filter((item) => item !== '') : items;
  });

// Query strings arrive as "true"/"false"; anything else is left for
// @IsBoolean() to reject.
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
