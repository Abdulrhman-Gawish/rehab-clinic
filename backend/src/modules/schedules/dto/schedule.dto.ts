import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { IsLocalTime } from '../../../common/decorators/date-time.decorators.js';
import { OptionalNotNull } from '../../../common/decorators/transform.decorators.js';
import type { DoctorSchedule } from '../entities/doctor-schedule.entity.js';

const DAY_DOC = {
  minimum: 0,
  maximum: 6,
  example: 0,
  description: '0 = Sunday ... 6 = Saturday (clinic local time)',
};
const TIME_DOC = (example: string) => ({
  example,
  description: 'Clinic local wall-clock time, HH:mm',
});

// 'HH:MM:SS' from Postgres -> 'HH:mm'.
const toHHmm = (time: string) => time.slice(0, 5);

export class CreateScheduleDto {
  @ApiProperty(DAY_DOC)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty(TIME_DOC('09:00'))
  @IsLocalTime()
  startTime: string;

  @ApiProperty(TIME_DOC('13:00'))
  @IsLocalTime()
  endTime: string;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional(DAY_DOC)
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @ApiPropertyOptional(TIME_DOC('09:00'))
  @OptionalNotNull()
  @IsLocalTime()
  startTime?: string;

  @ApiPropertyOptional(TIME_DOC('13:00'))
  @OptionalNotNull()
  @IsLocalTime()
  endTime?: string;
}

export class ScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  doctorId: string;

  @ApiProperty(DAY_DOC)
  dayOfWeek: number;

  @ApiProperty(TIME_DOC('09:00'))
  startTime: string;

  @ApiProperty(TIME_DOC('13:00'))
  endTime: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(this: void, schedule: DoctorSchedule): ScheduleResponseDto {
    return {
      id: schedule.id,
      doctorId: schedule.doctorId,
      dayOfWeek: schedule.dayOfWeek,
      startTime: toHHmm(schedule.startTime),
      endTime: toHHmm(schedule.endTime),
      isActive: schedule.isActive,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    };
  }
}
