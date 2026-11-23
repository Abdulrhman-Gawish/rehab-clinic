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
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  MAX_UPLOAD_BYTES,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import {
  REVIEW_ATTACHMENTS_FIELD,
  REVIEW_ATTACHMENTS_MAX,
  REVIEW_CONTENT_MAX,
  REVIEW_KEYWORDS_MAX,
} from './client-reviews.constants.js';
import { ClientReviewType } from './client-reviews.enums.js';
import { ClientReviewsService } from './client-reviews.service.js';
import {
  ClientReviewResponseDto,
  ClientReviewSummaryDto,
  CreateClientReviewDto,
  ListClientReviewsQueryDto,
  UpdateClientReviewDto,
} from './dto/client-review.dto.js';

// Guards run before interceptors: a non-OWNER gets 403 before any file is
// read. Browsers send UTF-8 file names (Arabic ones too); busboy would read
// them as latin1 by default.
const AttachmentsUpload = () =>
  UseInterceptors(
    FilesInterceptor(REVIEW_ATTACHMENTS_FIELD, REVIEW_ATTACHMENTS_MAX, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: REVIEW_ATTACHMENTS_MAX },
      defParamCharset: 'utf8',
    }),
  );

// The multipart body for Swagger ("Try it out" can send the files).
const multipartSchema = (required: string[], update = false) => ({
  schema: {
    type: 'object',
    required,
    properties: {
      [REVIEW_ATTACHMENTS_FIELD]: {
        type: 'array',
        items: { type: 'string', format: 'binary' },
        maxItems: REVIEW_ATTACHMENTS_MAX,
        description: `JPG, PNG, WEBP or PDF, 5 MB each, at most ${REVIEW_ATTACHMENTS_MAX} per review`,
      },
      reviewType: { type: 'string', enum: Object.values(ClientReviewType) },
      clientName: { type: 'string', minLength: 2, maxLength: 120 },
      content: { type: 'string', maxLength: REVIEW_CONTENT_MAX },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        maxItems: REVIEW_KEYWORDS_MAX,
      },
      isPublished: { type: 'boolean' },
      ...(update && {
        removeAttachmentIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        },
      }),
    },
  },
});

// Client reviews (testimonials): the OWNER only, on every route (attachment
// files included). RECEPTIONIST and DOCTOR get 403, no token 401.
@ApiTags('Client reviews')
@Controller('client-reviews')
@Auth(UserRole.OWNER)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class ClientReviewsController {
  constructor(private readonly reviews: ClientReviewsService) {}

  @Post()
  @AttachmentsUpload()
  @ApiOperation({
    summary: 'Add a review (multipart: fields + `attachments` files)',
    description:
      'Every file is checked from its content (magic bytes) before anything is stored.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartSchema(['reviewType', 'clientName', 'content']))
  @ApiCreatedResponse({ type: ClientReviewResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE',
  })
  create(
    @Body() dto: CreateClientReviewDto,
    @UploadedFiles() files: UploadedFileData[] | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<ClientReviewResponseDto> {
    return this.reviews.create(dto, files ?? [], actor);
  }

  @Get()
  @ApiOperation({
    summary: 'Reviews, newest first (search, type and published filters)',
  })
  @ApiOkResponse({ type: PaginatedResponse(ClientReviewSummaryDto) })
  findAll(
    @Query() query: ListClientReviewsQueryDto,
  ): Promise<Paginated<ClientReviewSummaryDto>> {
    return this.reviews.findAll(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ClientReviewResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientReviewResponseDto> {
    return this.reviews.findOne(id);
  }

  @Patch(':id')
  @AttachmentsUpload()
  @ApiOperation({
    summary: 'Edit a review (multipart or JSON; only the fields sent change)',
    description:
      'New `attachments` files are added; `removeAttachmentIds` takes attachments off the review. One request, one transaction.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody(multipartSchema([], true))
  @ApiOkResponse({ type: ClientReviewResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientReviewDto,
    @UploadedFiles() files: UploadedFileData[] | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<ClientReviewResponseDto> {
    return this.reviews.update(id, dto, files ?? [], actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete for good (404 afterwards)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.reviews.remove(id, actor);
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'An attachment file (streamed, never public)' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    const file = await this.reviews.attachmentFile(id, attachmentId);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: file.disposition,
    });
  }
}
