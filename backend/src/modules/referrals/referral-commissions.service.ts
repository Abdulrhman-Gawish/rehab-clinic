import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  isZeroMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import type { Payment } from '../billing/entities/payment.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type {
  CommissionAdjustmentDto,
  CommissionBalanceDto,
  CommissionDto,
  ListCommissionsQueryDto,
} from './dto/referrals.dto.js';
import { PatientReferralTerms } from './entities/patient-referral-terms.entity.js';
import { PatientReferral } from './entities/patient-referral.entity.js';
import { ReferralCommission } from './entities/referral-commission.entity.js';
import { ReferringDoctor } from './entities/referring-doctor.entity.js';
import { commissionDelta } from './referral-math.js';
import { commissionRule, toCommission } from './referral.mapper.js';
import {
  CommissionKind,
  CommissionStatus,
  ReferralRateType,
} from './referrals.enums.js';

// A patient payment event on an invoice.
export interface PaymentEvent {
  kind: Exclude<CommissionKind, CommissionKind.ADJUSTMENT>;
  // The patient PAYMENT the event is about.
  paymentId: string;
  // The payments row of the event (the payment, or the refund).
  source: Payment;
}

// Allocations that count: those of VALID payouts (alias a).
export const VALID_ALLOCATIONS = `referral_payout_allocations a
    JOIN referral_payouts p ON p.id = a.payout_id AND p.status = 'VALID'`;

// What valid payouts settled of each commission row (signed like the
// row); rows absent from the map have nothing settled.
export async function paidAmounts(
  manager: EntityManager,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows: { commission_id: string; paid: string }[] = await manager.query(
    `SELECT a.commission_id, SUM(a.amount) AS paid FROM ${VALID_ALLOCATIONS}
      WHERE a.commission_id = ANY($1) GROUP BY a.commission_id`,
    [ids],
  );
  return new Map(rows.map((r) => [r.commission_id, toMoney(r.paid)]));
}

// One of the sessions of a package sale ($1 = its invoice id) was attended.
const ATTENDED_PACKAGE_SESSION = `EXISTS (
  SELECT 1 FROM patient_packages pp
    JOIN package_usages u ON u.patient_package_id = pp.id
   WHERE pp.invoice_id = $1 AND u.reason = 'ATTENDED' AND u.restored_at IS NULL)`;

const RELATIONS = {
  referringDoctor: true,
  patient: true,
  invoice: true,
  payment: true,
  sourcePayment: true,
  referralTerms: true,
  recordedBy: true,
} as const;

/**
 * The referral commission ledger. Rows are written in the same transaction
 * as the patient payment, refund or void that causes them, with the invoice
 * row already locked by billing, so events on one invoice are processed one
 * at a time. Each row is the change of the invoice's commission target
 * (see referral-math): replaying an event writes nothing, and the unique
 * (source_payment_id, kind) index forbids a second row for the same event.
 */
@Injectable()
export class ReferralCommissionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  /**
   * After a payment, refund or void on `invoice` (amount_paid already
   * refreshed). Nothing happens unless the invoice is covered by referral
   * terms with a commission.
   */
  async recordPaymentEvent(
    manager: EntityManager,
    invoice: Invoice,
    event: PaymentEvent,
    actor: Actor,
  ): Promise<void> {
    if (!invoice.referralTermsId) return;
    const terms = await manager.findOneOrFail(PatientReferralTerms, {
      where: { id: invoice.referralTermsId },
      relations: { patientReferral: true },
    });
    const rule = commissionRule(terms);
    if (rule.type === ReferralRateType.NONE) return;
    const referral = terms.patientReferral as PatientReferral;

    const [{ recorded }]: { recorded: string }[] = await manager.query(
      `SELECT COALESCE(SUM(amount), 0) AS recorded FROM referral_commissions
        WHERE invoice_id = $1 AND kind <> 'ADJUSTMENT'`,
      [invoice.id],
    );
    const amount = commissionDelta(
      rule,
      invoice.amountPaid,
      invoice.total,
      recorded,
    );
    if (isZeroMoney(amount)) return;

    const now = this.time.now();
    const eligible = await this.sessionAttended(manager, invoice);
    const repository = manager.getRepository(ReferralCommission);
    const row = await repository.save(
      repository.create({
        referringDoctorId: referral.referringDoctorId,
        patientId: invoice.patientId,
        patientReferralId: referral.id,
        referralTermsId: terms.id,
        invoiceId: invoice.id,
        visitId: invoice.visitId,
        paymentId: event.paymentId,
        sourcePaymentId: event.source.id,
        kind: event.kind,
        commissionType: rule.type,
        rate: rule.value,
        baseAmount: event.source.amount,
        amount,
        status: eligible ? CommissionStatus.ELIGIBLE : CommissionStatus.PENDING,
        eligibleAt: eligible ? now : null,
        payoutId: null,
        reason: null,
        recordedById: actor.userId as string,
        recordedAt: now,
      }),
    );
    await this.auditService.logAction(
      actor,
      AuditAction.REFERRAL_COMMISSION_RECORDED,
      AuditEntityType.REFERRAL_COMMISSION,
      row.id,
      {
        newValues: {
          kind: row.kind,
          amount: row.amount,
          status: row.status,
          commissionType: row.commissionType,
          rate: row.rate,
          baseAmount: row.baseAmount,
          referringDoctorId: row.referringDoctorId,
          invoiceId: row.invoiceId,
          paymentId: row.paymentId,
          sourcePaymentId: row.sourcePaymentId,
          referralTermsId: terms.id,
          termsVersion: terms.version,
          invoiceAmountPaid: invoice.amountPaid,
          invoiceTotal: invoice.total,
        },
      },
      manager,
    );
  }

  /**
   * A package's commission becomes ELIGIBLE when one of its sessions is
   * attended, and goes back to PENDING if that attendance is undone (rows
   * a valid payout already paid, even in part, stay owed: payouts only
   * ever settle owed rows). Called in the transaction that uses or
   * restores the session; the package invoice is locked so a payment
   * recorded at the same time is either seen here or sees the session.
   */
  async syncPackageEligibility(
    manager: EntityManager,
    invoiceId: string,
  ): Promise<void> {
    await manager.findOne(Invoice, {
      where: { id: invoiceId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    const [{ attended }]: { attended: boolean }[] = await manager.query(
      `SELECT ${ATTENDED_PACKAGE_SESSION} AS attended`,
      [invoiceId],
    );
    const repository = manager.getRepository(ReferralCommission);
    if (attended) {
      await repository.update(
        { invoiceId, status: CommissionStatus.PENDING },
        { status: CommissionStatus.ELIGIBLE, eligibleAt: this.time.now() },
      );
    } else {
      await repository
        .createQueryBuilder()
        .update()
        .set({ status: CommissionStatus.PENDING, eligibleAt: null })
        .where('invoice_id = :invoiceId AND status = :eligible', {
          invoiceId,
          eligible: CommissionStatus.ELIGIBLE,
        })
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM ${VALID_ALLOCATIONS} WHERE a.commission_id = referral_commissions.id)`,
        )
        .execute();
    }
  }

  // OWNER: a signed correction with a reason, owed (or taken back) at once.
  async adjust(
    referringDoctorId: string,
    dto: CommissionAdjustmentDto,
    actor: Actor,
  ): Promise<CommissionDto> {
    const amount = toMoney(dto.amount);
    if (isZeroMoney(amount)) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'amount',
            errors: ['amount must not be 0'],
            constraints: ['isNotZero'],
          },
        ],
      });
    }
    const id = await this.dataSource.transaction(async (manager) => {
      if (
        !(await manager.existsBy(ReferringDoctor, { id: referringDoctorId }))
      ) {
        throw new NotFoundException('Referring doctor not found');
      }
      let patientReferralId: string | null = null;
      if (dto.patientId) {
        if (!(await manager.existsBy(Patient, { id: dto.patientId }))) {
          throw new NotFoundException('Patient not found');
        }
        const referral = await manager.findOne(PatientReferral, {
          where: { patientId: dto.patientId, referringDoctorId },
          order: { assignedAt: 'DESC', createdAt: 'DESC' },
        });
        patientReferralId = referral?.id ?? null;
      }
      const now = this.time.now();
      const repository = manager.getRepository(ReferralCommission);
      const row = await repository.save(
        repository.create({
          referringDoctorId,
          patientId: dto.patientId ?? null,
          patientReferralId,
          referralTermsId: null,
          invoiceId: null,
          visitId: null,
          paymentId: null,
          sourcePaymentId: null,
          kind: CommissionKind.ADJUSTMENT,
          commissionType: null,
          rate: null,
          baseAmount: null,
          amount,
          status: CommissionStatus.ELIGIBLE,
          eligibleAt: now,
          payoutId: null,
          reason: dto.reason,
          recordedById: actor.userId as string,
          recordedAt: now,
        }),
      );
      await this.auditService.logAction(
        actor,
        AuditAction.REFERRAL_COMMISSION_ADJUSTED,
        AuditEntityType.REFERRAL_COMMISSION,
        row.id,
        {
          newValues: {
            referringDoctorId,
            patientId: row.patientId,
            amount,
            reason: dto.reason,
          },
        },
        manager,
      );
      return row.id;
    });
    return this.findOne(id);
  }

  async list(
    referringDoctorId: string,
    query: ListCommissionsQueryDto,
  ): Promise<Paginated<CommissionDto>> {
    await this.assertDoctor(referringDoctorId);
    const qb = this.dataSource
      .getRepository(ReferralCommission)
      .createQueryBuilder('row')
      .innerJoinAndSelect('row.referringDoctor', 'referringDoctor')
      .innerJoinAndSelect('row.recordedBy', 'recordedBy')
      .leftJoinAndSelect('row.patient', 'patient')
      .leftJoinAndSelect('row.invoice', 'invoice')
      .leftJoinAndSelect('row.payment', 'payment')
      .leftJoinAndSelect('row.sourcePayment', 'sourcePayment')
      .leftJoinAndSelect('row.referralTerms', 'referralTerms')
      .where('row.referringDoctorId = :referringDoctorId', {
        referringDoctorId,
      })
      .orderBy('row.recordedAt', 'DESC')
      .addOrderBy('row.createdAt', 'DESC')
      .addOrderBy('row.id', 'DESC')
      .skip(query.skip)
      .take(query.limit);
    if (query.status) {
      qb.andWhere('row.status = :status', { status: query.status });
    }
    if (query.patientId) {
      qb.andWhere('row.patientId = :patientId', { patientId: query.patientId });
    }
    const { start, end } = this.time.dateRange(query.from, query.to);
    if (start) qb.andWhere('row.recordedAt >= :start', { start });
    if (end) qb.andWhere('row.recordedAt < :end', { end });
    const [rows, total] = await qb.getManyAndCount();
    return toPaginated(await this.toDtos(rows), total, query);
  }

  // Every row about the patient, newest first.
  async forPatient(patientId: string): Promise<CommissionDto[]> {
    const rows = await this.dataSource.getRepository(ReferralCommission).find({
      where: { patientId },
      relations: RELATIONS,
      order: { recordedAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
    });
    return this.toDtos(rows);
  }

  /**
   * The doctor's balance at the end of a local day (default today): rows
   * recorded by then, owed if they were eligible by then, and payouts
   * dated up to that day. outstanding = earned - reversed + adjustments -
   * pending - paid.
   */
  async balance(
    referringDoctorId: string,
    asOf?: string,
  ): Promise<CommissionBalanceDto> {
    await this.assertDoctor(referringDoctorId);
    const day = asOf ?? this.time.today();
    const { end } = this.time.dayBounds(day);
    const [row]: Record<string, string>[] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE recorded_at < $2 AND (status = 'PENDING' OR eligible_at >= $2)), 0) AS pending,
         COALESCE(SUM(amount) FILTER (WHERE status <> 'PENDING' AND eligible_at < $2), 0) AS owed,
         COALESCE(SUM(amount) FILTER (WHERE kind IN ('EARNED', 'REFUND_VOIDED') AND recorded_at < $2), 0) AS earned,
         COALESCE(-SUM(amount) FILTER (WHERE kind IN ('REFUND_REVERSAL', 'VOID_REVERSAL') AND recorded_at < $2), 0) AS reversed,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'ADJUSTMENT' AND recorded_at < $2), 0) AS adjustments,
         (SELECT COALESCE(SUM(amount), 0) FROM referral_payouts
           WHERE referring_doctor_id = $1 AND status = 'VALID' AND payout_date <= $3) AS paid
       FROM referral_commissions WHERE referring_doctor_id = $1`,
      [referringDoctorId, end, day],
    );
    return {
      asOf: day,
      pending: toMoney(row.pending),
      outstanding: subMoney(row.owed, row.paid),
      paid: toMoney(row.paid),
      earned: toMoney(row.earned),
      reversed: toMoney(row.reversed),
      adjustments: toMoney(row.adjustments),
    };
  }

  private async findOne(id: string): Promise<CommissionDto> {
    const row = await this.dataSource
      .getRepository(ReferralCommission)
      .findOne({
        where: { id },
        relations: RELATIONS,
      });
    if (!row) throw new NotFoundException('Commission not found');
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  private async toDtos(rows: ReferralCommission[]): Promise<CommissionDto[]> {
    const paid = await paidAmounts(
      this.dataSource.manager,
      rows.map((r) => r.id),
    );
    const toIso = (d: Date) => this.time.toIso(d);
    return rows.map((r) => toCommission(r, paid.get(r.id) ?? ZERO, toIso));
  }

  /**
   * The session behind the money was attended: always for a visit's
   * invoice (it exists only once the patient attended); for a package
   * sale, once one of its sessions was attended (and not undone).
   */
  private async sessionAttended(
    manager: EntityManager,
    invoice: Invoice,
  ): Promise<boolean> {
    if (invoice.visitId) return true;
    const [{ attended }]: { attended: boolean }[] = await manager.query(
      `SELECT ${ATTENDED_PACKAGE_SESSION} AS attended`,
      [invoice.id],
    );
    return attended;
  }

  private async assertDoctor(id: string): Promise<void> {
    if (!(await this.dataSource.manager.existsBy(ReferringDoctor, { id }))) {
      throw new NotFoundException('Referring doctor not found');
    }
  }
}
