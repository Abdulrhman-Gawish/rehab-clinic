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
import { PaymentMethod, PaymentStatus } from '../../billing/billing.enums.js';
import { Expense } from '../../expenses/entities/expense.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { ReferringDoctor } from './referring-doctor.entity.js';

export const PAYOUT_EXPENSE_UNIQUE = 'uq_referral_payouts_expense';

/**
 * Money the clinic paid to a referring doctor (OWNER only), any amount up
 * to what is owed. It settles commission rows oldest first
 * (referral_payout_allocations) and is a clinic expense: exactly one
 * expense row (expense_id, NOT NULL and unique) with the same amount,
 * method and date, so every financial report counts it once. A payout
 * recorded by mistake is VOIDED with its expense: its rows are owed again.
 */
@Entity('referral_payouts')
@Index('idx_referral_payouts_doctor_paid', ['referringDoctorId', 'paidAt'])
@Index(PAYOUT_EXPENSE_UNIQUE, ['expenseId'], { unique: true })
@Check('chk_referral_payouts_amount_positive', '"amount" > 0')
@Check(
  'chk_referral_payouts_voided',
  `("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)`,
)
export class ReferralPayout extends BaseEntity {
  @Column({ type: 'uuid' })
  referringDoctorId: string;

  @ManyToOne(() => ReferringDoctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_payouts_doctor' })
  referringDoctor?: Relation<ReferringDoctor>;

  // At most what was owed when it was recorded; = the sum of its allocations.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  // Clinic local date the money was paid ('YYYY-MM-DD'); the expense date.
  @Column({ type: 'date' })
  payoutDate: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  method: PaymentMethod;

  @Column({ type: 'uuid' })
  expenseId: string;

  @ManyToOne(() => Expense, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_referral_payouts_expense' })
  expense?: Relation<Expense>;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.VALID,
  })
  status: PaymentStatus;

  @Column({ type: 'uuid', name: 'paid_by' })
  paidById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'paid_by',
    foreignKeyConstraintName: 'fk_referral_payouts_paid_by',
  })
  paidBy?: Relation<User>;

  // When it was recorded (clinic clock).
  @Column({ type: 'timestamptz' })
  paidAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'voided_by',
    foreignKeyConstraintName: 'fk_referral_payouts_voided_by',
  })
  voidedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;
}
