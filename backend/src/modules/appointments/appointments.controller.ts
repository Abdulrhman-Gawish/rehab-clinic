import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import {
  CurrentActor,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityService } from './availability/availability.service.js';
import {
  AppointmentResponseDto,
  CancelAppointmentDto,
  CreateAppointmentDto,
  DayListEntryDto,
  DayListQueryDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  StatusHistoryEntryDto,
} from './dto/appointment.dto.js';
import { SlotDto, StaffSlotsQueryDto } from './dto/availability.dto.js';

const STAFF = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];

const BOOKING_CONFLICTS = {
  type: ErrorResponseDto,
  description: 'SLOT_UNAVAILABLE (doctor busy) or PATIENT_OVERLAP',
};
const TRANSITION_ERRORS = {
  type: ErrorResponseDto,
  description: 'INVALID_STATUS_TRANSITION (or NO_SHOW_TOO_EARLY)',
};

// Doctors see only their own appointments; anything else is 404.
@ApiTags('Appointments')
@Controller('appointments')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly access: DoctorAccessService,
  ) {}

  // Static routes are declared before ':id' routes on purpose.

  @Get('availability')
  @Auth(...STAFF)
  @ApiOperation({
    summary: 'Free slots of a doctor for a service on a local date',
    description:
      'Doctors may query only themselves. includeOutsideSchedule is honoured for OWNER/RECEPTIONIST only.',
  })
  @ApiOkResponse({ type: [SlotDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED or DATE_OUT_OF_RANGE',
  })
  async availabilityForStaff(
    @Query() query: StaffSlotsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SlotDto[]> {
    await this.access.assertCanAccessDoctor(user, query.doctorId);
    return this.availability.getSlots(
      query.doctorId,
      query.serviceId,
      query.date,
      {
        includeOutsideSchedule:
          user.role !== UserRole.DOCTOR &&
          (query.includeOutsideSchedule ?? false),
      },
    );
  }

  @Get('day')
  @Auth(...STAFF)
  @ApiOperation({
    summary: 'Day list for a clinic local date',
    description:
      "Every appointment of the day (with its visit if attended) plus the day's walk-ins (isWalkIn), ordered by time, each with allowedActions. A DOCTOR gets only their own rows, without billing fields.",
  })
  @ApiOkResponse({ type: [DayListEntryDto] })
  day(
    @Query() query: DayListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DayListEntryDto[]> {
    return this.appointments.day(query, user);
  }

  @Get('by-reference/:code')
  @Auth(...STAFF)
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  byReference(
    @Param('code') code: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.findByReference(code, user);
  }

  @Post()
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Book at reception (CONFIRMED)',
    description:
      'patientId OR name + phone (find-or-create by phone). allowOutsideSchedule skips schedule checks but never the overlap rules.',
  })
  @ApiCreatedResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse(BOOKING_CONFLICTS)
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'OUTSIDE_SCHEDULE, DATE_OUT_OF_RANGE or SERVICE_NOT_OFFERED',
  })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.create(dto, actor);
  }

  @Get()
  @Auth(...STAFF)
  @ApiOperation({ summary: 'Search appointments (sorted by start time)' })
  @ApiOkResponse({ type: PaginatedResponse(AppointmentResponseDto) })
  list(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<AppointmentResponseDto>> {
    return this.appointments.list(query, user);
  }

  @Get(':id')
  @Auth(...STAFF)
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.findOne(id, user);
  }

  @Get(':id/history')
  @Auth(...STAFF)
  @ApiOperation({ summary: 'Status history (oldest first)' })
  @ApiOkResponse({ type: [StatusHistoryEntryDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StatusHistoryEntryDto[]> {
    return this.appointments.statusHistory(id, user);
  }

  @Post(':id/confirm')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING -> CONFIRMED (optional)' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(TRANSITION_ERRORS)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.confirm(id, actor);
  }

  @Post(':id/cancel')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING/CONFIRMED -> CANCELLED (reason required)' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(TRANSITION_ERRORS)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.cancel(id, dto.reason, actor);
  }

  @Post(':id/no-show')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PENDING/CONFIRMED -> NO_SHOW (only after the start time)',
  })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(TRANSITION_ERRORS)
  noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.noShow(id, actor);
  }

  @Post(':id/undo-no-show')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marked as no-show by mistake: NO_SHOW -> CONFIRMED',
    description:
      'Same local day only. 409 SLOT_UNAVAILABLE / PATIENT_OVERLAP if the freed slot was booked meanwhile.',
  })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse(BOOKING_CONFLICTS)
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNDO_WRONG_DAY or INVALID_STATUS_TRANSITION',
  })
  undoNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.undoNoShow(id, actor);
  }

  @Post(':id/reschedule')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Move a PENDING or CONFIRMED appointment (atomically)',
    description:
      'Creates a new CONFIRMED appointment (rescheduledFromId = old id) and marks the old one RESCHEDULED. Returns the new appointment.',
  })
  @ApiCreatedResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse(BOOKING_CONFLICTS)
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INVALID_STATUS_TRANSITION, OUTSIDE_SCHEDULE, ...',
  })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<AppointmentResponseDto> {
    return this.appointments.reschedule(id, dto, actor);
  }
}

@ApiTags('Appointments')
@Controller('patients/:patientId/appointments')
export class PatientAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @Auth(...STAFF)
  @ApiOperation({
    summary: "A patient's appointment history across all doctors",
    description: 'Doctors only see their own appointments with the patient.',
  })
  @ApiOkResponse({ type: PaginatedResponse(AppointmentResponseDto) })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<AppointmentResponseDto>> {
    return this.appointments.forPatient(patientId, query, user);
  }
}
