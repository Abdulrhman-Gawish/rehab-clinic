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
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { PaymentMethod, PaymentStatus, PaymentType } from '../billing.enums.js';
import { Invoice } from './invoice.entity.js';

export const PAYMENT_IDEMPOTENCY_UNIQUE = 'uq_payments_idempotency_key';

/**
 * Money received (PAYMENT) or returned (REFUND). Paid money is never edited
 * or deleted: a mistake is VOIDED (same local day), returned money is a new
 * REFUND row pointing at the payment it returns.
 */
@Entity('payments')
@Unique('uq_payments_receipt_number', ['receiptNumber'])
@Unique(PAYMENT_IDEMPOTENCY_UNIQUE, ['idempotencyKey'])
@Index('idx_payments_invoice', ['invoiceId'])
@Index('idx_payments_received_at', ['receivedAt'])
@Index('idx_payments_method_received_at', ['method', 'receivedAt'])
@Index('idx_payments_refund_of', ['refundOfId'])
@Check('chk_payments_amount_positive', '"amount" > 0')
@Check(
  'chk_payments_refund_shape',
  `("type" = 'REFUND' AND "refund_of_id" IS NOT NULL AND "reason" IS NOT NULL) OR ("type" = 'PAYMENT' AND "refund_of_id" IS NULL)`,
)
@Check(
  'chk_payments_reference',
  `"type" <> 'PAYMENT' OR "method" = 'CASH' OR "reference" IS NOT NULL`,
)
@Check(
  'chk_payments_voided',
  `("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)`,
)
export class Payment extends BaseEntity {
  // RCP-2026-000045 (document_counters, also for refunds).
  @Column({ type: 'varchar', length: 32 })
  receiptNumber: string;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_payments_invoice' })
  invoice?: Relation<Invoice>;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_payments_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'enum', enum: PaymentType, enumName: 'payment_type' })
  type: PaymentType;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.VALID,
  })
  status: PaymentStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  method: PaymentMethod;

  // Required for CARD / WALLET / INSTAPAY payments.
  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  // Required for refunds.
  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  idempotencyKey: string | null;

  // SHA-256 of the request that used the key (same key + other body = 409).
  @Column({ type: 'varchar', length: 64, nullable: true })
  idempotencyHash: string | null;

  @Column({ type: 'uuid', name: 'received_by' })
  receivedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'received_by',
    foreignKeyConstraintName: 'fk_payments_received_by',
  })
  receivedBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'voided_by',
    foreignKeyConstraintName: 'fk_payments_voided_by',
  })
  voidedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  // A refund points to the payment it returns.
  @Column({ type: 'uuid', nullable: true })
  refundOfId: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_payments_refund_of' })
  refundOf?: Relation<Payment> | null;
}
