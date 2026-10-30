import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
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

  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO 8601)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

// ---------- Outputs ----------

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Acting user; null for public/system actions',
  })
  userId: string | null;

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

  static fromEntity(this: void, log: AuditLog): AuditLogResponseDto {
    return {
      id: log.id,
      userId: log.userId,
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
