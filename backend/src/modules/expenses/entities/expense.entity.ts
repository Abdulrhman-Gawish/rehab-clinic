import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { PaymentMethod } from '../../billing/billing.enums.js';
import { User } from '../../users/entities/user.entity.js';
import { ExpenseCategory } from './expense-category.entity.js';

export enum ExpenseStatus {
  VALID = 'VALID',
  VOIDED = 'VOIDED',
}

/**
 * Money the clinic spends (not a patient invoice). Never deleted: mistakes
 * are VOIDED. created_at is set from the clinic clock and decides the
 * "same local day" edit window for receptionists.
 */
@Entity('expenses')
@Unique('uq_expenses_expense_number', ['expenseNumber'])
@Index('idx_expenses_expense_date', ['expenseDate'])
@Index('idx_expenses_category_date', ['categoryId', 'expenseDate'])
@Check('chk_expenses_amount_positive', '"amount" > 0')
@Check(
  'chk_expenses_voided',
  `("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)`,
)
export class Expense extends BaseEntity {
  // EXP-2026-000010 (document_counters).
  @Column({ type: 'varchar', length: 32 })
  expenseNumber: string;

  @Column({ type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => ExpenseCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_expenses_category' })
  category?: Relation<ExpenseCategory>;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  // Clinic local date ('YYYY-MM-DD').
  @Column({ type: 'date' })
  expenseDate: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  vendorName: string | null;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  // Key in the private StorageService (never a public URL).
  @Column({ type: 'varchar', length: 255, nullable: true })
  receiptFileKey: string | null;

  @Column({
    type: 'enum',
    enum: ExpenseStatus,
    enumName: 'expense_status',
    default: ExpenseStatus.VALID,
  })
  status: ExpenseStatus;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_expenses_created_by',
  })
  createdBy?: Relation<User>;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'voided_by',
    foreignKeyConstraintName: 'fk_expenses_voided_by',
  })
  voidedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;
}
