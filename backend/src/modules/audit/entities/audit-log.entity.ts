import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

export type AuditValues = Record<string, unknown>;

// Append-only, so it has created_at but no updated_at.
@Entity('audit_logs')
@Index('idx_audit_logs_entity', ['entityType', 'entityId'])
@Index('idx_audit_logs_user_id', ['userId'])
@Index('idx_audit_logs_created_at', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NULL = public or system action.
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_audit_logs_user' })
  user?: User | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 64 })
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValues: AuditValues | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues: AuditValues | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
