import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { orJsonNull } from '../../common/utils/json-null.util.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { DiscountsService } from './discounts.service.js';
import {
  ApplyDiscountDto,
  DiscountHistoryEntryDto,
  LastDiscountDto,
  LastDiscountQueryDto,
} from './dto/discount.dto.js';
import { InvoiceDetailDto, ReasonDto } from './dto/invoice.dto.js';

const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];

@ApiTags('Billing: discounts')
@Controller()
@Auth(...DESK)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get('patients/:patientId/last-discount')
  @ApiOperation({
    summary: "The patient's most recent active desk discount (to repeat it)",
    description:
      'Doctor referral discounts and cancelled invoices are skipped (they cannot be repeated). `null` when there is none. Pass excludeInvoiceId (the invoice being edited) to get the previous one.',
  })
  @ApiOkResponse({ type: LastDiscountDto, description: 'or null' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Patient not found',
  })
  async lastDiscount(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: LastDiscountQueryDto,
  ): Promise<LastDiscountDto | null> {
    return orJsonNull(
      await this.discounts.lastForPatient(patientId, query.excludeInvoiceId),
    );
  }

  @Get('patients/:patientId/discounts')
  @ApiOperation({
    summary: "The patient's discount history (newest first)",
    description:
      'Active, removed and replaced discounts, also on cancelled invoices.',
  })
  @ApiOkResponse({ type: PaginatedResponse(DiscountHistoryEntryDto) })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Patient not found',
  })
  discountHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<DiscountHistoryEntryDto>> {
    return this.discounts.historyForPatient(patientId, query);
  }

  @Post('invoices/:id/discount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply or replace the discount (only while nothing is paid)',
    description:
      'Body: { type, value, reason } OR { repeatFromDiscountId }. Repeating copies type/value/reason of a desk discount of the same patient, recomputes the amount and never changes the old invoice. A doctor referral discount or a discount on a cancelled invoice is not repeated.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'INVOICE_LOCKED, DISCOUNT_LIMIT_EXCEEDED, DISCOUNT_EXCEEDS_SUBTOTAL, DISCOUNT_PATIENT_MISMATCH, or DISCOUNT_NOT_REPEATABLE with details.reason: REFERRAL_DISCOUNT, INVOICE_CANCELLED',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyDiscountDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.discounts.apply(id, dto, actor);
  }

  @Post('invoices/:id/discount/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the discount (kept in history)' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INVOICE_LOCKED',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.discounts.remove(id, dto.reason, actor);
  }

  @Post('invoices/:id/referral')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Cover the invoice by the patient's doctor referral",
    description:
      'For a session or package sale invoiced before the referral was recorded (attend and sale do it automatically). Only while nothing is paid. Pins the terms (commission) and applies the referral discount, replacing any other discount.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'INVOICE_LOCKED, or REFERRAL_NOT_APPLICABLE with details.reason: ALREADY_APPLIED, MANUAL_INVOICE, PACKAGE_SESSION, NO_ACTIVE_REFERRAL, NOT_COVERED',
  })
  applyReferral(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.discounts.applyReferralToInvoice(id, actor);
  }
}
