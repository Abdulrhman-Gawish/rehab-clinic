import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';

// One row per issued refresh token. Only the SHA-256 of the token is stored.
// Rotation chain: when a token is used it gets revoked_at + replaced_by_id.
@Entity('refresh_tokens')
@Index('idx_refresh_tokens_user_id', ['userId'])
@Unique('uq_refresh_tokens_token_hash', ['tokenHash'])
export class RefreshToken extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_refresh_tokens_user' })
  user?: User;

  // Hex SHA-256 of the raw token.
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  replacedById: string | null;
}
