import { registerDecorator, type ValidationOptions } from 'class-validator';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar date (YYYY-MM-DD) between 1900-01-01 and today (UTC).
export function isBirthDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  const today = new Date().toISOString().slice(0, 10);
  return isRealDate && year >= 1900 && value <= today;
}

export function IsBirthDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isBirthDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: '$property must be a past date in YYYY-MM-DD format',
        ...options,
      },
      validator: { validate: isBirthDate },
    });
}
