import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import {
  IsMoney,
  IsPositiveMoney,
} from '../../../common/decorators/money.decorator.js';
import {
  Trim,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { PaymentMethod, PaymentStatus } from '../../billing/billing.enums.js';
import {
  SalaryCommissionMode,
  SalaryRateType,
  SessionValueSource,
} from '../salaries.enums.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IsMonth = () =>
  Matches(MONTH, { message: '$property must be a month in YYYY-MM format' });
const MONEY = (example: string) => ({ example, type: String });

class RefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

// ---------- Inputs ----------

export class SalaryMonthQueryDto {
  @ApiProperty({ example: '2026-11', description: 'Salary month (YYYY-MM)' })
  @IsMonth()
  month: string;
}

export class SalaryRateInputDto {
  @ApiProperty({ enum: SalaryRateType })
  @IsEnum(SalaryRateType)
  type: SalaryRateType;

  @ApiProperty({
    example: '50.00',
    description: 'EGP per session (FIXED) or a percentage 0-100 (PERCENT)',
  })
  @IsMoney()
  value: string;
}

export class ServiceRateInputDto extends SalaryRateInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;
}

export class SetSalaryTermsDto {
  @ApiProperty({
    example: '2026-11',
    description:
      'First month these terms apply to (until the next version). Refused (422 SALARY_MONTH_PAID) when that month or a later one already has a valid salary payment.',
  })
  @IsMonth()
  effectiveMonth: string;

  @ApiProperty({
    example: '8000.00',
    description: 'Monthly fixed salary; 0 = commission only',
  })
  @IsMoney()
  fixedSalary: string;

  @ApiProperty({ enum: SalaryCommissionMode })
  @IsEnum(SalaryCommissionMode)
  commissionMode: SalaryCommissionMode;

  @ApiPropertyOptional({
    type: SalaryRateInputDto,
    description: 'Required with PER_SESSION, not allowed otherwise',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SalaryRateInputDto)
  sessionRate?: SalaryRateInputDto | null;

  @ApiPropertyOptional({
    type: [ServiceRateInputDto],
    description:
      'Required (at least one) with PER_SERVICE, not allowed otherwise. Services without a rate earn no commission.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ServiceRateInputDto)
  serviceRates?: ServiceRateInputDto[] | null;
}

export class RecordSalaryPaymentDto {
  @ApiProperty({
    example: '2026-11',
    description: 'The salary month it pays (not a future month)',
  })
  @IsMonth()
  month: string;

  @ApiProperty({
    example: '3000.00',
    description:
      'Any amount > 0: advances and partial payments are allowed; the statement shows what remains (or was overpaid).',
  })
  @IsPositiveMoney()
  amount: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Clinic local date the money was paid (default today; never in the future). Also the date of its expense.',
  })
  @IsOptional()
  @IsLocalDate()
  paymentDate?: string;

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

export class SalaryReasonDto {
  @ApiProperty({ example: 'Recorded for the wrong month' })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

// ---------- Outputs ----------

export class SalaryRateDto {
  @ApiProperty({ enum: SalaryRateType })
  type: SalaryRateType;

  @ApiProperty(MONEY('50.00'))
  value: string;
}

export class ServiceRateDto extends SalaryRateDto {
  @ApiProperty({ type: RefDto })
  service: RefDto;
}

export class SalaryTermsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026-11' })
  effectiveMonth: string;

  @ApiProperty(MONEY('8000.00'))
  fixedSalary: string;

  @ApiProperty({ enum: SalaryCommissionMode })
  commissionMode: SalaryCommissionMode;

  @ApiProperty({ type: SalaryRateDto, nullable: true })
  sessionRate: SalaryRateDto | null;

  @ApiProperty({ type: [ServiceRateDto] })
  serviceRates: ServiceRateDto[];

  @ApiProperty({ type: UserRefDto })
  setBy: UserRefDto;

  @ApiProperty()
  setAt: string;
}

export class SalaryPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: RefDto })
  doctor: RefDto;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty(MONEY('3000.00'))
  amount: string;

  @ApiProperty({ example: '2026-11-30' })
  paymentDate: string;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ nullable: true, type: String })
  reference: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({
    description: 'The clinic expense recording it (voided with the payment)',
  })
  expense: { id: string; expenseNumber: string };

  @ApiProperty({ type: UserRefDto })
  paidBy: UserRefDto;

  @ApiProperty()
  paidAt: string;

  @ApiProperty({ nullable: true, type: String })
  voidedAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  voidedBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;
}

export class SalarySessionDto {
  @ApiProperty({ format: 'uuid' })
  visitId: string;

  @ApiProperty()
  attendedAt: string;

  @ApiProperty({ type: RefDto })
  patient: RefDto;

  @ApiProperty({ type: RefDto })
  service: RefDto;

  @ApiProperty({
    ...MONEY('300.00'),
    description:
      'The session value (base of a PERCENT rate): its invoice total after discount, or package price / sessions',
  })
  sessionValue: string;

  @ApiProperty({ enum: SessionValueSource })
  valueSource: SessionValueSource;

  @ApiProperty({
    type: SalaryRateDto,
    nullable: true,
    description: 'null: no commission for this session (no rate)',
  })
  rate: SalaryRateDto | null;

  @ApiProperty(MONEY('60.00'))
  commission: string;
}

export class SalaryStatementDto {
  @ApiProperty({ type: RefDto })
  doctor: RefDto;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({
    type: SalaryTermsDto,
    nullable: true,
    description: 'The terms in effect that month; null = none set yet',
  })
  terms: SalaryTermsDto | null;

  @ApiProperty(MONEY('8000.00'))
  fixedSalary: string;

  @ApiProperty({ example: 42 })
  sessionCount: number;

  @ApiProperty(MONEY('2100.00'))
  commissionTotal: string;

  @ApiProperty({
    ...MONEY('10100.00'),
    description: 'fixedSalary + commissionTotal',
  })
  earned: string;

  @ApiProperty({
    ...MONEY('3000.00'),
    description: 'Valid payments for this month',
  })
  paid: string;

  @ApiProperty({
    ...MONEY('7100.00'),
    description: 'earned - paid (negative when overpaid)',
  })
  remaining: string;

  @ApiProperty({
    type: [SalarySessionDto],
    description: "The month's attended sessions (ACTIVE visits), oldest first",
  })
  sessions: SalarySessionDto[];

  @ApiProperty({
    type: [SalaryPaymentDto],
    description: 'Every payment for this month, voided ones too, newest first',
  })
  payments: SalaryPaymentDto[];
}

export class SalaryOverviewRowDto {
  @ApiProperty({ type: RefDto })
  doctor: RefDto;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ enum: SalaryCommissionMode, nullable: true })
  commissionMode: SalaryCommissionMode | null;

  @ApiProperty()
  hasTerms: boolean;

  @ApiProperty(MONEY('8000.00'))
  fixedSalary: string;

  @ApiProperty({ example: 42 })
  sessionCount: number;

  @ApiProperty(MONEY('2100.00'))
  commissionTotal: string;

  @ApiProperty(MONEY('10100.00'))
  earned: string;

  @ApiProperty(MONEY('3000.00'))
  paid: string;

  @ApiProperty(MONEY('7100.00'))
  remaining: string;
}
