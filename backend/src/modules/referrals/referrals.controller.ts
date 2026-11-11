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
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  AgreementDto,
  AssignReferralDto,
  CommissionAdjustmentDto,
  CommissionBalanceDto,
  CommissionBalanceQueryDto,
  CommissionDto,
  CreateAgreementDto,
  CreateReferringDoctorDto,
  ListCommissionsQueryDto,
  ListReferringDoctorsQueryDto,
  PatientReferralDto,
  PayoutDto,
  RecordPayoutDto,
  ReferralReasonDto,
  ReferralReportDto,
  ReferralReportQueryDto,
  ReferralStatementDto,
  ReferralTermsInputDto,
  ReferredPatientDto,
  ReferringDoctorDto,
  UpdateReferringDoctorDto,
} from './dto/referrals.dto.js';
import { PatientReferralsService } from './patient-referrals.service.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';
import { ReferralPayoutsService } from './referral-payouts.service.js';
import { ReferralReportsService } from './referral-reports.service.js';
import { ReferringDoctorsService } from './referring-doctors.service.js';

const { OWNER, RECEPTIONIST } = UserRole;

@ApiTags('Referring doctors')
@Controller('referring-doctors')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ReferringDoctorsController {
  constructor(
    private readonly doctors: ReferringDoctorsService,
    private readonly commissions: ReferralCommissionsService,
    private readonly payouts: ReferralPayoutsService,
    private readonly reports: ReferralReportsService,
  ) {}

  @Post()
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Add an outside doctor who refers patients',
    description:
      'With the default agreement (version 1, effective today): commission and patient discount, each NONE / PERCENT / FIXED.',
  })
  @ApiCreatedResponse({ type: ReferringDoctorDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'REFERRING_DOCTOR_PHONE_TAKEN',
  })
  create(
    @Body() dto: CreateReferringDoctorDto,
    @CurrentActor() actor: Actor,
  ): Promise<ReferringDoctorDto> {
    return this.doctors.create(dto, actor);
  }

  @Get()
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Referring doctors, by name, with the current default agreement',
  })
  @ApiOkResponse({ type: PaginatedResponse(ReferringDoctorDto) })
  list(
    @Query() query: ListReferringDoctorsQueryDto,
  ): Promise<Paginated<ReferringDoctorDto>> {
    return this.doctors.list(query);
  }

  @Get(':id')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'A referring doctor with the default in force today',
    description:
      'Reception loads the defaults from `currentAgreement` when assigning a referral.',
  })
  @ApiOkResponse({ type: ReferringDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReferringDoctorDto> {
    return this.doctors.findOne(id);
  }

  @Patch(':id')
  @Auth(OWNER)
  @ApiOperation({ summary: 'Edit the doctor (old and new values audited)' })
  @ApiOkResponse({ type: ReferringDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'REFERRING_DOCTOR_PHONE_TAKEN',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReferringDoctorDto,
    @CurrentActor() actor: Actor,
  ): Promise<ReferringDoctorDto> {
    return this.doctors.update(id, dto, actor);
  }

  @Patch(':id/activate')
  @Auth(OWNER)
  @ApiOperation({ summary: 'Activate the doctor' })
  @ApiOkResponse({ type: ReferringDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ReferringDoctorDto> {
    return this.doctors.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Deactivate the doctor',
    description:
      'No new referrals; patients already referred keep their terms until their referral is ended.',
  })
  @ApiOkResponse({ type: ReferringDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ReferringDoctorDto> {
    return this.doctors.setActive(id, false, actor);
  }

  @Get(':id/agreements')
  @Auth(OWNER)
  @ApiOperation({ summary: 'Default agreement versions, newest first' })
  @ApiOkResponse({ type: [AgreementDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  agreements(@Param('id', ParseUUIDPipe) id: string): Promise<AgreementDto[]> {
    return this.doctors.agreements(id);
  }

  @Post(':id/agreements')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Change the default agreement (a new version)',
    description:
      'Effective today or a later date (not before the latest version). Patients already referred keep their terms; invoices and commissions already recorded never change.',
  })
  @ApiCreatedResponse({ type: ReferringDoctorDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'AGREEMENT_DATE_INVALID',
  })
  addAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAgreementDto,
    @CurrentActor() actor: Actor,
  ): Promise<ReferringDoctorDto> {
    return this.doctors.addAgreement(id, dto, actor);
  }

  @Get(':id/patients')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Patients the doctor referred, with their money and commission',
  })
  @ApiOkResponse({ type: PaginatedResponse(ReferredPatientDto) })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  patients(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ReferredPatientDto>> {
    return this.reports.doctorPatients(id, query);
  }

  @Get(':id/commissions')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'The doctor’s commission ledger, newest first',
    description:
      'Filter by status, patient and recorded date (local dates). Each row names the payment (and refund) that caused it and the terms version used.',
  })
  @ApiOkResponse({ type: PaginatedResponse(CommissionDto) })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  commissionsOf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListCommissionsQueryDto,
  ): Promise<Paginated<CommissionDto>> {
    return this.commissions.list(id, query);
  }

  @Get(':id/commission-balance')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Earned, reversed, adjusted, pending, paid and outstanding',
    description:
      'Now, or at the end of the local day `asOf` (rows recorded and owed by then, payouts dated up to then).',
  })
  @ApiOkResponse({ type: CommissionBalanceDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  balance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommissionBalanceQueryDto,
  ): Promise<CommissionBalanceDto> {
    return this.commissions.balance(id, query.asOf);
  }

  @Post(':id/commission-adjustments')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Add a signed commission adjustment with a reason',
    description: 'Owed (or taken back) at once; settled by the next payout.',
  })
  @ApiCreatedResponse({ type: CommissionDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommissionAdjustmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<CommissionDto> {
    return this.commissions.adjust(id, dto, actor);
  }

  @Get(':id/payouts')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Payouts to the doctor (voided ones too), newest first',
  })
  @ApiOkResponse({ type: [PayoutDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  payoutsOf(@Param('id', ParseUUIDPipe) id: string): Promise<PayoutDto[]> {
    return this.payouts.list(id);
  }

  @Post(':id/payouts')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Pay the doctor (all or part of what is owed)',
    description:
      'Settles owed rows oldest first (money owed back is deducted first) and records a clinic expense with the same amount, method and date in the referral-commission category, in one transaction: it counts in the cash summary (CASH), expenses and the owner reports.',
  })
  @ApiCreatedResponse({ type: PayoutDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'NOTHING_TO_PAY, PAYOUT_EXCEEDS_OUTSTANDING (details.outstanding) or EXPENSE_DATE_IN_FUTURE',
  })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPayoutDto,
    @CurrentActor() actor: Actor,
  ): Promise<PayoutDto> {
    return this.payouts.record(id, dto, actor);
  }
}

@ApiTags('Referring doctors')
@Controller('referral-payouts')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ReferralPayoutsController {
  constructor(private readonly payouts: ReferralPayoutsService) {}

  @Post(':id/void')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Void a payout recorded by mistake',
    description:
      'What it paid is owed again and its expense is voided with the same reason.',
  })
  @ApiCreatedResponse({ type: PayoutDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'PAYOUT_VOIDED',
  })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReferralReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<PayoutDto> {
    return this.payouts.void(id, dto.reason, actor);
  }
}

@ApiTags('Patient referrals')
@Controller()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PatientReferralsController {
  constructor(
    private readonly referrals: PatientReferralsService,
    private readonly reports: ReferralReportsService,
  ) {}

  @Get('patients/:patientId/referrals')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: "The patient's doctor referrals, newest first",
    description:
      'Each with every terms version: the doctor defaults next to the applied values, override and reason, who and when.',
  })
  @ApiOkResponse({ type: [PatientReferralDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  forPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ): Promise<PatientReferralDto[]> {
    return this.referrals.forPatient(patientId);
  }

  @Post('patients/:patientId/referrals')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Record that a referring doctor sent the patient',
    description:
      "The applied commission and discount are compared with the doctor's current default; a difference is an override and needs `overrideReason`. Also records the DOCTOR_REFERRAL source. Sessions billed from now on are covered according to `applicability`.",
  })
  @ApiCreatedResponse({ type: PatientReferralDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'REFERRAL_ALREADY_ACTIVE',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'REFERRING_DOCTOR_INACTIVE, OVERRIDE_REASON_REQUIRED, DISCOUNT_LIMIT_EXCEEDED',
  })
  assign(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: AssignReferralDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientReferralDto> {
    return this.referrals.assign(patientId, dto, actor);
  }

  @Post('patient-referrals/:id/terms')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'Change the patient-specific terms (a new version)',
    description:
      'Applies to sessions billed from now on; billed sessions keep their version. Same rules as assigning.',
  })
  @ApiCreatedResponse({ type: PatientReferralDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'REFERRAL_ENDED, OVERRIDE_REASON_REQUIRED, DISCOUNT_LIMIT_EXCEEDED',
  })
  changeTerms(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReferralTermsInputDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientReferralDto> {
    return this.referrals.changeTerms(id, dto, actor);
  }

  @Post('patient-referrals/:id/end')
  @Auth(OWNER, RECEPTIONIST)
  @ApiOperation({
    summary: 'End the referral (no new session is covered)',
    description: 'Invoices and commissions already recorded stay.',
  })
  @ApiCreatedResponse({ type: PatientReferralDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'REFERRAL_ENDED',
  })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReferralReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<PatientReferralDto> {
    return this.referrals.end(id, dto.reason, actor);
  }

  @Get('patients/:patientId/referral-statement')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Why the patient got discounts and the doctor commissions',
    description:
      'Referrals with every terms version, covered invoices (discount, payments), every commission row and the payouts that settled them.',
  })
  @ApiOkResponse({ type: ReferralStatementDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  statement(
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ): Promise<ReferralStatementDto> {
    return this.reports.statement(patientId);
  }
}

@ApiTags('Reports')
@Controller('reports')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ReferralReportsController {
  constructor(private readonly reports: ReferralReportsService) {}

  @Get('referrals')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Per referring doctor: patients, sessions, money and commission',
  })
  @ApiOkResponse({ type: ReferralReportDto })
  report(@Query() query: ReferralReportQueryDto): Promise<ReferralReportDto> {
    return this.reports.report(query);
  }
}
