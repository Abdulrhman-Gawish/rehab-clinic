import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../../common/storage/file-storage.service.js';
import { DocumentCounterModule } from '../billing/document-counter.module.js';
import { ExpenseCategory } from './entities/expense-category.entity.js';
import { Expense } from './entities/expense.entity.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import {
  ExpenseCategoriesController,
  ExpensesController,
} from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

// Exports ExpensesService for referral payouts: each payout writes (and a
// void voids) its expense in the payout's transaction.
@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, ExpenseCategory]),
    DocumentCounterModule,
  ],
  controllers: [ExpensesController, ExpenseCategoriesController],
  providers: [ExpensesService, ExpenseCategoriesService, FileStorage],
  exports: [ExpensesService],
})
export class ExpensesModule {}
