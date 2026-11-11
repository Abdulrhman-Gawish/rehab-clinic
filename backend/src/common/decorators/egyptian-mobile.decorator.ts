import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import {
  EGYPTIAN_MOBILE_E164,
  tryNormalizeEgyptianMobile,
} from '../utils/phone.util.js';

// DTO field decorator: normalizes the phone to +201XXXXXXXXX before
// validation runs, then validates the normalized value. Invalid input is
// left untouched so the validation error can report it.
export function EgyptianMobile() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? (tryNormalizeEgyptianMobile(value) ?? value)
        : value,
    ),
    IsString(),
    Matches(EGYPTIAN_MOBILE_E164, {
      message:
        '$property must be an Egyptian mobile number (010, 011, 012 or 015 followed by 8 digits)',
    }),
  );
}
