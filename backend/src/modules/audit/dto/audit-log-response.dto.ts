import { ApiProperty } from '@nestjs/swagger';
import type { AuditLog, AuditValues } from '../entities/audit-log.entity.js';

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
