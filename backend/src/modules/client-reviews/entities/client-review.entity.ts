import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { ClientReviewType } from '../client-reviews.enums.js';
import { ClientReviewAttachment } from './client-review-attachment.entity.js';

/**
 * A client's review (testimonial), managed by the OWNER only. `isPublished`
 * marks the reviews meant for the website; nothing public reads them yet.
 * deleted_at removes the review for good (the row and its files stay).
 */
@Entity('client_reviews')
@Check('chk_client_reviews_keywords_count', 'cardinality("keywords") <= 20')
export class ClientReview extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ClientReviewType,
    enumName: 'client_review_type',
  })
  reviewType: ClientReviewType;

  @Column({ type: 'varchar', length: 120 })
  clientName: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  keywords: string[];

  @Column({ type: 'boolean', default: false })
  isPublished: boolean;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_client_reviews_created_by' })
  createdBy?: Relation<User>;

  @OneToMany(() => ClientReviewAttachment, (attachment) => attachment.review)
  attachments?: Relation<ClientReviewAttachment[]>;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
