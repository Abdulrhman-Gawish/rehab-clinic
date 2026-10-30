import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';
import { normalizePersonName } from '../utils/person-name.util.js';

// Like @IsOptional() but only for `undefined`: an explicit null is still
// validated (and rejected) by the other decorators. Use for PATCH fields
// backed by NOT NULL columns.
export const OptionalNotNull = () =>
  ValidateIf((_object, value) => value !== undefined);

// Trims strings and collapses inner whitespace ("  Ahmed   Ali " -> "Ahmed Ali").
export const TrimAndCollapse = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizePersonName(value) : value,
  );

export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

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

// Query strings arrive as "true"/"false"; anything else is left for
// @IsBoolean() to reject.
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
