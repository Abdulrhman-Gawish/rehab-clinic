import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Gender } from '../../../common/enums/gender.enum.js';
import { User } from '../../users/entities/user.entity.js';

export enum PatientSource {
  ONLINE = 'ONLINE',
  RECEPTION = 'RECEPTION',
}

export const PATIENT_PHONE_UNIQUE = 'uq_patients_phone';

// Patients never log in. The phone number (E.164) is their only identity and
// the only unique business key.
@Entity('patients')
@Unique(PATIENT_PHONE_UNIQUE, ['phone'])
// GIN trigram index on name, written by hand in the migration.
@Index('idx_patients_name_trgm', { synchronize: false })
@Check(
  'chk_patients_created_source',
  `created_source IN ('ONLINE', 'RECEPTION')`,
)
@Check('chk_patients_gender', `gender IS NULL OR gender IN ('MALE', 'FEMALE')`)
export class Patient extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  // 'YYYY-MM-DD'
  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  gender: Gender | null;

  // Administrative notes only. Medical information does NOT belong here.
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 16 })
  createdSource: PatientSource;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_patients_created_by',
  })
  createdBy?: User | null;
}
