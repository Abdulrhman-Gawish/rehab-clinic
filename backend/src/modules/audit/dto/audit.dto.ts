import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  LocalDateFrom,
  LocalDateTo,
} from '../../../common/decorators/date-time.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { UserRole } from '../../../common/enums/user-role.enum.js';
import { AuditAction, AuditEntityType } from '../audit.constants.js';
import type { AuditLog, AuditValues } from '../entities/audit-log.entity.js';

// ---------- Inputs ----------

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditEntityType })
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Acting user' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @LocalDateFrom('Logged')
  from?: string;

  @LocalDateTo('Logged')
  to?: string;
}

// ---------- Outputs ----------

export class AuditUserDto extends UserRefDto {
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;
}

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    type: AuditUserDto,
    nullable: true,
    description: 'Acting user; null for public/system actions',
  })
  user: AuditUserDto | null;

  @ApiProperty({ example: 'PATIENT_UPDATED' })
  action: string;

  @ApiProperty({ example: 'PATIENT' })
  entityType: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  entityId: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { phone: '+201012345678' },
  })
  oldValues: AuditValues | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { phone: '+201112345678' },
  })
  newValues: AuditValues | null;

  @ApiProperty({ nullable: true, type: String, example: '203.0.113.7' })
  ip: string | null;

  @ApiProperty()
  createdAt: Date;

  // Requires `user` to be loaded.
  static fromEntity(this: void, log: AuditLog): AuditLogResponseDto {
    return {
      id: log.id,
      user: log.user
        ? { id: log.user.id, name: log.user.name, role: log.user.role }
        : null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      oldValues: log.oldValues,
      newValues: log.newValues,
      ip: log.ip,
      createdAt: log.createdAt,
    };
  }
}
