import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsIsoWithOffset } from '../../../common/decorators/date-time.decorators.js';
import {
  OptionalNotNull,
  Trim,
} from '../../../common/decorators/transform.decorators.js';
import { AppointmentSummaryDto } from '../../appointments/dto/appointment-summary.dto.js';
import type { DoctorTimeOff } from '../entities/doctor-time-off.entity.js';

const AT_DOC = (example: string) => ({
  example,
  description: 'ISO 8601 with offset',
});

export class CreateTimeOffDto {
  @ApiProperty(AT_DOC('2026-11-10T09:00:00+02:00'))
  @IsIsoWithOffset()
  startAt: string;

  @ApiProperty(AT_DOC('2026-11-10T17:00:00+02:00'))
  @IsIsoWithOffset()
  endAt: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 255 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class UpdateTimeOffDto {
  @ApiPropertyOptional(AT_DOC('2026-11-10T09:00:00+02:00'))
  @OptionalNotNull()
  @IsIsoWithOffset()
  startAt?: string;

  @ApiPropertyOptional(AT_DOC('2026-11-10T17:00:00+02:00'))
  @OptionalNotNull()
  @IsIsoWithOffset()
  endAt?: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 255 })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Trim()
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}

export class ListTimeOffQueryDto {
  @ApiPropertyOptional(AT_DOC('2026-11-01T00:00:00+02:00'))
  @IsOptional()
  @IsIsoWithOffset()
  from?: string;

  @ApiPropertyOptional(AT_DOC('2026-12-01T00:00:00+02:00'))
  @IsOptional()
  @IsIsoWithOffset()
  to?: string;
}

export class TimeOffResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  doctorId: string;

  @ApiProperty(AT_DOC('2026-11-10T09:00:00+02:00'))
  startAt: string;

  @ApiProperty(AT_DOC('2026-11-10T17:00:00+02:00'))
  endAt: string;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ format: 'uuid' })
  createdById: string;

  @ApiProperty()
  createdAt: Date;

  static fromEntity(
    timeOff: DoctorTimeOff,
    toIso: (instant: Date) => string,
  ): TimeOffResponseDto {
    return {
      id: timeOff.id,
      doctorId: timeOff.doctorId,
      startAt: toIso(timeOff.startAt),
      endAt: toIso(timeOff.endAt),
      reason: timeOff.reason,
      createdById: timeOff.createdById,
      createdAt: timeOff.createdAt,
    };
  }
}

export class TimeOffMutationResponseDto {
  @ApiProperty({ type: TimeOffResponseDto })
  timeOff: TimeOffResponseDto;

  @ApiProperty({
    type: [AppointmentSummaryDto],
    description:
      'Active appointments overlapping the period. They are NOT cancelled automatically; reception must handle them.',
  })
  conflictingAppointments: AppointmentSummaryDto[];
}
