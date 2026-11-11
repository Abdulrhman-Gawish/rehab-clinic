import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import {
  PatientOverviewDto,
  TimelinePageDto,
  TimelineQueryDto,
} from './dto/patient-history.dto.js';
import { PatientHistoryService } from './patient-history.service.js';
import { PatientTimelineService } from './patient-timeline.service.js';

const STAFF = [UserRole.OWNER, UserRole.RECEPTIONIST, UserRole.DOCTOR];

@ApiTags('Patient history')
@Controller('patients/:id')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Unknown patient, or a doctor without access to the patient',
})
export class PatientHistoryController {
  constructor(
    private readonly history: PatientHistoryService,
    private readonly timelineService: PatientTimelineService,
  ) {}

  @Get('overview')
  @Auth(...STAFF)
  @ApiOperation({
    summary: 'Everything the patient page needs, in one request',
    description:
      'A DOCTOR needs at least one appointment or visit with the patient (else 404) and gets `balance: null`. A RECEPTIONIST gets `notesNeedingAttention: null`.',
  })
  @ApiOkResponse({ type: PatientOverviewDto })
  overview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientOverviewDto> {
    return this.history.overview(id, user);
  }

  @Get('timeline')
  @Auth(...STAFF)
  @ApiOperation({
    summary: 'Everything that happened with the patient, newest first',
    description:
      'RECEPTIONIST: no clinical events. DOCTOR (with access, else 404): no billing events. Draft notes never appear. Keyset pagination: pass `nextCursor` as `cursor`.',
  })
  @ApiOkResponse({ type: TimelinePageDto })
  timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TimelineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TimelinePageDto> {
    return this.timelineService.timeline(id, query, user);
  }
}
