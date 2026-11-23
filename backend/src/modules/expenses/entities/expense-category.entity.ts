import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

export const EXPENSE_CATEGORY_NAME_UNIQUE = 'uq_expense_categories_name';

// Categories the system writes to. Their expenses only come from the
// system (never typed by hand), and they can't be deactivated.
export enum ExpenseCategoryKey {
  // Payouts to referring doctors (one expense per payout).
  REFERRAL_COMMISSION = 'REFERRAL_COMMISSION',
  // Salary payments to the clinic's doctors (one expense per payment).
  DOCTOR_SALARY = 'DOCTOR_SALARY',
  // Salary payments to the clinic's employees (one expense per payment).
  EMPLOYEE_SALARY = 'EMPLOYEE_SALARY',
}

// Categories only the OWNER sees, with their expenses: salaries (doctors'
// and employees'). For every other role they don't exist (not listed, not
// in any total, 404).
export const OWNER_ONLY_CATEGORY_KEYS: readonly ExpenseCategoryKey[] = [
  ExpenseCategoryKey.DOCTOR_SALARY,
  ExpenseCategoryKey.EMPLOYEE_SALARY,
];

export const isOwnerOnlyCategory = (key: ExpenseCategoryKey | null) =>
  key !== null && OWNER_ONLY_CATEGORY_KEYS.includes(key);

// Created by the migration (and on demand, for a database emptied by tests).
export const SYSTEM_CATEGORY_NAMES: Record<ExpenseCategoryKey, string> = {
  [ExpenseCategoryKey.REFERRAL_COMMISSION]: 'عمولات الأطباء المحيلين',
  [ExpenseCategoryKey.DOCTOR_SALARY]: 'رواتب وعمولات الأطباء',
  [ExpenseCategoryKey.EMPLOYEE_SALARY]: 'رواتب الموظفين',
};

// What the clinic spends on (hospitality, supplies...). Seeded by migration.
@Entity('expense_categories')
@Unique(EXPENSE_CATEGORY_NAME_UNIQUE, ['name'])
@Index('uq_expense_categories_system_key', ['systemKey'], { unique: true })
export class ExpenseCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // Set on system categories only; the name can still be changed.
  @Column({
    type: 'enum',
    enum: ExpenseCategoryKey,
    enumName: 'expense_category_key',
    nullable: true,
  })
  systemKey: ExpenseCategoryKey | null;
}
