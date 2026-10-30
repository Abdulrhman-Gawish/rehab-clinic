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
  AttendResponseDto,
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

const UNDO_ERRORS = {
  type: ErrorResponseDto,
  description:
    'UNDO_WRONG_DAY, VISIT_HAS_NOTE, INVOICE_HAS_PAYMENTS, VISIT_VOIDED or INVALID_STATUS_TRANSITION',
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
      'patientId OR name + phone (find-or-create). Attended now; the invoice is created in the same transaction (invoiceId). Walk-ins do not block booking slots.',
  })
  @ApiCreatedResponse({ type: AttendResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SERVICE_NOT_OFFERED',
  })
  walkIn(
    @Body() dto: WalkInDto,
    @CurrentActor() actor: Actor,
  ): Promise<AttendResponseDto> {
    return this.visits.walkIn(dto, actor);
  }

  @Get('queue')
  @Auth(...STAFF)
  @ApiOperation({
    summary: "The day's ACTIVE visits, in the order they attended",
  })
  @ApiOkResponse({ type: [QueueEntryDto] })
  queue(
    @Query() query: QueueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QueueEntryDto[]> {
    return this.visits.queue(query, user);
  }

  @Get()
  @Auth(...STAFF)
  @ApiOperation({ summary: 'Search visits (newest first)' })
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

  @Post(':id/undo-attend')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Undo an attendance through its visit (the way to undo a walk-in)',
    description:
      'Same day only, no note, nothing paid. Visit -> VOIDED and its invoice CANCELLED; for an appointment visit the appointment goes back to CONFIRMED.',
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(UNDO_ERRORS)
  undoAttend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.undoVisit(id, dto.reason, actor);
  }
}

@ApiTags('Visits')
@Controller('appointments')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class AttendController {
  constructor(private readonly visits: VisitsService) {}

  @Post(':id/attend')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'The patient entered the doctor (PENDING/CONFIRMED -> ATTENDED)',
    description:
      "Only on the appointment's local date. Creates the ACTIVE visit and its invoice in one transaction; the response includes invoiceId.",
  })
  @ApiCreatedResponse({ type: AttendResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ALREADY_ATTENDED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'ATTEND_WRONG_DAY or INVALID_STATUS_TRANSITION',
  })
  attend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AttendResponseDto> {
    return this.visits.attend(id, actor);
  }

  @Post(':id/undo-attend')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Attended by mistake (ATTENDED -> CONFIRMED)',
    description:
      'Same local day only, and only while the doctor has no note and the invoice has no payments. The visit is VOIDED and its invoice CANCELLED.',
  })
  @ApiOkResponse({ type: VisitResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(UNDO_ERRORS)
  undoAttend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.visits.undoAttend(id, dto.reason, actor);
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
