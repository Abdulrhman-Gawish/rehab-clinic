import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

export const EXPENSE_CATEGORY_NAME_UNIQUE = 'uq_expense_categories_name';

// Categories the system writes to. Their expenses only come from the
// system (never typed by hand), and they can't be deactivated.
export enum ExpenseCategoryKey {
  // Payouts to referring doctors (one expense per payout).
  REFERRAL_COMMISSION = 'REFERRAL_COMMISSION',
}

// Created by the migration (and on demand, for a database emptied by tests).
export const SYSTEM_CATEGORY_NAMES: Record<ExpenseCategoryKey, string> = {
  [ExpenseCategoryKey.REFERRAL_COMMISSION]: 'عمولات الأطباء المحيلين',
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
