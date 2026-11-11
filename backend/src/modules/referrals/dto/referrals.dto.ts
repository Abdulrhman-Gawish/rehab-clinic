import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import { IsPositiveMoney } from '../../../common/decorators/money.decorator.js';
import {
  OptionalNotNull,
  ToBoolean,
  Trim,
  TrimAndCollapse,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '../../billing/billing.enums.js';
import {
  CommissionKind,
  CommissionStatus,
  PatientReferralStatus,
  ReferralApplicability,
  ReferralRateType,
} from '../referrals.enums.js';

const MONEY = (example: string, description?: string) => ({
  example,
  ...(description && { description }),
});

// ---------- Inputs ----------

export class RateInputDto {
  @ApiProperty({ enum: ReferralRateType })
  @IsEnum(ReferralRateType)
  type: ReferralRateType;

  @ApiPropertyOptional({
    example: '10.00',
    nullable: true,
    type: String,
    description:
      'Required unless NONE (then omit it). PERCENT: 0 < value <= 100. FIXED: EGP (commission: per covered session).',
  })
  @IsOptional()
  @IsPositiveMoney()
  value?: string | null;
}

export class ApplicabilityInputDto {
  @ApiProperty({ enum: ReferralApplicability })
  @IsEnum(ReferralApplicability)
  type: ReferralApplicability;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 1000,
    description: 'SESSION_COUNT only',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxSessions?: number | null;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'DATE_RANGE only: first local date (inclusive)',
  })
  @IsOptional()
  @IsLocalDate()
  validFrom?: string | null;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'DATE_RANGE only: last local date (inclusive)',
  })
  @IsOptional()
  @IsLocalDate()
  validTo?: string | null;
}

class AgreementValuesDto {
  @ApiProperty({ type: RateInputDto })
  @ValidateNested()
  @Type(() => RateInputDto)
  commission: RateInputDto;

  @ApiProperty({ type: RateInputDto, description: 'Discount for the patient' })
  @ValidateNested()
  @Type(() => RateInputDto)
  discount: RateInputDto;
}

export class CreateReferringDoctorDto extends AgreementValuesDto {
  @ApiProperty({ example: 'Dr. Hany Samir', minLength: 2, maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ example: '01012345678', nullable: true, type: String })
  @IsOptional()
  @EgyptianMobile()
  phone?: string | null;

  @ApiPropertyOptional({ example: 'Orthopedics', maxLength: 120 })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @MaxLength(120)
  specialty?: string | null;

  @ApiPropertyOptional({ example: 'Cairo University Hospital', maxLength: 200 })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @MaxLength(200)
  workplace?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Notes on the first agreement version',
  })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  agreementNotes?: string | null;
}

export class UpdateReferringDoctorDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @EgyptianMobile()
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @MaxLength(120)
  specialty?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @MaxLength(200)
  workplace?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateAgreementDto extends AgreementValuesDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description:
      'First local date it applies (default today). Not in the past, not before the current latest version.',
  })
  @IsOptional()
  @IsLocalDate()
  effectiveFrom?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class ListReferringDoctorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of the name or phone' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class ReferralTermsInputDto extends AgreementValuesDto {
  @ApiProperty({
    type: ApplicabilityInputDto,
    description: 'Which sessions are covered (no default: choose explicitly)',
  })
  @ValidateNested()
  @Type(() => ApplicabilityInputDto)
  applicability: ApplicabilityInputDto;

  @ApiPropertyOptional({
    example: 'Agreed with the doctor by phone',
    maxLength: 255,
    description:
      "Required (3+ characters) when the commission or discount differs from the doctor's current default",
  })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  overrideReason?: string | null;
}

export class AssignReferralDto extends ReferralTermsInputDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Picked from GET /referring-doctors (active ones)',
  })
  @IsUUID()
  referringDoctorId: string;

  @ApiPropertyOptional({
    description:
      "Make DOCTOR_REFERRAL the patient's primary acquisition source (it is anyway when it is the first one)",
  })
  @IsOptional()
  @IsBoolean()
  primarySource?: boolean;
}

export class ReferralReasonDto {
  @ApiProperty({ example: 'Referral recorded for the wrong patient' })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class ListCommissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CommissionStatus })
  @IsOptional()
  @IsEnum(CommissionStatus)
  status?: CommissionStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Recorded on or after',
  })
  @IsOptional()
  @IsLocalDate()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Recorded on or before',
  })
  @IsOptional()
  @IsLocalDate()
  to?: string;
}

// A signed amount: "-25.00" takes back, "25.00" adds. Never 0.
export const SIGNED_MONEY = /^-?\d{1,10}(\.\d{1,2})?$/;

export class CommissionAdjustmentDto {
  @ApiProperty({
    example: '-25.00',
    description: 'Signed EGP: positive owes the doctor more, negative less',
  })
  @IsString()
  @Matches(SIGNED_MONEY, {
    message: '$property must be a signed decimal string, e.g. "-25.00"',
  })
  amount: string;

  @ApiProperty({ example: 'Agreed bonus for November', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The patient it is about',
  })
  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class RecordPayoutDto {
  @ApiProperty({
    example: '350.00',
    description:
      "The money paid now: > 0 and at most the doctor's outstanding commission (422 PAYOUT_EXCEEDS_OUTSTANDING). Less is a partial payout.",
  })
  @IsPositiveMoney()
  amount: string;

  @ApiPropertyOptional({
    example: '2026-11-03',
    description:
      'Clinic local date the money was paid (default today; never in the future). Also the date of its expense.',
  })
  @IsOptional()
  @IsLocalDate()
  payoutDate?: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}

export class CommissionBalanceQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'The balance at the end of this local day (default today): rows recorded and owed by then, payouts dated up to then',
  })
  @IsOptional()
  @IsLocalDate()
  asOf?: string;
}

export class ReferralReportQueryDto {
  @ApiProperty({ example: '2026-11-01' })
  @IsLocalDate()
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  @IsLocalDate()
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referringDoctorId?: string;
}

// ---------- Outputs ----------

export class RateDto {
  @ApiProperty({ enum: ReferralRateType })
  type: ReferralRateType;

  @ApiProperty({ example: '10.00', nullable: true, type: String })
  value: string | null;
}

export class AgreementDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 2 })
  version: number;

  @ApiProperty({ example: '2026-11-01' })
  effectiveFrom: string;

  @ApiProperty({ type: RateDto })
  commission: RateDto;

  @ApiProperty({ type: RateDto })
  discount: RateDto;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty({ example: '2026-11-01T10:00:00+02:00' })
  recordedAt: string;
}

export class ReferringDoctorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  specialty: string | null;

  @ApiProperty({ nullable: true, type: String })
  workplace: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({
    type: AgreementDto,
    nullable: true,
    description: 'The default in force today',
  })
  currentAgreement: AgreementDto | null;

  @ApiProperty({
    type: AgreementDto,
    nullable: true,
    description: 'A later version that starts on a future date',
  })
  upcomingAgreement: AgreementDto | null;

  @ApiProperty()
  createdAt: string;
}

export class RefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class ApplicabilityDto {
  @ApiProperty({ enum: ReferralApplicability })
  type: ReferralApplicability;

  @ApiProperty({ nullable: true, type: Number })
  maxSessions: number | null;

  @ApiProperty({ nullable: true, type: String })
  validFrom: string | null;

  @ApiProperty({ nullable: true, type: String })
  validTo: string | null;
}

export class TermsDefaultsDto {
  @ApiProperty({ format: 'uuid' })
  agreementId: string;

  @ApiProperty({ example: 1 })
  agreementVersion: number;

  @ApiProperty({ type: RateDto })
  commission: RateDto;

  @ApiProperty({ type: RateDto })
  discount: RateDto;
}

export class ReferralTermsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({
    type: TermsDefaultsDto,
    description: "The doctor's default when this version was written",
  })
  defaults: TermsDefaultsDto;

  @ApiProperty({ type: RateDto, description: 'Applied commission' })
  commission: RateDto;

  @ApiProperty({ type: RateDto, description: 'Applied patient discount' })
  discount: RateDto;

  @ApiProperty({ type: ApplicabilityDto })
  applicability: ApplicabilityDto;

  @ApiProperty({ description: 'Applied values differ from the defaults' })
  isOverride: boolean;

  @ApiProperty({ nullable: true, type: String })
  overrideReason: string | null;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty()
  recordedAt: string;
}

export class PatientReferralDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: RefDto })
  patient: RefDto;

  @ApiProperty({ type: RefDto })
  referringDoctor: RefDto & { isActive: boolean };

  @ApiProperty({ enum: PatientReferralStatus })
  status: PatientReferralStatus;

  @ApiProperty({ type: UserRefDto })
  assignedBy: UserRefDto;

  @ApiProperty()
  assignedAt: string;

  @ApiProperty({ nullable: true, type: String })
  endedAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  endedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  endReason: string | null;

  @ApiProperty({
    description:
      'Sessions covered so far (billed visits and package sales, cancelled invoices excluded)',
  })
  coveredSessions: number;

  @ApiProperty({ type: ReferralTermsDto, description: 'Latest version' })
  terms: ReferralTermsDto;

  @ApiProperty({
    type: [ReferralTermsDto],
    description: 'Every version, newest first',
  })
  history: ReferralTermsDto[];
}

export class InvoiceRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;
}

export class PaymentRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCP-2026-000045' })
  receiptNumber: string;

  @ApiProperty({ enum: PaymentType })
  type: PaymentType;
}

export class CommissionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: RefDto })
  referringDoctor: RefDto;

  @ApiProperty({ enum: CommissionKind })
  kind: CommissionKind;

  @ApiProperty({ enum: CommissionStatus })
  status: CommissionStatus;

  @ApiProperty(MONEY('30.00', 'Signed: reversals are negative'))
  amount: string;

  @ApiProperty({ enum: ReferralRateType, nullable: true })
  commissionType: ReferralRateType | null;

  @ApiProperty({ nullable: true, type: String, example: '10.00' })
  rate: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '300.00',
    description: 'The payment or refund amount of the event',
  })
  baseAmount: string | null;

  @ApiProperty({ type: RefDto, nullable: true })
  patient: RefDto | null;

  @ApiProperty({ type: InvoiceRefDto, nullable: true })
  invoice: InvoiceRefDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  visitId: string | null;

  @ApiProperty({
    type: PaymentRefDto,
    nullable: true,
    description: 'The patient payment it is about',
  })
  payment: PaymentRefDto | null;

  @ApiProperty({
    type: PaymentRefDto,
    nullable: true,
    description: 'The payment or refund whose event wrote the row',
  })
  sourcePayment: PaymentRefDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  referralTermsId: string | null;

  @ApiProperty({ nullable: true, type: Number })
  termsVersion: number | null;

  @ApiProperty(
    MONEY(
      '50.00',
      'Settled by valid payouts (signed like amount); partly paid while ELIGIBLE',
    ),
  )
  paidAmount: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'The payout that completed the row (PAID)',
  })
  payoutId: string | null;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ type: UserRefDto })
  recordedBy: UserRefDto;

  @ApiProperty()
  recordedAt: string;

  @ApiProperty({ nullable: true, type: String })
  eligibleAt: string | null;
}

export class CommissionBalanceDto {
  @ApiProperty({ example: '2026-11-30', description: 'End of this local day' })
  asOf: string;

  @ApiProperty(MONEY('0.00', 'PENDING: package paid, no session attended yet'))
  pending: string;

  @ApiProperty(
    MONEY(
      '550.00',
      'Owed and not paid yet: earned - reversed + adjustments - pending - paid (can be negative)',
    ),
  )
  outstanding: string;

  @ApiProperty(MONEY('350.00', 'Valid payouts (by payout date)'))
  paid: string;

  @ApiProperty(MONEY('450.00', 'Every positive row from payments'))
  earned: string;

  @ApiProperty(MONEY('30.00', 'Every reversal (as a positive number)'))
  reversed: string;

  @ApiProperty(MONEY('0.00', 'Sum of adjustments (signed)'))
  adjustments: string;
}

export class PayoutExpenseRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'EXP-2026-000010' })
  expenseNumber: string;
}

export class PayoutDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: RefDto })
  referringDoctor: RefDto;

  @ApiProperty(MONEY('350.00'))
  amount: string;

  @ApiProperty({
    example: '2026-11-03',
    description: 'Local date the money was paid (and of its expense)',
  })
  payoutDate: string;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ nullable: true, type: String })
  reference: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({
    type: PayoutExpenseRefDto,
    description: 'The clinic expense recording it (voided with the payout)',
  })
  expense: PayoutExpenseRefDto;

  @ApiProperty({ type: UserRefDto })
  paidBy: UserRefDto;

  @ApiProperty({ description: 'When it was recorded' })
  paidAt: string;

  @ApiProperty({ nullable: true, type: String })
  voidedAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  voidedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;

  @ApiProperty({ description: 'Commission rows it settled (fully or in part)' })
  commissionCount: number;
}

export class ReferredPatientDto {
  @ApiProperty({ type: RefDto })
  patient: RefDto & { phone: string };

  @ApiProperty({ format: 'uuid' })
  referralId: string;

  @ApiProperty({ enum: PatientReferralStatus })
  status: PatientReferralStatus;

  @ApiProperty()
  assignedAt: string;

  @ApiProperty()
  termsVersion: number;

  @ApiProperty()
  isOverride: boolean;

  @ApiProperty()
  coveredSessions: number;

  @ApiProperty(MONEY('900.00', 'Net collected on covered invoices'))
  collected: string;

  @ApiProperty(MONEY('100.00', 'Referral discounts on covered invoices'))
  discounts: string;

  @ApiProperty(MONEY('90.00', 'Net commission (all rows of the referral)'))
  commission: string;

  @ApiProperty(MONEY('60.00', 'Owed, not paid yet'))
  outstanding: string;
}

export class ReferralReportRowDto {
  @ApiProperty({ type: RefDto })
  referringDoctor: RefDto & { isActive: boolean };

  @ApiProperty({ description: 'Referrals assigned in the range' })
  referredPatients: number;

  @ApiProperty({
    description:
      'Appointments of referred patients starting in the range, while referred (RESCHEDULED excluded)',
  })
  bookings: number;

  @ApiProperty({
    description: 'Visits of referred patients in the range, while referred',
  })
  attendedSessions: number;

  @ApiProperty({
    description: 'Invoices the referral covered, issued in the range',
  })
  coveredSessions: number;

  @ApiProperty(MONEY('900.00', 'Net received in the range on covered invoices'))
  collected: string;

  @ApiProperty(MONEY('100.00', 'Referral discounts applied in the range'))
  discounts: string;

  @ApiProperty(MONEY('90.00', 'Positive rows recorded in the range'))
  commissionEarned: string;

  @ApiProperty(MONEY('10.00', 'Reversals recorded in the range (positive)'))
  commissionReversed: string;

  @ApiProperty(MONEY('0.00', 'Adjustments recorded in the range (signed)'))
  adjustments: string;

  @ApiProperty(MONEY('50.00', 'Valid payouts dated in the range'))
  commissionPaid: string;

  @ApiProperty(MONEY('30.00', 'Owed and not paid, now (any date)'))
  outstanding: string;

  @ApiProperty(MONEY('0.00', 'PENDING now (any date)'))
  pending: string;
}

export class ReferralReportDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;

  @ApiProperty({ type: [ReferralReportRowDto], description: 'By name' })
  rows: ReferralReportRowDto[];
}

export class StatementDiscountDto {
  @ApiProperty({ example: 'PERCENT' })
  type: string;

  @ApiProperty({ example: '10.00' })
  value: string;

  @ApiProperty({ example: '100.00' })
  amount: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ description: 'Came from the referral terms' })
  fromReferral: boolean;

  @ApiProperty({ type: UserRefDto })
  appliedBy: UserRefDto;

  @ApiProperty()
  appliedAt: string;
}

export class StatementPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  receiptNumber: string;

  @ApiProperty({ enum: PaymentType })
  type: PaymentType;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty(MONEY('300.00'))
  amount: string;

  @ApiProperty()
  receivedAt: string;
}

export class StatementInvoiceDto {
  @ApiProperty({ type: InvoiceRefDto })
  invoice: InvoiceRefDto;

  @ApiProperty({ enum: InvoiceStatus })
  status: InvoiceStatus;

  @ApiProperty()
  issuedAt: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  visitId: string | null;

  @ApiProperty({ description: 'A package sale (no visit)' })
  isPackageSale: boolean;

  @ApiProperty({ format: 'uuid' })
  referralId: string;

  @ApiProperty()
  termsVersion: number;

  @ApiProperty(MONEY('1000.00'))
  subtotal: string;

  @ApiProperty(MONEY('100.00'))
  discountTotal: string;

  @ApiProperty(MONEY('900.00'))
  total: string;

  @ApiProperty(MONEY('600.00', 'Net collected'))
  amountPaid: string;

  @ApiProperty({ type: StatementDiscountDto, nullable: true })
  discount: StatementDiscountDto | null;

  @ApiProperty({ type: [StatementPaymentDto] })
  payments: StatementPaymentDto[];
}

export class ReferralStatementDto {
  @ApiProperty({ type: [PatientReferralDto], description: 'Newest first' })
  referrals: PatientReferralDto[];

  @ApiProperty({
    type: [StatementInvoiceDto],
    description: 'Invoices the referrals covered, newest first',
  })
  invoices: StatementInvoiceDto[];

  @ApiProperty({
    type: [CommissionDto],
    description: 'Every commission row about the patient, newest first',
  })
  commissions: CommissionDto[];

  @ApiProperty({
    type: [PayoutDto],
    description: 'Payouts that settled any of those rows',
  })
  payouts: PayoutDto[];
}

export class InvoiceReferralDto {
  @ApiProperty({ format: 'uuid' })
  referralId: string;

  @ApiProperty({ format: 'uuid' })
  termsId: string;

  @ApiProperty()
  termsVersion: number;

  @ApiProperty({ type: RefDto })
  referringDoctor: RefDto;

  @ApiProperty()
  isOverride: boolean;
}
