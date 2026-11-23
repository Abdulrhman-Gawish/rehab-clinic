import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
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
  type DetectedType,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import type { AuditValues } from '../audit/entities/audit-log.entity.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { PATIENT_NAME_SEARCH_KEY } from '../patients/entities/patient.entity.js';
import {
  cleanAttachmentName,
  contentDisposition,
} from './attachment-file-name.js';
import {
  REVIEW_ATTACHMENTS_FIELD,
  REVIEW_ATTACHMENTS_MAX,
  REVIEW_STORAGE_PREFIX,
} from './client-reviews.constants.js';
import {
  toClientReview,
  toClientReviewSummary,
} from './client-reviews.mapper.js';
import type {
  ClientReviewResponseDto,
  ClientReviewSummaryDto,
  CreateClientReviewDto,
  ListClientReviewsQueryDto,
  UpdateClientReviewDto,
} from './dto/client-review.dto.js';
import { ClientReviewAttachment } from './entities/client-review-attachment.entity.js';
import { ClientReview } from './entities/client-review.entity.js';

// Audited with their old and new values (like blog posts); attachments by
// file name (attachmentsAdded / attachmentsRemoved).
const REVIEW_AUDIT_FIELDS = [
  'reviewType',
  'clientName',
  'content',
  'keywords',
  'isPublished',
] as const satisfies readonly (keyof ClientReview)[];

export interface ReviewAttachmentFile extends StoredFile {
  mimeType: string;
  disposition: string;
}

interface StoredUpload {
  key: string;
  type: DetectedType;
  fileName: string;
  sizeBytes: number;
}

const tooManyAttachments = () =>
  new BadRequestException({
    message: 'Validation failed',
    details: [
      {
        field: REVIEW_ATTACHMENTS_FIELD,
        errors: [`a review has at most ${REVIEW_ATTACHMENTS_MAX} attachments`],
        constraints: ['arrayMaxSize'],
      },
    ],
  });

/**
 * Client reviews (testimonials): OWNER only, every endpoint. A review is
 * written with its attachments in one request; PATCH changes the fields
 * sent, adds new files and removes attachments by id. DELETE and removed
 * attachments are soft (deleted_at): rows and files stay, the API answers
 * 404 for them. Attachments follow the shared upload rules (JPG, PNG, WEBP
 * or PDF checked by content, 5 MB each), at most 10 per review.
 */
@Injectable()
export class ClientReviewsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: FileStorage,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async create(
    dto: CreateClientReviewDto,
    files: UploadedFileData[],
    actor: Actor,
  ): Promise<ClientReviewResponseDto> {
    if (files.length > REVIEW_ATTACHMENTS_MAX) throw tooManyAttachments();
    const stored = await this.storeAll(files);
    const id = await this.dataSource
      .transaction(async (manager) => {
        const repository = manager.getRepository(ClientReview);
        const review = await repository.save(
          repository.create({
            reviewType: dto.reviewType,
            clientName: dto.clientName,
            content: dto.content,
            keywords: dto.keywords ?? [],
            isPublished: dto.isPublished ?? false,
            createdById: actor.userId as string,
            deletedAt: null,
          }),
        );
        await this.recordAttachments(manager, review.id, stored, actor);
        await this.auditService.logAction(
          actor,
          AuditAction.CLIENT_REVIEW_CREATED,
          AuditEntityType.CLIENT_REVIEW,
          review.id,
          {
            newValues: {
              ...pickValues(review, REVIEW_AUDIT_FIELDS),
              ...(stored.length > 0 && {
                attachmentsAdded: stored.map((file) => file.fileName),
              }),
            },
          },
          manager,
        );
        return review.id;
      })
      .catch(async (error: unknown) => {
        await this.discardAll(stored);
        throw error;
      });
    return this.findOne(id);
  }

  // Newest first; the id breaks ties so pages never repeat or skip a row.
  async findAll(
    query: ListClientReviewsQueryDto,
  ): Promise<Paginated<ClientReviewSummaryDto>> {
    const qb = this.dataSource
      .getRepository(ClientReview)
      .createQueryBuilder('review')
      .leftJoin('review.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name'])
      .where('review.deletedAt IS NULL')
      .orderBy('review.createdAt', 'DESC')
      .addOrderBy('review.id', 'DESC')
      .skip(query.skip)
      .take(query.limit);
    if (query.reviewType) {
      qb.andWhere('review.reviewType = :reviewType', {
        reviewType: query.reviewType,
      });
    }
    if (query.isPublished !== undefined) {
      qb.andWhere('review.isPublished = :isPublished', {
        isPublished: query.isPublished,
      });
    }
    if (query.search) {
      // The patients' Arabic-aware search key (diacritics, alef forms, ى/ي,
      // ة/ه, case), on the name, the text and the keywords.
      const key = PATIENT_NAME_SEARCH_KEY;
      qb.andWhere(
        `(${key}(review.clientName) LIKE ${key}(:term)
          OR ${key}(review.content) LIKE ${key}(:term)
          OR ${key}(array_to_string(review.keywords, ' ')) LIKE ${key}(:term))`,
        { term: `%${escapeLike(query.search)}%` },
      );
    }
    const [reviews, total] = await qb.getManyAndCount();
    const counts = await this.attachmentCounts(reviews.map((r) => r.id));
    return toPaginated(
      reviews.map((review) =>
        toClientReviewSummary(review, counts.get(review.id) ?? 0, (d) =>
          this.time.toIso(d),
        ),
      ),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<ClientReviewResponseDto> {
    const review = await this.dataSource.getRepository(ClientReview).findOne({
      where: { id, deletedAt: IsNull() },
      relations: { createdBy: true },
    });
    if (!review) throw new NotFoundException('Client review not found');
    const attachments = await this.activeAttachments(
      this.dataSource.manager,
      id,
    );
    return toClientReview(review, attachments, (d) => this.time.toIso(d));
  }

  async update(
    id: string,
    dto: UpdateClientReviewDto,
    files: UploadedFileData[],
    actor: Actor,
  ): Promise<ClientReviewResponseDto> {
    if (files.length > REVIEW_ATTACHMENTS_MAX) throw tooManyAttachments();
    const stored = await this.storeAll(files);
    await this.dataSource
      .transaction(async (manager) => {
        const repository = manager.getRepository(ClientReview);
        const review = await repository.findOne({
          where: { id, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!review) throw new NotFoundException('Client review not found');

        const active = await this.activeAttachments(manager, id);
        const removeIds = new Set(dto.removeAttachmentIds ?? []);
        const removed = active.filter((a) => removeIds.has(a.id));
        if (removed.length !== removeIds.size) {
          throw new NotFoundException('Attachment not found');
        }
        if (
          active.length - removed.length + stored.length >
          REVIEW_ATTACHMENTS_MAX
        ) {
          throw tooManyAttachments();
        }

        const before = { ...review };
        if (dto.reviewType !== undefined) review.reviewType = dto.reviewType;
        if (dto.clientName !== undefined) review.clientName = dto.clientName;
        if (dto.content !== undefined) review.content = dto.content;
        if (dto.keywords !== undefined) review.keywords = dto.keywords;
        if (dto.isPublished !== undefined) {
          review.isPublished = dto.isPublished;
        }

        const changes = diffValues(before, review, REVIEW_AUDIT_FIELDS);
        const filesChanged = removed.length > 0 || stored.length > 0;
        if (!changes && !filesChanged) return;

        if (changes) {
          await repository.save(review);
        } else {
          // Only the attachments changed: still an edit of the review.
          await repository.update(id, { updatedAt: this.time.now() });
        }
        if (removed.length > 0) {
          await manager
            .getRepository(ClientReviewAttachment)
            .update(
              { id: In(removed.map((a) => a.id)) },
              { deletedAt: this.time.now() },
            );
        }
        await this.recordAttachments(manager, id, stored, actor);

        const oldValues: AuditValues = { ...changes?.oldValues };
        const newValues: AuditValues = { ...changes?.newValues };
        if (stored.length > 0) {
          newValues.attachmentsAdded = stored.map((file) => file.fileName);
        }
        if (removed.length > 0) {
          newValues.attachmentsRemoved = removed.map((a) => a.fileName);
        }
        await this.auditService.logAction(
          actor,
          AuditAction.CLIENT_REVIEW_UPDATED,
          AuditEntityType.CLIENT_REVIEW,
          id,
          { oldValues, newValues },
          manager,
        );
      })
      .catch(async (error: unknown) => {
        await this.discardAll(stored);
        throw error;
      });
    return this.findOne(id);
  }

  // For good: out of the list, 404 afterwards. The rows and files stay.
  async remove(id: string, actor: Actor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(ClientReview, {
        where: { id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!review) throw new NotFoundException('Client review not found');
      review.deletedAt = this.time.now();
      await manager.getRepository(ClientReview).save(review);
      await this.auditService.logAction(
        actor,
        AuditAction.CLIENT_REVIEW_DELETED,
        AuditEntityType.CLIENT_REVIEW,
        id,
        {
          oldValues: { clientName: review.clientName },
          newValues: { deleted: true },
        },
        manager,
      );
    });
  }

  // An active attachment of an active review; anything else is a 404.
  async attachmentFile(
    reviewId: string,
    attachmentId: string,
  ): Promise<ReviewAttachmentFile> {
    const attachment = await this.dataSource
      .getRepository(ClientReviewAttachment)
      .createQueryBuilder('attachment')
      .innerJoin('attachment.review', 'review')
      .where('attachment.id = :attachmentId', { attachmentId })
      .andWhere('attachment.reviewId = :reviewId', { reviewId })
      .andWhere('attachment.deletedAt IS NULL')
      .andWhere('review.deletedAt IS NULL')
      .getOne();
    if (!attachment) throw new NotFoundException('Attachment not found');
    const extension = attachment.fileKey.slice(
      attachment.fileKey.lastIndexOf('.') + 1,
    );
    return {
      ...(await this.storage.get(attachment.fileKey)),
      mimeType: attachment.mimeType,
      disposition: contentDisposition(
        `${attachment.id}.${extension}`,
        attachment.fileName,
      ),
    };
  }

  private activeAttachments(
    manager: EntityManager,
    reviewId: string,
  ): Promise<ClientReviewAttachment[]> {
    return manager.getRepository(ClientReviewAttachment).find({
      where: { reviewId, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  private async attachmentCounts(
    reviewIds: string[],
  ): Promise<Map<string, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows: { reviewId: string; count: number }[] = await this.dataSource
      .getRepository(ClientReviewAttachment)
      .createQueryBuilder('attachment')
      .select('attachment.reviewId', 'reviewId')
      .addSelect('count(*)::int', 'count')
      .where('attachment.reviewId IN (:...reviewIds)', { reviewIds })
      .andWhere('attachment.deletedAt IS NULL')
      .groupBy('attachment.reviewId')
      .getRawMany();
    return new Map(rows.map((row) => [row.reviewId, row.count]));
  }

  private async recordAttachments(
    manager: EntityManager,
    reviewId: string,
    stored: StoredUpload[],
    actor: Actor,
  ): Promise<void> {
    const repository = manager.getRepository(ClientReviewAttachment);
    // One INSERT per file, in upload order: created_at is clock_timestamp(),
    // so the review lists its files in the order they were sent.
    for (const file of stored) {
      await repository.save(
        repository.create({
          reviewId,
          fileName: file.fileName,
          fileKey: file.key,
          mimeType: file.type.mimeType,
          sizeBytes: file.sizeBytes,
          uploadedById: actor.userId as string,
          deletedAt: null,
        }),
      );
    }
  }

  /**
   * Checks every file first (nothing is written when one is refused), then
   * writes each under a fresh key before the transaction that records them,
   * so a failed transaction can discard exactly these files.
   */
  private async storeAll(files: UploadedFileData[]): Promise<StoredUpload[]> {
    // Size: the upload interceptor already answered 413 above MAX_UPLOAD_BYTES.
    const checked = files.map((upload) => checkUpload(upload));
    const stored: StoredUpload[] = [];
    try {
      for (const { file, type } of checked) {
        const key = `${REVIEW_STORAGE_PREFIX}${randomUUID()}.${type.extension}`;
        await this.storage.put(key, file.buffer);
        stored.push({
          key,
          type,
          fileName: cleanAttachmentName(file.originalname, type.extension),
          sizeBytes: file.size,
        });
      }
    } catch (error) {
      await this.discardAll(stored);
      throw error;
    }
    return stored;
  }

  private async discardAll(stored: StoredUpload[]): Promise<void> {
    for (const file of stored) await this.storage.discard(file.key);
  }
}
