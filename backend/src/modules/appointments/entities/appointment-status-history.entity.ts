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
import { AppointmentStatus } from '../appointment.enums.js';
import { Appointment } from './appointment.entity.js';

// Append-only log of status changes (written in the same transaction as the
// change). from_status is NULL for the creation entry.
@Entity('appointment_status_history')
@Index('idx_appointment_status_history_appointment', [
  'appointmentId',
  'changedAt',
])
export class AppointmentStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => Appointment, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_appointment_status_history_appointment',
  })
  appointment?: Relation<Appointment>;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
    nullable: true,
  })
  fromStatus: AppointmentStatus | null;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
  })
  toStatus: AppointmentStatus;

  // NULL for public (online) actions.
  @Column({ type: 'uuid', name: 'changed_by', nullable: true })
  changedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'changed_by',
    foreignKeyConstraintName: 'fk_appointment_status_history_changed_by',
  })
  changedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  // clock_timestamp(), not now(): several rows written in one transaction
  // (e.g. PENDING -> CONFIRMED -> CHECKED_IN) must keep their order.
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  changedAt: Date;
}
