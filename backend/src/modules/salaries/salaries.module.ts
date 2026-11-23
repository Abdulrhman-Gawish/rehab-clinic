import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { EmployeeSalariesService } from './employee-salaries.service.js';
import {
  EmployeeSalariesController,
  EmployeesController,
} from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { DoctorSalaryPayment } from './entities/doctor-salary-payment.entity.js';
import { DoctorSalaryServiceRate } from './entities/doctor-salary-service-rate.entity.js';
import { DoctorSalaryTerms } from './entities/doctor-salary-terms.entity.js';
import { EmployeeSalaryPayment } from './entities/employee-salary-payment.entity.js';
import { EmployeeSalaryTerms } from './entities/employee-salary-terms.entity.js';
import { Employee } from './entities/employee.entity.js';
import { SalariesController } from './salaries.controller.js';
import { SalariesService } from './salaries.service.js';

/**
 * Salaries (OWNER only). The clinic's own doctors: versioned terms (fixed
 * salary + commission per session or per service), monthly statements
 * computed from attended sessions. Its employees (receptionists, office
 * boys...; a login is optional): a versioned fixed monthly salary. Every
 * payment of either is recorded as an expense.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DoctorSalaryTerms,
      DoctorSalaryServiceRate,
      DoctorSalaryPayment,
      Employee,
      EmployeeSalaryTerms,
      EmployeeSalaryPayment,
    ]),
    ExpensesModule,
  ],
  controllers: [
    SalariesController,
    EmployeesController,
    EmployeeSalariesController,
  ],
  providers: [SalariesService, EmployeesService, EmployeeSalariesService],
})
export class SalariesModule {}
