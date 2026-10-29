import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import { ToBoolean } from '../../../common/decorators/transform.decorators.js';

export class PublicSlotsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({
    example: '2026-11-05',
    description: 'Clinic local date (YYYY-MM-DD)',
  })
  @IsLocalDate()
  date: string;
}

export class StaffSlotsQueryDto extends PublicSlotsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  doctorId: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Reception only: whole day, ignoring schedule, time off and lead time (still excludes booked slots)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeOutsideSchedule?: boolean;
}

export class SlotDto {
  @ApiProperty({ example: '2026-11-05T17:00:00+02:00' })
  startAt: string;

  @ApiProperty({ example: '2026-11-05T17:30:00+02:00' })
  endAt: string;
}
