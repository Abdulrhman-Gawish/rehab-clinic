import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  OptionalNotNull,
  ToTrimmedList,
  Trim,
  TrimAndCollapse,
} from '../../../common/decorators/transform.decorators.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../../common/dto/user-ref.dto.js';
import { sanitizeBlogHtml } from '../blog-html.js';
import {
  BLOG_CONTENT_MAX,
  BLOG_DESCRIPTION_MAX,
  BLOG_KEYWORD_MAX,
  BLOG_KEYWORDS_MAX,
  BLOG_KEYWORDS_MIN,
  BLOG_TITLE_MAX,
} from '../blog.constants.js';
import { BlogCategory } from '../blog.enums.js';

// Multipart sends one `keywords` field per keyword (or `keywords[]`); each
// keyword is trimmed.
const ToKeywordList = () => ToTrimmedList();

// Sanitized before validation, so "required" and the length apply to what
// is stored. Nothing readable left becomes '' (rejected as empty).
const SanitizeHtml = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeBlogHtml(value) : value,
  );

const caseInsensitive = (keyword: unknown) =>
  typeof keyword === 'string' ? keyword.toLocaleLowerCase() : keyword;

const KEYWORDS_DOC: ApiPropertyOptions = {
  type: [String],
  minItems: BLOG_KEYWORDS_MIN,
  maxItems: BLOG_KEYWORDS_MAX,
  example: ['تأهيل', 'جلطات', 'علاج طبيعي', 'أعصاب', 'شلل نصفي'],
  description: `${BLOG_KEYWORDS_MIN}-${BLOG_KEYWORDS_MAX} keywords, each at most ${BLOG_KEYWORD_MAX} characters, unique ignoring case. Multipart: repeat the \`keywords\` field.`,
};

const CONTENT_DOC: ApiPropertyOptions = {
  example: '<h2>عنوان</h2><p class="ql-align-right">نص المقال</p>',
  description:
    'HTML from the editor. Sanitized on the server: only p, br, h1-h3, strong, b, em, i, u, s, ol, ul, li and a (http, https, mailto) are kept, plus the Quill classes ql-align-*, ql-direction-rtl and ql-indent-*. Empty after that is a 400.',
};

// ---------- Inputs ----------

// Multipart form fields; the cover image is the `image` file field.
export class CreateBlogPostDto {
  @ApiProperty({
    example: 'تأهيل حالات ما بعد الجلطات',
    maxLength: BLOG_TITLE_MAX,
  })
  @TrimAndCollapse()
  @IsString()
  @Length(1, BLOG_TITLE_MAX)
  title: string;

  @ApiProperty({ maxLength: BLOG_DESCRIPTION_MAX })
  @Trim()
  @IsString()
  @Length(1, BLOG_DESCRIPTION_MAX)
  description: string;

  @ApiProperty(KEYWORDS_DOC)
  @ToKeywordList()
  @IsArray()
  @ArrayMinSize(BLOG_KEYWORDS_MIN)
  @ArrayMaxSize(BLOG_KEYWORDS_MAX)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(BLOG_KEYWORD_MAX, { each: true })
  @ArrayUnique(caseInsensitive)
  keywords: string[];

  @ApiProperty({ enum: BlogCategory })
  @IsEnum(BlogCategory)
  category: BlogCategory;

  @ApiProperty(CONTENT_DOC)
  @SanitizeHtml()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BLOG_CONTENT_MAX)
  content: string;
}

// Only the fields sent change. A new `image` file replaces the cover.
export class UpdateBlogPostDto {
  @ApiPropertyOptional({ maxLength: BLOG_TITLE_MAX })
  @OptionalNotNull()
  @TrimAndCollapse()
  @IsString()
  @Length(1, BLOG_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ maxLength: BLOG_DESCRIPTION_MAX })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @Length(1, BLOG_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional(KEYWORDS_DOC)
  @OptionalNotNull()
  @ToKeywordList()
  @IsArray()
  @ArrayMinSize(BLOG_KEYWORDS_MIN)
  @ArrayMaxSize(BLOG_KEYWORDS_MAX)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(BLOG_KEYWORD_MAX, { each: true })
  @ArrayUnique(caseInsensitive)
  keywords?: string[];

  @ApiPropertyOptional({ enum: BlogCategory })
  @OptionalNotNull()
  @IsEnum(BlogCategory)
  category?: BlogCategory;

  @ApiPropertyOptional(CONTENT_DOC)
  @OptionalNotNull()
  @SanitizeHtml()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BLOG_CONTENT_MAX)
  content?: string;
}

export class ListBlogPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BlogCategory })
  @IsOptional()
  @IsEnum(BlogCategory)
  category?: BlogCategory;
}

// ---------- Outputs ----------

// A card of the public list. The cover is GET /public/blog-posts/:id/cover.
export class PublicBlogPostSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: BlogCategory })
  category: BlogCategory;

  @ApiProperty({
    example: '2026-11-07T12:00:00+02:00',
    description: 'Published (added) at',
  })
  createdAt: string;

  @ApiProperty({ example: '2026-11-07T12:00:00+02:00' })
  updatedAt: string;
}

export class PublicBlogPostDto extends PublicBlogPostSummaryDto {
  @ApiProperty({ type: [String] })
  keywords: string[];

  @ApiProperty({ description: 'Sanitized HTML' })
  content: string;
}

// A row of the OWNER's list (no content).
export class BlogPostSummaryDto extends PublicBlogPostSummaryDto {
  @ApiProperty({ type: [String] })
  keywords: string[];

  @ApiProperty({ type: UserRefDto })
  author: UserRefDto;
}

export class BlogPostResponseDto extends BlogPostSummaryDto {
  @ApiProperty({ description: 'Sanitized HTML' })
  content: string;
}
