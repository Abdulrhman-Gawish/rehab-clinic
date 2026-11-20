import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { addDays } from '../../common/time/clinic-time.util.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { DoctorSchedulesService } from './doctor-schedules.service.js';
import { DoctorTimeOffService } from './doctor-time-off.service.js';
import {
  WORKING_HOURS_MAX_DAYS,
  WorkingHoursQueryDto,
  WorkingHoursResponseDto,
} from './dto/working-hours.dto.js';

// The desk calendar's shading in one request (instead of two per doctor).
@ApiTags('Doctor schedules & time off')
@Controller('working-hours')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class WorkingHoursController {
  constructor(
    private readonly schedules: DoctorSchedulesService,
    private readonly timeOff: DoctorTimeOffService,
    private readonly access: DoctorAccessService,
    private readonly time: ClinicTimeService,
  ) {}

  @Get()
  @Auth(UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR)
  @ApiOperation({
    summary: "Every doctor's weekly schedule and time off for a date range",
    description:
      'Active weekly ranges plus the time off overlapping from..to (inclusive, at most 31 days; else 422 DATE_OUT_OF_RANGE). A DOCTOR gets only their own.',
  })
  @ApiOkResponse({ type: WorkingHoursResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'DATE_OUT_OF_RANGE',
  })
  async list(
    @Query() query: WorkingHoursQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkingHoursResponseDto> {
    const maxTo = addDays(query.from, WORKING_HOURS_MAX_DAYS - 1);
    if (query.to < query.from || query.to > maxTo) {
      throw unprocessable(
        ErrorCode.DATE_OUT_OF_RANGE,
        `to must be between ${query.from} and ${maxTo}`,
        { from: query.from, to: maxTo },
      );
    }
    const doctorId = await this.access.scopeFor(user);
    const { start } = this.time.dayBounds(query.from);
    const { end } = this.time.dayBounds(query.to);
    const [schedules, timeOff] = await Promise.all([
      this.schedules.listActive(doctorId),
      this.timeOff.listOverlapping(doctorId, start, end),
    ]);
    return { schedules, timeOff };
  }
}
