import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import {
  OptionalNotNull,
  ToBoolean,
  ToLowerCaseTrimmed,
  TrimAndCollapse,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRole } from '../../../common/enums/user-role.enum.js';
import type { User } from '../entities/user.entity.js';

// ---------- Field decorators ----------

// Shared by user, doctor, patient and appointment DTOs (a doctor is also a
// user). `required: false` makes the field optional for PATCH bodies while
// still rejecting an explicit null.

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

// ---------- Inputs ----------

// Doctors are created through POST /doctors (user + profile together).
export const MANAGEABLE_ROLES = [
  UserRole.OWNER,
  UserRole.RECEPTIONIST,
] as const;
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

export class CreateUserDto {
  @PersonNameField()
  name: string;

  @EmailField()
  email: string;

  @OptionalStaffPhoneField()
  phone?: string | null;

  @PasswordField()
  password: string;

  @ApiProperty({
    enum: MANAGEABLE_ROLES,
    description: 'DOCTOR accounts are created via POST /doctors',
  })
  @IsIn(MANAGEABLE_ROLES, {
    message: 'role must be OWNER or RECEPTIONIST (create doctors via /doctors)',
  })
  role: ManageableRole;
}

// Password changes go through POST /users/:id/reset-password and
// activation through the activate/deactivate endpoints.
export class UpdateUserDto {
  @PersonNameField({ required: false })
  name?: string;

  @EmailField({ required: false })
  email?: string;

  @OptionalStaffPhoneField()
  phone?: string | null;

  @ApiPropertyOptional({ enum: MANAGEABLE_ROLES })
  @OptionalNotNull()
  @IsIn(MANAGEABLE_ROLES)
  role?: ManageableRole;
}

export class ResetPasswordDto {
  @PasswordField()
  newPassword: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Matches name or email' })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// ---------- Outputs ----------

// Public shape of a user. Built field by field so password_hash can never leak.
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  @ApiProperty({ example: 'mona@clinic.com' })
  email: string;

  @ApiProperty({ nullable: true, type: String, example: '+201012345678' })
  phone: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, type: Date })
  lastLoginAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, user: User): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
