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
import {
  ListVisitsQueryDto,
  QueueEntryDto,
  QueueQueryDto,
  VisitHistoryEntryDto,
  VisitReasonDto,
  VisitResponseDto,
  WalkInDto,
} from './dto/visit.dto.js';
import { VisitsService } from './visits.service.js';

const STAFF = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];
const CLINICIANS = [UserRole.OWNER, UserRole.DOCTOR];

const TRANSITION_ERROR = {
  type: ErrorResponseDto,
  description: 'INVALID_VISIT_TRANSITION',
};

// Doctors only see/act on their own visits; others' are 404.
@ApiTags('Visits')
@Controller('visits')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  // Static routes are declared before ':id' routes on purpose.

  @Post('walk-in')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Register a walk-in (visit without appointment)',
    description:
      'patientId OR name + phone (find-or-create). Walk-ins do not block booking slots.',
  })
  @ApiCreatedResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PATIENT_HAS_OPEN_VISIT',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED',
  })
  walkIn(
    @Body() dto: WalkInDto,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.walkIn(dto, actor);
  }

  @Get('queue')
  @Auth(...STAFF)
  @ApiOperation({
    summary:
      "The day's waiting room: WAITING and IN_SESSION visits by check-in time",
  })
  @ApiOkResponse({ type: [QueueEntryDto] })
  queue(
    @Query() query: QueueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QueueEntryDto[]> {
    return this.visits.queue(query, user);
  }

  @Get('open')
  @Auth(...DESK)
  @ApiOperation({
    summary:
      'Visits still WAITING/IN_SESSION from previous days (forgotten ones)',
  })
  @ApiOkResponse({ type: [VisitResponseDto] })
  open(): Promise<VisitResponseDto[]> {
    return this.visits.openFromPreviousDays();
  }

  @Get()
  @Auth(...STAFF)
  @ApiOperation({ summary: 'Search visits (newest check-in first)' })
  @ApiOkResponse({ type: PaginatedResponse(VisitResponseDto) })
  list(
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<VisitResponseDto>> {
    return this.visits.list(query, user);
  }

  @Get(':id')
  @Auth(...STAFF)
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitResponseDto> {
    return this.visits.findOne(id, user);
  }

  @Get(':id/history')
  @Auth(...STAFF)
  @ApiOkResponse({ type: [VisitHistoryEntryDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitHistoryEntryDto[]> {
    return this.visits.statusHistory(id, user);
  }

  @Post(':id/undo-check-in')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Checked in by mistake (WAITING only)',
    description: 'Visit -> CANCELLED; the appointment goes back to CONFIRMED.',
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(TRANSITION_ERROR)
  undoCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.undoCheckIn(id, dto.reason, actor);
  }

  @Post(':id/cancel')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Patient left before being seen (WAITING only)',
    description: 'Visit and its appointment -> CANCELLED with the same reason.',
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(TRANSITION_ERROR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.cancel(id, dto.reason, actor);
  }

  @Post(':id/start')
  @Auth(...CLINICIANS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "WAITING -> IN_SESSION (the visit's doctor or OWNER)",
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DOCTOR_ALREADY_IN_SESSION',
  })
  @ApiUnprocessableEntityResponse(TRANSITION_ERROR)
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.start(id, user, actor);
  }

  @Post(':id/complete')
  @Auth(...CLINICIANS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "IN_SESSION -> COMPLETED (the visit's doctor or OWNER)",
    description:
      'The linked appointment becomes COMPLETED in the same transaction.',
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INVALID_VISIT_TRANSITION or VISIT_COMPLETION_BLOCKED',
  })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.complete(id, user, actor);
  }
}

@ApiTags('Visits')
@Controller('appointments')
export class CheckInController {
  constructor(private readonly visits: VisitsService) {}

  @Post(':id/check-in')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Check in an appointment (creates the WAITING visit)',
    description:
      "Only on the appointment's local date. A PENDING booking is confirmed on the way (two history rows).",
  })
  @ApiCreatedResponse({ type: VisitResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ALREADY_CHECKED_IN or PATIENT_HAS_OPEN_VISIT',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'CHECK_IN_WRONG_DAY or INVALID_STATUS_TRANSITION',
  })
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.checkIn(id, actor);
  }
}

@ApiTags('Visits')
@Controller('patients/:patientId/visits')
export class PatientVisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @Auth(...STAFF)
  @ApiOperation({
    summary:
      "A patient's visits across all doctors (metadata only, no clinical data)",
  })
  @ApiOkResponse({ type: PaginatedResponse(VisitResponseDto) })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<VisitResponseDto>> {
    return this.visits.forPatient(patientId, query);
  }
}
