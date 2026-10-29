import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import { IsMoney } from '../../../common/decorators/money.decorator.js';
import {
  OptionalNotNull,
  ToBoolean,
  Trim,
  TrimAndCollapse,
} from '../../../common/decorators/transform.decorators.js';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../../common/dto/pagination.dto.js';
import { PaymentMethod } from '../../billing/billing.enums.js';
import { ExpenseStatus } from '../entities/expense.entity.js';

const NullableOptional = () =>
  ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  );

// ---------- Inputs ----------

export class CreateExpenseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Tea and sugar', maxLength: 255 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 255)
  description: string;

  @ApiProperty({ example: '85.50', description: 'Decimal string, > 0' })
  @IsMoney()
  amount: string;

  @ApiProperty({
    example: '2026-11-03',
    description:
      'Clinic local date; not in the future. RECEPTIONIST: at most BACKDATE_MAX_DAYS back.',
  })
  @IsLocalDate()
  expenseDate: string;

  @ApiPropertyOptional({ example: 'Corner shop', maxLength: 120 })
  @IsOptional()
  @TrimAndCollapse()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ example: 'INV-778', maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @OptionalNotNull()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 255)
  description?: string;

  @ApiPropertyOptional({ example: '90.00' })
  @OptionalNotNull()
  @IsMoney()
  amount?: string;

  @ApiPropertyOptional({ example: '2026-11-03' })
  @OptionalNotNull()
  @IsLocalDate()
  expenseDate?: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 120 })
  @NullableOptional()
  @TrimAndCollapse()
  @IsString()
  @MaxLength(120)
  vendorName?: string | null;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @OptionalNotNull()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 100 })
  @NullableOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  reference?: string | null;
}

export class ListExpensesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'expense_date >= from (local date)',
  })
  @IsOptional()
  @IsLocalDate()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'expense_date <= to (local date)',
  })
  @IsOptional()
  @IsLocalDate()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'ضيافة', maxLength: 80 })
  @TrimAndCollapse()
  @IsString()
  @Length(2, 80)
  name: string;
}

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

// ---------- Outputs ----------

export class ExpenseCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ضيافة' })
  name: string;

  @ApiProperty()
  isActive: boolean;
}

export class ExpenseResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'EXP-2026-000010' })
  expenseNumber: string;

  @ApiProperty({ type: ExpenseCategoryDto })
  category: ExpenseCategoryDto;

  @ApiProperty({ example: 'Tea and sugar' })
  description: string;

  @ApiProperty({ example: '85.50' })
  amount: string;

  @ApiProperty({ example: '2026-11-03' })
  expenseDate: string;

  @ApiProperty({ nullable: true, type: String })
  vendorName: string | null;

  @ApiProperty({ enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @ApiProperty({ nullable: true, type: String })
  reference: string | null;

  @ApiProperty({
    description: 'A receipt file is attached (GET /expenses/:id/receipt)',
  })
  hasReceipt: boolean;

  @ApiProperty({ enum: ExpenseStatus })
  status: ExpenseStatus;

  @ApiProperty({ format: 'uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-11-03T09:00:00+02:00' })
  createdAt: string;

  @ApiProperty({ nullable: true, type: String })
  voidedAt: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  voidedById: string | null;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;
}

export class ExpenseListDto {
  @ApiProperty({ type: [ExpenseResponseDto] })
  items: ExpenseResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;

  @ApiProperty({
    example: '1250.00',
    description: 'Sum of VALID expenses matching the filters (all pages)',
  })
  totalAmount: string;
}
