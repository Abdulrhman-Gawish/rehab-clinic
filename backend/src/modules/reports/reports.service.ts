import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  addMoney,
  compareMoney,
  percentageOfBase,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { totalsFromRows } from '../billing/billing-reports.service.js';
import type { PaymentMethod } from '../billing/billing.enums.js';
import type {
  AttendanceCountsDto,
  AttendanceQueryDto,
  AttendanceReportDto,
  DiscountsReportDto,
  ExpensesReportDto,
  OutstandingQueryDto,
  OutstandingRowDto,
  ReportRangeDto,
  ReportRangeQueryDto,
  RevenueQueryDto,
  RevenueReportDto,
  RevenueRowDto,
  SummaryReportDto,
} from './dto/reports.dto.js';
import { RevenueGroupBy } from './reports.enums.js';

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
  ) {}

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
         (SELECT COALESCE(SUM(total), 0) FROM invoices
           WHERE status <> 'CANCELLED' AND issued_at >= $1 AND issued_at < $2) AS invoiced,
         (SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices
           WHERE status <> 'CANCELLED' AND issued_at >= $1 AND issued_at < $2) AS outstanding,
         (SELECT COALESCE(SUM(d.amount), 0) FROM invoice_discounts d JOIN invoices i ON i.id = d.invoice_id
           WHERE d.removed_at IS NULL AND i.status <> 'CANCELLED'
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
    return {
      from: range.from,
      to: range.to,
      collected,
      refunded,
      netCollected,
      expenses,
      netAfterExpenses: subMoney(netCollected, expenses),
      invoiced: toMoney(row.invoiced),
      outstanding: toMoney(row.outstanding),
      discountsGiven: toMoney(row.discounts),
      attendedVisits: Number(row.attended),
      noShows: Number(row.no_shows),
      cancellations: Number(row.cancellations),
      newPatients: Number(row.new_patients),
      unsignedNotes: Number(row.unsigned_notes),
    };
  }

  /**
   * Collected (payments - refunds, by received time), invoiced (non-cancelled
   * invoices, by issue time) and ACTIVE visits (by attended time), per group.
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
          'SUM(i.total)',
          `invoices i LEFT JOIN visits v ON v.id = i.visit_id ${VISIT_JOINS}
            WHERE i.status <> 'CANCELLED' AND i.issued_at >= $1 AND i.issued_at < $2`,
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

  // Active discounts applied in the range, on non-cancelled invoices.
  async discounts(query: ReportRangeQueryDto): Promise<DiscountsReportDto> {
    const range = this.range(query);
    const from = (join = '') => `invoice_discounts d
      JOIN invoices i ON i.id = d.invoice_id ${join}
      WHERE d.removed_at IS NULL AND i.status <> 'CANCELLED'
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

  // Valid expenses dated in the range.
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
    return {
      from: range.from,
      to: range.to,
      count: totals.count,
      total: totals.total,
      byCategory: byCategory.map((row) => ({
        category: { id: row.id, name: row.name },
        count: Number(row.count),
        total: toMoney(row.total),
      })),
      byMethod: totals.byMethod,
    };
  }

  /**
   * Patients owing money on non-cancelled invoices issued in the range,
   * largest balance first. The balances add up to summary.outstanding.
   */
  async outstanding(
    query: OutstandingQueryDto,
  ): Promise<Paginated<OutstandingRowDto>> {
    const range = this.range(query);
    const unpaid = (join = '') => `invoices i ${join}
      WHERE i.status <> 'CANCELLED' AND i.amount_paid < i.total
        AND i.issued_at >= $1 AND i.issued_at < $2`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT i.patient_id) AS total FROM ${unpaid()}`,
      [range.start, range.end],
    );
    const rows: {
      id: string;
      name: string;
      phone: string;
      balance: string;
      oldest: Date;
    }[] = await this.dataSource.query(
      `SELECT p.id, p.name, p.phone, SUM(i.total - i.amount_paid) AS balance,
              MIN(i.issued_at) AS oldest
         FROM ${unpaid('JOIN patients p ON p.id = i.patient_id')}
        GROUP BY p.id
        ORDER BY SUM(i.total - i.amount_paid) DESC, p.name, p.id
        LIMIT $3 OFFSET $4`,
      [range.start, range.end, query.limit, query.skip],
    );
    return toPaginated(
      rows.map((row) => ({
        patient: { id: row.id, name: row.name, phone: row.phone },
        balance: toMoney(row.balance),
        oldestUnpaidInvoiceDate: this.time.localDate(row.oldest),
      })),
      Number(total),
      query,
    );
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
