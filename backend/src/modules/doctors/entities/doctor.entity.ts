import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { DoctorClinicService } from './doctor-clinic-service.entity.js';

// Doctor profile. Login data (name, email, phone, password) lives in the
// linked users row (role DOCTOR); both are created in one transaction.
// is_active hides the doctor for a while; deleted_at removes them for good
// (the row stays: appointments, visits and invoices point at it).
@Entity('doctors')
@Unique('uq_doctors_user_id', ['userId'])
@Check(
  'chk_doctors_deleted_inactive',
  '"deleted_at" IS NULL OR "is_active" = false',
)
export class Doctor extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  // One-to-one in practice: enforced by uq_doctors_user_id.
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctors_user' })
  user: Relation<User>;

  @Column({ type: 'varchar', length: 120 })
  specialty: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  photoUrl: string | null;

  // Shown on the public website.
  @Column({ type: 'boolean', default: true })
  isPublic: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => DoctorClinicService, (assignment) => assignment.doctor)
  services?: Relation<DoctorClinicService>[];
}
