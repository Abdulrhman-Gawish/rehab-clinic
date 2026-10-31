import {
  Check,
  Column,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { Package } from '../../packages/entities/package.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import {
  ACTIVE_STATUSES,
  AppointmentSource,
  AppointmentStatus,
} from '../appointment.enums.js';

export const APPOINTMENT_REFERENCE_UNIQUE = 'uq_appointments_reference_code';
export const DOCTOR_OVERLAP_EXCLUSION = 'excl_appointments_doctor_overlap';
export const PATIENT_OVERLAP_EXCLUSION = 'excl_appointments_patient_overlap';

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(', ');

/**
 * The database is the source of truth against double booking: neither a
 * doctor nor a patient can hold two overlapping ACTIVE appointments.
 * Ranges are half-open, so back-to-back appointments are fine.
 */
@Entity('appointments')
@Unique(APPOINTMENT_REFERENCE_UNIQUE, ['referenceCode'])
@Index('idx_appointments_doctor_start', ['doctorId', 'startAt'])
@Index('idx_appointments_patient_start', ['patientId', 'startAt'])
@Index('idx_appointments_status_start', ['status', 'startAt'])
@Check('chk_appointments_period', 'end_at > start_at')
@Exclusion(
  DOCTOR_OVERLAP_EXCLUSION,
  `USING gist ("doctor_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN (${ACTIVE_SQL}))`,
)
@Exclusion(
  PATIENT_OVERLAP_EXCLUSION,
  `USING gist ("patient_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN (${ACTIVE_SQL}))`,
)
export class Appointment extends BaseEntity {
  // Short human code for phone/WhatsApp lookups, e.g. APT-7K3Q9X.
  @Column({ type: 'varchar', length: 16 })
  referenceCode: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_appointments_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_appointments_doctor' })
  doctor?: Relation<Doctor>;

  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_appointments_service' })
  service?: Relation<ClinicService>;

  @Column({ type: 'timestamptz' })
  startAt: Date;

  // Always computed server-side from the service duration.
  @Column({ type: 'timestamptz' })
  endAt: Date;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
  })
  status: AppointmentStatus;

  @Column({
    type: 'enum',
    enum: AppointmentSource,
    enumName: 'appointment_source',
  })
  source: AppointmentSource;

  // The name typed at booking time (may differ from the patient's name).
  @Column({ type: 'varchar', length: 120 })
  bookedName: string;

  // NULL for online bookings.
  @Column({ type: 'uuid', name: 'booked_by', nullable: true })
  bookedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'booked_by',
    foreignKeyConstraintName: 'fk_appointments_booked_by',
  })
  bookedBy?: Relation<User> | null;

  @Column({ type: 'uuid', nullable: true })
  rescheduledFromId: string | null;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_appointments_rescheduled_from' })
  rescheduledFrom?: Relation<Appointment> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelReason: string | null;

  // Administrative notes only, never medical information.
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // The package the patient picked when booking online: only a request;
  // reception sells it at the desk (nothing is sold or paid online).
  @Column({ type: 'uuid', nullable: true })
  requestedPackageId: string | null;

  @ManyToOne(() => Package, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_appointments_requested_package' })
  requestedPackage?: Relation<Package> | null;
}
