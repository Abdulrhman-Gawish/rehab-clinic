import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { Doctor } from './doctor.entity.js';

// Which services a doctor offers, with an optional doctor-specific price.
@Entity('doctor_services')
@Index('idx_doctor_services_service_id', ['serviceId'])
@Check(
  'chk_doctor_services_price_override_non_negative',
  'price_override IS NULL OR price_override >= 0',
)
export class DoctorClinicService {
  @PrimaryColumn({ type: 'uuid' })
  doctorId: string;

  @PrimaryColumn({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => Doctor, (doctor) => doctor.services, { onDelete: 'CASCADE' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_services_doctor' })
  doctor?: Relation<Doctor>;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_services_service' })
  service?: Relation<ClinicService>;

  // null = use the service's base price.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  priceOverride: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
