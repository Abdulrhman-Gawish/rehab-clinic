import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { VisitStatus } from '../visit.enums.js';
import { Visit } from './visit.entity.js';

// Append-only, written in the same transaction as each status change.
@Entity('visit_status_history')
@Index('idx_visit_status_history_visit', ['visitId', 'changedAt'])
export class VisitStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visit_status_history_visit' })
  visit?: Relation<Visit>;

  @Column({
    type: 'enum',
    enum: VisitStatus,
    enumName: 'visit_status',
    nullable: true,
  })
  fromStatus: VisitStatus | null;

  @Column({ type: 'enum', enum: VisitStatus, enumName: 'visit_status' })
  toStatus: VisitStatus;

  // Visits are always changed by staff.
  @Column({ type: 'uuid', name: 'changed_by' })
  changedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'changed_by',
    foreignKeyConstraintName: 'fk_visit_status_history_changed_by',
  })
  changedBy?: Relation<User>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  changedAt: Date;
}
