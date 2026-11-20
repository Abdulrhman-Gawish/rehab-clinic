import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { toPaginated } from '../../common/dto/pagination.dto.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  addMoney,
  compareMoney,
  percentageOfBase,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import {
  PAYOUT_EXPENSE,
  SALARY_EXPENSE,
  totalsFromRows,
} from '../billing/billing-reports.service.js';
import type { PaymentMethod } from '../billing/billing.enums.js';
import {
  DISCOUNT_ACTIVE_AT,
  NOT_CANCELLED_AT,
  TOTAL_AT,
} from '../outstanding/as-of.sql.js';
import { OutstandingService } from '../outstanding/outstanding.service.js';
import type {
  AttendanceCountsDto,
  AttendanceQueryDto,
  AttendanceReportDto,
  CountTotalDto,
  DiscountsReportDto,
  ExpensesReportDto,
  MoneyFlowReportDto,
  ReportRangeDto,
  ReportRangeQueryDto,
  RevenueQueryDto,
  RevenueReportDto,
  RevenueRowDto,
  SummaryReportDto,
  TransactionListDto,
  TransactionsQueryDto,
} from './dto/reports.dto.js';
import {
  ExpenseOrigin,
  RevenueGroupBy,
  TransactionKind,
} from './reports.enums.js';

// [$1, $2) instants of the local range, plus the local dates for
// date columns (expense_date).
interface Range extends ReportRangeDto {
  start: Date;
  end: Date;
}

const NO_VISIT_LABEL = 'Manual invoices (no visit)';

// Doctor and service of an invoice's visit (LEFT: manual invoices have none).
const VISIT_JOINS = `LEFT JOIN doctors d ON d.id = v.doctor_id
  LEFT JOIN users du ON du.id = d.user_id
  LEFT JOIN clinic_services s ON s.id = v.service_id`;

interface GroupRow {
  key: string | null;
  label: string | null;
  value: string;
}

interface AttendanceRow {
  doctor_id: string;
  doctor_name: string;
  booked: string;
  attended: string;
  no_show: string;
  cancelled: string;
  online: string;
  reception: string;
  walk_ins: string;
}

function noShowRate(attended: number, noShow: number): string | null {
  const due = attended + noShow;
  return due === 0
    ? null
    : toMoney(percentageOfBase(String(noShow), String(due)));
}

/**
 * OWNER reports over a range of clinic local dates (inclusive). Money is
 * what was actually collected: valid payments minus valid refunds (voided
 * rows never count). Definitions of every number are in the README.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly time: ClinicTimeService,
    private readonly outstanding: OutstandingService,
  ) {}

  /**
   * Money totals of the range, and the outstanding balances at the end of
   * `to` (the same numbers as the daily summary of `to`).
   */
  async summary(query: ReportRangeQueryDto): Promise<SummaryReportDto> {
    const range = this.range(query);
    const [row]: Record<string, string>[] = await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE type = 'PAYMENT' AND status = 'VALID' AND received_at >= $1 AND received_at < $2) AS collected,
         (SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE type = 'REFUND' AND status = 'VALID' AND received_at >= $1 AND received_at < $2) AS refunded,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses
           WHERE status = 'VALID' AND expense_date BETWEEN $3 AND $4) AS expenses,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses e
           WHERE e.status = 'VALID' AND e.expense_date BETWEEN $3 AND $4
             AND ${PAYOUT_EXPENSE('e.id')}) AS commission_payouts,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses e
           WHERE e.status = 'VALID' AND e.expense_date BETWEEN $3 AND $4
             AND ${SALARY_EXPENSE('e.id')}) AS salary_payments,
         (SELECT COALESCE(SUM(${TOTAL_AT('$2')}), 0) FROM invoices i
           WHERE ${NOT_CANCELLED_AT('$2')} AND i.issued_at >= $1 AND i.issued_at < $2) AS invoiced,
         (SELECT COALESCE(SUM(d.amount), 0) FROM invoice_discounts d JOIN invoices i ON i.id = d.invoice_id
           WHERE ${DISCOUNT_ACTIVE_AT('$2')} AND ${NOT_CANCELLED_AT('$2')}
             AND d.applied_at >= $1 AND d.applied_at < $2) AS discounts,
         (SELECT COUNT(*) FROM visits
           WHERE status = 'ACTIVE' AND attended_at >= $1 AND attended_at < $2) AS attended,
         (SELECT COUNT(*) FROM appointments
           WHERE status = 'NO_SHOW' AND start_at >= $1 AND start_at < $2) AS no_shows,
         (SELECT COUNT(*) FROM appointments
           WHERE status = 'CANCELLED' AND start_at >= $1 AND start_at < $2) AS cancellations,
         (SELECT COUNT(*) FROM patients
           WHERE created_at >= $1 AND created_at < $2) AS new_patients,
         (SELECT COUNT(*) FROM visits v
           WHERE v.status = 'ACTIVE' AND v.attended_at >= $1 AND v.attended_at < $2
             AND NOT EXISTS (SELECT 1 FROM clinical_notes n
                              WHERE n.visit_id = v.id AND n.status = 'SIGNED')) AS unsigned_notes`,
      [range.start, range.end, range.from, range.to],
    );
    const collected = toMoney(row.collected);
    const refunded = toMoney(row.refunded);
    const netCollected = subMoney(collected, refunded);
    const expenses = toMoney(row.expenses);
    const owed = await this.outstanding.balancesAt(range.to);
    return {
      from: range.from,
      to: range.to,
      collected,
      refunded,
      netCollected,
      expenses,
      commissionPayouts: toMoney(row.commission_payouts),
      salaryPayments: toMoney(row.salary_payments),
      netAfterExpenses: subMoney(netCollected, expenses),
      invoiced: toMoney(row.invoiced),
      patientsOwe: owed.patientsOwe,
      clinicOwes: owed.clinicOwes.owed,
      discountsGiven: toMoney(row.discounts),
      attendedVisits: Number(row.attended),
      noShows: Number(row.no_shows),
      cancellations: Number(row.cancellations),
      newPatients: Number(row.new_patients),
      unsignedNotes: Number(row.unsigned_notes),
    };
  }

  /**
   * Collected (payments - refunds, by received time), invoiced (invoices by
   * issue time, not cancelled by the end of the range, at their total then)
   * and ACTIVE visits (by attended time), per group.
   * Payments and invoices belong to the doctor/service of their invoice's
   * visit; manual invoices form their own group (key null).
   */
  async revenue(query: RevenueQueryDto): Promise<RevenueReportDto> {
    const range = this.range(query);
    const { groupBy } = query;
    const byMethod = groupBy === RevenueGroupBy.METHOD;

    const collected = await this.grouped(
      groupBy,
      'p.received_at',
      `SUM(CASE WHEN p.type = 'PAYMENT' THEN p.amount ELSE -p.amount END)`,
      `payments p JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN visits v ON v.id = i.visit_id ${VISIT_JOINS}
        WHERE p.status = 'VALID' AND p.received_at >= $1 AND p.received_at < $2`,
      range,
    );
    const invoiced = byMethod
      ? []
      : await this.grouped(
          groupBy,
          'i.issued_at',
          `SUM(${TOTAL_AT('$2')})`,
          `invoices i LEFT JOIN visits v ON v.id = i.visit_id ${VISIT_JOINS}
            WHERE ${NOT_CANCELLED_AT('$2')} AND i.issued_at >= $1 AND i.issued_at < $2`,
          range,
        );
    const visits = byMethod
      ? []
      : await this.grouped(
          groupBy,
          'v.attended_at',
          'COUNT(*)',
          `visits v ${VISIT_JOINS}
            WHERE v.status = 'ACTIVE' AND v.attended_at >= $1 AND v.attended_at < $2`,
          range,
        );

    const rows = new Map<string | null, RevenueRowDto>();
    const rowFor = ({ key, label }: GroupRow): RevenueRowDto => {
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          label: label ?? NO_VISIT_LABEL,
          collected: ZERO,
          invoiced: byMethod ? null : ZERO,
          visits: byMethod ? null : 0,
        };
        rows.set(key, row);
      }
      return row;
    };
    for (const g of collected) rowFor(g).collected = toMoney(g.value);
    for (const g of invoiced) rowFor(g).invoiced = toMoney(g.value);
    for (const g of visits) rowFor(g).visits = Number(g.value);

    const timeGroup =
      groupBy === RevenueGroupBy.DAY || groupBy === RevenueGroupBy.MONTH;
    const sorted = [...rows.values()].sort((a, b) =>
      timeGroup
        ? (a.key ?? '').localeCompare(b.key ?? '')
        : // Highest collected first; manual invoices last.
          Number(a.key === null) - Number(b.key === null) ||
          compareMoney(b.collected, a.collected) ||
          a.label.localeCompare(b.label),
    );
    return {
      from: range.from,
      to: range.to,
      groupBy,
      rows: sorted,
      totals: {
        collected: addMoney(ZERO, ...sorted.map((r) => r.collected)),
        invoiced: byMethod
          ? null
          : addMoney(ZERO, ...sorted.map((r) => r.invoiced ?? ZERO)),
        visits: byMethod
          ? null
          : sorted.reduce((sum, r) => sum + (r.visits ?? 0), 0),
      },
    };
  }

  /**
   * Per doctor: appointments starting in the range (RESCHEDULED ones are
   * replaced by their new appointment, so they don't count) and ACTIVE
   * walk-in visits attended in the range.
   */
  async attendance(query: AttendanceQueryDto): Promise<AttendanceReportDto> {
    const range = this.range(query);
    const rows: AttendanceRow[] = await this.dataSource.query(
      `WITH booked AS (
         SELECT ap.doctor_id,
                COUNT(*) AS booked,
                COUNT(*) FILTER (WHERE ap.status = 'ATTENDED') AS attended,
                COUNT(*) FILTER (WHERE ap.status = 'NO_SHOW') AS no_show,
                COUNT(*) FILTER (WHERE ap.status = 'CANCELLED') AS cancelled,
                COUNT(*) FILTER (WHERE ap.source = 'ONLINE') AS online,
                COUNT(*) FILTER (WHERE ap.source = 'RECEPTION') AS reception
           FROM appointments ap
          WHERE ap.status <> 'RESCHEDULED' AND ap.start_at >= $1 AND ap.start_at < $2
          GROUP BY ap.doctor_id
       ), walk_ins AS (
         SELECT v.doctor_id, COUNT(*) AS walk_ins
           FROM visits v
          WHERE v.status = 'ACTIVE' AND v.appointment_id IS NULL
            AND v.attended_at >= $1 AND v.attended_at < $2
          GROUP BY v.doctor_id
       )
       SELECT d.id AS doctor_id, u.name AS doctor_name,
              COALESCE(b.booked, 0) AS booked, COALESCE(b.attended, 0) AS attended,
              COALESCE(b.no_show, 0) AS no_show, COALESCE(b.cancelled, 0) AS cancelled,
              COALESCE(b.online, 0) AS online, COALESCE(b.reception, 0) AS reception,
              COALESCE(w.walk_ins, 0) AS walk_ins
         FROM booked b
         FULL JOIN walk_ins w ON w.doctor_id = b.doctor_id
         JOIN doctors d ON d.id = COALESCE(b.doctor_id, w.doctor_id)
         JOIN users u ON u.id = d.user_id
        WHERE $3::uuid IS NULL OR d.id = $3
        ORDER BY u.name, d.id`,
      [range.start, range.end, query.doctorId ?? null],
    );

    const doctors = rows.map((row) => {
      const counts = {
        booked: Number(row.booked),
        attended: Number(row.attended),
        noShow: Number(row.no_show),
        cancelled: Number(row.cancelled),
        walkIns: Number(row.walk_ins),
        onlineBookings: Number(row.online),
        receptionBookings: Number(row.reception),
      };
      return {
        doctor: { id: row.doctor_id, name: row.doctor_name },
        ...counts,
        noShowRate: noShowRate(counts.attended, counts.noShow),
      };
    });
    const sum = (field: Exclude<keyof AttendanceCountsDto, 'noShowRate'>) =>
      doctors.reduce((total, d) => total + d[field], 0);
    return {
      from: range.from,
      to: range.to,
      doctors,
      totals: {
        booked: sum('booked'),
        attended: sum('attended'),
        noShow: sum('noShow'),
        cancelled: sum('cancelled'),
        noShowRate: noShowRate(sum('attended'), sum('noShow')),
        walkIns: sum('walkIns'),
        onlineBookings: sum('onlineBookings'),
        receptionBookings: sum('receptionBookings'),
      },
    };
  }

  // Discounts applied in the range and still in effect at its end, on
  // invoices not cancelled by then (= summary.discountsGiven).
  async discounts(query: ReportRangeQueryDto): Promise<DiscountsReportDto> {
    const range = this.range(query);
    const from = (join = '') => `invoice_discounts d
      JOIN invoices i ON i.id = d.invoice_id ${join}
      WHERE ${DISCOUNT_ACTIVE_AT('$2')} AND ${NOT_CANCELLED_AT('$2')}
        AND d.applied_at >= $1 AND d.applied_at < $2`;
    const params = [range.start, range.end];

    const [totals]: { count: string; amount: string; repeats: string }[] =
      await this.dataSource.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(d.amount), 0) AS amount,
                COUNT(*) FILTER (WHERE d.repeated_from_id IS NOT NULL) AS repeats
           FROM ${from()}`,
        params,
      );
    const byUser: {
      id: string;
      name: string;
      count: string;
      amount: string;
    }[] = await this.dataSource.query(
      `SELECT u.id, u.name, COUNT(*) AS count, SUM(d.amount) AS amount
           FROM ${from('JOIN users u ON u.id = d.applied_by')}
          GROUP BY u.id, u.name
          ORDER BY SUM(d.amount) DESC, u.name, u.id`,
      params,
    );
    // Same reason typed differently ("student", " Student ") is one group.
    const byReason: { reason: string; count: string; amount: string }[] =
      await this.dataSource.query(
        `SELECT MIN(btrim(d.reason)) AS reason, COUNT(*) AS count, SUM(d.amount) AS amount
           FROM ${from()}
          GROUP BY lower(btrim(d.reason))
          ORDER BY COUNT(*) DESC, SUM(d.amount) DESC, 1
          LIMIT 10`,
        params,
      );

    return {
      from: range.from,
      to: range.to,
      count: Number(totals.count),
      totalAmount: toMoney(totals.amount),
      repeats: Number(totals.repeats),
      byUser: byUser.map((row) => ({
        user: { id: row.id, name: row.name },
        count: Number(row.count),
        amount: toMoney(row.amount),
      })),
      byReason: byReason.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
        amount: toMoney(row.amount),
      })),
    };
  }

  // Valid expenses dated in the range (referral payouts included: their
  // category is one row of byCategory, and commissionPayouts their total).
  async expenses(query: ReportRangeQueryDto): Promise<ExpensesReportDto> {
    const range = this.range(query);
    const params = [range.from, range.to];
    const byCategory: {
      id: string;
      name: string;
      count: string;
      total: string;
    }[] = await this.dataSource.query(
      `SELECT c.id, c.name, COUNT(*) AS count, SUM(e.amount) AS total
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.status = 'VALID' AND e.expense_date BETWEEN $1 AND $2
        GROUP BY c.id, c.name
        ORDER BY SUM(e.amount) DESC, c.name`,
      params,
    );
    const byMethod: { method: PaymentMethod; count: string; total: string }[] =
      await this.dataSource.query(
        `SELECT e.payment_method AS method, COUNT(*) AS count, SUM(e.amount) AS total
           FROM expenses e
          WHERE e.status = 'VALID' AND e.expense_date BETWEEN $1 AND $2
          GROUP BY e.payment_method`,
        params,
      );
    const totals = totalsFromRows(byMethod);
    const [parts]: { payouts: string; salaries: string }[] =
      await this.dataSource.query(
        `SELECT
           COALESCE(SUM(e.amount) FILTER (WHERE ${PAYOUT_EXPENSE('e.id')}), 0) AS payouts,
           COALESCE(SUM(e.amount) FILTER (WHERE ${SALARY_EXPENSE('e.id')}), 0) AS salaries
         FROM expenses e
        WHERE e.status = 'VALID' AND e.expense_date BETWEEN $1 AND $2`,
        params,
      );
    return {
      from: range.from,
      to: range.to,
      count: totals.count,
      total: totals.total,
      commissionPayouts: toMoney(parts.payouts),
      salaryPayments: toMoney(parts.salaries),
      byCategory: byCategory.map((row) => ({
        category: { id: row.id, name: row.name },
        count: Number(row.count),
        total: toMoney(row.total),
      })),
      byMethod: totals.byMethod,
    };
  }

  /**
   * How what is owed moved over the range, both ways: owed at the start of
   * `from`, what added to it and what paid it, owed at the end of `to`. A
   * one-day range is that day's daily summary `outstanding`.
   */
  async moneyFlow(query: ReportRangeQueryDto): Promise<MoneyFlowReportDto> {
    const range = this.range(query);
    return {
      from: range.from,
      to: range.to,
      ...(await this.outstanding.flow(range.from, range.to, true)),
    };
  }

  /**
   * Every transaction that counts in the range, newest first: valid patient
   * payments and refunds (by received time) and valid expenses (by expense
   * date; salary payments and referral payouts are expenses). The totals
   * are those of the daily summary (one day) or the summary report.
   */
  async transactions(query: TransactionsQueryDto): Promise<TransactionListDto> {
    const range = this.range(query);
    const rows = `(
      SELECT p.type::text AS kind, p.id::text AS id, p.receipt_number AS number,
             to_char(p.received_at AT TIME ZONE $5, 'YYYY-MM-DD') AS date,
             p.received_at AS recorded_at, p.method::text AS method, p.amount,
             pt.id::text AS patient_id, pt.name AS patient_name,
             i.id::text AS invoice_id, i.invoice_number,
             NULL::text AS origin, NULL::text AS category_id, NULL::text AS category_name,
             NULL::text AS description, NULL::text AS payee, p.reason,
             u.id::text AS user_id, u.name AS user_name
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        JOIN patients pt ON pt.id = p.patient_id
        JOIN users u ON u.id = p.received_by
       WHERE p.status = 'VALID' AND p.received_at >= $1 AND p.received_at < $2
      UNION ALL
      SELECT 'EXPENSE', e.id::text, e.expense_number, e.expense_date::text,
             e.created_at, e.payment_method::text, e.amount,
             NULL, NULL, NULL, NULL,
             CASE WHEN ${SALARY_EXPENSE('e.id')} THEN 'DOCTOR_SALARY'
                  WHEN ${PAYOUT_EXPENSE('e.id')} THEN 'REFERRAL_PAYOUT'
                  ELSE 'MANUAL' END,
             c.id::text, c.name, e.description, e.vendor_name, NULL,
             u.id::text, u.name
        FROM expenses e
        JOIN expense_categories c ON c.id = e.category_id
        JOIN users u ON u.id = e.created_by
       WHERE e.status = 'VALID' AND e.expense_date BETWEEN $3 AND $4
    ) t`;
    const params = [
      range.start,
      range.end,
      range.from,
      range.to,
      this.time.zone,
    ];

    const sums: {
      kind: TransactionKind;
      origin: ExpenseOrigin | null;
      count: string;
      total: string;
    }[] = await this.dataSource.query(
      `SELECT kind, origin, COUNT(*) AS count, SUM(amount) AS total
         FROM ${rows} GROUP BY kind, origin`,
      params,
    );
    const sum = (
      match: (s: (typeof sums)[number]) => boolean,
    ): CountTotalDto => {
      const picked = sums.filter(match);
      return {
        count: picked.reduce((n, s) => n + Number(s.count), 0),
        total: addMoney(ZERO, ...picked.map((s) => s.total)),
      };
    };
    const payments = sum((s) => s.kind === TransactionKind.PAYMENT);
    const refunds = sum((s) => s.kind === TransactionKind.REFUND);
    const expenses = sum((s) => s.kind === TransactionKind.EXPENSE);

    const filter = `WHERE $6::text IS NULL OR t.kind = $6`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM ${rows} ${filter}`,
      [...params, query.kind ?? null],
    );
    const page: {
      kind: TransactionKind;
      id: string;
      number: string;
      date: string;
      recorded_at: Date;
      method: string;
      amount: string;
      patient_id: string | null;
      patient_name: string | null;
      invoice_id: string | null;
      invoice_number: string | null;
      origin: ExpenseOrigin | null;
      category_id: string | null;
      category_name: string | null;
      description: string | null;
      payee: string | null;
      reason: string | null;
      user_id: string;
      user_name: string;
    }[] = await this.dataSource.query(
      `SELECT * FROM ${rows} ${filter}
        ORDER BY t.date DESC, t.recorded_at DESC, t.number DESC
        LIMIT $7 OFFSET $8`,
      [...params, query.kind ?? null, query.limit, query.skip],
    );

    return {
      ...toPaginated(
        page.map((r) => ({
          kind: r.kind,
          id: r.id,
          number: r.number,
          date: r.date,
          recordedAt: this.time.toIso(r.recorded_at),
          method: r.method,
          amount: toMoney(r.amount),
          patient:
            r.patient_id && r.patient_name
              ? { id: r.patient_id, name: r.patient_name }
              : null,
          invoice:
            r.invoice_id && r.invoice_number
              ? { id: r.invoice_id, invoiceNumber: r.invoice_number }
              : null,
          expenseOrigin: r.origin,
          category:
            r.category_id && r.category_name
              ? { id: r.category_id, name: r.category_name }
              : null,
          description: r.description,
          payee: r.payee,
          reason: r.reason,
          recordedBy: { id: r.user_id, name: r.user_name },
        })),
        Number(total),
        query,
      ),
      from: range.from,
      to: range.to,
      totals: {
        payments,
        refunds,
        expenses,
        salaryPayments: sum((s) => s.origin === ExpenseOrigin.DOCTOR_SALARY),
        commissionPayouts: sum(
          (s) => s.origin === ExpenseOrigin.REFERRAL_PAYOUT,
        ),
        net: subMoney(subMoney(payments.total, refunds.total), expenses.total),
      },
    };
  }

  // ---------- Internals ----------

  private range({ from, to }: { from: string; to: string }): Range {
    if (from > to) {
      throw new BadRequestException('`from` must be on or before `to`');
    }
    const { start, end } = this.time.dateRange(from, to);
    return { from, to, start: start!, end: end! };
  }

  // `value` per group over `source` (which binds $1/$2 to the range).
  // Day/month groups use the clinic zone (DST-aware) for the local date.
  private grouped(
    groupBy: RevenueGroupBy,
    at: string,
    value: string,
    source: string,
    range: Range,
  ): Promise<GroupRow[]> {
    const params: unknown[] = [range.start, range.end];
    let key: string;
    let label: string;
    switch (groupBy) {
      case RevenueGroupBy.DAY:
      case RevenueGroupBy.MONTH:
        params.push(this.time.zone);
        key = `to_char(${at} AT TIME ZONE $3, '${groupBy === RevenueGroupBy.DAY ? 'YYYY-MM-DD' : 'YYYY-MM'}')`;
        label = key;
        break;
      case RevenueGroupBy.DOCTOR:
        key = 'v.doctor_id::text';
        label = 'du.name';
        break;
      case RevenueGroupBy.SERVICE:
        key = 'v.service_id::text';
        label = 's.name';
        break;
      case RevenueGroupBy.METHOD:
        key = 'p.method::text';
        label = key;
        break;
    }
    return this.dataSource.query(
      `SELECT ${key} AS key, ${label} AS label, ${value} AS value
         FROM ${source}
        GROUP BY 1, 2`,
      params,
    );
  }
}
