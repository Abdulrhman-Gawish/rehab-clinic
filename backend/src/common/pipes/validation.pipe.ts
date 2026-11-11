import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export interface FieldError {
  field: string;
  // English messages (for developers and logs).
  errors: string[];
  // The failed rules, same order as `errors` (e.g. 'isNotEmpty', 'isEnum',
  // 'whitelistValidation'): stable keys a client translates.
  constraints: string[];
}

// Flattens nested class-validator errors into
// [{ field: 'a.b', errors, constraints }].
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own: FieldError[] = error.constraints
      ? [
          {
            field,
            errors: Object.values(error.constraints),
            constraints: Object.keys(error.constraints),
          },
        ]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Validation failed',
        details: flattenValidationErrors(errors),
      }),
  });
}
