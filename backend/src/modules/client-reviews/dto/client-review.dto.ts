import { applyDecorators } from '@nestjs/common';
import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import {
  OptionalNotNull,
  ToBoolean,
  ToTrimmedList,
  Trim,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { PersonNameField } from '../../users/dto/user.dto.js';
import {
  REVIEW_ATTACHMENTS_MAX,
  REVIEW_CONTENT_MAX,
  REVIEW_KEYWORD_MAX,
  REVIEW_KEYWORDS_MAX,
} from '../client-reviews.constants.js';
import { ClientReviewType } from '../client-reviews.enums.js';

const caseInsensitive = (keyword: unknown) =>
  typeof keyword === 'string' ? keyword.toLocaleLowerCase() : keyword;

const KEYWORDS_DOC: ApiPropertyOptions = {
  type: [String],
  maxItems: REVIEW_KEYWORDS_MAX,
  example: ['تأهيل', 'خشونة الركبة'],
  description: `0-${REVIEW_KEYWORDS_MAX} keywords, each at most ${REVIEW_KEYWORD_MAX} characters, unique ignoring case. Multipart: repeat the \`keywords\` field; one empty \`keywords\` field sends no keywords (clears them on PATCH).`,
};

// Each keyword trimmed; blank ones are dropped.
const KeywordsField = () =>
  applyDecorators(
    ApiPropertyOptional(KEYWORDS_DOC),
    OptionalNotNull(),
    ToTrimmedList({ dropEmpty: true }),
    IsArray(),
    ArrayMaxSize(REVIEW_KEYWORDS_MAX),
    IsString({ each: true }),
    IsNotEmpty({ each: true }),
    MaxLength(REVIEW_KEYWORD_MAX, { each: true }),
    ArrayUnique(caseInsensitive),
  );

// ---------- Inputs ----------

// Multipart form fields; the files are the repeated `attachments` field.
export class CreateClientReviewDto {
  @ApiProperty({ enum: ClientReviewType })
  @IsEnum(ClientReviewType)
  reviewType: ClientReviewType;

  @PersonNameField()
  clientName: string;

  @ApiProperty({ maxLength: REVIEW_CONTENT_MAX })
  @Trim()
  @IsString()
  @Length(1, REVIEW_CONTENT_MAX)
  content: string;

  @KeywordsField()
  keywords?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Meant for the website (nothing public reads it yet)',
  })
  @OptionalNotNull()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;
}

// Only the fields sent change. New `attachments` files are added;
// `removeAttachmentIds` takes attachments off the review.
export class UpdateClientReviewDto {
  @ApiPropertyOptional({ enum: ClientReviewType })
  @OptionalNotNull()
  @IsEnum(ClientReviewType)
  reviewType?: ClientReviewType;

  @PersonNameField({ required: false })
  clientName?: string;

  @ApiPropertyOptional({ maxLength: REVIEW_CONTENT_MAX })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @Length(1, REVIEW_CONTENT_MAX)
  content?: string;

  @KeywordsField()
  keywords?: string[];

  @ApiPropertyOptional()
  @OptionalNotNull()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: REVIEW_ATTACHMENTS_MAX,
    description:
      'Attachments of this review to remove (repeat the field). An unknown id is a 404.',
  })
  @OptionalNotNull()
  @ToTrimmedList({ dropEmpty: true })
  @IsArray()
  @ArrayMaxSize(REVIEW_ATTACHMENTS_MAX)
  @IsUUID(undefined, { each: true })
  @ArrayUnique()
  removeAttachmentIds?: string[];
}

export class ListClientReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Client name, text or keywords; ignores case and common Arabic spelling variants',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ClientReviewType })
  @IsOptional()
  @IsEnum(ClientReviewType)
  reviewType?: ClientReviewType;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;
}

// ---------- Outputs ----------

// The file itself: GET /client-reviews/:id/attachments/:attachmentId.
export class ClientReviewAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'رسالة المريض.png' })
  fileName: string;

  @ApiProperty({ example: 'image/png' })
  mimeType: string;

  @ApiProperty({ example: 182044 })
  sizeBytes: number;

  @ApiProperty({ example: '2026-11-23T12:00:00+02:00' })
  createdAt: string;
}

// A row of the list.
export class ClientReviewSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ClientReviewType })
  reviewType: ClientReviewType;

  @ApiProperty()
  clientName: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ type: [String] })
  keywords: string[];

  @ApiProperty()
  isPublished: boolean;

  @ApiProperty({ example: 2 })
  attachmentCount: number;

  @ApiProperty({ type: UserRefDto })
  createdBy: UserRefDto;

  @ApiProperty({ example: '2026-11-23T12:00:00+02:00' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-23T12:00:00+02:00' })
  updatedAt: string;
}

export class ClientReviewResponseDto extends ClientReviewSummaryDto {
  @ApiProperty({
    type: [ClientReviewAttachmentDto],
    description: 'Oldest first',
  })
  attachments: ClientReviewAttachmentDto[];
}
