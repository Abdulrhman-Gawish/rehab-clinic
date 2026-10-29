import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  isValidLocalDate,
  LOCAL_TIME,
  parseIsoWithOffset,
} from '../time/clinic-time.util.js';

function simple(
  name: string,
  message: string,
  validate: (value: unknown) => boolean,
) {
  return (options?: ValidationOptions): PropertyDecorator =>
    (target, propertyName) =>
      registerDecorator({
        name,
        target: target.constructor,
        propertyName: propertyName as string,
        options: { message, ...options },
        validator: { validate },
      });
}

// ISO 8601 date-time with an explicit offset: 2026-11-05T17:00:00+02:00.
export const IsIsoWithOffset = simple(
  'isIsoWithOffset',
  '$property must be an ISO 8601 date-time with offset, e.g. 2026-11-05T17:00:00+02:00',
  (value) => typeof value === 'string' && parseIsoWithOffset(value) !== null,
);

// Clinic-local calendar date: YYYY-MM-DD.
export const IsLocalDate = simple(
  'isLocalDate',
  '$property must be a date in YYYY-MM-DD format',
  (value) => typeof value === 'string' && isValidLocalDate(value),
);

// Clinic-local wall-clock time: HH:mm (00:00 to 23:59).
export const IsLocalTime = simple(
  'isLocalTime',
  '$property must be a time in HH:mm format',
  (value) => typeof value === 'string' && LOCAL_TIME.test(value),
);
