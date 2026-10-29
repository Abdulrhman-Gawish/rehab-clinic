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
import { DiscountType } from '../billing.enums.js';
import { Invoice } from './invoice.entity.js';

export const ACTIVE_DISCOUNT_UNIQUE = 'uq_invoice_discounts_active';

/**
 * Discounts are never edited in place: replacing or removing one sets
 * removed_at on the old row (history kept) and inserts a new row.
 */
@Entity('invoice_discounts')
@Index(ACTIVE_DISCOUNT_UNIQUE, ['invoiceId'], {
  unique: true,
  where: '"removed_at" IS NULL',
})
@Index('idx_invoice_discounts_patient_applied', ['patientId', 'appliedAt'])
@Check(
  'chk_invoice_discounts_value',
  `("type" = 'PERCENT' AND "value" > 0 AND "value" <= 100) OR ("type" = 'FIXED' AND "value" > 0)`,
)
@Check('chk_invoice_discounts_amount_non_negative', '"amount" >= 0')
@Check('chk_invoice_discounts_reason', 'length(trim("reason")) >= 3')
@Check(
  'chk_invoice_discounts_removed',
  '("removed_at" IS NULL AND "removed_by" IS NULL) OR ("removed_at" IS NOT NULL AND "removed_by" IS NOT NULL)',
)
export class InvoiceDiscount extends BaseEntity {
  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoice_discounts_invoice' })
  invoice?: Relation<Invoice>;

  // Denormalized for the fast "last discount of this patient" lookup.
  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoice_discounts_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'enum', enum: DiscountType, enumName: 'discount_type' })
  type: DiscountType;

  // PERCENT: 20.00 = 20%. FIXED: EGP.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  value: string;

  // EGP actually discounted on this invoice (re-derived for PERCENT when
  // the items change).
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'uuid', nullable: true })
  repeatedFromId: string | null;

  @ManyToOne(() => InvoiceDiscount, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_invoice_discounts_repeated_from',
  })
  repeatedFrom?: Relation<InvoiceDiscount> | null;

  @Column({ type: 'uuid', name: 'applied_by' })
  appliedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'applied_by',
    foreignKeyConstraintName: 'fk_invoice_discounts_applied_by',
  })
  appliedBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  appliedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'uuid', name: 'removed_by', nullable: true })
  removedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'removed_by',
    foreignKeyConstraintName: 'fk_invoice_discounts_removed_by',
  })
  removedBy?: Relation<User> | null;

  // Why it was removed ("Replaced" when a new discount took its place).
  @Column({ type: 'varchar', length: 255, nullable: true })
  removalReason: string | null;
}
