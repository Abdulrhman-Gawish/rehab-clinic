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
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { Expense } from '../../expenses/entities/expense.entity.js';
import { User } from '../../users/entities/user.entity.js';

export const SALARY_PAYMENT_EXPENSE_UNIQUE =
  'uq_doctor_salary_payments_expense';

/**
 * Money paid to a doctor for a month's salary (OWNER only). A month can be
 * paid in several parts, advances included (never capped: the statement
 * shows what is still owed, or overpaid). Each payment is exactly one clinic
 * expense (same amount, method and date), so the reports count it once. A
 * payment recorded by mistake is VOIDED with its expense.
 */
@Entity('doctor_salary_payments')
@Index('idx_doctor_salary_payments_doctor_month', ['doctorId', 'month'])
@Index(SALARY_PAYMENT_EXPENSE_UNIQUE, ['expenseId'], { unique: true })
@Check('chk_doctor_salary_payments_amount_positive', '"amount" > 0')
@Check(
  'chk_doctor_salary_payments_month',
  `"month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
)
@Check(
  'chk_doctor_salary_payments_voided',
  `("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)`,
)
export class DoctorSalaryPayment extends BaseEntity {
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_salary_payments_doctor' })
  doctor?: Relation<Doctor>;

  // 'YYYY-MM': the salary month it pays.
  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  // Clinic local date the money was paid; the expense date.
  @Column({ type: 'date' })
  paymentDate: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  method: PaymentMethod;

  @Column({ type: 'uuid' })
  expenseId: string;

  @ManyToOne(() => Expense, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_salary_payments_expense' })
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
    foreignKeyConstraintName: 'fk_doctor_salary_payments_paid_by',
  })
  paidBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  paidAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'voided_by',
    foreignKeyConstraintName: 'fk_doctor_salary_payments_voided_by',
  })
  voidedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;
}
