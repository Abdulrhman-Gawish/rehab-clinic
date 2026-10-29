import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/transform.decorators.js';
import { MANAGEABLE_ROLES, type ManageableRole } from './create-user.dto.js';
import {
  EmailField,
  OptionalStaffPhoneField,
  PersonNameField,
} from './user-fields.js';

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
