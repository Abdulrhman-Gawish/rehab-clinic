import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

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
