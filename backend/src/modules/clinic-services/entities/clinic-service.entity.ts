import { Check, Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

// Catalog of services the clinic offers. Prices here are the CURRENT price;
// invoices must snapshot the price at billing time.
@Entity('clinic_services')
@Check('chk_clinic_services_duration_positive', 'duration_minutes > 0')
@Check('chk_clinic_services_base_price_non_negative', 'base_price >= 0')
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
}
