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
import { UserRole } from '../../common/enums/user-role.enum.js';
import { orJsonNull } from '../../common/utils/json-null.util.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { DiscountsService } from './discounts.service.js';
import {
  ApplyDiscountDto,
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
    summary: "The patient's most recent active discount (to repeat it)",
    description:
      '`null` when there is none. Pass excludeInvoiceId (the invoice being edited) to get the previous one.',
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

  @Post('invoices/:id/discount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply or replace the discount (only while nothing is paid)',
    description:
      'Body: { type, value, reason } OR { repeatFromDiscountId }. Repeating copies type/value/reason from the same patient, recomputes the amount and never changes the old invoice.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'INVOICE_LOCKED, DISCOUNT_LIMIT_EXCEEDED, DISCOUNT_EXCEEDS_SUBTOTAL or DISCOUNT_PATIENT_MISMATCH',
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
}
