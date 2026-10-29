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
import { Appointment } from '../../appointments/entities/appointment.entity.js';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { VisitStatus } from '../visit.enums.js';

export const VISIT_APPOINTMENT_UNIQUE = 'uq_visits_appointment_live';
export const VISIT_PATIENT_OPEN_UNIQUE = 'uq_visits_patient_open';
export const VISIT_DOCTOR_IN_SESSION_UNIQUE = 'uq_visits_doctor_in_session';

/**
 * What actually happened when the patient came. Created by check-in (from an
 * appointment) or as a walk-in (appointment_id NULL). Walk-ins never block
 * booking slots. The partial unique indexes are the real guarantees.
 */
@Entity('visits')
@Index('idx_visits_doctor_checked_in', ['doctorId', 'checkedInAt'])
@Index('idx_visits_patient_checked_in', ['patientId', 'checkedInAt'])
@Index('idx_visits_status', ['status'])
// One live visit per appointment. A CANCELLED one (undo check-in) doesn't
// count, so the appointment can be checked in again.
@Index(VISIT_APPOINTMENT_UNIQUE, ['appointmentId'], {
  unique: true,
  where: `"status" <> 'CANCELLED'`,
})
@Index(VISIT_PATIENT_OPEN_UNIQUE, ['patientId'], {
  unique: true,
  where: `"status" IN ('WAITING', 'IN_SESSION')`,
})
@Index(VISIT_DOCTOR_IN_SESSION_UNIQUE, ['doctorId'], {
  unique: true,
  where: `"status" = 'IN_SESSION'`,
})
@Check(
  'chk_visits_in_session_started',
  `"status" <> 'IN_SESSION' OR "started_at" IS NOT NULL`,
)
@Check(
  'chk_visits_completed_times',
  `"status" <> 'COMPLETED' OR ("started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "completed_at" >= "started_at")`,
)
@Check(
  'chk_visits_cancelled_reason',
  `"status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)`,
)
export class Visit extends BaseEntity {
  // NULL = walk-in.
  @Column({ type: 'uuid', nullable: true })
  appointmentId: string | null;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visits_appointment' })
  appointment?: Relation<Appointment> | null;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visits_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visits_doctor' })
  doctor?: Relation<Doctor>;

  // Needed for walk-ins and for billing later.
  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visits_service' })
  service?: Relation<ClinicService>;

  @Column({ type: 'enum', enum: VisitStatus, enumName: 'visit_status' })
  status: VisitStatus;

  @Column({ type: 'timestamptz' })
  checkedInAt: Date;

  @Column({ type: 'uuid', name: 'checked_in_by' })
  checkedInById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'checked_in_by',
    foreignKeyConstraintName: 'fk_visits_checked_in_by',
  })
  checkedInBy?: Relation<User>;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'uuid', name: 'completed_by', nullable: true })
  completedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completed_by',
    foreignKeyConstraintName: 'fk_visits_completed_by',
  })
  completedBy?: Relation<User> | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'cancelled_by',
    foreignKeyConstraintName: 'fk_visits_cancelled_by',
  })
  cancelledBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelReason: string | null;
}
