import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThanOrEqual } from 'typeorm';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  addMoney,
  isZeroMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentStatus } from '../billing/billing.enums.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import type {
  EmployeeSalaryOverviewRowDto,
  EmployeeSalaryPaymentDto,
  EmployeeSalaryStatementDto,
  EmployeeSalaryTermsDto,
  SetEmployeeSalaryDto,
} from './dto/employees.dto.js';
import type { RecordSalaryPaymentDto } from './dto/salaries.dto.js';
import { EmployeeSalaryPayment } from './entities/employee-salary-payment.entity.js';
import { EmployeeSalaryTerms } from './entities/employee-salary-terms.entity.js';
import { Employee } from './entities/employee.entity.js';
import { termsForMonth } from './salary-math.js';

const TERMS_RELATIONS = { setBy: true };
const PAYMENT_RELATIONS = {
  employee: true,
  expense: true,
  paidBy: true,
  voidedBy: true,
};

/**
 * Employees' fixed monthly salaries (OWNER only), with the rules of the
 * doctors' salaries minus the commission: versions by month, a statement
 * computed live (the month's salary, its payments, what remains), and
 * payments (advances and parts allowed) that are clinic expenses.
 */
@Injectable()
export class EmployeeSalariesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly expenses: ExpensesService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Salary versions ----------

  // Every version, newest first.
  async listTerms(employeeId: string): Promise<EmployeeSalaryTermsDto[]> {
    await this.employee(employeeId);
    const versions = await this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .find({
        where: { employeeId },
        relations: TERMS_RELATIONS,
        order: { effectiveMonth: 'DESC' },
      });
    return versions.map((v) => this.toTerms(v));
  }

  async setSalary(
    employeeId: string,
    dto: SetEmployeeSalaryDto,
    actor: Actor,
  ): Promise<EmployeeSalaryTermsDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      // Serializes salary changes and payments of the employee.
      await this.employee(employeeId, manager, true);
      return this.writeSalary(manager, employeeId, dto, actor);
    });
    const saved = await this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .findOneOrFail({ where: { id }, relations: TERMS_RELATIONS });
    return this.toTerms(saved);
  }

  /**
   * A salary version from `dto.effectiveMonth` on, in the caller's
   * transaction (the employee row locked or just created). The version of
   * the same month is replaced; a month that has a valid payment (or a
   * later one) is refused. Returns the new version's id.
   */
  async writeSalary(
    manager: EntityManager,
    employeeId: string,
    dto: SetEmployeeSalaryDto,
    actor: Actor,
  ): Promise<string> {
    const paid = await manager.findOne(EmployeeSalaryPayment, {
      where: {
        employeeId,
        status: PaymentStatus.VALID,
        month: MoreThanOrEqual(dto.effectiveMonth),
      },
      order: { month: 'DESC' },
    });
    if (paid) {
      throw unprocessable(
        ErrorCode.SALARY_MONTH_PAID,
        `${paid.month} already has a salary payment: a new salary can start after it`,
        { paidMonth: paid.month },
      );
    }
    const old = await manager.findOneBy(EmployeeSalaryTerms, {
      employeeId,
      effectiveMonth: dto.effectiveMonth,
    });
    if (old) await manager.delete(EmployeeSalaryTerms, { id: old.id });
    const termsId = randomUUID();
    const fixedSalary = toMoney(dto.fixedSalary);
    await manager.insert(EmployeeSalaryTerms, {
      id: termsId,
      employeeId,
      effectiveMonth: dto.effectiveMonth,
      fixedSalary,
      setById: actor.userId as string,
    });
    await this.auditService.logAction(
      actor,
      AuditAction.EMPLOYEE_SALARY_SET,
      AuditEntityType.EMPLOYEE_SALARY_TERMS,
      termsId,
      {
        oldValues: old
          ? {
              effectiveMonth: old.effectiveMonth,
              fixedSalary: toMoney(old.fixedSalary),
            }
          : undefined,
        newValues: {
          employeeId,
          effectiveMonth: dto.effectiveMonth,
          fixedSalary,
        },
      },
      manager,
    );
    return termsId;
  }

  // ---------- Statement ----------

  async statement(
    employeeId: string,
    month: string,
  ): Promise<EmployeeSalaryStatementDto> {
    const employee = await this.employee(employeeId);
    const versions = await this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .find({ where: { employeeId }, relations: TERMS_RELATIONS });
    const terms = termsForMonth(versions, month);
    const payments = await this.dataSource
      .getRepository(EmployeeSalaryPayment)
      .find({
        where: { employeeId, month },
        relations: PAYMENT_RELATIONS,
        order: { paymentDate: 'DESC', paidAt: 'DESC' },
      });
    const fixedSalary = terms ? toMoney(terms.fixedSalary) : ZERO;
    const paid = this.validTotal(payments);
    return {
      employee: this.ref(employee),
      month,
      terms: terms ? this.toTerms(terms) : null,
      fixedSalary,
      paid,
      remaining: subMoney(fixedSalary, paid),
      payments: payments.map((p) => this.toPayment(p)),
    };
  }

  /**
   * Every active employee, and every inactive one with a salary or a
   * payment that month, with the month's totals (the statement's numbers).
   */
  async overview(month: string): Promise<EmployeeSalaryOverviewRowDto[]> {
    const employees = await this.dataSource
      .getRepository(Employee)
      .find({ order: { name: 'ASC', id: 'ASC' } });
    if (employees.length === 0) return [];
    const versions = await this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .find();
    const payments = await this.dataSource
      .getRepository(EmployeeSalaryPayment)
      .find({ where: { month } });
    const rows: EmployeeSalaryOverviewRowDto[] = [];
    for (const employee of employees) {
      const terms = termsForMonth(
        versions.filter((v) => v.employeeId === employee.id),
        month,
      );
      const fixedSalary = terms ? toMoney(terms.fixedSalary) : ZERO;
      const own = payments.filter((p) => p.employeeId === employee.id);
      if (!employee.isActive && isZeroMoney(fixedSalary) && own.length === 0) {
        continue;
      }
      const paid = this.validTotal(own);
      rows.push({
        employee: this.ref(employee),
        isActive: employee.isActive,
        hasTerms: terms !== null,
        fixedSalary,
        paid,
        remaining: subMoney(fixedSalary, paid),
      });
    }
    return rows;
  }

  // ---------- Payments ----------

  async recordPayment(
    employeeId: string,
    dto: RecordSalaryPaymentDto,
    actor: Actor,
  ): Promise<EmployeeSalaryPaymentDto> {
    const thisMonth = this.time.today().slice(0, 7);
    if (dto.month > thisMonth) {
      throw unprocessable(
        ErrorCode.DATE_OUT_OF_RANGE,
        `month must be ${thisMonth} or earlier`,
        { to: thisMonth },
      );
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const employee = await this.employee(employeeId, manager, true);
      const paymentId = randomUUID();
      const paymentDate = dto.paymentDate ?? this.time.today();
      const reference = dto.reference ?? null;
      const amount = toMoney(dto.amount);
      const expense = await this.expenses.createForEmployeeSalaryPayment(
        manager,
        {
          salaryPaymentId: paymentId,
          employeeName: employee.name,
          month: dto.month,
          amount,
          date: paymentDate,
          method: dto.method,
          reference,
        },
        actor,
      );
      await manager.insert(EmployeeSalaryPayment, {
        id: paymentId,
        employeeId,
        month: dto.month,
        amount,
        paymentDate,
        method: dto.method,
        expenseId: expense.id,
        reference,
        notes: dto.notes ?? null,
        status: PaymentStatus.VALID,
        paidById: actor.userId as string,
        paidAt: this.time.now(),
        voidedAt: null,
        voidedById: null,
        voidReason: null,
      });
      await this.auditService.logAction(
        actor,
        AuditAction.EMPLOYEE_SALARY_PAID,
        AuditEntityType.EMPLOYEE_SALARY_PAYMENT,
        paymentId,
        {
          newValues: {
            employeeId,
            month: dto.month,
            amount,
            paymentDate,
            method: dto.method,
            reference,
            notes: dto.notes ?? null,
            expenseId: expense.id,
            expenseNumber: expense.expenseNumber,
          },
        },
        manager,
      );
      return paymentId;
    });
    return this.payment(id);
  }

  // A payment recorded by mistake: it no longer counts, and its expense is
  // voided with it.
  async voidPayment(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<EmployeeSalaryPaymentDto> {
    await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOneBy(EmployeeSalaryPayment, { id });
      if (!found) throw new NotFoundException('Salary payment not found');
      await this.employee(found.employeeId, manager, true);
      const payment = await manager.findOneOrFail(EmployeeSalaryPayment, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (payment.status === PaymentStatus.VOIDED) {
        throw unprocessable(
          ErrorCode.PAYOUT_VOIDED,
          'The payment is already voided',
        );
      }
      payment.status = PaymentStatus.VOIDED;
      payment.voidedAt = this.time.now();
      payment.voidedById = actor.userId;
      payment.voidReason = reason;
      await manager.getRepository(EmployeeSalaryPayment).save(payment);
      await this.expenses.voidForPayout(
        manager,
        payment.expenseId,
        reason,
        actor,
      );
      await this.auditService.logAction(
        actor,
        AuditAction.EMPLOYEE_SALARY_PAYMENT_VOIDED,
        AuditEntityType.EMPLOYEE_SALARY_PAYMENT,
        id,
        {
          oldValues: { status: PaymentStatus.VALID },
          newValues: {
            status: payment.status,
            reason,
            expenseId: payment.expenseId,
          },
        },
        manager,
      );
    });
    return this.payment(id);
  }

  // ---------- Internals ----------

  private async employee(
    id: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<Employee> {
    const m = manager ?? this.dataSource.manager;
    const employee = await m.findOne(Employee, {
      where: { id },
      ...(lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async payment(id: string): Promise<EmployeeSalaryPaymentDto> {
    const payment = await this.dataSource
      .getRepository(EmployeeSalaryPayment)
      .findOne({ where: { id }, relations: PAYMENT_RELATIONS });
    if (!payment) throw new NotFoundException('Salary payment not found');
    return this.toPayment(payment);
  }

  private validTotal(payments: EmployeeSalaryPayment[]): string {
    return addMoney(
      ZERO,
      ...payments
        .filter((p) => p.status === PaymentStatus.VALID)
        .map((p) => p.amount),
    );
  }

  private ref(e: Employee) {
    return { id: e.id, name: e.name, jobTitle: e.jobTitle };
  }

  private toTerms(t: EmployeeSalaryTerms): EmployeeSalaryTermsDto {
    return {
      id: t.id,
      effectiveMonth: t.effectiveMonth,
      fixedSalary: toMoney(t.fixedSalary),
      setBy: UserRefDto.fromEntity(t.setBy),
      setAt: this.time.toIso(t.createdAt),
    };
  }

  private toPayment(p: EmployeeSalaryPayment): EmployeeSalaryPaymentDto {
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      id: p.id,
      employee: {
        id: p.employeeId,
        name: p.employee?.name ?? '',
        jobTitle: p.employee?.jobTitle ?? '',
      },
      month: p.month,
      amount: toMoney(p.amount),
      paymentDate: p.paymentDate,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      status: p.status,
      expense: {
        id: p.expenseId,
        expenseNumber: p.expense?.expenseNumber ?? '',
      },
      paidBy: UserRefDto.fromEntity(p.paidBy),
      paidAt: toIso(p.paidAt),
      voidedAt: p.voidedAt ? toIso(p.voidedAt) : null,
      voidedBy: UserRefDto.fromNullable(p.voidedBy),
      voidReason: p.voidReason,
    };
  }
}
