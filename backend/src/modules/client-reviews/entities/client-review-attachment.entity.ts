import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { ClientReview } from './client-review.entity.js';

// A picture or PDF of a client review. The file lives in FileStorage under
// file_key and is only streamed to the OWNER. deleted_at removes it from the
// review (the row and the file stay).
@Entity('client_review_attachments')
@Index('idx_client_review_attachments_review', ['reviewId'])
@Check('chk_client_review_attachments_size_positive', '"size_bytes" > 0')
export class ClientReviewAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  reviewId: string;

  @ManyToOne(() => ClientReview, (review) => review.attachments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_client_review_attachments_review',
  })
  review?: Relation<ClientReview>;

  // The uploaded file's name, cleaned; shown in the UI, never used as a path.
  @Column({ type: 'varchar', length: 200 })
  fileName: string;

  @Column({ type: 'varchar', length: 255 })
  fileKey: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'uuid', name: 'uploaded_by' })
  uploadedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'uploaded_by',
    foreignKeyConstraintName: 'fk_client_review_attachments_uploaded_by',
  })
  uploadedBy?: Relation<User>;

  // clock_timestamp(), not now(): the files of one request are written in one
  // transaction and must keep their upload order.
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
