import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  toPaginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { addDays } from '../../common/time/clinic-time.util.js';
import {
  addMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { OWNER_ONLY_CATEGORY_KEYS } from '../expenses/entities/expense-category.entity.js';
import { Expense, ExpenseStatus } from '../expenses/entities/expense.entity.js';
import { OutstandingService } from '../outstanding/outstanding.service.js';
import { VisitStatus } from '../visits/visit.enums.js';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from './billing.enums.js';
import type {
  AttentionDto,
  DailySummaryDto,
  MethodBreakdownDto,
  MoneyTotalsDto,
} from './dto/payment.dto.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { Payment } from './entities/payment.entity.js';
import { toInvoiceSummary } from './invoice.mapper.js';

// The expense `id` records a referral payout.
export const PAYOUT_EXPENSE = (id: string) =>
  `EXISTS (SELECT 1 FROM referral_payouts rp WHERE rp.expense_id = ${id})`;

// The expense `id` records a salary payment to one of the clinic's doctors.
export const SALARY_EXPENSE = (id: string) =>
  `EXISTS (SELECT 1 FROM doctor_salary_payments sp WHERE sp.expense_id = ${id})`;

// The expense `id` records a salary payment to one of the clinic's employees.
export const EMPLOYEE_SALARY_EXPENSE = (id: string) =>
  `EXISTS (SELECT 1 FROM employee_salary_payments esp WHERE esp.expense_id = ${id})`;

// The expense `id` is in a category only the OWNER sees (salaries, see
// OWNER_ONLY_CATEGORY_KEYS). The keys are constants, inlined as literals.
export const OWNER_ONLY_EXPENSE = (id: string) =>
  `EXISTS (SELECT 1 FROM expenses ox JOIN expense_categories oc ON oc.id = ox.category_id
            WHERE ox.id = ${id}
              AND oc.system_key IN (${OWNER_ONLY_CATEGORY_KEYS.map((k) => `'${k}'`).join(', ')}))`;

export interface DayRange {
  date: string;
  start: Date;
  end: Date;
}

interface MethodRow {
  method: PaymentMethod;
  count: string;
  total: string | null;
}

export function emptyBreakdown(): MethodBreakdownDto {
  return { CASH: ZERO, CARD: ZERO, WALLET: ZERO, INSTAPAY: ZERO };
}

// Aggregates rows grouped by method into { count, total, byMethod }.
export function totalsFromRows(rows: MethodRow[]): MoneyTotalsDto {
  const byMethod = emptyBreakdown();
  let count = 0;
  for (const row of rows) {
    byMethod[row.method] = toMoney(row.total ?? ZERO);
    count += Number(row.count);
  }
  return { count, total: addMoney(...Object.values(byMethod)), byMethod };
}

@Injectable()
export class BillingReportsService {
  private readonly overdueDays: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly time: ClinicTimeService,
    private readonly outstanding: OutstandingService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.overdueDays = config.get('BILLING_OVERDUE_DAYS', { infer: true });
  }

  /**
   * Invoices someone must look at: money held for a VOIDED visit (only
   * from before undo attend required unpaid invoices; all of them), and
   * balances left open since before (today - BILLING_OVERDUE_DAYS), one
   * page. Both oldest first; the invoice number breaks ties.
   */
  async attention(query: PaginationQueryDto): Promise<AttentionDto> {
    const toIso = (d: Date) => this.time.toIso(d);
    const base = () =>
      this.dataSource
        .getRepository(Invoice)
        .createQueryBuilder('invoice')
        .innerJoinAndSelect('invoice.patient', 'patient')
        .leftJoinAndSelect('invoice.issuedBy', 'issuedBy')
        .leftJoinAndSelect('invoice.cancelledBy', 'cancelledBy')
        .where('invoice.status <> :cancelled', {
          cancelled: InvoiceStatus.CANCELLED,
        })
        .orderBy('invoice.issuedAt', 'ASC')
        .addOrderBy('invoice.invoiceNumber', 'ASC');

    const voidedVisits = await base()
      .innerJoin('invoice.visit', 'visit')
      .andWhere('visit.status = :voided', { voided: VisitStatus.VOIDED })
      .andWhere('invoice.amountPaid > 0')
      .getMany();

    const cutoff = this.time.dayBounds(
      addDays(this.time.today(), -this.overdueDays),
    ).start;
    const [overdue, total] = await base()
      .andWhere('invoice.amountPaid < invoice.total')
      .andWhere('invoice.issuedAt < :cutoff', { cutoff })
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    return {
      ...toPaginated(
        overdue.map((i) => toInvoiceSummary(i, toIso)),
        total,
        query,
      ),
      overdueDays: this.overdueDays,
      voidedVisitsWithPayments: voidedVisits.map((i) =>
        toInvoiceSummary(i, toIso),
      ),
    };
  }

  /**
   * Cash-desk totals for one clinic local day (23/24/25 h with DST).
   * expectedCash = cash payments - cash refunds - cash expenses. A payout
   * to a referring doctor or a doctor's or employee's salary payment is an
   * expense, so it is in `expenses` (and so in expectedCash when paid in
   * cash) exactly once; `commissionPayouts`, `salaryPayments` and
   * `employeeSalaryPayments` show those parts.
   * `outstanding` is what was owed at the start and at the end of the day,
   * and what moved it (what the clinic owes: OWNER only). Salaries
   * (doctors' and employees') are the OWNER's only: for a receptionist they
   * are not in `expenses` nor `expectedCash`, and `salaryPayments` and
   * `employeeSalaryPayments` are null.
   */
  async dailySummary(
    date: string | undefined,
    actor: Actor,
  ): Promise<DailySummaryDto> {
    const today = this.time.today();
    const day = date ?? today;
    if (actor.role !== UserRole.OWNER && day !== today) {
      throw new ForbiddenException(
        "Receptionists can only see today's summary",
      );
    }
    const { start, end } = this.time.dayBounds(day);
    const range: DayRange = { date: day, start, end };
    const isOwner = actor.role === UserRole.OWNER;
    // Salaries (doctors' and employees') are the OWNER's only: anyone
    // else's totals (and expected cash) leave them out, so no figure gives
    // them away.
    const hidden = isOwner ? undefined : OWNER_ONLY_EXPENSE;

    const payments = await this.paymentTotals(PaymentType.PAYMENT, range);
    const refunds = await this.paymentTotals(PaymentType.REFUND, range);
    const expenses = await this.expenseTotals(range, undefined, hidden);
    const commissionPayouts = await this.expenseTotals(range, PAYOUT_EXPENSE);
    const salaryPayments = isOwner
      ? await this.expenseTotals(range, SALARY_EXPENSE)
      : null;
    const employeeSalaryPayments = isOwner
      ? await this.expenseTotals(range, EMPLOYEE_SALARY_EXPENSE)
      : null;

    return {
      date: day,
      from: this.time.toIso(start),
      to: this.time.toIso(end),
      payments,
      refunds,
      voided: await this.voidedTotals(range),
      discounts: await this.discountTotals(range),
      expenses,
      commissionPayouts,
      salaryPayments,
      employeeSalaryPayments,
      expectedCash: subMoney(
        subMoney(payments.byMethod.CASH, refunds.byMethod.CASH),
        expenses.byMethod.CASH,
      ),
      outstanding: await this.outstanding.flow(
        day,
        day,
        actor.role === UserRole.OWNER,
      ),
    };
  }

  // Valid expenses dated on that local day (or only those that `part`
  // matches: PAYOUT_EXPENSE, SALARY_EXPENSE, EMPLOYEE_SALARY_EXPENSE; never
  // those that `exclude` matches), by payment method.
  private async expenseTotals(
    range: DayRange,
    part?: (id: string) => string,
    exclude?: (id: string) => string,
  ): Promise<MoneyTotalsDto> {
    const qb = this.dataSource
      .getRepository(Expense)
      .createQueryBuilder('expense')
      .select('expense.paymentMethod', 'method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(expense.amount)', 'total')
      .where('expense.status = :valid', { valid: ExpenseStatus.VALID })
      .andWhere('expense.expenseDate = :date', { date: range.date })
      .groupBy('expense.paymentMethod');
    if (part) qb.andWhere(part('expense.id'));
    if (exclude) qb.andWhere(`NOT ${exclude('expense.id')}`);
    return totalsFromRows(await qb.getRawMany<MethodRow>());
  }

  private async paymentTotals(
    type: PaymentType,
    range: DayRange,
  ): Promise<MoneyTotalsDto> {
    const rows: MethodRow[] = await this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .select('payment.method', 'method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(payment.amount)', 'total')
      .where('payment.type = :type', { type })
      .andWhere('payment.status = :valid', { valid: PaymentStatus.VALID })
      .andWhere(
        'payment.receivedAt >= :start AND payment.receivedAt < :end',
        range,
      )
      .groupBy('payment.method')
      .getRawMany();
    return totalsFromRows(rows);
  }

  // Voided during the day (payments or refunds).
  private async voidedTotals(
    range: DayRange,
  ): Promise<{ count: number; amount: string }> {
    const row: { count: string; amount: string | null } | undefined =
      await this.dataSource
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .select('COUNT(*)', 'count')
        .addSelect('SUM(payment.amount)', 'amount')
        .where('payment.status = :voided', { voided: PaymentStatus.VOIDED })
        .andWhere(
          'payment.voidedAt >= :start AND payment.voidedAt < :end',
          range,
        )
        .getRawOne();
    return {
      count: Number(row?.count ?? 0),
      amount: toMoney(row?.amount ?? ZERO),
    };
  }

  // Discounts applied during the day and still in effect at its end, on
  // invoices not cancelled by then: removing or replacing a discount, or
  // cancelling its invoice, on a later day never changes this day.
  private async discountTotals(
    range: DayRange,
  ): Promise<DailySummaryDto['discounts']> {
    const rows: {
      userId: string;
      name: string;
      count: string;
      amount: string | null;
    }[] = await this.dataSource
      .getRepository(InvoiceDiscount)
      .createQueryBuilder('discount')
      .innerJoin('discount.invoice', 'invoice')
      .innerJoin('discount.appliedBy', 'user')
      .select('user.id', 'userId')
      .addSelect('user.name', 'name')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(discount.amount)', 'amount')
      .where('(discount.removedAt IS NULL OR discount.removedAt >= :end)', {
        end: range.end,
      })
      .andWhere(
        '(invoice.status <> :cancelled OR invoice.cancelledAt >= :end)',
        { cancelled: InvoiceStatus.CANCELLED, end: range.end },
      )
      .andWhere(
        'discount.appliedAt >= :start AND discount.appliedAt < :end',
        range,
      )
      .groupBy('user.id')
      .addGroupBy('user.name')
      .orderBy('user.name', 'ASC')
      .getRawMany();
    const byUser = rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      count: Number(row.count),
      amount: toMoney(row.amount ?? ZERO),
    }));
    return {
      count: byUser.reduce((sum, u) => sum + u.count, 0),
      amount: addMoney(ZERO, ...byUser.map((u) => u.amount)),
      byUser,
    };
  }
}
