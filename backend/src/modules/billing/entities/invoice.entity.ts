import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { Visit } from '../../visits/entities/visit.entity.js';
import { InvoiceStatus } from '../billing.enums.js';
import { InvoiceItem } from './invoice-item.entity.js';

export const INVOICE_VISIT_UNIQUE = 'uq_invoices_visit_live';

/**
 * A patient invoice: one per visit (created on check-in) or manual
 * (visit_id NULL). Money is numeric(12,2), handled as strings in TS.
 * The CHECKs make inconsistent rows impossible even for direct SQL.
 */
@Entity('invoices')
@Unique('uq_invoices_invoice_number', ['invoiceNumber'])
@Index(INVOICE_VISIT_UNIQUE, ['visitId'], {
  unique: true,
  where: `"status" <> 'CANCELLED'`,
})
@Index('idx_invoices_patient_issued', ['patientId', 'issuedAt'])
@Index('idx_invoices_status', ['status'])
@Index('idx_invoices_issued_at', ['issuedAt'])
@Check(
  'chk_invoices_amounts_non_negative',
  `"subtotal" >= 0 AND "discount_total" >= 0 AND "total" >= 0 AND "amount_paid" >= 0`,
)
@Check('chk_invoices_total', `"total" = "subtotal" - "discount_total"`)
@Check('chk_invoices_paid_not_above_total', `"amount_paid" <= "total"`)
@Check(
  'chk_invoices_status_matches_amounts',
  `("status" = 'CANCELLED' AND "amount_paid" = 0 AND "cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
   OR ("status" = 'PAID' AND "amount_paid" = "total")
   OR ("status" = 'PARTIALLY_PAID' AND "amount_paid" > 0 AND "amount_paid" < "total")
   OR ("status" = 'ISSUED' AND "amount_paid" = 0 AND "total" > 0)`,
)
export class Invoice extends BaseEntity {
  // INV-2026-000123 (year in CLINIC_TIMEZONE).
  @Column({ type: 'varchar', length: 32 })
  invoiceNumber: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoices_patient' })
  patient?: Relation<Patient>;

  // NULL = manual invoice.
  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  @ManyToOne(() => Visit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoices_visit' })
  visit?: Relation<Visit> | null;

  @Column({ type: 'enum', enum: InvoiceStatus, enumName: 'invoice_status' })
  status: InvoiceStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  subtotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountTotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: string;

  // Net of refunds, excluding voided payments.
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amountPaid: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // NULL when created automatically (check-in).
  @Column({ type: 'uuid', name: 'issued_by', nullable: true })
  issuedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'issued_by',
    foreignKeyConstraintName: 'fk_invoices_issued_by',
  })
  issuedBy?: Relation<User> | null;

  @Column({ type: 'timestamptz' })
  issuedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'cancelled_by',
    foreignKeyConstraintName: 'fk_invoices_cancelled_by',
  })
  cancelledBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelReason: string | null;

  @OneToMany(() => InvoiceItem, (item) => item.invoice)
  items?: Relation<InvoiceItem>[];
}
