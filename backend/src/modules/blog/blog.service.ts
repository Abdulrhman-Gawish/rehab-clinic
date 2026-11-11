import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  FileStorage,
  type StoredFile,
} from '../../common/storage/file-storage.service.js';
import {
  checkUpload,
  IMAGE_TYPES,
  type DetectedType,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import {
  toBlogPost,
  toBlogPostSummary,
  toPublicBlogPost,
  toPublicBlogPostSummary,
} from './blog.mapper.js';
import type {
  BlogPostResponseDto,
  BlogPostSummaryDto,
  CreateBlogPostDto,
  ListBlogPostsQueryDto,
  PublicBlogPostDto,
  PublicBlogPostSummaryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto.js';
import { BlogPost } from './entities/blog-post.entity.js';

// The cover key is audited, so a replaced cover stays referenced (the
// orphan sweep never removes it).
const BLOG_POST_AUDIT_FIELDS = [
  'title',
  'description',
  'keywords',
  'category',
  'content',
  'coverImageKey',
  'coverImageMimeType',
] as const satisfies readonly (keyof BlogPost)[];

export interface CoverFile extends StoredFile {
  mimeType: string;
  fileName: string;
}

interface StoredCover {
  key: string;
  type: DetectedType;
}

/**
 * Blog posts: the OWNER writes them, the website reads them. A post is
 * published when it is added; DELETE removes it for good (deleted_at).
 * Covers follow the upload rules of attachments (5 MB, magic bytes), but
 * only JPG, PNG and WEBP.
 */
@Injectable()
export class BlogService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: FileStorage,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async create(
    dto: CreateBlogPostDto,
    image: UploadedFileData | undefined,
    actor: Actor,
  ): Promise<BlogPostResponseDto> {
    if (!image) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'image',
            errors: ['image (the cover) is required'],
            constraints: ['isDefined'],
          },
        ],
      });
    }
    const cover = await this.storeCover(image);
    const post = await this.dataSource
      .transaction(async (manager) => {
        const repository = manager.getRepository(BlogPost);
        const saved = await repository.save(
          repository.create({
            title: dto.title,
            description: dto.description,
            keywords: dto.keywords,
            category: dto.category,
            content: dto.content,
            coverImageKey: cover.key,
            coverImageMimeType: cover.type.mimeType,
            authorId: actor.userId as string,
            deletedAt: null,
          }),
        );
        const created = await repository.findOneOrFail({
          where: { id: saved.id },
          relations: { author: true },
        });
        await this.auditService.logAction(
          actor,
          AuditAction.BLOG_POST_CREATED,
          AuditEntityType.BLOG_POST,
          created.id,
          { newValues: pickValues(created, BLOG_POST_AUDIT_FIELDS) },
          manager,
        );
        return created;
      })
      .catch(async (error: unknown) => {
        await this.storage.discard(cover.key);
        throw error;
      });
    return toBlogPost(post, (d) => this.time.toIso(d));
  }

  async findAll(
    query: ListBlogPostsQueryDto,
  ): Promise<Paginated<BlogPostSummaryDto>> {
    const [posts, total] = await this.list(query, true);
    return toPaginated(
      posts.map((post) => toBlogPostSummary(post, (d) => this.time.toIso(d))),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<BlogPostResponseDto> {
    const post = await this.dataSource.getRepository(BlogPost).findOne({
      where: { id, deletedAt: IsNull() },
      relations: { author: true },
    });
    if (!post) throw new NotFoundException('Blog post not found');
    return toBlogPost(post, (d) => this.time.toIso(d));
  }

  async update(
    id: string,
    dto: UpdateBlogPostDto,
    image: UploadedFileData | undefined,
    actor: Actor,
  ): Promise<BlogPostResponseDto> {
    const cover = image ? await this.storeCover(image) : null;
    const post = await this.dataSource
      .transaction(async (manager) => {
        const repository = manager.getRepository(BlogPost);
        const post = await repository.findOne({
          where: { id, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!post) throw new NotFoundException('Blog post not found');

        const before = { ...post };
        if (dto.title !== undefined) post.title = dto.title;
        if (dto.description !== undefined) post.description = dto.description;
        if (dto.keywords !== undefined) post.keywords = dto.keywords;
        if (dto.category !== undefined) post.category = dto.category;
        if (dto.content !== undefined) post.content = dto.content;
        if (cover) {
          post.coverImageKey = cover.key;
          post.coverImageMimeType = cover.type.mimeType;
        }
        await repository.save(post);
        const after = await repository.findOneOrFail({
          where: { id },
          relations: { author: true },
        });

        const changes = diffValues(before, after, BLOG_POST_AUDIT_FIELDS);
        if (changes) {
          await this.auditService.logAction(
            actor,
            AuditAction.BLOG_POST_UPDATED,
            AuditEntityType.BLOG_POST,
            id,
            changes,
            manager,
          );
        }
        return after;
      })
      .catch(async (error: unknown) => {
        if (cover) await this.storage.discard(cover.key);
        throw error;
      });
    return toBlogPost(post, (d) => this.time.toIso(d));
  }

  // For good: out of every list, 404 afterwards. The row and its cover stay.
  async remove(id: string, actor: Actor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(BlogPost, {
        where: { id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!post) throw new NotFoundException('Blog post not found');
      post.deletedAt = this.time.now();
      await manager.getRepository(BlogPost).save(post);
      await this.auditService.logAction(
        actor,
        AuditAction.BLOG_POST_DELETED,
        AuditEntityType.BLOG_POST,
        id,
        { oldValues: { title: post.title }, newValues: { deleted: true } },
        manager,
      );
    });
  }

  async findPublic(
    query: ListBlogPostsQueryDto,
  ): Promise<Paginated<PublicBlogPostSummaryDto>> {
    const [posts, total] = await this.list(query, false);
    return toPaginated(
      posts.map((post) =>
        toPublicBlogPostSummary(post, (d) => this.time.toIso(d)),
      ),
      total,
      query,
    );
  }

  async findPublicOne(id: string): Promise<PublicBlogPostDto> {
    const post = await this.dataSource
      .getRepository(BlogPost)
      .findOneBy({ id, deletedAt: IsNull() });
    if (!post) throw new NotFoundException('Blog post not found');
    return toPublicBlogPost(post, (d) => this.time.toIso(d));
  }

  async cover(id: string): Promise<CoverFile> {
    const post = await this.dataSource
      .getRepository(BlogPost)
      .findOneBy({ id, deletedAt: IsNull() });
    if (!post) throw new NotFoundException('Blog post not found');
    const extension = post.coverImageKey.slice(
      post.coverImageKey.lastIndexOf('.') + 1,
    );
    return {
      ...(await this.storage.get(post.coverImageKey)),
      mimeType: post.coverImageMimeType,
      fileName: `${post.id}.${extension}`,
    };
  }

  // Newest first; the list never loads the content.
  private list(
    query: ListBlogPostsQueryDto,
    withAuthor: boolean,
  ): Promise<[BlogPost[], number]> {
    const qb = this.dataSource
      .getRepository(BlogPost)
      .createQueryBuilder('post')
      .select([
        'post.id',
        'post.title',
        'post.description',
        'post.keywords',
        'post.category',
        'post.createdAt',
        'post.updatedAt',
      ])
      .where('post.deletedAt IS NULL')
      .orderBy('post.createdAt', 'DESC')
      .addOrderBy('post.id', 'DESC')
      .skip(query.skip)
      .take(query.limit);
    if (withAuthor) {
      qb.leftJoin('post.author', 'author').addSelect([
        'author.id',
        'author.name',
      ]);
    }
    if (query.category) {
      qb.andWhere('post.category = :category', { category: query.category });
    }
    return qb.getManyAndCount();
  }

  // Written before the transaction that records it, under a fresh key, so a
  // failed transaction can discard exactly this file.
  private async storeCover(image: UploadedFileData): Promise<StoredCover> {
    // Size: the upload interceptor already answered 413 above MAX_UPLOAD_BYTES.
    const { file, type } = checkUpload(image, IMAGE_TYPES);
    const key = `blog/${randomUUID()}.${type.extension}`;
    await this.storage.put(key, file.buffer);
    return { key, type };
  }
}
