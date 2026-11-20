import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { DoctorSalaryPayment } from './entities/doctor-salary-payment.entity.js';
import { DoctorSalaryServiceRate } from './entities/doctor-salary-service-rate.entity.js';
import { DoctorSalaryTerms } from './entities/doctor-salary-terms.entity.js';
import { SalariesController } from './salaries.controller.js';
import { SalariesService } from './salaries.service.js';

/**
 * Salaries of the clinic's own doctors (OWNER only): versioned terms (fixed
 * salary + commission per session or per service), monthly statements
 * computed from attended sessions, and payments recorded as expenses.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DoctorSalaryTerms,
      DoctorSalaryServiceRate,
      DoctorSalaryPayment,
    ]),
    ExpensesModule,
  ],
  controllers: [SalariesController],
  providers: [SalariesService],
})
export class SalariesModule {}
