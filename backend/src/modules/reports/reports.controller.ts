import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import {
  AttendanceQueryDto,
  AttendanceReportDto,
  DiscountsReportDto,
  ExpensesReportDto,
  OutstandingQueryDto,
  OutstandingRowDto,
  ReportRangeQueryDto,
  RevenueQueryDto,
  RevenueReportDto,
  SummaryReportDto,
} from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

// OWNER only. Every report takes from/to (clinic local dates, inclusive).
@ApiTags('Reports')
@Controller('reports')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid dates, or `from` after `to`',
})
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Money and activity totals for the range' })
  @ApiOkResponse({ type: SummaryReportDto })
  summary(@Query() query: ReportRangeQueryDto): Promise<SummaryReportDto> {
    return this.reports.summary(query);
  }

  @Get('revenue')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary:
      'Collected, invoiced and visits per day, month, doctor, service or method',
  })
  @ApiOkResponse({ type: RevenueReportDto })
  revenue(@Query() query: RevenueQueryDto): Promise<RevenueReportDto> {
    return this.reports.revenue(query);
  }

  @Get('attendance')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Bookings, attendance and no-shows per doctor' })
  @ApiOkResponse({ type: AttendanceReportDto })
  attendance(@Query() query: AttendanceQueryDto): Promise<AttendanceReportDto> {
    return this.reports.attendance(query);
  }

  @Get('discounts')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Discounts given, by user and by reason' })
  @ApiOkResponse({ type: DiscountsReportDto })
  discounts(@Query() query: ReportRangeQueryDto): Promise<DiscountsReportDto> {
    return this.reports.discounts(query);
  }

  @Get('expenses')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Expenses by category and by payment method' })
  @ApiOkResponse({ type: ExpensesReportDto })
  expenses(@Query() query: ReportRangeQueryDto): Promise<ExpensesReportDto> {
    return this.reports.expenses(query);
  }

  @Get('outstanding')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Patients with an unpaid balance, largest first',
    description: 'Only invoices issued in the range count.',
  })
  @ApiOkResponse({ type: PaginatedResponse(OutstandingRowDto) })
  outstanding(
    @Query() query: OutstandingQueryDto,
  ): Promise<Paginated<OutstandingRowDto>> {
    return this.reports.outstanding(query);
  }
}
