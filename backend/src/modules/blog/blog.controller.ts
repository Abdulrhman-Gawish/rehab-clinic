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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { Public } from '../../common/decorators/public.decorator.js';
import { ThrottlePublic } from '../../common/decorators/throttle.decorators.js';
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
import { BlogService } from './blog.service.js';
import {
  BLOG_CONTENT_MAX,
  BLOG_DESCRIPTION_MAX,
  BLOG_KEYWORDS_MAX,
  BLOG_KEYWORDS_MIN,
  BLOG_TITLE_MAX,
} from './blog.constants.js';
import { BlogCategory } from './blog.enums.js';
import {
  BlogPostResponseDto,
  BlogPostSummaryDto,
  CreateBlogPostDto,
  ListBlogPostsQueryDto,
  PublicBlogPostDto,
  PublicBlogPostSummaryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto.js';

const CoverUpload = () =>
  UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  );

// The multipart body for Swagger ("Try it out" can send the file).
const multipartSchema = (required: string[]) => ({
  schema: {
    type: 'object',
    required,
    properties: {
      image: {
        type: 'string',
        format: 'binary',
        description: 'Cover: JPG, PNG or WEBP, 5 MB at most',
      },
      title: { type: 'string', maxLength: BLOG_TITLE_MAX },
      description: { type: 'string', maxLength: BLOG_DESCRIPTION_MAX },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        minItems: BLOG_KEYWORDS_MIN,
        maxItems: BLOG_KEYWORDS_MAX,
      },
      category: { type: 'string', enum: Object.values(BlogCategory) },
      content: {
        type: 'string',
        maxLength: BLOG_CONTENT_MAX,
        description: 'HTML, sanitized on the server',
      },
    },
  },
});

// Written by the OWNER in the staff UI.
@ApiTags('Blog')
@Controller('blog-posts')
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class BlogPostsController {
  constructor(private readonly blog: BlogService) {}

  @Post()
  @Auth(UserRole.OWNER)
  @CoverUpload()
  @ApiOperation({
    summary: 'Publish a post (multipart: fields + `image`, the cover)',
    description:
      'Published at once (no drafts). The content HTML is sanitized; the cover type is checked from its content (magic bytes).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(
    multipartSchema([
      'image',
      'title',
      'description',
      'keywords',
      'category',
      'content',
    ]),
  )
  @ApiCreatedResponse({ type: BlogPostResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE',
  })
  create(
    @Body() dto: CreateBlogPostDto,
    @UploadedFile() image: UploadedFileData | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<BlogPostResponseDto> {
    return this.blog.create(dto, image, actor);
  }

  @Get()
  @Auth(UserRole.OWNER)
  @ApiOperation({ summary: 'Posts, newest first (without the content)' })
  @ApiOkResponse({ type: PaginatedResponse(BlogPostSummaryDto) })
  findAll(
    @Query() query: ListBlogPostsQueryDto,
  ): Promise<Paginated<BlogPostSummaryDto>> {
    return this.blog.findAll(query);
  }

  @Get(':id')
  @Auth(UserRole.OWNER)
  @ApiOkResponse({ type: BlogPostResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BlogPostResponseDto> {
    return this.blog.findOne(id);
  }

  @Patch(':id')
  @Auth(UserRole.OWNER)
  @CoverUpload()
  @ApiOperation({
    summary: 'Edit a post (multipart; only the fields sent change)',
    description: 'A new `image` replaces the cover; without one it stays.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartSchema([]))
  @ApiOkResponse({ type: BlogPostResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_FILE_TYPE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
    @UploadedFile() image: UploadedFileData | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<BlogPostResponseDto> {
    return this.blog.update(id, dto, image, actor);
  }

  @Delete(':id')
  @Auth(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete for good (gone from the website, 404 afterwards)',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.blog.remove(id, actor);
  }
}

@ApiTags('Public')
@Controller('public/blog-posts')
@Public()
export class PublicBlogPostsController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  @ThrottlePublic()
  @ApiOperation({ summary: 'Blog posts for the website, newest first' })
  @ApiOkResponse({ type: PaginatedResponse(PublicBlogPostSummaryDto) })
  findAll(
    @Query() query: ListBlogPostsQueryDto,
  ): Promise<Paginated<PublicBlogPostSummaryDto>> {
    return this.blog.findPublic(query);
  }

  @Get(':id')
  @ThrottlePublic()
  @ApiOkResponse({ type: PublicBlogPostDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicBlogPostDto> {
    return this.blog.findPublicOne(id);
  }

  // Default rate limit (not the stricter public one): a list page loads
  // one cover per card.
  @Get(':id/cover')
  @ApiOperation({ summary: "The post's cover image" })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async cover(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.blog.cover(id);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `inline; filename="${file.fileName}"`,
    });
  }
}
