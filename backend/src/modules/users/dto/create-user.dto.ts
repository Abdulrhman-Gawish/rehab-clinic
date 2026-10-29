import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum.js';
import {
  EmailField,
  OptionalStaffPhoneField,
  PasswordField,
  PersonNameField,
} from './user-fields.js';

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
