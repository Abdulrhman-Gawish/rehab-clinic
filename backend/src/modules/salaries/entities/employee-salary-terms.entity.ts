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
import { User } from '../../users/entities/user.entity.js';
import { Employee } from './employee.entity.js';

export const EMPLOYEE_SALARY_TERMS_MONTH_UNIQUE =
  'uq_employee_salary_terms_employee_month';

/**
 * One version of an employee's fixed monthly salary (OWNER only), like a
 * doctor's terms without commission: it applies from its month until the
 * next version, so past months keep the salary they had. 0 = not paid from
 * that month (e.g. the employee left). A month that already has a valid
 * salary payment (or any later month) can no longer get a new version.
 */
@Entity('employee_salary_terms')
@Unique(EMPLOYEE_SALARY_TERMS_MONTH_UNIQUE, ['employeeId', 'effectiveMonth'])
@Check(
  'chk_employee_salary_terms_month',
  `"effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
)
@Check('chk_employee_salary_terms_fixed', '"fixed_salary" >= 0')
export class EmployeeSalaryTerms extends BaseEntity {
  @Column({ type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_employee_salary_terms_employee' })
  employee?: Relation<Employee>;

  // 'YYYY-MM': the first month this salary applies to.
  @Column({ type: 'varchar', length: 7 })
  effectiveMonth: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  fixedSalary: string;

  @Column({ type: 'uuid', name: 'set_by' })
  setById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'set_by',
    foreignKeyConstraintName: 'fk_employee_salary_terms_set_by',
  })
  setBy?: Relation<User>;
}
