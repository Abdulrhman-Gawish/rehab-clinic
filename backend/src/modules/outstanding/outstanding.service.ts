import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { toPaginated } from '../../common/dto/pagination.dto.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { addDays } from '../../common/time/clinic-time.util.js';
import {
  addMoney,
  isZeroMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { monthDates } from '../salaries/salary-math.js';
import { SalaryCommissionMode } from '../salaries/salaries.enums.js';
import { DoctorSalaryTerms } from '../salaries/entities/doctor-salary-terms.entity.js';
import { EmployeeSalaryTerms } from '../salaries/entities/employee-salary-terms.entity.js';
import type {
  ClinicOwesFlowDto,
  ClinicOwesReportDto,
  ClinicOwesTotalsDto,
  EmployeeSalaryBalanceRowDto,
  OutstandingFlowDto,
  PatientsOweFlowDto,
  PatientsOweListDto,
  PatientsOweQueryDto,
  ReferralBalanceRowDto,
  SalaryBalanceRowDto,
} from './dto/outstanding.dto.js';
import {
  commissionsThrough,
  salaryBalances,
  salaryEarnedBetween,
  splitBalances,
  type SalaryBalanceLine,
  type SalaryDoctor,
  type SalaryPaymentRow,
  type SessionGroup,
} from './outstanding-math.js';
import { LIVE_AT, PAID_BEFORE, TOTAL_AT, TOTAL_AT_ISSUE } from './as-of.sql.js';

// ---------- Patients: invoice balances at an instant ----------

// Every invoice live at `cut`, with its total and what was paid on it then.
const INVOICES_AT = (
  cut: string,
) => `SELECT i.id, i.patient_id, i.invoice_number, i.issued_at,
       ${TOTAL_AT(cut)} AS total, ${PAID_BEFORE(cut)} AS paid
  FROM invoices i
 WHERE ${LIVE_AT(cut)}`;

interface SalaryData {
  doctors: (SalaryDoctor & { name: string })[];
  sessions: SessionGroup[];
  payments: SalaryPaymentRow[];
}

/**
 * Employees' salaries, in the shape of the doctors' (outstanding-math): each
 * employee is a payee whose terms are a fixed salary without commission, so
 * the same rules apply with no sessions. `SalaryPaymentRow.doctorId` holds
 * the employee's id.
 */
interface EmployeeSalaryData {
  employees: (SalaryDoctor & { name: string })[];
  payments: SalaryPaymentRow[];
}

interface ReferralBalance {
  id: string;
  name: string;
  earned: string;
  paid: string;
  balance: string;
  pending: string;
}

interface ClinicOwesAt {
  totals: ClinicOwesTotalsDto;
  salaryLines: (SalaryBalanceLine & { doctorName: string })[];
  employeeLines: (SalaryBalanceLine & { employeeName: string })[];
  referrals: ReferralBalance[];
}

/**
 * Outstanding money at the end of any clinic local day, in both directions:
 * what patients owe the clinic (invoice balances) and what the clinic owes
 * its doctors and employees (salaries, referral commissions). Everything is computed from
 * the dated rows, so a past day shows what was still unpaid then, even if
 * it was paid later. The daily summary and the reports read only this.
 */
@Injectable()
export class OutstandingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly time: ClinicTimeService,
  ) {}

  /** From the start of `from` to the end of `to` (inclusive local dates). */
  async flow(
    from: string,
    to: string,
    includeClinic: boolean,
  ): Promise<OutstandingFlowDto> {
    return {
      patientsOwe: await this.patientsFlow(from, to),
      clinicOwes: includeClinic ? await this.clinicFlow(from, to) : null,
    };
  }

  /** Both balances at the end of `date` (the closing of flow(…, date)). */
  async balancesAt(date: string): Promise<{
    patientsOwe: string;
    clinicOwes: ClinicOwesTotalsDto;
  }> {
    const cut = this.time.dayBounds(date).end;
    const patients = await this.patientsOweAt(cut);
    const clinic = await this.clinicOwesAt(
      await this.salaryData(date),
      await this.employeeSalaryData(date),
      cut,
      date,
    );
    return { patientsOwe: patients.balance, clinicOwes: clinic.totals };
  }

  // ---------- Patients owe ----------

  /**
   * Every event that moved what patients owe, each on the instant it
   * happened: an invoice issued (its total then), a later change of a total
   * (discount applied, replaced or removed; item edit), an invoice cancelled
   * (its total then; nothing is paid on a cancelled invoice), a payment, a
   * refund. So closing = opening + invoiced + adjustments - cancelled -
   * payments + refunds, exactly.
   */
  async patientsFlow(from: string, to: string): Promise<PatientsOweFlowDto> {
    const start = this.time.dayBounds(from).start;
    const end = this.time.dayBounds(to).end;
    const opening = await this.patientsOweAt(start);
    const closing = await this.patientsOweAt(end);
    const [row]: Record<string, string>[] = await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(${TOTAL_AT_ISSUE}), 0) FROM invoices i
           WHERE i.issued_at >= $1 AND i.issued_at < $2) AS invoiced,
         (SELECT COALESCE(SUM(c.delta), 0) FROM (
            SELECT h.changed_at,
                   h.total - LAG(h.total) OVER (PARTITION BY h.invoice_id ORDER BY h.changed_at) AS delta
              FROM invoice_total_changes h
             WHERE h.invoice_id IN (SELECT invoice_id FROM invoice_total_changes
                                     WHERE changed_at >= $1 AND changed_at < $2)
          ) c
           WHERE c.delta IS NOT NULL AND c.changed_at >= $1 AND c.changed_at < $2) AS adjustments,
         (SELECT COALESCE(SUM(total), 0) FROM invoices
           WHERE status = 'CANCELLED' AND cancelled_at >= $1 AND cancelled_at < $2) AS cancelled,
         (SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE type = 'PAYMENT' AND status = 'VALID'
             AND received_at >= $1 AND received_at < $2) AS payments,
         (SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE type = 'REFUND' AND status = 'VALID'
             AND received_at >= $1 AND received_at < $2) AS refunds`,
      [start, end],
    );
    return {
      opening: opening.balance,
      invoiced: toMoney(row.invoiced),
      adjustments: toMoney(row.adjustments),
      cancelled: toMoney(row.cancelled),
      payments: toMoney(row.payments),
      refunds: toMoney(row.refunds),
      closing: closing.balance,
      unpaidInvoices: closing.unpaidInvoices,
    };
  }

  /**
   * Patients with a balance at the end of `asOf`, largest first, each with
   * its unpaid invoices. The balances add up to totalBalance, which is the
   * daily summary's patientsOwe.closing for that day.
   */
  async patientsOwe(query: PatientsOweQueryDto): Promise<PatientsOweListDto> {
    const cut = this.time.dayBounds(query.asOf).end;
    const unpaid = `(SELECT b.*, b.total - b.paid AS balance
                       FROM (${INVOICES_AT('$1')}) b
                      WHERE b.total <> b.paid) u`;
    const [totals]: {
      patients: string;
      invoices: string;
      balance: string;
    }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT u.patient_id) AS patients, COUNT(*) AS invoices,
              COALESCE(SUM(u.balance), 0) AS balance
         FROM ${unpaid}`,
      [cut],
    );
    const patients: {
      id: string;
      name: string;
      phone: string;
      balance: string;
      oldest: Date;
    }[] = await this.dataSource.query(
      `SELECT p.id, p.name, p.phone, SUM(u.balance) AS balance,
              MIN(u.issued_at) AS oldest
         FROM ${unpaid} JOIN patients p ON p.id = u.patient_id
        GROUP BY p.id
        ORDER BY SUM(u.balance) DESC, p.name, p.id
        LIMIT $2 OFFSET $3`,
      [cut, query.limit, query.skip],
    );
    const invoices: {
      id: string;
      patient_id: string;
      invoice_number: string;
      issued_at: Date;
      total: string;
      paid: string;
      balance: string;
    }[] = patients.length
      ? await this.dataSource.query(
          `SELECT u.id, u.patient_id, u.invoice_number, u.issued_at, u.total,
                  u.paid, u.balance
             FROM ${unpaid}
            WHERE u.patient_id = ANY($2)
            ORDER BY u.issued_at, u.invoice_number`,
          [cut, patients.map((p) => p.id)],
        )
      : [];
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      ...toPaginated(
        patients.map((p) => ({
          patient: { id: p.id, name: p.name, phone: p.phone },
          balance: toMoney(p.balance),
          oldestUnpaidInvoiceDate: this.time.localDate(p.oldest),
          invoices: invoices
            .filter((i) => i.patient_id === p.id)
            .map((i) => ({
              id: i.id,
              invoiceNumber: i.invoice_number,
              issuedAt: toIso(i.issued_at),
              total: toMoney(i.total),
              paid: toMoney(i.paid),
              balance: toMoney(i.balance),
            })),
        })),
        Number(totals.patients),
        query,
      ),
      asOf: query.asOf,
      totalBalance: toMoney(totals.balance),
      unpaidInvoices: Number(totals.invoices),
    };
  }

  private async patientsOweAt(
    cut: Date,
  ): Promise<{ balance: string; unpaidInvoices: number }> {
    const [row]: { balance: string; unpaid: string }[] =
      await this.dataSource.query(
        `SELECT COALESCE(SUM(b.total - b.paid), 0) AS balance,
                COUNT(*) FILTER (WHERE b.total <> b.paid) AS unpaid
           FROM (${INVOICES_AT('$1')}) b`,
        [cut],
      );
    return {
      balance: toMoney(row.balance),
      unpaidInvoices: Number(row.unpaid),
    };
  }

  // ---------- Clinic owes ----------

  /**
   * closing.owed = opening.owed + salariesEarned + salaryAdjustments +
   * employeeSalariesEarned + commissionsEarned - salaryPayments -
   * employeeSalaryPayments - commissionPayouts + advancesChange.
   * Sessions are valued at each end (their invoice total then), so an
   * earlier session whose invoice changed in the period moves the balance
   * by salaryAdjustments, on the day it changed.
   */
  async clinicFlow(from: string, to: string): Promise<ClinicOwesFlowDto> {
    const before = addDays(from, -1);
    const atOpening = await this.salaryData(before);
    const data = await this.salaryData(to);
    const employeesAtOpening = await this.employeeSalaryData(before);
    const employees = await this.employeeSalaryData(to);
    const start = this.time.dayBounds(from).start;
    const end = this.time.dayBounds(to).end;
    const opening = await this.clinicOwesAt(
      atOpening,
      employeesAtOpening,
      start,
      before,
    );
    const closing = await this.clinicOwesAt(data, employees, end, to);

    const salariesEarned = addMoney(
      ZERO,
      ...data.doctors.map((d) =>
        salaryEarnedBetween(d, data.sessions, from, to),
      ),
    );
    // The sessions attended before the period: valued at the end minus
    // valued at the start (the same doctors' terms).
    const salaryAdjustments = addMoney(
      ZERO,
      ...data.doctors.map((d) =>
        subMoney(
          commissionsThrough(d, data.sessions, before),
          commissionsThrough(d, atOpening.sessions, before),
        ),
      ),
    );
    const salaryPayments = addMoney(
      ZERO,
      ...data.payments
        .filter((p) => p.paymentDate >= from && p.paymentDate <= to)
        .map((p) => p.amount),
    );
    // Fixed salaries only: what falls due in the period, nothing to adjust.
    const employeeSalariesEarned = addMoney(
      ZERO,
      ...employees.employees.map((e) => salaryEarnedBetween(e, [], from, to)),
    );
    const employeeSalaryPayments = addMoney(
      ZERO,
      ...employees.payments
        .filter((p) => p.paymentDate >= from && p.paymentDate <= to)
        .map((p) => p.amount),
    );
    const [referral]: { earned: string; paid: string }[] =
      await this.dataSource.query(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM referral_commissions
             WHERE status <> 'PENDING' AND eligible_at >= $1 AND eligible_at < $2) AS earned,
           (SELECT COALESCE(SUM(amount), 0) FROM referral_payouts
             WHERE status = 'VALID' AND payout_date BETWEEN $3 AND $4) AS paid`,
        [start, end, from, to],
      );
    return {
      opening: opening.totals,
      salariesEarned,
      salaryAdjustments,
      employeeSalariesEarned,
      commissionsEarned: toMoney(referral.earned),
      salaryPayments,
      employeeSalaryPayments,
      commissionPayouts: toMoney(referral.paid),
      advancesChange: subMoney(
        closing.totals.advances,
        opening.totals.advances,
      ),
      closing: closing.totals,
    };
  }

  /**
   * Who the clinic owes at the end of `asOf`: each doctor-month and each
   * employee-month with a balance (salaries), each referring doctor with a
   * balance or pending commission.
   */
  async clinicOwes(asOf: string): Promise<ClinicOwesReportDto> {
    const data = await this.salaryData(asOf);
    const at = await this.clinicOwesAt(
      data,
      await this.employeeSalaryData(asOf),
      this.time.dayBounds(asOf).end,
      asOf,
    );
    const salaryRows: SalaryBalanceRowDto[] = at.salaryLines
      .filter((l) => !isZeroMoney(l.balance))
      .map((l) => ({
        doctor: { id: l.doctorId, name: l.doctorName },
        month: l.month,
        fixedSalary: l.fixedSalary,
        fixedDue: l.fixedDue,
        sessionCount: l.sessionCount,
        commissions: l.commissions,
        earned: l.earned,
        paid: l.paid,
        balance: l.balance,
      }));
    const employeeRows: EmployeeSalaryBalanceRowDto[] = at.employeeLines
      .filter((l) => !isZeroMoney(l.balance))
      .map((l) => ({
        employee: { id: l.doctorId, name: l.employeeName },
        month: l.month,
        fixedSalary: l.fixedSalary,
        fixedDue: l.fixedDue,
        paid: l.paid,
        balance: l.balance,
      }));
    const referralRows: ReferralBalanceRowDto[] = at.referrals
      .filter((r) => !isZeroMoney(r.balance) || !isZeroMoney(r.pending))
      .map((r) => ({
        referringDoctor: { id: r.id, name: r.name },
        earned: r.earned,
        paid: r.paid,
        balance: r.balance,
        pending: r.pending,
      }));
    const salaries = splitBalances(salaryRows.map((r) => r.balance));
    const employeeSalaries = splitBalances(employeeRows.map((r) => r.balance));
    const referrals = splitBalances(referralRows.map((r) => r.balance));
    return {
      asOf,
      owed: at.totals.owed,
      advances: at.totals.advances,
      doctorSalaries: { ...salaries, rows: salaryRows },
      employeeSalaries: { ...employeeSalaries, rows: employeeRows },
      referralCommissions: {
        ...referrals,
        pending: at.totals.pendingCommissions,
        rows: referralRows,
      },
    };
  }

  // At the instant `cut`, the end of the local day `date`.
  private async clinicOwesAt(
    data: SalaryData,
    employeeData: EmployeeSalaryData,
    cut: Date,
    date: string,
  ): Promise<ClinicOwesAt> {
    const salaryLines = data.doctors.flatMap((d) =>
      salaryBalances(d, data.sessions, data.payments, date).map((l) => ({
        ...l,
        doctorName: d.name,
      })),
    );
    const employeeLines = employeeData.employees.flatMap((e) =>
      salaryBalances(e, [], employeeData.payments, date).map((l) => ({
        ...l,
        employeeName: e.name,
      })),
    );
    const referrals = await this.referralBalances(cut, date);
    const salaries = splitBalances(salaryLines.map((l) => l.balance));
    const employees = splitBalances(employeeLines.map((l) => l.balance));
    const commissions = splitBalances(referrals.map((r) => r.balance));
    return {
      totals: {
        owed: addMoney(salaries.owed, employees.owed, commissions.owed),
        doctorSalaries: salaries.owed,
        employeeSalaries: employees.owed,
        referralCommissions: commissions.owed,
        advances: addMoney(
          salaries.advances,
          employees.advances,
          commissions.advances,
        ),
        pendingCommissions: addMoney(ZERO, ...referrals.map((r) => r.pending)),
      },
      salaryLines,
      employeeLines,
      referrals,
    };
  }

  /**
   * The employees' side of the salary balances at the end of `lastDate`:
   * every salary version (a version set later for a month applies to that
   * whole month, as in the statement) and the valid payments dated by then.
   */
  private async employeeSalaryData(
    lastDate: string,
  ): Promise<EmployeeSalaryData> {
    const versions = await this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .find();
    const payments: {
      employee_id: string;
      month: string;
      amount: string;
      payment_date: string;
    }[] = await this.dataSource.query(
      `SELECT employee_id, month, amount, payment_date::text AS payment_date
         FROM employee_salary_payments
        WHERE status = 'VALID' AND payment_date <= $1`,
      [lastDate],
    );
    const ids = [
      ...new Set([
        ...versions.map((v) => v.employeeId),
        ...payments.map((p) => p.employee_id),
      ]),
    ];
    if (ids.length === 0) return { employees: [], payments: [] };
    const people: { id: string; name: string }[] = await this.dataSource.query(
      `SELECT id, name FROM employees WHERE id = ANY($1) ORDER BY name, id`,
      [ids],
    );
    return {
      employees: people.map((p) => ({
        id: p.id,
        name: p.name,
        // Employees are never deleted: the salary versions decide.
        deletedOn: null,
        terms: versions
          .filter((v) => v.employeeId === p.id)
          .map((v) => ({
            effectiveMonth: v.effectiveMonth,
            fixedSalary: v.fixedSalary,
            commissionMode: SalaryCommissionMode.NONE,
            sessionRateType: null,
            sessionRateValue: null,
          })),
      })),
      payments: payments.map((p) => ({
        doctorId: p.employee_id,
        month: p.month,
        amount: toMoney(p.amount),
        paymentDate: p.payment_date,
      })),
    };
  }

  /**
   * Each referring doctor's balance at the end of `date` (`cut` = its end),
   * by the rule of GET /referring-doctors/:id/commission-balance?asOf:
   * ledger rows owed (eligible) by then, payouts dated up to then.
   */
  private async referralBalances(
    cut: Date,
    date: string,
  ): Promise<ReferralBalance[]> {
    const rows: {
      id: string;
      name: string;
      earned: string;
      paid: string;
      pending: string;
    }[] = await this.dataSource.query(
      `SELECT rd.id, rd.name, COALESCE(c.earned, 0) AS earned,
              COALESCE(po.paid, 0) AS paid, COALESCE(c.pending, 0) AS pending
         FROM referring_doctors rd
         LEFT JOIN (
           SELECT referring_doctor_id,
                  SUM(amount) FILTER (WHERE status <> 'PENDING' AND eligible_at < $1) AS earned,
                  SUM(amount) FILTER (WHERE recorded_at < $1
                    AND (status = 'PENDING' OR eligible_at >= $1)) AS pending
             FROM referral_commissions
            GROUP BY referring_doctor_id
         ) c ON c.referring_doctor_id = rd.id
         LEFT JOIN (
           SELECT referring_doctor_id, SUM(amount) AS paid
             FROM referral_payouts
            WHERE status = 'VALID' AND payout_date <= $2
            GROUP BY referring_doctor_id
         ) po ON po.referring_doctor_id = rd.id
        WHERE c.referring_doctor_id IS NOT NULL OR po.referring_doctor_id IS NOT NULL
        ORDER BY rd.name, rd.id`,
      [cut, date],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      earned: toMoney(r.earned),
      paid: toMoney(r.paid),
      balance: subMoney(r.earned, r.paid),
      pending: toMoney(r.pending),
    }));
  }

  /**
   * Everything the salary balances need at the end of `lastDate`: terms
   * versions, valid payments dated by then, and the sessions of the doctors
   * with terms or payments (from the earliest such month) attended by then,
   * grouped by day, service and value. A session is valued as it was then
   * (the salary statement's rule, at that instant): visit not voided yet,
   * package session not given back yet, else its invoice live then at its
   * total then. With `lastDate` today, that is the statement's live value.
   */
  private async salaryData(lastDate: string): Promise<SalaryData> {
    const versions = await this.dataSource
      .getRepository(DoctorSalaryTerms)
      .find({ relations: { serviceRates: true } });
    const payments: {
      doctor_id: string;
      month: string;
      amount: string;
      payment_date: string;
    }[] = await this.dataSource.query(
      `SELECT doctor_id, month, amount, payment_date::text AS payment_date
         FROM doctor_salary_payments
        WHERE status = 'VALID' AND payment_date <= $1`,
      [lastDate],
    );
    const ids = [
      ...new Set([
        ...versions.map((v) => v.doctorId),
        ...payments.map((p) => p.doctor_id),
      ]),
    ];
    if (ids.length === 0) return { doctors: [], sessions: [], payments: [] };

    const people: { id: string; name: string; deleted_at: Date | null }[] =
      await this.dataSource.query(
        `SELECT d.id, u.name, d.deleted_at
           FROM doctors d JOIN users u ON u.id = d.user_id
          WHERE d.id = ANY($1)
          ORDER BY u.name, d.id`,
        [ids],
      );
    const doctors = people.map((p) => ({
      id: p.id,
      name: p.name,
      deletedOn: p.deleted_at ? this.time.localDate(p.deleted_at) : null,
      terms: versions
        .filter((v) => v.doctorId === p.id)
        .map((v) => ({
          effectiveMonth: v.effectiveMonth,
          fixedSalary: v.fixedSalary,
          commissionMode: v.commissionMode,
          sessionRateType: v.sessionRateType,
          sessionRateValue: v.sessionRateValue,
          serviceRates: (v.serviceRates ?? []).map((r) => ({
            serviceId: r.serviceId,
            rateType: r.rateType,
            value: r.value,
          })),
        })),
    }));

    // From the earliest month with terms or a payment: every doctor-month a
    // balance line can have, with the session count of its statement.
    const firstMonth = [
      ...versions.map((v) => v.effectiveMonth),
      ...payments.map((p) => p.month),
    ].sort()[0];
    let sessions: SessionGroup[] = [];
    if (doctors.length > 0) {
      const rows: {
        doctor_id: string;
        service_id: string;
        date: string;
        invoice_total: string | null;
        package_price: string | null;
        package_sessions: number | null;
        sessions: number;
      }[] = await this.dataSource.query(
        `SELECT v.doctor_id, v.service_id,
                to_char(v.attended_at AT TIME ZONE $4, 'YYYY-MM-DD') AS date,
                li.total AS invoice_total, pk.price AS package_price,
                pk.total_sessions AS package_sessions, COUNT(*)::int AS sessions
           FROM visits v
           LEFT JOIN LATERAL (
             SELECT ${TOTAL_AT('$3')} AS total
               FROM invoices i
              WHERE i.visit_id = v.id AND ${LIVE_AT('$3')}
              ORDER BY i.issued_at DESC LIMIT 1
           ) li ON true
           LEFT JOIN LATERAL (
             SELECT pp.price, pp.total_sessions
               FROM package_usages u
               JOIN patient_packages pp ON pp.id = u.patient_package_id
              WHERE u.visit_id = v.id AND u.reason = 'ATTENDED'
                AND (u.restored_at IS NULL OR u.restored_at >= $3)
              ORDER BY u.restored_at DESC NULLS FIRST LIMIT 1
           ) pk ON true
          WHERE (v.status = 'ACTIVE' OR v.voided_at >= $3)
            AND v.doctor_id = ANY($1)
            AND v.attended_at >= $2 AND v.attended_at < $3
          GROUP BY 1, 2, 3, 4, 5, 6`,
        [
          doctors.map((d) => d.id),
          this.time.dayBounds(monthDates(firstMonth).first).start,
          this.time.dayBounds(lastDate).end,
          this.time.zone,
        ],
      );
      sessions = rows.map((r) => ({
        doctorId: r.doctor_id,
        serviceId: r.service_id,
        date: r.date,
        invoiceTotal: r.invoice_total,
        packagePrice: r.package_price,
        packageSessions:
          r.package_sessions === null ? null : Number(r.package_sessions),
        sessions: Number(r.sessions),
      }));
    }

    return {
      doctors,
      sessions,
      payments: payments.map((p) => ({
        doctorId: p.doctor_id,
        month: p.month,
        amount: toMoney(p.amount),
        paymentDate: p.payment_date,
      })),
    };
  }
}
