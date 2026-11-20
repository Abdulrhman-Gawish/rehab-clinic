import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  RecordSalaryPaymentDto,
  SalaryMonthQueryDto,
  SalaryOverviewRowDto,
  SalaryPaymentDto,
  SalaryReasonDto,
  SalaryStatementDto,
  SalaryTermsDto,
  SetSalaryTermsDto,
} from './dto/salaries.dto.js';
import { SalariesService } from './salaries.service.js';

const { OWNER } = UserRole;

// Doctors' salaries and commissions: OWNER only.
@ApiTags('Doctor salaries')
@Controller()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class SalariesController {
  constructor(private readonly salaries: SalariesService) {}

  @Get('doctor-salaries')
  @Auth(OWNER)
  @ApiOperation({ summary: "Every doctor's salary totals for a month" })
  @ApiOkResponse({ type: [SalaryOverviewRowDto] })
  overview(
    @Query() query: SalaryMonthQueryDto,
  ): Promise<SalaryOverviewRowDto[]> {
    return this.salaries.overview(query.month);
  }

  @Get('doctors/:doctorId/salary/terms')
  @Auth(OWNER)
  @ApiOperation({
    summary: "A doctor's salary terms, every version, newest first",
  })
  @ApiOkResponse({ type: [SalaryTermsDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  listTerms(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
  ): Promise<SalaryTermsDto[]> {
    return this.salaries.listTerms(doctorId);
  }

  @Put('doctors/:doctorId/salary/terms')
  @Auth(OWNER)
  @ApiOperation({
    summary: "Set a doctor's salary terms from a month on",
    description:
      'Fixed monthly salary (0 = commission only) plus commission NONE / PER_SESSION (one rate) / PER_SERVICE (a rate per service); each rate FIXED (EGP per session) or PERCENT (of the session value). Replaces the version of the same month. 422 SALARY_TERMS_INVALID, SALARY_MONTH_PAID.',
  })
  @ApiOkResponse({ type: SalaryTermsDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  setTerms(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() dto: SetSalaryTermsDto,
    @CurrentActor() actor: Actor,
  ): Promise<SalaryTermsDto> {
    return this.salaries.setTerms(doctorId, dto, actor);
  }

  @Get('doctors/:doctorId/salary/statement')
  @Auth(OWNER)
  @ApiOperation({
    summary: "A doctor's salary statement for a month",
    description:
      "Fixed salary + the commission of each attended session (computed live), the month's payments, and what remains.",
  })
  @ApiOkResponse({ type: SalaryStatementDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  statement(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query() query: SalaryMonthQueryDto,
  ): Promise<SalaryStatementDto> {
    return this.salaries.statement(doctorId, query.month);
  }

  @Post('doctors/:doctorId/salary/payments')
  @Auth(OWNER)
  @ApiOperation({
    summary: 'Record a salary payment (also a clinic expense)',
    description:
      'Any amount > 0 for a month up to the current one: advances and partial payments allowed. 422 DATE_OUT_OF_RANGE (future month), EXPENSE_DATE_IN_FUTURE.',
  })
  @ApiCreatedResponse({ type: SalaryPaymentDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  recordPayment(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() dto: RecordSalaryPaymentDto,
    @CurrentActor() actor: Actor,
  ): Promise<SalaryPaymentDto> {
    return this.salaries.recordPayment(doctorId, dto, actor);
  }

  @Post('doctor-salaries/payments/:id/void')
  @Auth(OWNER)
  @ApiOperation({ summary: 'Void a salary payment (and its expense)' })
  @ApiCreatedResponse({ type: SalaryPaymentDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'PAYOUT_VOIDED',
  })
  voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SalaryReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<SalaryPaymentDto> {
    return this.salaries.voidPayment(id, dto.reason, actor);
  }
}
