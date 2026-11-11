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
import { Invoice } from '../../billing/entities/invoice.entity.js';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { PatientPackageStatus } from '../packages.enums.js';
import { Package } from './package.entity.js';

/**
 * A package sold to a patient. Name, service, sessions and prices are
 * snapshots of the catalog at sale time; the allowed doctors are not (they
 * follow the package's current list). The sale's invoice has no visit.
 * Row-locked (FOR UPDATE) whenever a session is used or restored.
 */
@Entity('patient_packages')
@Unique('uq_patient_packages_invoice', ['invoiceId'])
@Index('idx_patient_packages_patient_sold', ['patientId', 'soldAt'])
@Index('idx_patient_packages_package_id', ['packageId'])
@Check(
  'chk_patient_packages_sessions',
  '"total_sessions" > 0 AND "used_sessions" >= 0 AND "used_sessions" <= "total_sessions"',
)
@Check(
  'chk_patient_packages_amounts',
  '"list_price" >= 0 AND "offer_amount" >= 0 AND "price" >= 0 AND "price" = "list_price" - "offer_amount"',
)
@Check(
  'chk_patient_packages_status',
  `("status" = 'ACTIVE' AND "used_sessions" < "total_sessions" AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancel_reason" IS NULL)
   OR ("status" = 'FINISHED' AND "used_sessions" = "total_sessions" AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancel_reason" IS NULL)
   OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL)`,
)
export class PatientPackage extends BaseEntity {
  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_packages_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'uuid' })
  packageId: string;

  @ManyToOne(() => Package, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_packages_package' })
  package?: Relation<Package>;

  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_packages_service' })
  service?: Relation<ClinicService>;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  listPrice: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  offerAmount: string;

  // Selling price = list_price - offer_amount (the invoice's item).
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: string;

  @Column({ type: 'int' })
  totalSessions: number;

  // = sessions with a package_usages row not restored.
  @Column({ type: 'int', default: 0 })
  usedSessions: number;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_packages_invoice' })
  invoice?: Relation<Invoice>;

  @Column({
    type: 'enum',
    enum: PatientPackageStatus,
    enumName: 'patient_package_status',
  })
  status: PatientPackageStatus;

  @Column({ type: 'uuid', name: 'sold_by' })
  soldById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'sold_by',
    foreignKeyConstraintName: 'fk_patient_packages_sold_by',
  })
  soldBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  soldAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'cancelled_by',
    foreignKeyConstraintName: 'fk_patient_packages_cancelled_by',
  })
  cancelledBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelReason: string | null;
}
