import {
  Check,
  Column,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';

export const SCHEDULE_OVERLAP_EXCLUSION = 'excl_doctor_schedules_no_overlap';

/**
 * A weekly working range in CLINIC LOCAL wall-clock time (no offset stored):
 * "every Sunday 09:00-13:00". Converted to UTC per concrete date, so DST is
 * handled automatically. A day may have several non-overlapping ranges.
 */
@Entity('doctor_schedules')
@Index('idx_doctor_schedules_doctor_day', ['doctorId', 'dayOfWeek'])
@Check('chk_doctor_schedules_day_of_week', 'day_of_week BETWEEN 0 AND 6')
@Check('chk_doctor_schedules_time_order', 'end_time > start_time')
// Active ranges of one doctor on one weekday must not overlap. Times are
// anchored to a fixed date to build a range; '[)' lets 09-12 and 12-15 touch.
@Exclusion(
  SCHEDULE_OVERLAP_EXCLUSION,
  `USING gist ("doctor_id" WITH =, "day_of_week" WITH =, tsrange(('2000-01-01'::date + "start_time"), ('2000-01-01'::date + "end_time"), '[)') WITH &&) WHERE ("is_active")`,
)
export class DoctorSchedule extends BaseEntity {
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_schedules_doctor' })
  doctor?: Relation<Doctor>;

  // 0 = Sunday ... 6 = Saturday, in clinic local time.
  @Column({ type: 'smallint' })
  dayOfWeek: number;

  // 'HH:MM:SS' local wall-clock time.
  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
