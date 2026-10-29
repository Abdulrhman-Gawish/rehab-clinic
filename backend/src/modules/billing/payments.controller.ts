import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { BillingReportsService } from './billing-reports.service.js';
import { ReasonDto } from './dto/invoice.dto.js';
import {
  AttentionDto,
  DailySummaryDto,
  DailySummaryQueryDto,
  ListPaymentsQueryDto,
  PaymentResponseDto,
  ReceiptDto,
  RecordPaymentDto,
  RefundPaymentDto,
} from './dto/payment.dto.js';
import { PaymentsService, type PaymentResult } from './payments.service.js';

const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Retry-safe key (1-100 chars). Same key + same body returns the original (header Idempotent-Replayed: true); same key + other body -> 409 IDEMPOTENCY_KEY_REUSED.',
};

function respond(res: Response, result: PaymentResult): PaymentResponseDto {
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(HttpStatus.CREATED);
  return result.payment;
}

@ApiTags('Billing: payments')
@Controller()
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reports: BillingReportsService,
  ) {}

  @Post('invoices/:id/payments')
  @Auth(...DESK)
  @ApiOperation({ summary: 'Record a (partial) payment' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'IDEMPOTENCY_KEY_REUSED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'OVERPAYMENT or INVOICE_CANCELLED',
  })
  async record(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentResponseDto> {
    return respond(res, await this.payments.record(id, dto, key, actor));
  }

  @Post('payments/:id/refund')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Return money for a valid payment (OWNER)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'IDEMPOTENCY_KEY_REUSED',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'REFUND_EXCEEDS_PAYMENT or REFUND_NOT_ALLOWED',
  })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentResponseDto> {
    return respond(res, await this.payments.refund(id, dto, key, actor));
  }

  @Post('payments/:id/void')
  @Auth(...DESK)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Void a mistaken payment or refund (same local day)',
    description: 'RECEPTIONIST: only payments they recorded. OWNER: any.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'VOID_NOT_ALLOWED',
  })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<PaymentResponseDto> {
    return this.payments.void(id, dto.reason, actor);
  }

  @Get('payments')
  @Auth(...DESK)
  @ApiOperation({ summary: 'Search payments and refunds (newest first)' })
  @ApiOkResponse({ type: PaginatedResponse(PaymentResponseDto) })
  list(
    @Query() query: ListPaymentsQueryDto,
  ): Promise<Paginated<PaymentResponseDto>> {
    return this.payments.list(query);
  }

  @Get('payments/:id/receipt')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Printable receipt data (JSON; printing is the frontend)',
  })
  @ApiOkResponse({ type: ReceiptDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  receipt(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptDto> {
    return this.payments.receipt(id);
  }

  @Get('billing/attention')
  @Auth(...DESK)
  @ApiOperation({
    summary:
      'Invoices to follow up: paid invoices of cancelled visits, overdue balances',
  })
  @ApiOkResponse({ type: AttentionDto })
  attention(): Promise<AttentionDto> {
    return this.reports.attention();
  }

  @Get('billing/daily-summary')
  @Auth(...DESK)
  @ApiOperation({
    summary: 'Cash-desk totals for a clinic local day',
    description:
      'expectedCash = cash payments - cash refunds - cash expenses. RECEPTIONIST: today only.',
  })
  @ApiOkResponse({ type: DailySummaryDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  dailySummary(
    @Query() query: DailySummaryQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<DailySummaryDto> {
    return this.reports.dailySummary(query.date, actor);
  }
}
