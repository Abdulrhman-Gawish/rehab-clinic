import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { DiscountType } from '../../billing/billing.enums.js';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { PackageDoctor } from './package-doctor.entity.js';

/**
 * Catalog: N sessions of ONE service for a total price, offered by every
 * doctor (all_doctors) or by the doctors in package_doctors. An optional
 * offer lowers the selling price between two local dates. Sold packages
 * snapshot name, service, sessions and prices (patient_packages).
 */
@Entity('packages')
@Index('idx_packages_service_id', ['serviceId'])
@Check('chk_packages_sessions_positive', '"sessions_count" > 0')
@Check('chk_packages_price_non_negative', '"price" >= 0')
@Check(
  'chk_packages_deleted_inactive',
  '"deleted_at" IS NULL OR "is_active" = false',
)
@Check(
  'chk_packages_offer',
  `("offer_type" IS NULL AND "offer_value" IS NULL AND "offer_starts_on" IS NULL AND "offer_ends_on" IS NULL)
   OR ("offer_type" IS NOT NULL AND "offer_value" > 0
       AND ("offer_type" <> 'PERCENT' OR "offer_value" <= 100)
       AND ("offer_type" <> 'FIXED' OR "offer_value" <= "price")
       AND ("offer_starts_on" IS NULL OR "offer_ends_on" IS NULL OR "offer_starts_on" <= "offer_ends_on"))`,
)
export class Package extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_packages_service' })
  service?: Relation<ClinicService>;

  @Column({ type: 'int' })
  sessionsCount: number;

  // Total price of the whole package.
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: string;

  // true = every doctor, including doctors added later.
  @Column({ type: 'boolean', default: false })
  allDoctors: boolean;

  @Column({
    type: 'enum',
    enum: DiscountType,
    enumName: 'discount_type',
    nullable: true,
  })
  offerType: DiscountType | null;

  // PERCENT: 20.00 = 20%. FIXED: EGP off the package price.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  offerValue: string | null;

  // Clinic local dates, both inclusive; null = open-ended.
  @Column({ type: 'date', nullable: true })
  offerStartsOn: string | null;

  @Column({ type: 'date', nullable: true })
  offerEndsOn: string | null;

  // Shown on the public website (GET /public/packages).
  @Column({ type: 'boolean', default: true })
  isPublic: boolean;

  // Not sold any more while false; can be switched back on.
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // Deleted for good: gone from every list, never active again. Sold
  // packages keep working (they keep pointing here).
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => PackageDoctor, (link) => link.package)
  doctors?: Relation<PackageDoctor>[];
}
