import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { AcquisitionReportsService } from './acquisition-reports.service.js';
import { AcquisitionSourcesService } from './acquisition-sources.service.js';
import {
  AcquisitionReportDto,
  AcquisitionReportQueryDto,
  AddAcquisitionSourceDto,
  CampaignReportDto,
  CampaignReportQueryDto,
  PatientAcquisitionDto,
  RemoveAcquisitionSourceDto,
  UpdateAcquisitionSourceDto,
} from './dto/acquisition.dto.js';

const { OWNER, RECEPTIONIST } = UserRole;

@ApiTags('Acquisition')
@Controller()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class AcquisitionController {
  constructor(private readonly sources: AcquisitionSourcesService) {}

  @Get('patients/:patientId/acquisition')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'How the patient found the clinic',
    description:
      'Sources recorded by reception (current, primary first, and removed ones) plus the utm_* tags of their online bookings (automatic, kept apart).',
  })
  @ApiOkResponse({ type: PatientAcquisitionDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ): Promise<PatientAcquisitionDto> {
    return this.sources.forPatient(patientId);
  }

  @Post('patients/:patientId/acquisition-sources')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Record a source (channel) for the patient',
    description:
      'The first source is primary; `isPrimary: true` moves the primary to the new one. A channel can be recorded once at a time (409 SOURCE_ALREADY_RECORDED).',
  })
  @ApiCreatedResponse({ type: PatientAcquisitionDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'SOURCE_ALREADY_RECORDED',
  })
  add(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: AddAcquisitionSourceDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    return this.sources.add(patientId, dto, actor);
  }

  @Patch('acquisition-sources/:id')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Change the details of a source or make it primary',
    description: 'Old and new values are audited.',
  })
  @ApiOkResponse({ type: PatientAcquisitionDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcquisitionSourceDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    return this.sources.update(id, dto, actor);
  }

  @Post('acquisition-sources/:id/remove')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Remove a source (kept as history, with the reason)',
    description:
      'A removed primary hands over to the oldest remaining source. DOCTOR_REFERRAL stays while the patient has an active referral (422 SOURCE_IN_USE).',
  })
  @ApiCreatedResponse({ type: PatientAcquisitionDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'SOURCE_IN_USE',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveAcquisitionSourceDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    return this.sources.remove(id, dto.reason, actor);
  }
}

@ApiTags('Reports')
@Controller('reports')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class AcquisitionReportsController {
  constructor(private readonly reports: AcquisitionReportsService) {}

  @Get('acquisition')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'New patients by acquisition source',
    description:
      'Patients created in the range, by the PRIMARY source reception recorded (`mentions` counts every source), with how many of them attended and paid. Also by category and by month.',
  })
  @ApiOkResponse({ type: AcquisitionReportDto })
  acquisition(
    @Query() query: AcquisitionReportQueryDto,
  ): Promise<AcquisitionReportDto> {
    return this.reports.acquisition(query);
  }

  @Get('campaigns')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Online bookings by utm_source / utm_medium / utm_campaign',
    description:
      'Tagged appointments starting in the range (RESCHEDULED excluded): bookings, attended, patients, new patients, paying patients and money collected on those visits.',
  })
  @ApiOkResponse({ type: CampaignReportDto })
  campaigns(
    @Query() query: CampaignReportQueryDto,
  ): Promise<CampaignReportDto> {
    return this.reports.campaigns(query);
  }
}
