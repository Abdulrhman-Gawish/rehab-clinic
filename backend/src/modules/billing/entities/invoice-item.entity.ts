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
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { Invoice } from './invoice.entity.js';

// A priced line. Description and price are SNAPSHOTS: later catalog price
// changes never alter existing invoices.
@Entity('invoice_items')
@Index('idx_invoice_items_invoice', ['invoiceId'])
@Check('chk_invoice_items_quantity_positive', '"quantity" > 0')
@Check('chk_invoice_items_unit_price_non_negative', '"unit_price" >= 0')
@Check(
  'chk_invoice_items_line_total',
  '"line_total" = "unit_price" * "quantity"',
)
export class InvoiceItem extends BaseEntity {
  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoice_items_invoice' })
  invoice?: Relation<Invoice>;

  // NULL for free-text items (e.g. a medical report fee).
  @Column({ type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => ClinicService, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_invoice_items_service' })
  service?: Relation<ClinicService> | null;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  lineTotal: string;

  // Display order on the invoice/receipt (rows of one transaction share
  // created_at, so it can't be used for ordering).
  @Column({ type: 'int' })
  position: number;
}
