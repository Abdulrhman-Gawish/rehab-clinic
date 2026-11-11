import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { BlogCategory } from '../blog.enums.js';

/**
 * A blog post for the public website, written by the OWNER. Published as
 * soon as it is added (no drafts). `content` is HTML already sanitized on
 * write. The cover image lives in FileStorage under cover_image_key and is
 * streamed by GET /public/blog-posts/:id/cover. deleted_at removes the post
 * for good (the row stays).
 */
@Entity('blog_posts')
@Check(
  'chk_blog_posts_keywords_count',
  'cardinality("keywords") BETWEEN 5 AND 20',
)
export class BlogPost extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'text', array: true })
  keywords: string[];

  @Column({ type: 'enum', enum: BlogCategory, enumName: 'blog_category' })
  category: BlogCategory;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 255 })
  coverImageKey: string;

  @Column({ type: 'varchar', length: 100 })
  coverImageMimeType: string;

  @Column({ type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_blog_posts_author' })
  author?: Relation<User>;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
