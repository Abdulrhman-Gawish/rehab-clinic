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

export const VISIT_APPOINTMENT_UNIQUE = 'uq_visits_appointment_active';

/**
 * The patient attended: created by reception from an appointment ("attend")
 * or as a walk-in (appointment_id NULL), together with its invoice. Walk-ins
 * never block booking slots. Undoing an attendance voids the visit.
 */
@Entity('visits')
@Index('idx_visits_doctor_attended', ['doctorId', 'attendedAt'])
@Index('idx_visits_patient_attended', ['patientId', 'attendedAt'])
@Index('idx_visits_status', ['status'])
// One ACTIVE visit per appointment. A VOIDED one (undo attend) doesn't
// count, so the appointment can attend again.
@Index(VISIT_APPOINTMENT_UNIQUE, ['appointmentId'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
@Check(
  'chk_visits_voided',
  `"status" <> 'VOIDED' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL)`,
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

  // Needed for walk-ins and for billing.
  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_visits_service' })
  service?: Relation<ClinicService>;

  @Column({ type: 'enum', enum: VisitStatus, enumName: 'visit_status' })
  status: VisitStatus;

  @Column({ type: 'timestamptz' })
  attendedAt: Date;

  @Column({ type: 'uuid', name: 'attended_by' })
  attendedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'attended_by',
    foreignKeyConstraintName: 'fk_visits_attended_by',
  })
  attendedBy?: Relation<User>;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'voided_by',
    foreignKeyConstraintName: 'fk_visits_voided_by',
  })
  voidedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;
}
