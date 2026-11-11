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
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { PatientReferralStatus } from '../referrals.enums.js';
import { ReferringDoctor } from './referring-doctor.entity.js';

export const ACTIVE_REFERRAL_UNIQUE = 'uq_patient_referrals_active';

/**
 * A referring doctor sent this patient. At most one ACTIVE referral per
 * patient; ending one keeps it (and its terms and commissions) as history.
 * Row-locked while a session is covered, so two parallel attends can't both
 * take the last covered session.
 */
@Entity('patient_referrals')
@Index(ACTIVE_REFERRAL_UNIQUE, ['patientId'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
@Index('idx_patient_referrals_patient', ['patientId'])
@Index('idx_patient_referrals_doctor', ['referringDoctorId'])
@Check(
  'chk_patient_referrals_ended',
  `("status" = 'ACTIVE' AND "ended_at" IS NULL AND "ended_by" IS NULL AND "end_reason" IS NULL)
   OR ("status" = 'ENDED' AND "ended_at" IS NOT NULL AND "ended_by" IS NOT NULL AND "end_reason" IS NOT NULL)`,
)
export class PatientReferral extends BaseEntity {
  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_referrals_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'uuid' })
  referringDoctorId: string;

  @ManyToOne(() => ReferringDoctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_referrals_doctor' })
  referringDoctor?: Relation<ReferringDoctor>;

  @Column({
    type: 'enum',
    enum: PatientReferralStatus,
    enumName: 'patient_referral_status',
  })
  status: PatientReferralStatus;

  @Column({ type: 'uuid', name: 'assigned_by' })
  assignedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'assigned_by',
    foreignKeyConstraintName: 'fk_patient_referrals_assigned_by',
  })
  assignedBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  assignedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'uuid', name: 'ended_by', nullable: true })
  endedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ended_by',
    foreignKeyConstraintName: 'fk_patient_referrals_ended_by',
  })
  endedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endReason: string | null;
}
