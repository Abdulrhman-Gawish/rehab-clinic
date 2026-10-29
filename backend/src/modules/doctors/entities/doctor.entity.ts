import {
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
@Entity('doctors')
@Unique('uq_doctors_user_id', ['userId'])
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

  @OneToMany(() => DoctorClinicService, (assignment) => assignment.doctor)
  services?: Relation<DoctorClinicService>[];
}
