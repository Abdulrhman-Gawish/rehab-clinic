import { Check, Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

// Catalog of services the clinic offers. Prices here are the CURRENT price;
// invoices must snapshot the price at billing time. is_active hides it for a
// while; deleted_at removes it for good (the row stays for history).
@Entity('clinic_services')
@Check('chk_clinic_services_duration_positive', 'duration_minutes > 0')
@Check('chk_clinic_services_base_price_non_negative', 'base_price >= 0')
@Check(
  'chk_clinic_services_deleted_inactive',
  '"deleted_at" IS NULL OR "is_active" = false',
)
export class ClinicService extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  durationMinutes: number;

  // numeric(12,2) comes back from pg as a string; never convert to float.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  basePrice: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
