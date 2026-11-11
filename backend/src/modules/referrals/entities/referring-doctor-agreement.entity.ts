import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { rateCheck } from '../referrals.constants.js';
import { ReferralRateType } from '../referrals.enums.js';
import { ReferringDoctor } from './referring-doctor.entity.js';

/**
 * The doctor's default terms, set by the OWNER. Rows are never edited: a
 * change is a new version, effective from a local date (today or later,
 * never before the previous version). The current agreement is the highest
 * version already in effect. Patient terms point at the version they were
 * loaded from, so a change never touches existing patients.
 */
@Entity('referring_doctor_agreements')
@Unique('uq_referring_doctor_agreements_version', [
  'referringDoctorId',
  'version',
])
@Check('chk_referring_doctor_agreements_version', '"version" >= 1')
@Check('chk_referring_doctor_agreements_commission', rateCheck('commission'))
@Check('chk_referring_doctor_agreements_discount', rateCheck('discount'))
export class ReferringDoctorAgreement extends BaseEntity {
  @Column({ type: 'uuid' })
  referringDoctorId: string;

  @ManyToOne(() => ReferringDoctor, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_referring_doctor_agreements_doctor',
  })
  referringDoctor?: Relation<ReferringDoctor>;

  @Column({ type: 'int' })
  version: number;

  // Clinic local date, inclusive.
  @Column({ type: 'date' })
  effectiveFrom: string;

  @Column({
    type: 'enum',
    enum: ReferralRateType,
    enumName: 'referral_rate_type',
  })
  commissionType: ReferralRateType;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  commissionValue: string | null;

  @Column({
    type: 'enum',
    enum: ReferralRateType,
    enumName: 'referral_rate_type',
  })
  discountType: ReferralRateType;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  discountValue: string | null;

  // Why the agreement was set or changed.
  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_referring_doctor_agreements_created_by',
  })
  createdBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;
}
