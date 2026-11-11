import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import {
  toPaginated,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { toMoney } from '../../common/utils/money.util.js';
import { InvoiceDiscount } from '../billing/entities/invoice-discount.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Payment } from '../billing/entities/payment.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type {
  ReferralReportDto,
  ReferralReportQueryDto,
  ReferralStatementDto,
  ReferredPatientDto,
} from './dto/referrals.dto.js';
import { ReferringDoctor } from './entities/referring-doctor.entity.js';
import { PatientReferralsService } from './patient-referrals.service.js';
import {
  ReferralCommissionsService,
  VALID_ALLOCATIONS,
} from './referral-commissions.service.js';
import { ReferralPayoutsService } from './referral-payouts.service.js';
import type { PatientReferralStatus } from './referrals.enums.js';

// Each referral's period: from the end of the patient's previous referral
// (or the beginning) to its own end (or forever). A patient's bookings and
// visits belong to the referral whose period they fall in.
const PERIODS = `periods AS (
  SELECT r.id, r.patient_id, r.referring_doctor_id,
         COALESCE(LAG(r.ended_at) OVER (PARTITION BY r.patient_id ORDER BY r.assigned_at, r.created_at, r.id),
                  '-infinity'::timestamptz) AS period_start,
         COALESCE(r.ended_at, 'infinity'::timestamptz) AS period_end
    FROM patient_referrals r)`;

interface ReportSqlRow {
  id: string;
  name: string;
  is_active: boolean;
  referred: string;
  bookings: string;
  attended: string;
  covered: string;
  collected: string;
  discounts: string;
  earned: string;
  reversed: string;
  adjustments: string;
  paid: string;
  outstanding: string;
  pending: string;
}

interface PatientSqlRow {
  referral_id: string;
  status: PatientReferralStatus;
  assigned_at: Date;
  patient_id: string;
  name: string;
  phone: string;
  version: number;
  is_override: boolean;
  covered: string;
  collected: string;
  discounts: string;
  commission: string;
  outstanding: string;
}

/**
 * Referral reports (OWNER). Money collected is valid payments minus valid
 * refunds on covered invoices; commission figures come from the ledger, so
 * they are exactly what was recorded, never recomputed.
 */
@Injectable()
export class ReferralReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly referrals: PatientReferralsService,
    private readonly commissions: ReferralCommissionsService,
    private readonly payouts: ReferralPayoutsService,
    private readonly time: ClinicTimeService,
  ) {}

  async report(query: ReferralReportQueryDto): Promise<ReferralReportDto> {
    if (query.from > query.to) {
      throw new BadRequestException('`from` must be on or before `to`');
    }
    const { start, end } = this.time.dateRange(query.from, query.to);
    const rows: ReportSqlRow[] = await this.dataSource.query(
      `WITH ${PERIODS},
       doctor_terms AS (
         SELECT t.id, r.referring_doctor_id FROM patient_referral_terms t
           JOIN patient_referrals r ON r.id = t.patient_referral_id),
       referred AS (
         SELECT referring_doctor_id AS id, COUNT(*) AS n FROM patient_referrals
          WHERE assigned_at >= $1 AND assigned_at < $2 GROUP BY 1),
       bookings AS (
         SELECT p.referring_doctor_id AS id, COUNT(*) AS n FROM appointments a
           JOIN periods p ON p.patient_id = a.patient_id
            AND a.start_at >= p.period_start AND a.start_at < p.period_end
          WHERE a.status <> 'RESCHEDULED' AND a.start_at >= $1 AND a.start_at < $2 GROUP BY 1),
       attended AS (
         SELECT p.referring_doctor_id AS id, COUNT(*) AS n FROM visits v
           JOIN periods p ON p.patient_id = v.patient_id
            AND v.attended_at >= p.period_start AND v.attended_at < p.period_end
          WHERE v.status = 'ACTIVE' AND v.attended_at >= $1 AND v.attended_at < $2 GROUP BY 1),
       covered AS (
         SELECT dt.referring_doctor_id AS id, COUNT(*) AS n FROM invoices i
           JOIN doctor_terms dt ON dt.id = i.referral_terms_id
          WHERE i.status <> 'CANCELLED' AND i.issued_at >= $1 AND i.issued_at < $2 GROUP BY 1),
       collected AS (
         SELECT dt.referring_doctor_id AS id,
                SUM(CASE WHEN pm.type = 'PAYMENT' THEN pm.amount ELSE -pm.amount END) AS n
           FROM payments pm JOIN invoices i ON i.id = pm.invoice_id
           JOIN doctor_terms dt ON dt.id = i.referral_terms_id
          WHERE pm.status = 'VALID' AND pm.received_at >= $1 AND pm.received_at < $2 GROUP BY 1),
       discounts AS (
         SELECT dt.referring_doctor_id AS id, SUM(d.amount) AS n FROM invoice_discounts d
           JOIN invoices i ON i.id = d.invoice_id
           JOIN doctor_terms dt ON dt.id = d.referral_terms_id
          WHERE d.removed_at IS NULL AND i.status <> 'CANCELLED'
            AND d.applied_at >= $1 AND d.applied_at < $2 GROUP BY 1),
       ledger AS (
         SELECT referring_doctor_id AS id,
                SUM(amount) FILTER (WHERE kind IN ('EARNED', 'REFUND_VOIDED') AND recorded_at >= $1 AND recorded_at < $2) AS earned,
                -SUM(amount) FILTER (WHERE kind IN ('REFUND_REVERSAL', 'VOID_REVERSAL') AND recorded_at >= $1 AND recorded_at < $2) AS reversed,
                SUM(amount) FILTER (WHERE kind = 'ADJUSTMENT' AND recorded_at >= $1 AND recorded_at < $2) AS adjustments,
                SUM(amount) FILTER (WHERE status <> 'PENDING') AS owed,
                SUM(amount) FILTER (WHERE status = 'PENDING') AS pending
           FROM referral_commissions GROUP BY 1),
       paid AS (
         SELECT referring_doctor_id AS id,
                SUM(amount) FILTER (WHERE payout_date BETWEEN $4 AND $5) AS n,
                SUM(amount) AS total
           FROM referral_payouts WHERE status = 'VALID' GROUP BY 1)
       SELECT d.id, d.name, d.is_active,
              COALESCE(referred.n, 0) AS referred, COALESCE(bookings.n, 0) AS bookings,
              COALESCE(attended.n, 0) AS attended, COALESCE(covered.n, 0) AS covered,
              COALESCE(collected.n, 0) AS collected, COALESCE(discounts.n, 0) AS discounts,
              COALESCE(ledger.earned, 0) AS earned, COALESCE(ledger.reversed, 0) AS reversed,
              COALESCE(ledger.adjustments, 0) AS adjustments, COALESCE(paid.n, 0) AS paid,
              COALESCE(ledger.owed, 0) - COALESCE(paid.total, 0) AS outstanding,
              COALESCE(ledger.pending, 0) AS pending
         FROM referring_doctors d
         LEFT JOIN referred ON referred.id = d.id
         LEFT JOIN bookings ON bookings.id = d.id
         LEFT JOIN attended ON attended.id = d.id
         LEFT JOIN covered ON covered.id = d.id
         LEFT JOIN collected ON collected.id = d.id
         LEFT JOIN discounts ON discounts.id = d.id
         LEFT JOIN ledger ON ledger.id = d.id
         LEFT JOIN paid ON paid.id = d.id
        WHERE ($3::uuid IS NULL OR d.id = $3)
        ORDER BY d.name, d.id`,
      [start, end, query.referringDoctorId ?? null, query.from, query.to],
    );
    return {
      from: query.from,
      to: query.to,
      rows: rows.map((r) => ({
        referringDoctor: { id: r.id, name: r.name, isActive: r.is_active },
        referredPatients: Number(r.referred),
        bookings: Number(r.bookings),
        attendedSessions: Number(r.attended),
        coveredSessions: Number(r.covered),
        collected: toMoney(r.collected),
        discounts: toMoney(r.discounts),
        commissionEarned: toMoney(r.earned),
        commissionReversed: toMoney(r.reversed),
        adjustments: toMoney(r.adjustments),
        commissionPaid: toMoney(r.paid),
        outstanding: toMoney(r.outstanding),
        pending: toMoney(r.pending),
      })),
    };
  }

  // Every patient the doctor referred (all referrals), newest first, one page
  // at a time. The money is summed for the referrals of the page only.
  async doctorPatients(
    referringDoctorId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ReferredPatientDto>> {
    if (
      !(await this.dataSource.manager.existsBy(ReferringDoctor, {
        id: referringDoctorId,
      }))
    ) {
      throw new NotFoundException('Referring doctor not found');
    }
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      'SELECT COUNT(*) AS total FROM patient_referrals WHERE referring_doctor_id = $1',
      [referringDoctorId],
    );
    const rows: PatientSqlRow[] = await this.dataSource.query(
      `WITH page AS (
         SELECT id, patient_id, status, assigned_at, created_at FROM patient_referrals
          WHERE referring_doctor_id = $1
          ORDER BY assigned_at DESC, created_at DESC, id DESC
          LIMIT $2 OFFSET $3),
       covered AS (
         SELECT t.patient_referral_id AS id, COUNT(*) AS n, SUM(i.amount_paid) AS collected
           FROM invoices i JOIN patient_referral_terms t ON t.id = i.referral_terms_id
          WHERE i.status <> 'CANCELLED' AND t.patient_referral_id IN (SELECT id FROM page)
          GROUP BY 1),
       discounts AS (
         SELECT t.patient_referral_id AS id, SUM(d.amount) AS n
           FROM invoice_discounts d JOIN patient_referral_terms t ON t.id = d.referral_terms_id
           JOIN invoices i ON i.id = d.invoice_id
          WHERE d.removed_at IS NULL AND i.status <> 'CANCELLED'
            AND t.patient_referral_id IN (SELECT id FROM page)
          GROUP BY 1),
       ledger AS (
         SELECT c.patient_referral_id AS id, SUM(c.amount) AS n,
                SUM(c.amount - COALESCE(s.paid, 0)) FILTER (WHERE c.status = 'ELIGIBLE') AS outstanding
           FROM referral_commissions c
           LEFT JOIN (SELECT a.commission_id, SUM(a.amount) AS paid FROM ${VALID_ALLOCATIONS}
                       GROUP BY a.commission_id) s ON s.commission_id = c.id
          WHERE c.patient_referral_id IN (SELECT id FROM page)
          GROUP BY 1)
       SELECT r.id AS referral_id, r.status, r.assigned_at, p.id AS patient_id, p.name, p.phone,
              t.version, t.is_override,
              COALESCE(covered.n, 0) AS covered, COALESCE(covered.collected, 0) AS collected,
              COALESCE(discounts.n, 0) AS discounts, COALESCE(ledger.n, 0) AS commission,
              COALESCE(ledger.outstanding, 0) AS outstanding
         FROM page r
         JOIN patients p ON p.id = r.patient_id
         JOIN LATERAL (SELECT version, is_override FROM patient_referral_terms
                        WHERE patient_referral_id = r.id ORDER BY version DESC LIMIT 1) t ON true
         LEFT JOIN covered ON covered.id = r.id
         LEFT JOIN discounts ON discounts.id = r.id
         LEFT JOIN ledger ON ledger.id = r.id
        ORDER BY r.assigned_at DESC, r.created_at DESC, r.id DESC`,
      [referringDoctorId, query.limit, query.skip],
    );
    const items = rows.map((r) => ({
      patient: { id: r.patient_id, name: r.name, phone: r.phone },
      referralId: r.referral_id,
      status: r.status,
      assignedAt: this.time.toIso(r.assigned_at),
      termsVersion: r.version,
      isOverride: r.is_override,
      coveredSessions: Number(r.covered),
      collected: toMoney(r.collected),
      discounts: toMoney(r.discounts),
      commission: toMoney(r.commission),
      outstanding: toMoney(r.outstanding),
    }));
    return toPaginated(items, Number(total), query);
  }

  /**
   * Why the patient got a discount and why the doctor earned what they did:
   * the referrals with every terms version (defaults vs applied, reasons),
   * the covered invoices with their discount and payments, every
   * commission row and the payouts that settled them (voided ones too).
   */
  async statement(patientId: string): Promise<ReferralStatementDto> {
    if (!(await this.dataSource.manager.existsBy(Patient, { id: patientId }))) {
      throw new NotFoundException('Patient not found');
    }
    const toIso = (d: Date) => this.time.toIso(d);
    const referrals = await this.referrals.forPatient(patientId);
    const invoices = await this.dataSource
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.referralTerms', 'terms')
      .where('invoice.patientId = :patientId', { patientId })
      .orderBy('invoice.issuedAt', 'DESC')
      .addOrderBy('invoice.invoiceNumber', 'DESC')
      .getMany();
    const ids = invoices.map((i) => i.id);
    const discounts = ids.length
      ? await this.dataSource.getRepository(InvoiceDiscount).find({
          where: { invoiceId: In(ids), removedAt: IsNull() },
          relations: { appliedBy: true },
        })
      : [];
    const payments = ids.length
      ? await this.dataSource.getRepository(Payment).find({
          where: { invoiceId: In(ids) },
          order: { receivedAt: 'ASC', receiptNumber: 'ASC' },
        })
      : [];
    const commissions = await this.commissions.forPatient(patientId);
    const settledBy: { payout_id: string }[] = commissions.length
      ? await this.dataSource.query(
          `SELECT DISTINCT payout_id FROM referral_payout_allocations
            WHERE commission_id = ANY($1)`,
          [commissions.map((c) => c.id)],
        )
      : [];
    const payoutIds = settledBy.map((r) => r.payout_id);
    return {
      referrals,
      invoices: invoices.map((invoice) => {
        const discount = discounts.find((d) => d.invoiceId === invoice.id);
        return {
          invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
          status: invoice.status,
          issuedAt: toIso(invoice.issuedAt),
          visitId: invoice.visitId,
          isPackageSale: invoice.visitId === null,
          referralId: invoice.referralTerms!.patientReferralId,
          termsVersion: invoice.referralTerms!.version,
          subtotal: invoice.subtotal,
          discountTotal: invoice.discountTotal,
          total: invoice.total,
          amountPaid: invoice.amountPaid,
          discount: discount
            ? {
                type: discount.type,
                value: discount.value,
                amount: discount.amount,
                reason: discount.reason,
                fromReferral: discount.referralTermsId !== null,
                appliedBy: UserRefDto.fromEntity(discount.appliedBy),
                appliedAt: toIso(discount.appliedAt),
              }
            : null,
          payments: payments
            .filter((p) => p.invoiceId === invoice.id)
            .map((p) => ({
              id: p.id,
              receiptNumber: p.receiptNumber,
              type: p.type,
              status: p.status,
              amount: p.amount,
              receivedAt: toIso(p.receivedAt),
            })),
        };
      }),
      commissions,
      payouts: await this.payouts.forIds(payoutIds),
    };
  }
}
