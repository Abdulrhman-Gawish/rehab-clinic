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
import { ReferralApplicability, ReferralRateType } from '../referrals.enums.js';
import { PatientReferral } from './patient-referral.entity.js';
import { ReferringDoctorAgreement } from './referring-doctor-agreement.entity.js';

/**
 * One version of a patient's referral terms. Never edited: a change is a
 * new version. `doctor_agreement_id` is the doctor's default in force when
 * the version was written (the defaults shown next to the applied values);
 * `is_override` says the applied commission or discount differs from it,
 * and then a reason is required. A covered invoice points at the exact
 * version it was billed with (invoices.referral_terms_id).
 */
@Entity('patient_referral_terms')
@Unique('uq_patient_referral_terms_version', ['patientReferralId', 'version'])
@Check('chk_patient_referral_terms_version', '"version" >= 1')
@Check('chk_patient_referral_terms_commission', rateCheck('commission'))
@Check('chk_patient_referral_terms_discount', rateCheck('discount'))
@Check(
  'chk_patient_referral_terms_applicability',
  `("applicability" IN ('FIRST_SESSION', 'ALL_SESSIONS') AND "max_sessions" IS NULL AND "valid_from" IS NULL AND "valid_to" IS NULL)
   OR ("applicability" = 'SESSION_COUNT' AND "max_sessions" >= 1 AND "valid_from" IS NULL AND "valid_to" IS NULL)
   OR ("applicability" = 'DATE_RANGE' AND "max_sessions" IS NULL AND "valid_from" IS NOT NULL AND "valid_to" IS NOT NULL AND "valid_from" <= "valid_to")`,
)
@Check(
  'chk_patient_referral_terms_override',
  `NOT "is_override" OR length(trim("override_reason")) >= 3`,
)
export class PatientReferralTerms extends BaseEntity {
  @Column({ type: 'uuid' })
  patientReferralId: string;

  @ManyToOne(() => PatientReferral, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_patient_referral_terms_referral',
  })
  patientReferral?: Relation<PatientReferral>;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'uuid' })
  doctorAgreementId: string;

  @ManyToOne(() => ReferringDoctorAgreement, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_patient_referral_terms_agreement',
  })
  doctorAgreement?: Relation<ReferringDoctorAgreement>;

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

  @Column({
    type: 'enum',
    enum: ReferralApplicability,
    enumName: 'referral_applicability',
  })
  applicability: ReferralApplicability;

  // SESSION_COUNT only.
  @Column({ type: 'int', nullable: true })
  maxSessions: number | null;

  // DATE_RANGE only: clinic local dates, both inclusive.
  @Column({ type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ type: 'date', nullable: true })
  validTo: string | null;

  @Column({ type: 'boolean' })
  isOverride: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  overrideReason: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_patient_referral_terms_created_by',
  })
  createdBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;
}
