import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { MethodBreakdownDto } from '../../billing/dto/payment.dto.js';
import { OutstandingFlowDto } from '../../outstanding/dto/outstanding.dto.js';
import {
  ExpenseOrigin,
  RevenueGroupBy,
  TransactionKind,
} from '../reports.enums.js';

const MONEY = (example: string, description?: string) => ({
  example,
  description: description ?? 'Decimal string with 2 decimals',
});

// Required clinic local dates, both inclusive.
const ReportDate = (example: string, description: string) =>
  applyDecorators(ApiProperty({ example, description }), IsLocalDate());

// ---------- Inputs ----------

export class ReportRangeQueryDto {
  @ReportDate('2026-11-01', 'First clinic local date (inclusive)')
  from: string;

  @ReportDate('2026-11-30', 'Last clinic local date (inclusive)')
  to: string;
}

export class RevenueQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ enum: RevenueGroupBy, default: RevenueGroupBy.DAY })
  @IsOptional()
  @IsEnum(RevenueGroupBy)
  groupBy: RevenueGroupBy = RevenueGroupBy.DAY;
}

export class AttendanceQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}

export class TransactionsQueryDto extends PaginationQueryDto {
  @ReportDate('2026-11-01', 'First clinic local date (inclusive)')
  from: string;

  @ReportDate('2026-11-30', 'Last clinic local date (inclusive)')
  to: string;

  @ApiPropertyOptional({ enum: TransactionKind, description: 'Only this kind' })
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind;
}

// ---------- Outputs ----------

export class ReportRangeDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;
}

export class SummaryReportDto extends ReportRangeDto {
  @ApiProperty(MONEY('12500.00', 'Valid payments received in the range'))
  collected: string;

  @ApiProperty(MONEY('300.00', 'Valid refunds made in the range'))
  refunded: string;

  @ApiProperty(MONEY('12200.00', 'collected - refunded'))
  netCollected: string;

  @ApiProperty(
    MONEY(
      '1500.00',
      'Valid expenses dated in the range, referral commission payouts included',
    ),
  )
  expenses: string;

  @ApiProperty(
    MONEY(
      '350.00',
      'Of `expenses`: payouts to referring doctors (never added again)',
    ),
  )
  commissionPayouts: string;

  @ApiProperty(
    MONEY(
      '4000.00',
      'Of `expenses`: salary payments to the clinic’s doctors (never added again)',
    ),
  )
  salaryPayments: string;

  @ApiProperty(MONEY('10700.00', 'netCollected - expenses'))
  netAfterExpenses: string;

  @ApiProperty(
    MONEY('14000.00', 'Totals of non-cancelled invoices issued in the range'),
  )
  invoiced: string;

  @ApiProperty(
    MONEY(
      '1800.00',
      'What patients still owed at the end of `to`, on every invoice issued by then (= the daily summary of `to`)',
    ),
  )
  patientsOwe: string;

  @ApiProperty(
    MONEY(
      '5300.00',
      'What the clinic owed its doctors at the end of `to`: salaries and referral commissions earned and not paid (= the daily summary of `to`)',
    ),
  )
  clinicOwes: string;

  @ApiProperty(
    MONEY(
      '650.00',
      'Active discounts applied in the range, on non-cancelled invoices',
    ),
  )
  discountsGiven: string;

  @ApiProperty({
    example: 48,
    description: 'ACTIVE visits (walk-ins included)',
  })
  attendedVisits: number;

  @ApiProperty({
    example: 3,
    description: 'NO_SHOW appointments starting in the range',
  })
  noShows: number;

  @ApiProperty({
    example: 5,
    description: 'CANCELLED appointments starting in the range',
  })
  cancellations: number;

  @ApiProperty({ example: 12, description: 'Patients created in the range' })
  newPatients: number;

  @ApiProperty({
    example: 4,
    description: 'ACTIVE visits in the range without a SIGNED note',
  })
  unsignedNotes: number;
}

export class RevenueRowDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-03',
    description:
      'YYYY-MM-DD (day), YYYY-MM (month), doctor or service id, or the method. null = invoices without a visit (manual invoices)',
  })
  key: string | null;

  @ApiProperty({ example: '2026-11-03' })
  label: string;

  @ApiProperty(MONEY('1200.00', 'Payments - refunds'))
  collected: string;

  @ApiProperty({
    ...MONEY('1500.00', 'null when grouped by method'),
    type: String,
    nullable: true,
  })
  invoiced: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 5,
    description: 'ACTIVE visits; null when grouped by method',
  })
  visits: number | null;
}

export class RevenueTotalsDto {
  @ApiProperty(MONEY('12200.00'))
  collected: string;

  @ApiProperty({ ...MONEY('14000.00'), type: String, nullable: true })
  invoiced: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 48 })
  visits: number | null;
}

export class RevenueReportDto extends ReportRangeDto {
  @ApiProperty({ enum: RevenueGroupBy })
  groupBy: RevenueGroupBy;

  @ApiProperty({ type: [RevenueRowDto] })
  rows: RevenueRowDto[];

  @ApiProperty({ type: RevenueTotalsDto })
  totals: RevenueTotalsDto;
}

export class NamedRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;
}

export class AttendanceCountsDto {
  @ApiProperty({
    example: 40,
    description: 'Appointments starting in the range, except RESCHEDULED ones',
  })
  booked: number;

  @ApiProperty({ example: 33 })
  attended: number;

  @ApiProperty({ example: 3 })
  noShow: number;

  @ApiProperty({ example: 2 })
  cancelled: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '8.33',
    description: 'noShow / (attended + noShow) x 100; null when both are 0',
  })
  noShowRate: string | null;

  @ApiProperty({ example: 6, description: 'ACTIVE walk-in visits' })
  walkIns: number;

  @ApiProperty({ example: 15 })
  onlineBookings: number;

  @ApiProperty({ example: 25 })
  receptionBookings: number;
}

export class AttendanceRowDto extends AttendanceCountsDto {
  @ApiProperty({ type: NamedRefDto })
  doctor: NamedRefDto;
}

export class AttendanceReportDto extends ReportRangeDto {
  @ApiProperty({ type: [AttendanceRowDto] })
  doctors: AttendanceRowDto[];

  @ApiProperty({ type: AttendanceCountsDto })
  totals: AttendanceCountsDto;
}

export class DiscountByUserDto {
  @ApiProperty({ type: UserRefDto })
  user: UserRefDto;

  @ApiProperty({ example: 4 })
  count: number;

  @ApiProperty(MONEY('200.00'))
  amount: string;
}

export class DiscountByReasonDto {
  @ApiProperty({ example: 'Student' })
  reason: string;

  @ApiProperty({ example: 4 })
  count: number;

  @ApiProperty(MONEY('200.00'))
  amount: string;
}

export class DiscountsReportDto extends ReportRangeDto {
  @ApiProperty({ example: 9 })
  count: number;

  @ApiProperty(MONEY('650.00'))
  totalAmount: string;

  @ApiProperty({ example: 3, description: 'Repeated from an earlier discount' })
  repeats: number;

  @ApiProperty({ type: [DiscountByUserDto] })
  byUser: DiscountByUserDto[];

  @ApiProperty({
    type: [DiscountByReasonDto],
    description: 'Top 10, case and spacing ignored',
  })
  byReason: DiscountByReasonDto[];
}

export class ExpenseByCategoryDto {
  @ApiProperty({ type: NamedRefDto })
  category: NamedRefDto;

  @ApiProperty({ example: 3 })
  count: number;

  @ApiProperty(MONEY('450.00'))
  total: string;
}

export class ExpensesReportDto extends ReportRangeDto {
  @ApiProperty({ example: 7 })
  count: number;

  @ApiProperty(MONEY('1500.00'))
  total: string;

  @ApiProperty(MONEY('350.00', 'Of `total`: payouts to referring doctors'))
  commissionPayouts: string;

  @ApiProperty(
    MONEY('4000.00', 'Of `total`: salary payments to the clinic’s doctors'),
  )
  salaryPayments: string;

  @ApiProperty({ type: [ExpenseByCategoryDto] })
  byCategory: ExpenseByCategoryDto[];

  @ApiProperty({ type: MethodBreakdownDto })
  byMethod: MethodBreakdownDto;
}

export class MoneyFlowReportDto extends OutstandingFlowDto {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;
}

export class TransactionInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;
}

export class TransactionRowDto {
  @ApiProperty({ enum: TransactionKind })
  kind: TransactionKind;

  @ApiProperty({ format: 'uuid', description: 'The payment or expense id' })
  id: string;

  @ApiProperty({
    example: 'RCPT-2026-000045',
    description: 'Receipt number (payment, refund) or expense number',
  })
  number: string;

  @ApiProperty({
    example: '2026-11-05',
    description:
      'Clinic local date it counts on: received (payment, refund) or the expense date',
  })
  date: string;

  @ApiProperty({
    example: '2026-11-05T10:15:00+02:00',
    description: 'When it was recorded',
  })
  recordedAt: string;

  @ApiProperty({ enum: ['CASH', 'CARD', 'WALLET', 'INSTAPAY'] })
  method: string;

  @ApiProperty(MONEY('300.00', 'Always positive; `kind` gives the direction'))
  amount: string;

  @ApiPropertyOptional({ type: NamedRefDto, nullable: true })
  patient: NamedRefDto | null;

  @ApiPropertyOptional({ type: TransactionInvoiceDto, nullable: true })
  invoice: TransactionInvoiceDto | null;

  @ApiPropertyOptional({
    enum: ExpenseOrigin,
    nullable: true,
    description: 'EXPENSE only: what it pays for',
  })
  expenseOrigin: ExpenseOrigin | null;

  @ApiPropertyOptional({ type: NamedRefDto, nullable: true })
  category: NamedRefDto | null;

  @ApiPropertyOptional({ example: 'Salary 2026-10: Dr. Mona', nullable: true })
  description: string | null;

  @ApiPropertyOptional({
    example: 'Dr. Mona Adel',
    nullable: true,
    description: 'EXPENSE only: who was paid',
  })
  payee: string | null;

  @ApiPropertyOptional({
    example: 'Partial refund',
    nullable: true,
    description: 'REFUND only',
  })
  reason: string | null;

  @ApiProperty({ type: NamedRefDto })
  recordedBy: NamedRefDto;
}

export class CountTotalDto {
  @ApiProperty({ example: 3 })
  count: number;

  @ApiProperty(MONEY('750.00'))
  total: string;
}

export class TransactionTotalsDto {
  @ApiProperty({ type: CountTotalDto })
  payments: CountTotalDto;

  @ApiProperty({ type: CountTotalDto })
  refunds: CountTotalDto;

  @ApiProperty({
    type: CountTotalDto,
    description: 'Every expense, salary payments and referral payouts included',
  })
  expenses: CountTotalDto;

  @ApiProperty({ type: CountTotalDto, description: 'Of `expenses`' })
  salaryPayments: CountTotalDto;

  @ApiProperty({ type: CountTotalDto, description: 'Of `expenses`' })
  commissionPayouts: CountTotalDto;

  @ApiProperty(MONEY('2100.00', 'payments - refunds - expenses'))
  net: string;
}

export class TransactionListDto {
  @ApiProperty({ type: [TransactionRowDto] })
  items: TransactionRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;

  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;

  @ApiProperty({
    type: TransactionTotalsDto,
    description: 'The whole range, every kind (all pages)',
  })
  totals: TransactionTotalsDto;
}
