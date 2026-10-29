import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

export const EXPENSE_CATEGORY_NAME_UNIQUE = 'uq_expense_categories_name';

// What the clinic spends on (hospitality, supplies...). Seeded by migration.
@Entity('expense_categories')
@Unique(EXPENSE_CATEGORY_NAME_UNIQUE, ['name'])
export class ExpenseCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
