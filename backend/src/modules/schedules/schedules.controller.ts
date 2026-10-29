import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import {
  CurrentActor,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { DoctorSchedulesService } from './doctor-schedules.service.js';
import { DoctorTimeOffService } from './doctor-time-off.service.js';
import {
  CreateScheduleDto,
  ScheduleResponseDto,
  UpdateScheduleDto,
} from './dto/schedule.dto.js';
import {
  CreateTimeOffDto,
  ListTimeOffQueryDto,
  TimeOffMutationResponseDto,
  TimeOffResponseDto,
  UpdateTimeOffDto,
} from './dto/time-off.dto.js';

const READERS = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const MANAGERS = [UserRole.OWNER, UserRole.RECEPTIONIST];

// Doctors may read only their own schedule/time off; others get 404.
@ApiTags('Doctor schedules & time off')
@Controller('doctors/:doctorId')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
export class SchedulesController {
  constructor(
    private readonly schedules: DoctorSchedulesService,
    private readonly timeOff: DoctorTimeOffService,
  ) {}

  @Get('schedules')
  @Auth(...READERS)
  @ApiOperation({ summary: 'Weekly schedule ranges (clinic local time)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [ScheduleResponseDto] })
  listSchedules(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive: boolean | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScheduleResponseDto[]> {
    return this.schedules.list(doctorId, user, includeInactive ?? false);
  }

  @Post('schedules')
  @Auth(...MANAGERS)
  @ApiOperation({
    summary: 'Add a weekly range; ranges of one day must not overlap',
  })
  @ApiCreatedResponse({ type: ScheduleResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SCHEDULE_OVERLAP',
  })
  createSchedule(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() dto: CreateScheduleDto,
    @CurrentActor() actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.schedules.create(doctorId, dto, actor);
  }

  @Patch('schedules/:scheduleId')
  @Auth(...MANAGERS)
  @ApiOkResponse({ type: ScheduleResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SCHEDULE_OVERLAP',
  })
  updateSchedule(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentActor() actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.schedules.update(doctorId, scheduleId, dto, actor);
  }

  @Patch('schedules/:scheduleId/activate')
  @Auth(...MANAGERS)
  @ApiOkResponse({ type: ScheduleResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SCHEDULE_OVERLAP',
  })
  activateSchedule(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentActor() actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.schedules.setActive(doctorId, scheduleId, true, actor);
  }

  @Patch('schedules/:scheduleId/deactivate')
  @Auth(...MANAGERS)
  @ApiOkResponse({ type: ScheduleResponseDto })
  deactivateSchedule(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentActor() actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.schedules.setActive(doctorId, scheduleId, false, actor);
  }

  @Get('time-off')
  @Auth(...READERS)
  @ApiOkResponse({ type: [TimeOffResponseDto] })
  listTimeOff(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query() query: ListTimeOffQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TimeOffResponseDto[]> {
    return this.timeOff.list(doctorId, user, query);
  }

  @Post('time-off')
  @Auth(...MANAGERS)
  @ApiOperation({
    summary: 'Add time off',
    description:
      'Always created. Overlapping active appointments are returned in conflictingAppointments and are NOT cancelled.',
  })
  @ApiCreatedResponse({ type: TimeOffMutationResponseDto })
  createTimeOff(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() dto: CreateTimeOffDto,
    @CurrentActor() actor: Actor,
  ): Promise<TimeOffMutationResponseDto> {
    return this.timeOff.create(doctorId, dto, actor);
  }

  @Patch('time-off/:timeOffId')
  @Auth(...MANAGERS)
  @ApiOkResponse({ type: TimeOffMutationResponseDto })
  updateTimeOff(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
    @Body() dto: UpdateTimeOffDto,
    @CurrentActor() actor: Actor,
  ): Promise<TimeOffMutationResponseDto> {
    return this.timeOff.update(doctorId, timeOffId, dto, actor);
  }

  @Delete('time-off/:timeOffId')
  @Auth(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  removeTimeOff(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.timeOff.remove(doctorId, timeOffId, actor);
  }
}
