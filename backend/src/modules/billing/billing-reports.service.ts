import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { Expense, ExpenseStatus } from '../expenses/entities/expense.entity.js';
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
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.overdueDays = config.get('BILLING_OVERDUE_DAYS', { infer: true });
  }

  /**
   * Invoices someone must look at: money held for a VOIDED visit (only
   * from before undo attend required unpaid invoices), and
   * balances left open since before (today - BILLING_OVERDUE_DAYS).
   */
  async attention(): Promise<AttentionDto> {
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
        .orderBy('invoice.issuedAt', 'ASC');

    const voidedVisits = await base()
      .innerJoin('invoice.visit', 'visit')
      .andWhere('visit.status = :voided', { voided: VisitStatus.VOIDED })
      .andWhere('invoice.amountPaid > 0')
      .getMany();

    const cutoff = this.time.dayBounds(
      addDays(this.time.today(), -this.overdueDays),
    ).start;
    const overdue = await base()
      .andWhere('invoice.amountPaid < invoice.total')
      .andWhere('invoice.issuedAt < :cutoff', { cutoff })
      .getMany();

    return {
      overdueDays: this.overdueDays,
      voidedVisitsWithPayments: voidedVisits.map((i) =>
        toInvoiceSummary(i, toIso),
      ),
      overdue: overdue.map((i) => toInvoiceSummary(i, toIso)),
    };
  }

  /**
   * Cash-desk totals for one clinic local day (23/24/25 h with DST).
   * expectedCash = cash payments - cash refunds - cash expenses.
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

    const payments = await this.paymentTotals(PaymentType.PAYMENT, range);
    const refunds = await this.paymentTotals(PaymentType.REFUND, range);
    const expenses = await this.expenseTotals(range);

    return {
      date: day,
      from: this.time.toIso(start),
      to: this.time.toIso(end),
      payments,
      refunds,
      voided: await this.voidedTotals(range),
      discounts: await this.discountTotals(range),
      expenses,
      expectedCash: subMoney(
        subMoney(payments.byMethod.CASH, refunds.byMethod.CASH),
        expenses.byMethod.CASH,
      ),
    };
  }

  // Valid expenses dated on that local day, by payment method.
  private async expenseTotals(range: DayRange): Promise<MoneyTotalsDto> {
    const rows: MethodRow[] = await this.dataSource
      .getRepository(Expense)
      .createQueryBuilder('expense')
      .select('expense.paymentMethod', 'method')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(expense.amount)', 'total')
      .where('expense.status = :valid', { valid: ExpenseStatus.VALID })
      .andWhere('expense.expenseDate = :date', { date: range.date })
      .groupBy('expense.paymentMethod')
      .getRawMany();
    return totalsFromRows(rows);
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

  // Discounts applied during the day that are still active, on live invoices.
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
      .where('discount.removedAt IS NULL')
      .andWhere('invoice.status <> :cancelled', {
        cancelled: InvoiceStatus.CANCELLED,
      })
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
