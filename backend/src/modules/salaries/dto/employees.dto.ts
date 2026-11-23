import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { EgyptianMobile } from '../../../common/decorators/egyptian-mobile.decorator.js';
import { IsMoney } from '../../../common/decorators/money.decorator.js';
import {
  NullableOptional,
  OptionalNotNull,
  ToBoolean,
  Trim,
  TrimAndCollapse,
  TrimOrNull,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { UserRole } from '../../../common/enums/user-role.enum.js';
import { PaymentMethod, PaymentStatus } from '../../billing/billing.enums.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IsMonth = () =>
  Matches(MONTH, { message: '$property must be a month in YYYY-MM format' });
const MONEY = (example: string, description?: string) => ({
  example,
  type: String,
  ...(description && { description }),
});

class EmployeeRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Sara Hassan' })
  name: string;

  @ApiProperty({ example: 'Receptionist' })
  jobTitle: string;
}

// ---------- Inputs ----------

export class SetEmployeeSalaryDto {
  @ApiProperty({
    example: '2026-11',
    description:
      'First month this salary applies to (until the next version). Refused (422 SALARY_MONTH_PAID) when that month or a later one already has a valid salary payment.',
  })
  @IsMonth()
  effectiveMonth: string;

  @ApiProperty({
    example: '6000.00',
    description: 'Fixed monthly salary; 0 = not paid from that month',
  })
  @IsMoney()
  fixedSalary: string;
}

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Sara Hassan', minLength: 2, maxLength: 120 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: 'Receptionist', minLength: 2, maxLength: 80 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 80)
  jobTitle: string;

  @ApiPropertyOptional({ example: '01012345678', nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @EgyptianMobile()
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description:
      'Their login account (optional): an OWNER or RECEPTIONIST user not linked to another employee. 422 EMPLOYEE_USER_INVALID, 409 EMPLOYEE_USER_TAKEN.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({
    type: SetEmployeeSalaryDto,
    description: 'The first salary version (optional; can be set later)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SetEmployeeSalaryDto)
  salary?: SetEmployeeSalaryDto | null;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 80 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 80)
  jobTitle?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @EgyptianMobile()
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, type: String })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Link a login account, or null to unlink',
  })
  @NullableOptional()
  @IsUUID()
  userId?: string | null;
}

export class ListEmployeesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of the name, job title or phone' })
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

// ---------- Outputs ----------

export class EmployeeUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;
}

export class EmployeeSalaryVersionDto {
  @ApiProperty({ example: '2026-11' })
  effectiveMonth: string;

  @ApiProperty(MONEY('6000.00'))
  fixedSalary: string;
}

export class EmployeeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  jobTitle: string;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({
    type: EmployeeUserDto,
    nullable: true,
    description: 'The linked login account; null = no login',
  })
  user: EmployeeUserDto | null;

  @ApiProperty({
    type: EmployeeSalaryVersionDto,
    nullable: true,
    description: 'The salary in effect this month; null = none set',
  })
  currentSalary: EmployeeSalaryVersionDto | null;

  @ApiProperty({
    type: EmployeeSalaryVersionDto,
    nullable: true,
    description: 'A version starting after this month, if any',
  })
  upcomingSalary: EmployeeSalaryVersionDto | null;

  @ApiProperty()
  createdAt: string;
}

export class EmployeeSalaryTermsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026-11' })
  effectiveMonth: string;

  @ApiProperty(MONEY('6000.00'))
  fixedSalary: string;

  @ApiProperty({ type: UserRefDto })
  setBy: UserRefDto;

  @ApiProperty()
  setAt: string;
}

export class EmployeeSalaryPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: EmployeeRefDto })
  employee: EmployeeRefDto;

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

export class EmployeeSalaryStatementDto {
  @ApiProperty({ type: EmployeeRefDto })
  employee: EmployeeRefDto;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({
    type: EmployeeSalaryTermsDto,
    nullable: true,
    description: 'The salary version in effect that month; null = none set',
  })
  terms: EmployeeSalaryTermsDto | null;

  @ApiProperty(MONEY('6000.00', "The month's fixed salary (what is earned)"))
  fixedSalary: string;

  @ApiProperty(MONEY('2000.00', 'Valid payments for this month'))
  paid: string;

  @ApiProperty(MONEY('4000.00', 'fixedSalary - paid (negative when overpaid)'))
  remaining: string;

  @ApiProperty({
    type: [EmployeeSalaryPaymentDto],
    description: 'Every payment for this month, voided ones too, newest first',
  })
  payments: EmployeeSalaryPaymentDto[];
}

export class EmployeeSalaryOverviewRowDto {
  @ApiProperty({ type: EmployeeRefDto })
  employee: EmployeeRefDto;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'A salary version is in effect that month' })
  hasTerms: boolean;

  @ApiProperty(MONEY('6000.00'))
  fixedSalary: string;

  @ApiProperty(MONEY('2000.00'))
  paid: string;

  @ApiProperty(MONEY('4000.00'))
  remaining: string;
}
