import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
import {
  PaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  CreateInvoiceDto,
  InvoiceReplacementPreviewDto,
  InvoiceDetailDto,
  InvoiceItemInputDto,
  InvoiceSummaryDto,
  ListInvoicesQueryDto,
  PatientBalanceDto,
  ReasonDto,
  UpdateInvoiceItemDto,
} from './dto/invoice.dto.js';
import { InvoiceReplacementsService } from './invoice-replacements.service.js';
import { InvoicesService } from './invoices.service.js';

// Billing is OWNER + RECEPTIONIST only; doctors have no access.
const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];

const REPLACED = {
  type: ErrorResponseDto,
  description:
    'INVOICE_ALREADY_REPLACED (details.replacementInvoiceId / replacementInvoiceNumber when known)',
};

const LOCKED = {
  type: ErrorResponseDto,
  description:
    'INVOICE_LOCKED (payments exist or cancelled), INVOICE_NEEDS_ITEMS, DISCOUNT_EXCEEDS_SUBTOTAL',
};

@ApiTags('Billing: invoices')
@Controller('invoices')
@Auth(...DESK)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly replacements: InvoiceReplacementsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Manual invoice with custom items (totals computed server-side)',
    description:
      'Service items take description and base price from the catalog; free-text items need description + unitPrice.',
  })
  @ApiCreatedResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.create(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'Search invoices (newest first)' })
  @ApiOkResponse({ type: PaginatedResponse(InvoiceSummaryDto) })
  list(
    @Query() query: ListInvoicesQueryDto,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    return this.invoices.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Invoice with items, active discount and payments' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceDetailDto> {
    return this.invoices.findOne(id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add an item (only while nothing is paid)' })
  @ApiCreatedResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(LOCKED)
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceItemInputDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.addItem(id, dto, actor);
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change an item (only while nothing is paid)' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(LOCKED)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInvoiceItemDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.updateItem(id, itemId, dto, actor);
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Remove an item (at least one must remain)' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(LOCKED)
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.removeItem(id, itemId, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel (only when nothing is paid)' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INVOICE_HAS_PAYMENTS or INVOICE_CANCELLED',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.cancel(id, dto.reason, actor);
  }

  @Get(':id/replacement')
  @ApiOperation({
    summary: 'Replacement invoice preview (writes nothing)',
    description:
      "Which action applies (CORRECT, REISSUE, or null with blockedBy), the invoice now and what its replacement would be: same lines, the patient's current referral and its discount.",
  })
  @ApiOkResponse({ type: InvoiceReplacementPreviewDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  replacementPreview(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceReplacementPreviewDto> {
    return this.replacements.preview(id);
  }

  @Post(':id/correct')
  @ApiOperation({
    summary:
      'Billing correction: cancel the invoice and issue its replacement for the same visit',
    description:
      'For a live session invoice billed with a referral that has since ended (recorded by mistake), once every receipt on it was voided. The original keeps its number, referral, discount and receipts (CANCELLED, replacedBy); the replacement (replacesInvoice) has the same lines and the current referral. The attendance does not change. Returns the replacement.',
  })
  @ApiCreatedResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse(REPLACED)
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'INVOICE_NOT_REPLACEABLE with details.reason: CANCELLED, NOT_A_SESSION_INVOICE, HAS_PAYMENTS, NO_REFERRAL, REFERRAL_ACTIVE',
  })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.replacements.correct(id, dto.reason, actor);
  }

  @Post(':id/reissue')
  @ApiOperation({
    summary:
      'Issue the replacement of a cancelled session invoice (same visit, current referral)',
    description:
      "For a cancelled session invoice whose visit is still attended and that nothing replaced yet (Today's List: allowedActions createInvoice). The cancelled invoice stays as it was (replacedBy); the replacement (replacesInvoice) has the same lines and the patient's current referral and discount. The attendance does not change. Returns the replacement.",
  })
  @ApiCreatedResponse({ type: InvoiceDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse(REPLACED)
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'INVOICE_NOT_REPLACEABLE with details.reason: NOT_CANCELLED, NOT_A_SESSION_INVOICE, VISIT_VOIDED',
  })
  reissue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.replacements.reissue(id, actor);
  }
}

@ApiTags('Billing: invoices')
@Controller('patients/:patientId')
@Auth(...DESK)
export class PatientBillingController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  @ApiOkResponse({ type: PaginatedResponse(InvoiceSummaryDto) })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  invoicesOf(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    return this.invoices.forPatient(patientId, query);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'What the patient owes across non-cancelled invoices',
  })
  @ApiOkResponse({ type: PatientBalanceDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  balance(
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ): Promise<PatientBalanceDto> {
    return this.invoices.balance(patientId);
  }
}
