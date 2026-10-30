import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { MethodBreakdownDto } from '../../billing/dto/payment.dto.js';
import { RevenueGroupBy } from '../reports.enums.js';

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

export class OutstandingQueryDto extends PaginationQueryDto {
  @ReportDate('2026-11-01', 'Invoices issued on or after this local date')
  from: string;

  @ReportDate('2026-11-30', 'Invoices issued on or before this local date')
  to: string;
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

  @ApiProperty(MONEY('1500.00', 'Valid expenses dated in the range'))
  expenses: string;

  @ApiProperty(MONEY('10700.00', 'netCollected - expenses'))
  netAfterExpenses: string;

  @ApiProperty(
    MONEY('14000.00', 'Totals of non-cancelled invoices issued in the range'),
  )
  invoiced: string;

  @ApiProperty(
    MONEY(
      '1800.00',
      'Unpaid balance (today) of the invoices counted in invoiced',
    ),
  )
  outstanding: string;

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

  @ApiProperty({ type: [ExpenseByCategoryDto] })
  byCategory: ExpenseByCategoryDto[];

  @ApiProperty({ type: MethodBreakdownDto })
  byMethod: MethodBreakdownDto;
}

export class OutstandingPatientDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;
}

export class OutstandingRowDto {
  @ApiProperty({ type: OutstandingPatientDto })
  patient: OutstandingPatientDto;

  @ApiProperty(MONEY('450.00'))
  balance: string;

  @ApiProperty({
    example: '2026-11-03',
    description: 'Clinic local date of the oldest unpaid invoice',
  })
  oldestUnpaidInvoiceDate: string;
}
