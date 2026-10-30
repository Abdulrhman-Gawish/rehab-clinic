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
import { User } from '../../users/entities/user.entity.js';
import { Visit } from '../../visits/entities/visit.entity.js';
import { PackageUsageReason } from '../packages.enums.js';
import { PatientPackage } from './patient-package.entity.js';

export const USAGE_VISIT_UNIQUE = 'uq_package_usages_visit_active';
export const USAGE_APPOINTMENT_UNIQUE = 'uq_package_usages_appointment_active';

/**
 * One used session: by an attended visit, or by a no-show appointment.
 * Restoring sets restored_* (the row stays as history). A visit or an
 * appointment uses at most one session at a time (partial unique indexes).
 */
@Entity('package_usages')
@Index('idx_package_usages_patient_package', ['patientPackageId'])
@Index(USAGE_VISIT_UNIQUE, ['visitId'], {
  unique: true,
  where: '"restored_at" IS NULL',
})
@Index(USAGE_APPOINTMENT_UNIQUE, ['appointmentId'], {
  unique: true,
  where: '"restored_at" IS NULL',
})
@Check(
  'chk_package_usages_source',
  `("reason" = 'ATTENDED' AND "visit_id" IS NOT NULL AND "appointment_id" IS NULL)
   OR ("reason" = 'NO_SHOW' AND "appointment_id" IS NOT NULL AND "visit_id" IS NULL)`,
)
@Check(
  'chk_package_usages_restored',
  `("restored_at" IS NULL AND "restored_by" IS NULL AND "restore_reason" IS NULL)
   OR ("restored_at" IS NOT NULL AND "restored_by" IS NOT NULL AND "restore_reason" IS NOT NULL)`,
)
export class PackageUsage extends BaseEntity {
  @Column({ type: 'uuid' })
  patientPackageId: string;

  @ManyToOne(() => PatientPackage, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_package_usages_patient_package' })
  patientPackage?: Relation<PatientPackage>;

  @Column({
    type: 'enum',
    enum: PackageUsageReason,
    enumName: 'package_usage_reason',
  })
  reason: PackageUsageReason;

  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  @ManyToOne(() => Visit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_package_usages_visit' })
  visit?: Relation<Visit> | null;

  @Column({ type: 'uuid', nullable: true })
  appointmentId: string | null;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_package_usages_appointment' })
  appointment?: Relation<Appointment> | null;

  @Column({ type: 'timestamptz' })
  usedAt: Date;

  @Column({ type: 'uuid', name: 'used_by' })
  usedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'used_by',
    foreignKeyConstraintName: 'fk_package_usages_used_by',
  })
  usedBy?: Relation<User>;

  @Column({ type: 'timestamptz', nullable: true })
  restoredAt: Date | null;

  @Column({ type: 'uuid', name: 'restored_by', nullable: true })
  restoredById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'restored_by',
    foreignKeyConstraintName: 'fk_package_usages_restored_by',
  })
  restoredBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  restoreReason: string | null;
}
