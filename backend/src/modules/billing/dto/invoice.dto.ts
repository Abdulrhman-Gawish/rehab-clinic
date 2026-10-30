import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  LocalDateFrom,
  LocalDateTo,
} from '../../../common/decorators/date-time.decorators.js';
import { IsMoney } from '../../../common/decorators/money.decorator.js';
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
  DiscountType,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '../billing.enums.js';

const MONEY = (example: string, description?: string) => ({
  example,
  description: description ?? 'Decimal string with 2 decimals',
});

// ---------- Inputs ----------

export class InvoiceItemInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Catalog service: description and price come from it (any client price is ignored)',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    example: 'Medical report',
    description: 'Required for free-text items',
  })
  @IsOptional()
  @TrimOrNull({ collapse: true })
  @IsString()
  @Length(2, 255)
  description?: string;

  @ApiPropertyOptional(MONEY('150.00', 'Required for free-text items'))
  @IsOptional()
  @IsMoney()
  unitPrice?: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ type: [InvoiceItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items: InvoiceItemInputDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// Service items: only quantity can change. Free-text items: all three.
export class UpdateInvoiceItemDto {
  @ApiPropertyOptional({ example: 'Medical report (copy)' })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(2, 255)
  description?: string;

  @ApiPropertyOptional(MONEY('100.00'))
  @OptionalNotNull()
  @IsMoney()
  unitPrice?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 1000 })
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
}

export class ReasonDto {
  @ApiProperty({ example: 'Created by mistake', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @LocalDateFrom('Issued')
  from?: string;

  @LocalDateTo('Issued')
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description: 'true: something left to pay (not cancelled)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  hasBalance?: boolean;
}

// ---------- Outputs ----------

export class InvoicePatientDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;
}

export class InvoiceItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  serviceId: string | null;

  @ApiProperty({ example: 'Physiotherapy session' })
  description: string;

  @ApiProperty(MONEY('320.00'))
  unitPrice: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty(MONEY('320.00'))
  lineTotal: string;
}

export class InvoiceDiscountDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: DiscountType })
  type: DiscountType;

  @ApiProperty({
    example: '20.00',
    description: 'PERCENT: 20.00 = 20%; FIXED: EGP',
  })
  value: string;

  @ApiProperty(MONEY('64.00', 'EGP discounted on this invoice'))
  amount: string;

  @ApiProperty({ example: 'Regular patient' })
  reason: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  repeatedFromId: string | null;

  @ApiProperty({ type: UserRefDto })
  appliedBy: UserRefDto;

  @ApiProperty({ example: '2026-11-05T10:00:00+02:00' })
  appliedAt: string;
}

export class InvoicePaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCP-2026-000045' })
  receiptNumber: string;

  @ApiProperty({ enum: PaymentType })
  type: PaymentType;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty(MONEY('100.00'))
  amount: string;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ nullable: true, type: String })
  reference: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  refundOfId: string | null;

  @ApiProperty({ type: UserRefDto })
  receivedBy: UserRefDto;

  @ApiProperty({ example: '2026-11-05T10:05:00+02:00' })
  receivedAt: string;
}

export class InvoiceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;

  @ApiProperty({ enum: InvoiceStatus })
  status: InvoiceStatus;

  @ApiProperty({ type: InvoicePatientDto })
  patient: InvoicePatientDto;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'null = manual invoice',
  })
  visitId: string | null;

  @ApiProperty(MONEY('320.00'))
  subtotal: string;

  @ApiProperty(MONEY('64.00'))
  discountTotal: string;

  @ApiProperty(MONEY('256.00'))
  total: string;

  @ApiProperty(MONEY('100.00', 'Net of refunds, excluding voided payments'))
  amountPaid: string;

  @ApiProperty(MONEY('156.00', 'total - amountPaid'))
  balance: string;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description:
      'null only for invoices created by the system before attend became synchronous',
  })
  issuedBy: UserRefDto | null;

  @ApiProperty({ example: '2026-11-05T10:00:00+02:00' })
  issuedAt: string;

  @ApiProperty({ nullable: true, type: String })
  cancelledAt: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  cancelledBy: UserRefDto | null;

  @ApiProperty({ nullable: true, type: String })
  cancelReason: string | null;
}

export class InvoiceDetailDto extends InvoiceSummaryDto {
  @ApiProperty({
    description:
      'Items and discount can no longer change: cancelled, or it has (ever) had a valid payment',
  })
  isLocked: boolean;

  @ApiProperty({
    description: 'Not cancelled and nothing paid (amountPaid = 0)',
  })
  canCancel: boolean;

  @ApiProperty({ type: [InvoiceItemDto] })
  items: InvoiceItemDto[];

  @ApiProperty({
    type: InvoiceDiscountDto,
    nullable: true,
    description: 'The active discount',
  })
  discount: InvoiceDiscountDto | null;

  @ApiProperty({
    type: [InvoicePaymentDto],
    description: 'Payments and refunds, voided included',
  })
  payments: InvoicePaymentDto[];
}

export class PatientBalanceDto {
  @ApiProperty({ format: 'uuid' })
  patientId: string;

  @ApiProperty(MONEY('1200.00', 'Sum of totals of non-cancelled invoices'))
  totalInvoiced: string;

  @ApiProperty(MONEY('900.00'))
  totalPaid: string;

  @ApiProperty(MONEY('300.00'))
  balance: string;
}
