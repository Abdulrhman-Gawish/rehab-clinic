import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ReasonDto } from '../billing/dto/invoice.dto.js';
import {
  CreateCategoryDto,
  CreateExpenseDto,
  ExpenseCategoryDto,
  ExpenseListDto,
  ExpenseResponseDto,
  ListCategoriesQueryDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import {
  ExpensesService,
  MAX_RECEIPT_BYTES,
  type UploadedReceipt,
} from './expenses.service.js';

const DESK = [UserRole.OWNER, UserRole.RECEPTIONIST];
const EDIT_RULE =
  'RECEPTIONIST: only expenses they recorded, on the same local day. OWNER: any time.';

@ApiTags('Expenses')
@Controller('expenses')
@Auth(...DESK)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a clinic expense (tea, supplies, maintenance...)',
    description:
      'expenseDate cannot be in the future; RECEPTIONIST at most BACKDATE_MAX_DAYS back.',
  })
  @ApiCreatedResponse({ type: ExpenseResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'EXPENSE_DATE_IN_FUTURE, BACKDATE_LIMIT_EXCEEDED or CATEGORY_INACTIVE',
  })
  create(
    @Body() dto: CreateExpenseDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.create(dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'Search expenses, with the total of the valid ones',
  })
  @ApiOkResponse({ type: ExpenseListDto })
  list(@Query() query: ListExpensesQueryDto): Promise<ExpenseListDto> {
    return this.expenses.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ExpenseResponseDto> {
    return this.expenses.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Correct an expense (old/new values audited)',
    description: EDIT_RULE,
  })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'EXPENSE_EDIT_NOT_ALLOWED, ...',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.update(id, dto, actor);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void (no hard delete)', description: EDIT_RULE })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'EXPENSE_EDIT_NOT_ALLOWED',
  })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.void(id, dto.reason, actor);
  }

  @Post(':id/receipt')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Attach the receipt image/PDF (JPG, PNG, WEBP, PDF; max 5 MB)',
    description: `The type is checked from the file content (magic bytes). ${EDIT_RULE}`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE or EXPENSE_EDIT_NOT_ALLOWED',
  })
  uploadReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedReceipt | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.uploadReceipt(id, file, actor);
  }

  @Get(':id/receipt')
  @ApiOperation({
    summary: 'Download the receipt file (authorized users only)',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.expenses.receipt(id);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `inline; filename="${file.fileName}"`,
    });
  }
}

@ApiTags('Expenses')
@Controller('expense-categories')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @Auth(...DESK)
  @ApiOkResponse({ type: [ExpenseCategoryDto] })
  list(@Query() query: ListCategoriesQueryDto): Promise<ExpenseCategoryDto[]> {
    return this.categories.list(query.includeInactive ?? false);
  }

  @Post()
  @Auth(UserRole.OWNER)
  @ApiCreatedResponse({ type: ExpenseCategoryDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'CATEGORY_NAME_TAKEN',
  })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.create(dto.name, actor);
  }

  @Patch(':id')
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Rename' })
  @ApiOkResponse({ type: ExpenseCategoryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'CATEGORY_NAME_TAKEN',
  })
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCategoryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.rename(id, dto.name, actor);
  }

  @Patch(':id/activate')
  @Auth(UserRole.OWNER)
  @ApiOkResponse({ type: ExpenseCategoryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @Auth(UserRole.OWNER)
  @ApiOkResponse({ type: ExpenseCategoryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    return this.categories.setActive(id, false, actor);
  }
}
