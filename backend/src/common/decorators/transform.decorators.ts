import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

// Like @IsOptional() but only for `undefined`: an explicit null is still
// validated (and rejected) by the other decorators. Use for PATCH fields
// backed by NOT NULL columns.
export const OptionalNotNull = () =>
  ValidateIf((_object, value) => value !== undefined);

// Trims strings and collapses inner whitespace ("  Ahmed   Ali " -> "Ahmed Ali").
export const TrimAndCollapse = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  );

export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export const ToLowerCaseTrimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

// Query strings arrive as "true"/"false"; anything else is left for
// @IsBoolean() to reject.
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
