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
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { SalaryCommissionMode, SalaryRateType } from '../salaries.enums.js';
import { DoctorSalaryServiceRate } from './doctor-salary-service-rate.entity.js';

export const SALARY_TERMS_DOCTOR_MONTH_UNIQUE =
  'uq_doctor_salary_terms_doctor_month';

/**
 * One version of a doctor's pay (OWNER only): a monthly fixed salary (0 for
 * commission only) and how sessions earn commission. A version applies from
 * its month until the next version, so past months keep the terms they had.
 * A month that already has a valid salary payment (or any later month) can
 * no longer get new terms.
 */
@Entity('doctor_salary_terms')
@Unique(SALARY_TERMS_DOCTOR_MONTH_UNIQUE, ['doctorId', 'effectiveMonth'])
@Check(
  'chk_doctor_salary_terms_month',
  `"effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
)
@Check('chk_doctor_salary_terms_fixed', '"fixed_salary" >= 0')
@Check(
  'chk_doctor_salary_terms_session_rate',
  `("commission_mode" = 'PER_SESSION' AND "session_rate_type" IS NOT NULL AND "session_rate_value" IS NOT NULL)
   OR ("commission_mode" <> 'PER_SESSION' AND "session_rate_type" IS NULL AND "session_rate_value" IS NULL)`,
)
export class DoctorSalaryTerms extends BaseEntity {
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_doctor_salary_terms_doctor' })
  doctor?: Relation<Doctor>;

  // 'YYYY-MM': the first month these terms apply to.
  @Column({ type: 'varchar', length: 7 })
  effectiveMonth: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  fixedSalary: string;

  @Column({
    type: 'enum',
    enum: SalaryCommissionMode,
    enumName: 'salary_commission_mode',
  })
  commissionMode: SalaryCommissionMode;

  // PER_SESSION only.
  @Column({
    type: 'enum',
    enum: SalaryRateType,
    enumName: 'salary_rate_type',
    nullable: true,
  })
  sessionRateType: SalaryRateType | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  sessionRateValue: string | null;

  // PER_SERVICE only.
  @OneToMany(() => DoctorSalaryServiceRate, (rate) => rate.terms)
  serviceRates?: Relation<DoctorSalaryServiceRate>[];

  @Column({ type: 'uuid', name: 'set_by' })
  setById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'set_by',
    foreignKeyConstraintName: 'fk_doctor_salary_terms_set_by',
  })
  setBy?: Relation<User>;
}
