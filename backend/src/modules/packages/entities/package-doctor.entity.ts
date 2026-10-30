import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { Package } from './package.entity.js';

// The doctors offering a package (unused when packages.all_doctors). Sold
// packages follow this CURRENT list.
@Entity('package_doctors')
@Index('idx_package_doctors_doctor_id', ['doctorId'])
export class PackageDoctor {
  @PrimaryColumn({ type: 'uuid' })
  packageId: string;

  @PrimaryColumn({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Package, (pkg) => pkg.doctors, { onDelete: 'CASCADE' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_package_doctors_package' })
  package?: Relation<Package>;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_package_doctors_doctor' })
  doctor?: Relation<Doctor>;
}
