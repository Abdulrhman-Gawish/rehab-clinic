import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  OptionalNotNull,
  ToLowerCaseTrimmed,
  TrimAndCollapse,
} from '../../../common/decorators/transform.decorators.js';

// Field decorators shared by user and doctor DTOs (a doctor is also a user).
// `required: false` makes the field optional for PATCH bodies while still
// rejecting an explicit null.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

interface FieldOptions {
  required?: boolean;
}

const optionality = (required: boolean) =>
  required ? [] : [OptionalNotNull()];

export const PersonNameField = ({ required = true }: FieldOptions = {}) =>
  applyDecorators(
    ApiProperty({
      example: 'Mona Adel',
      minLength: 2,
      maxLength: 120,
      required,
    }),
    ...optionality(required),
    TrimAndCollapse(),
    IsString(),
    Length(2, 120),
  );

export const EmailField = ({ required = true }: FieldOptions = {}) =>
  applyDecorators(
    ApiProperty({
      example: 'mona@clinic.com',
      description: 'Stored lowercased',
      required,
    }),
    ...optionality(required),
    ToLowerCaseTrimmed(),
    IsEmail(),
    MaxLength(254),
  );

export const PasswordField = () =>
  applyDecorators(
    ApiProperty({
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      example: 'S3cure-passw0rd',
    }),
    IsString(),
    Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH),
  );

// Optional staff phone; null clears it on update.
export const OptionalStaffPhoneField = () =>
  applyDecorators(
    ApiProperty({
      required: false,
      nullable: true,
      type: String,
      example: '01012345678',
      description: 'Egyptian mobile, stored as +201XXXXXXXXX',
    }),
    IsOptional(),
    ValidateIf((_object, value) => value !== null),
    EgyptianMobile(),
  );
