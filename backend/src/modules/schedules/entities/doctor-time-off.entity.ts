import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { User } from '../../users/entities/user.entity.js';

// An absolute (UTC) period when a doctor is unavailable: leave, conference...
@Entity('doctor_time_off')
@Index('idx_doctor_time_off_doctor_start', ['doctorId', 'startAt'])
@Check('chk_doctor_time_off_period', 'end_at > start_at')
export class DoctorTimeOff extends BaseEntity {
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_time_off_doctor' })
  doctor?: Relation<Doctor>;

  @Column({ type: 'timestamptz' })
  startAt: Date;

  @Column({ type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_doctor_time_off_created_by',
  })
  createdBy?: Relation<User>;
}
