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

// SQL function (migration ArabicSearchAndLanguage) that folds a name for
// search: Arabic diacritics and tatweel removed, أ/إ/آ/ٱ -> ا, ى -> ي,
// ة -> ه, lowercased. Only for comparison; names are stored as entered.
export const PATIENT_NAME_SEARCH_KEY = 'patient_name_search_key';

// Patients never log in. The phone number (E.164) is their only identity and
// the only unique business key.
@Entity('patients')
@Unique(PATIENT_PHONE_UNIQUE, ['phone'])
// GIN trigram index on patient_name_search_key(name), written by hand in the
// migration.
@Index('idx_patients_name_search_trgm', { synchronize: false })
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
