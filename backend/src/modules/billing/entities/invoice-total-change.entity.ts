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
import { Invoice } from './invoice.entity.js';

export const INVOICE_TOTAL_CHANGE_UNIQUE =
  'uq_invoice_total_changes_invoice_at';

/**
 * Append-only history of an invoice's total: one row from its issue, then
 * one per instant it changed (item added, edited or removed; discount
 * applied, replaced or removed). Changes at the same instant collapse into
 * one row, the state after them. The total in effect at an instant is the
 * latest row before it, so a later discount never changes what an invoice
 * was worth on an earlier day. Written by InvoicesService only.
 */
@Entity('invoice_total_changes')
@Unique(INVOICE_TOTAL_CHANGE_UNIQUE, ['invoiceId', 'changedAt'])
@Check('chk_invoice_total_changes_total', '"total" >= 0')
export class InvoiceTotalChange extends BaseEntity {
  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoice_total_changes_invoice' })
  invoice?: Relation<Invoice>;

  // From this instant (clinic clock) the invoice's total is `total`.
  @Column({ type: 'timestamptz' })
  changedAt: Date;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: string;
}
