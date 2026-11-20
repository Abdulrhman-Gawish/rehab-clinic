import { ApiProperty } from '@nestjs/swagger';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import { ScheduleResponseDto } from './schedule.dto.js';
import { TimeOffResponseDto } from './time-off.dto.js';

/** GET /working-hours: the longest range, in days. */
export const WORKING_HOURS_MAX_DAYS = 31;

export class WorkingHoursQueryDto {
  @ApiProperty({
    example: '2026-11-07',
    description: 'First clinic local date',
  })
  @IsLocalDate()
  from: string;

  @ApiProperty({
    example: '2026-11-13',
    description: `Last clinic local date, inclusive (at most ${WORKING_HOURS_MAX_DAYS} days from \`from\`)`,
  })
  @IsLocalDate()
  to: string;
}

export class WorkingHoursResponseDto {
  @ApiProperty({
    type: [ScheduleResponseDto],
    description: 'Active weekly ranges of every doctor (clinic local time)',
  })
  schedules: ScheduleResponseDto[];

  @ApiProperty({
    type: [TimeOffResponseDto],
    description: 'Time off overlapping the range',
  })
  timeOff: TimeOffResponseDto[];
}
