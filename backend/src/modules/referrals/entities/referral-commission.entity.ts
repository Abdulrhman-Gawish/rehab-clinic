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
import { Invoice } from '../../billing/entities/invoice.entity.js';
import { Payment } from '../../billing/entities/payment.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { Visit } from '../../visits/entities/visit.entity.js';
import {
  CommissionKind,
  CommissionStatus,
  ReferralRateType,
} from '../referrals.enums.js';
import { PatientReferralTerms } from './patient-referral-terms.entity.js';
import { PatientReferral } from './patient-referral.entity.js';
import { ReferralPayout } from './referral-payout.entity.js';
import { ReferringDoctor } from './referring-doctor.entity.js';

export const COMMISSION_EVENT_UNIQUE = 'uq_referral_commissions_event';

/**
 * The commission ledger. Amounts are never recalculated or edited: every
 * patient payment event (payment, refund, void) adds one row with the
 * change it causes, computed from the terms the invoice was billed with.
 * Only `status`, `eligible_at` and `payout_id` move (PENDING -> ELIGIBLE
 * when a package's first session is attended, -> PAID once valid payouts
 * settled the whole row; payout_id is the payout that completed it). What
 * each payout settled is in referral_payout_allocations.
 */
@Entity('referral_commissions')
@Index(COMMISSION_EVENT_UNIQUE, ['sourcePaymentId', 'kind'], {
  unique: true,
  where: '"source_payment_id" IS NOT NULL',
})
@Index('idx_referral_commissions_doctor_status', [
  'referringDoctorId',
  'status',
])
@Index('idx_referral_commissions_invoice', ['invoiceId'])
@Index('idx_referral_commissions_patient', ['patientId'])
@Index('idx_referral_commissions_payout', ['payoutId'])
@Check(
  'chk_referral_commissions_shape',
  `("kind" = 'ADJUSTMENT' AND length(trim("reason")) >= 3 AND "referral_terms_id" IS NULL AND "invoice_id" IS NULL
     AND "payment_id" IS NULL AND "source_payment_id" IS NULL AND "commission_type" IS NULL AND "rate" IS NULL AND "base_amount" IS NULL)
   OR ("kind" <> 'ADJUSTMENT' AND "patient_id" IS NOT NULL AND "patient_referral_id" IS NOT NULL AND "referral_terms_id" IS NOT NULL
     AND "invoice_id" IS NOT NULL AND "payment_id" IS NOT NULL AND "source_payment_id" IS NOT NULL
     AND "commission_type" IN ('PERCENT', 'FIXED') AND "rate" > 0 AND "base_amount" > 0)`,
)
@Check(
  'chk_referral_commissions_sign',
  `("kind" IN ('EARNED', 'REFUND_VOIDED') AND "amount" > 0)
   OR ("kind" IN ('REFUND_REVERSAL', 'VOID_REVERSAL') AND "amount" < 0)
   OR ("kind" = 'ADJUSTMENT' AND "amount" <> 0)`,
)
@Check(
  'chk_referral_commissions_status',
  `("status" = 'PENDING' AND "eligible_at" IS NULL AND "payout_id" IS NULL)
   OR ("status" = 'ELIGIBLE' AND "eligible_at" IS NOT NULL AND "payout_id" IS NULL)
   OR ("status" = 'PAID' AND "eligible_at" IS NOT NULL AND "payout_id" IS NOT NULL)`,
)
export class ReferralCommission extends BaseEntity {
  @Column({ type: 'uuid' })
  referringDoctorId: string;

  @ManyToOne(() => ReferringDoctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_doctor' })
  referringDoctor?: Relation<ReferringDoctor>;

  // Optional on an ADJUSTMENT.
  @Column({ type: 'uuid', nullable: true })
  patientId: string | null;

  @ManyToOne(() => Patient, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_patient' })
  patient?: Relation<Patient> | null;

  @Column({ type: 'uuid', nullable: true })
  patientReferralId: string | null;

  @ManyToOne(() => PatientReferral, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_referral' })
  patientReferral?: Relation<PatientReferral> | null;

  // The terms version (and through it the doctor's agreement version) used.
  @Column({ type: 'uuid', nullable: true })
  referralTermsId: string | null;

  @ManyToOne(() => PatientReferralTerms, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_terms' })
  referralTerms?: Relation<PatientReferralTerms> | null;

  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @ManyToOne(() => Invoice, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_invoice' })
  invoice?: Relation<Invoice> | null;

  // The session; null for a package sale.
  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  @ManyToOne(() => Visit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_visit' })
  visit?: Relation<Visit> | null;

  // The patient PAYMENT the row is about.
  @Column({ type: 'uuid', nullable: true })
  paymentId: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_payment' })
  payment?: Relation<Payment> | null;

  // The payments row whose event wrote this row (the payment itself, or
  // the refund).
  @Column({ type: 'uuid', nullable: true })
  sourcePaymentId: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_referral_commissions_source_payment',
  })
  sourcePayment?: Relation<Payment> | null;

  @Column({
    type: 'enum',
    enum: CommissionKind,
    enumName: 'referral_commission_kind',
  })
  kind: CommissionKind;

  @Column({
    type: 'enum',
    enum: ReferralRateType,
    enumName: 'referral_rate_type',
    nullable: true,
  })
  commissionType: ReferralRateType | null;

  // PERCENT: 10.00 = 10%. FIXED: EGP per covered session.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  rate: string | null;

  // The money of the event: the payment or the refund amount.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  baseAmount: string | null;

  // Signed: reversals are negative.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({
    type: 'enum',
    enum: CommissionStatus,
    enumName: 'referral_commission_status',
  })
  status: CommissionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  eligibleAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  payoutId: string | null;

  @ManyToOne(() => ReferralPayout, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_commissions_payout' })
  payout?: Relation<ReferralPayout> | null;

  // Required for an ADJUSTMENT.
  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', name: 'recorded_by' })
  recordedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'recorded_by',
    foreignKeyConstraintName: 'fk_referral_commissions_recorded_by',
  })
  recordedBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;
}
