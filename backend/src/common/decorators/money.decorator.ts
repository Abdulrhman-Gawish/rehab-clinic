import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, ValidateBy } from 'class-validator';
import { isPositiveMoney } from '../utils/money.util.js';

// Money travels as a decimal string ("150.00") end to end so no JS float
// math ever touches it. Fits numeric(12,2).
export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const IsMoney = () =>
  applyDecorators(
    IsString(),
    Matches(MONEY_PATTERN, {
      message:
        '$property must be a non-negative decimal string with at most 2 decimals, e.g. "150.00"',
    }),
  );

// IsMoney() and strictly greater than 0.
export const IsPositiveMoney = () =>
  applyDecorators(
    IsMoney(),
    ValidateBy({
      name: 'isPositiveMoney',
      validator: {
        // Malformed values are reported by IsMoney() only.
        validate: (value: unknown) =>
          typeof value !== 'string' ||
          !MONEY_PATTERN.test(value) ||
          isPositiveMoney(value),
        defaultMessage: () => '$property must be greater than 0',
      },
    }),
  );
