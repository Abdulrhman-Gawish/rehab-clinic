import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import {
  IsIsoWithOffset,
  IsLocalDate,
} from '../../../common/decorators/date-time.decorators.js';
import { IsPositiveMoney } from '../../../common/decorators/money.decorator.js';
import { Trim } from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  DiscountType,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '../billing.enums.js';
import { InvoicePatientDto, InvoiceSummaryDto } from './invoice.dto.js';

const MONEY = (example: string, description?: string) => ({
  example,
  description: description ?? 'Decimal string with 2 decimals',
});

// ---------- Inputs ----------

export class RecordPaymentDto {
  @ApiProperty(MONEY('100.00', 'Must be > 0 and <= the remaining balance'))
  @IsPositiveMoney()
  amount: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({
    example: 'Card slip 88231',
    description:
      'Optional free text for any method (never validated against anything)',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  reference?: string;
}

export class RefundPaymentDto {
  @ApiProperty(MONEY('50.00', 'At most what is left unrefunded of the payment'))
  @IsPositiveMoney()
  amount: string;

  @ApiProperty({
    example: 'Session not delivered',
    minLength: 3,
    maxLength: 255,
  })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason: string;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: "Defaults to the original payment's method",
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00+02:00',
    description: 'received_at >= from',
  })
  @IsOptional()
  @IsIsoWithOffset()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00+02:00',
    description: 'received_at < to',
  })
  @IsOptional()
  @IsIsoWithOffset()
  to?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentType })
  @IsOptional()
  @IsEnum(PaymentType)
  type?: PaymentType;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receivedBy?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}

export class DailySummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-05',
    description:
      'Clinic local date (default today). Receptionists: today only.',
  })
  @IsOptional()
  @IsLocalDate()
  date?: string;
}

// ---------- Outputs ----------

export class PaymentInvoiceStateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;

  @ApiProperty({ example: 'PARTIALLY_PAID' })
  status: string;

  @ApiProperty(MONEY('256.00'))
  total: string;

  @ApiProperty(MONEY('100.00'))
  amountPaid: string;

  @ApiProperty(MONEY('156.00'))
  balance: string;
}

export class PaymentResponseDto {
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

  @ApiProperty({ nullable: true, type: String, description: 'Refund reason' })
  reason: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  refundOfId: string | null;

  @ApiProperty({ type: InvoicePatientDto })
  patient: InvoicePatientDto;

  @ApiProperty({
    type: PaymentInvoiceStateDto,
    description: 'The invoice as it is now',
  })
  invoice: PaymentInvoiceStateDto;

  @ApiProperty({ format: 'uuid' })
  receivedById: string;

  @ApiProperty({ example: '2026-11-05T10:05:00+02:00' })
  receivedAt: string;

  @ApiProperty({ nullable: true, type: String })
  voidedAt: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  voidedById: string | null;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;
}

export class ReceiptLineDto {
  @ApiProperty({ example: 'Physiotherapy session' })
  description: string;

  @ApiProperty(MONEY('320.00'))
  unitPrice: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty(MONEY('320.00'))
  lineTotal: string;
}

export class ReceiptDiscountDto {
  @ApiProperty({ enum: DiscountType })
  type: DiscountType;

  @ApiProperty({ example: '20.00' })
  value: string;

  @ApiProperty(MONEY('64.00'))
  amount: string;

  @ApiProperty({ example: 'Regular patient' })
  reason: string;
}

// Everything the frontend needs to print a receipt (JSON only).
export class ReceiptDto {
  @ApiProperty({ example: 'Rehab Clinic' })
  clinicName: string;

  @ApiProperty({ nullable: true, type: String, example: '+20 2 1234 5678' })
  clinicPhone: string | null;

  @ApiProperty({ example: 'RCP-2026-000045' })
  receiptNumber: string;

  @ApiProperty({ enum: PaymentType })
  type: PaymentType;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ example: '2026-11-05T10:05:00+02:00' })
  receivedAt: string;

  @ApiProperty({ example: 'Mona Adel', description: 'Who received the money' })
  receivedBy: string;

  @ApiProperty({ type: InvoicePatientDto })
  patient: InvoicePatientDto;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;

  @ApiProperty({ type: [ReceiptLineDto] })
  items: ReceiptLineDto[];

  @ApiProperty(MONEY('320.00'))
  subtotal: string;

  @ApiProperty({ type: ReceiptDiscountDto, nullable: true })
  discount: ReceiptDiscountDto | null;

  @ApiProperty(MONEY('256.00'))
  total: string;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ nullable: true, type: String })
  reference: string | null;

  @ApiProperty(MONEY('100.00', 'This payment (or refund)'))
  amount: string;

  @ApiProperty(MONEY('100.00', 'Net paid on the invoice so far'))
  totalPaid: string;

  @ApiProperty(MONEY('156.00'))
  remainingBalance: string;
}

export class MethodBreakdownDto {
  @ApiProperty(MONEY('0.00'))
  CASH: string;

  @ApiProperty(MONEY('0.00'))
  CARD: string;

  @ApiProperty(MONEY('0.00'))
  WALLET: string;

  @ApiProperty(MONEY('0.00'))
  INSTAPAY: string;
}

export class MoneyTotalsDto {
  @ApiProperty({ example: 3 })
  count: number;

  @ApiProperty(MONEY('750.00'))
  total: string;

  @ApiProperty({ type: MethodBreakdownDto })
  byMethod: MethodBreakdownDto;
}

export class VoidedTotalsDto {
  @ApiProperty({ example: 1 })
  count: number;

  @ApiProperty(MONEY('100.00'))
  amount: string;
}

export class DiscountsByUserDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  @ApiProperty({ example: 2 })
  count: number;

  @ApiProperty(MONEY('80.00'))
  amount: string;
}

export class DiscountTotalsDto {
  @ApiProperty({ example: 2 })
  count: number;

  @ApiProperty(MONEY('80.00'))
  amount: string;

  @ApiProperty({ type: [DiscountsByUserDto] })
  byUser: DiscountsByUserDto[];
}

export class DailySummaryDto {
  @ApiProperty({ example: '2026-11-05' })
  date: string;

  @ApiProperty({ example: '2026-11-05T00:00:00+02:00' })
  from: string;

  @ApiProperty({ example: '2026-11-06T00:00:00+02:00' })
  to: string;

  @ApiProperty({ type: MoneyTotalsDto, description: 'Valid payments received' })
  payments: MoneyTotalsDto;

  @ApiProperty({ type: MoneyTotalsDto, description: 'Valid refunds paid out' })
  refunds: MoneyTotalsDto;

  @ApiProperty({
    type: VoidedTotalsDto,
    description: 'Payments/refunds voided that day',
  })
  voided: VoidedTotalsDto;

  @ApiProperty({
    type: DiscountTotalsDto,
    description: 'Active discounts applied that day',
  })
  discounts: DiscountTotalsDto;

  @ApiProperty({
    type: MoneyTotalsDto,
    description: 'Valid expenses dated that day',
  })
  expenses: MoneyTotalsDto;

  @ApiProperty(MONEY('420.00', 'cash payments - cash refunds - cash expenses'))
  expectedCash: string;
}

export class AttentionDto {
  @ApiProperty({ example: 7 })
  overdueDays: number;

  @ApiProperty({
    type: [InvoiceSummaryDto],
    description: 'Invoices of VOIDED visits that still hold money',
  })
  voidedVisitsWithPayments: InvoiceSummaryDto[];

  @ApiProperty({
    type: [InvoiceSummaryDto],
    description: 'Invoices with a balance issued more than overdueDays ago',
  })
  overdue: InvoiceSummaryDto[];
}
