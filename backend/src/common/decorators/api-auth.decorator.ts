import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto.js';
import type { UserRole } from '../enums/user-role.enum.js';
import { Roles } from './roles.decorator.js';

// @Roles(...) plus the matching Swagger documentation.
export function Auth(...roles: UserRole[]) {
  return applyDecorators(
    Roles(...roles),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      type: ErrorResponseDto,
      description: 'Missing, invalid or expired access token',
    }),
    ApiForbiddenResponse({
      type: ErrorResponseDto,
      description: `Allowed roles: ${roles.join(', ')}`,
    }),
  );
}
