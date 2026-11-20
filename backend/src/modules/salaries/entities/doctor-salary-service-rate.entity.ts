import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { ClinicService } from '../../clinic-services/entities/clinic-service.entity.js';
import { SalaryRateType } from '../salaries.enums.js';
import { DoctorSalaryTerms } from './doctor-salary-terms.entity.js';

// The commission of one service in a PER_SERVICE terms version.
@Entity('doctor_salary_service_rates')
@Unique('uq_doctor_salary_service_rates_terms_service', [
  'termsId',
  'serviceId',
])
@Check('chk_doctor_salary_service_rates_value', '"value" >= 0')
export class DoctorSalaryServiceRate extends BaseEntity {
  @Column({ type: 'uuid' })
  termsId: string;

  @ManyToOne(() => DoctorSalaryTerms, (terms) => terms.serviceRates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_doctor_salary_service_rates_terms',
  })
  terms?: Relation<DoctorSalaryTerms>;

  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => ClinicService, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_doctor_salary_service_rates_service',
  })
  service?: Relation<ClinicService>;

  @Column({ type: 'enum', enum: SalaryRateType, enumName: 'salary_rate_type' })
  rateType: SalaryRateType;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  value: string;
}
