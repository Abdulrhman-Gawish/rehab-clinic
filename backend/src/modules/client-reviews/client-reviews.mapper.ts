import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type {
  ClientReviewAttachmentDto,
  ClientReviewResponseDto,
  ClientReviewSummaryDto,
} from './dto/client-review.dto.js';
import type { ClientReviewAttachment } from './entities/client-review-attachment.entity.js';
import type { ClientReview } from './entities/client-review.entity.js';

type ToIso = (instant: Date) => string;

export function toClientReviewAttachment(
  attachment: ClientReviewAttachment,
  toIso: ToIso,
): ClientReviewAttachmentDto {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    createdAt: toIso(attachment.createdAt),
  };
}

// Requires `createdBy` loaded.
export function toClientReviewSummary(
  review: ClientReview,
  attachmentCount: number,
  toIso: ToIso,
): ClientReviewSummaryDto {
  return {
    id: review.id,
    reviewType: review.reviewType,
    clientName: review.clientName,
    content: review.content,
    keywords: review.keywords,
    isPublished: review.isPublished,
    attachmentCount,
    createdBy: UserRefDto.fromEntity(review.createdBy),
    createdAt: toIso(review.createdAt),
    updatedAt: toIso(review.updatedAt),
  };
}

// Requires `createdBy` loaded; `attachments` are the active ones.
export function toClientReview(
  review: ClientReview,
  attachments: ClientReviewAttachment[],
  toIso: ToIso,
): ClientReviewResponseDto {
  return {
    ...toClientReviewSummary(review, attachments.length, toIso),
    attachments: attachments.map((a) => toClientReviewAttachment(a, toIso)),
  };
}
