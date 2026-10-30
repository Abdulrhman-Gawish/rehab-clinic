import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../../common/storage/file-storage.service.js';
import { BillingModule } from '../billing/billing.module.js';
import { ExpenseCategory } from './entities/expense-category.entity.js';
import { Expense } from './entities/expense.entity.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import {
  ExpenseCategoriesController,
  ExpensesController,
} from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, ExpenseCategory]),
    BillingModule,
  ],
  controllers: [ExpensesController, ExpenseCategoriesController],
  providers: [ExpensesService, ExpenseCategoriesService, FileStorage],
})
export class ExpensesModule {}
