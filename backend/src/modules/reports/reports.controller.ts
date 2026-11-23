import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import {
  AsOfQueryDto,
  ClinicOwesReportDto,
  PatientsOweListDto,
  PatientsOweQueryDto,
} from '../outstanding/dto/outstanding.dto.js';
import { OutstandingService } from '../outstanding/outstanding.service.js';
import {
  AttendanceQueryDto,
  AttendanceReportDto,
  DiscountsReportDto,
  ExpensesReportDto,
  MoneyFlowReportDto,
  ReportRangeQueryDto,
  RevenueQueryDto,
  RevenueReportDto,
  SummaryReportDto,
  TransactionListDto,
  TransactionsQueryDto,
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
  constructor(
    private readonly reports: ReportsService,
    private readonly outstanding: OutstandingService,
  ) {}

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

  @Get('money-flow')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary:
      'What is owed at the start and end of the range, and what moved it',
    description:
      'Patients owe: opening + invoiced - cancelled - payments + refunds = closing. Clinic owes: opening + salariesEarned + salaryAdjustments + employeeSalariesEarned + commissionsEarned - salaryPayments - employeeSalaryPayments - commissionPayouts + advancesChange = closing. One day = that day’s daily summary.',
  })
  @ApiOkResponse({ type: MoneyFlowReportDto })
  moneyFlow(@Query() query: ReportRangeQueryDto): Promise<MoneyFlowReportDto> {
    return this.reports.moneyFlow(query);
  }

  @Get('transactions')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Every payment, refund and expense that counts in the range',
    description:
      'Newest first. Voided rows never count. Totals cover the whole range.',
  })
  @ApiOkResponse({ type: TransactionListDto })
  transactions(
    @Query() query: TransactionsQueryDto,
  ): Promise<TransactionListDto> {
    return this.reports.transactions(query);
  }

  @Get('patients-owe')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary: 'Patients with a balance at the end of a day, largest first',
    description:
      'Every invoice issued by then and not cancelled by then, minus what was paid by then (unpaid then, even if paid later).',
  })
  @ApiOkResponse({ type: PatientsOweListDto })
  patientsOwe(
    @Query() query: PatientsOweQueryDto,
  ): Promise<PatientsOweListDto> {
    return this.outstanding.patientsOwe(query);
  }

  @Get('clinic-owes')
  @Auth(UserRole.OWNER)
  @ApiOperation({
    summary:
      'What the clinic owes its doctors and employees at the end of a day',
    description:
      'Salaries per doctor and month (fixed salary due on the month’s last day, commissions from the session day), salaries per employee and month (fixed salary due on the month’s last day) and referral commissions per referring doctor, minus payments dated by then.',
  })
  @ApiOkResponse({ type: ClinicOwesReportDto })
  clinicOwes(@Query() query: AsOfQueryDto): Promise<ClinicOwesReportDto> {
    return this.outstanding.clinicOwes(query.asOf);
  }
}
