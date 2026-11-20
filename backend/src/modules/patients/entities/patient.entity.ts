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
export const PATIENT_CODE_UNIQUE = 'uq_patients_patient_code';
export const PATIENT_NATIONAL_ID_UNIQUE = 'uq_patients_national_id';
export const PATIENT_PASSPORT_UNIQUE = 'uq_patients_passport_number';

// SQL function (migration ArabicSearchAndLanguage) that folds a name for
// search: Arabic diacritics and tatweel removed, أ/إ/آ/ٱ -> ا, ى -> ي,
// ة -> ه, lowercased. Only for comparison; names are stored as entered.
export const PATIENT_NAME_SEARCH_KEY = 'patient_name_search_key';

// Patients never log in. The phone number (E.164) identifies them at the
// desk; the identity document (Egyptian National ID, or a passport for a
// non-Egyptian) is collected before their first visit, and with it the
// clinic code (RH...). Each of the four is unique.
@Entity('patients')
@Unique(PATIENT_PHONE_UNIQUE, ['phone'])
@Unique(PATIENT_CODE_UNIQUE, ['patientCode'])
@Unique(PATIENT_NATIONAL_ID_UNIQUE, ['nationalId'])
@Unique(PATIENT_PASSPORT_UNIQUE, ['passportNumber'])
@Check(
  'chk_patients_national_id',
  `national_id IS NULL OR national_id ~ '^[23][0-9]{13}$'`,
)
@Check(
  'chk_patients_passport_number',
  `passport_number IS NULL OR passport_number ~ '^[A-Z0-9]{5,20}$'`,
)
@Check(
  'chk_patients_one_id_document',
  'national_id IS NULL OR passport_number IS NULL',
)
@Check(
  'chk_patients_patient_code',
  `patient_code IS NULL OR patient_code ~ '^RH[0-9]{8}$'`,
)
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

  // RH + the National ID's first 4 digits (0000 for a passport) + a 4-digit
  // sequence per those digits. Assigned once, when the identity document is
  // first recorded, and never changed (even if the document is corrected).
  @Column({ type: 'varchar', length: 10, nullable: true })
  patientCode: string | null;

  // Egyptian National ID, 14 digits. At most one of nationalId and
  // passportNumber.
  @Column({ type: 'varchar', length: 14, nullable: true })
  nationalId: string | null;

  // Non-Egyptians: passport number (upper case, letters and digits).
  @Column({ type: 'varchar', length: 20, nullable: true })
  passportNumber: string | null;

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
