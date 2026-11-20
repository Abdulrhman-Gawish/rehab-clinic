import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { compareMoney, toMoney } from '../../common/utils/money.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AcquisitionSourcesService } from '../acquisition/acquisition-sources.service.js';
import { AcquisitionChannel } from '../acquisition/acquisition.enums.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type {
  AssignReferralDto,
  PatientReferralDto,
  ReferralTermsInputDto,
} from './dto/referrals.dto.js';
import { PatientReferralTerms } from './entities/patient-referral-terms.entity.js';
import {
  ACTIVE_REFERRAL_UNIQUE,
  PatientReferral,
} from './entities/patient-referral.entity.js';
import { ReferringDoctor } from './entities/referring-doctor.entity.js';
import {
  coversSession,
  isOverride,
  normalizeApplicability,
  normalizeRate,
  sameRate,
  type Applicability,
  type RateRule,
} from './referral-math.js';
import {
  commissionRule,
  discountRule,
  toPatientReferral,
} from './referral.mapper.js';
import { PatientReferralStatus, ReferralRateType } from './referrals.enums.js';
import { ReferringDoctorsService } from './referring-doctors.service.js';

interface TermsInput extends Applicability {
  commission: RateRule;
  discount: RateRule;
  overrideReason: string | null;
}

// Why an invoice is not covered (details.reason of REFERRAL_NOT_APPLICABLE).
export type NotCoveredReason = 'NO_ACTIVE_REFERRAL' | 'NOT_COVERED';

export type Coverage =
  | { covered: true; terms: PatientReferralTerms; doctorName: string }
  | { covered: false; reason: NotCoveredReason };

// What would cover one more session (resolveCoverage); nothing written.
export type CoverageOption =
  | {
      covered: true;
      referral: PatientReferral;
      terms: PatientReferralTerms;
      doctor: ReferringDoctor;
      coveredSoFar: number;
    }
  | { covered: false; reason: NotCoveredReason };

/**
 * A patient's doctor referral and its terms (versions). Reception assigns
 * the referral: the doctor's current default is loaded, and the applied
 * values may differ from it (an override, with a reason). Which sessions
 * are covered is decided once, when the session is billed, and pinned on
 * the invoice (invoices.referral_terms_id).
 */
@Injectable()
export class PatientReferralsService {
  private readonly receptionistMaxPercent: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly doctors: ReferringDoctorsService,
    private readonly sources: AcquisitionSourcesService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.receptionistMaxPercent = String(
      config.get('RECEPTIONIST_MAX_DISCOUNT_PERCENT', { infer: true }),
    );
  }

  async assign(
    patientId: string,
    dto: AssignReferralDto,
    actor: Actor,
  ): Promise<PatientReferralDto> {
    let id: string;
    try {
      id = await this.dataSource.transaction((manager) =>
        this.assignWith(manager, patientId, dto, actor),
      );
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_REFERRAL_UNIQUE)) {
        throw conflict(
          ErrorCode.REFERRAL_ALREADY_ACTIVE,
          'The patient already has an active referral; end it first',
        );
      }
      throw error;
    }
    return this.findOne(id);
  }

  /**
   * The referral, its first terms version and the DOCTOR_REFERRAL source,
   * in the caller's transaction (assign above; check-in, before the visit's
   * invoice, so that invoice is covered). Returns the referral id.
   */
  async assignWith(
    manager: EntityManager,
    patientId: string,
    dto: AssignReferralDto,
    actor: Actor,
  ): Promise<string> {
    const input = this.normalize(dto);
    if (!(await manager.existsBy(Patient, { id: patientId }))) {
      throw new NotFoundException('Patient not found');
    }
    // Friendly answer; uq_patient_referrals_active is the guarantee.
    if (
      await manager.existsBy(PatientReferral, {
        patientId,
        status: PatientReferralStatus.ACTIVE,
      })
    ) {
      throw conflict(
        ErrorCode.REFERRAL_ALREADY_ACTIVE,
        'The patient already has an active referral; end it first',
      );
    }
    const doctor = await manager.findOneBy(ReferringDoctor, {
      id: dto.referringDoctorId,
    });
    if (!doctor) throw new NotFoundException('Referring doctor not found');
    if (!doctor.isActive) {
      throw unprocessable(
        ErrorCode.REFERRING_DOCTOR_INACTIVE,
        'This referring doctor is inactive',
      );
    }
    const repository = manager.getRepository(PatientReferral);
    // uq_patient_referrals_active: one active referral per patient.
    const referral = await repository.save(
      repository.create({
        patientId,
        referringDoctorId: doctor.id,
        status: PatientReferralStatus.ACTIVE,
        assignedById: actor.userId as string,
        assignedAt: this.time.now(),
        endedAt: null,
        endedById: null,
        endReason: null,
      }),
    );
    const terms = await this.insertTerms(manager, referral, 1, input, actor);
    await this.sources.ensureChannel(
      manager,
      patientId,
      AcquisitionChannel.DOCTOR_REFERRAL,
      doctor.name,
      dto.primarySource ?? false,
      actor,
    );
    await this.audit(
      manager,
      actor,
      AuditAction.PATIENT_REFERRAL_ASSIGNED,
      referral.id,
      {
        newValues: {
          patientId,
          referringDoctorId: doctor.id,
          referringDoctor: doctor.name,
          ...this.termsValues(terms),
        },
      },
    );
    return referral.id;
  }

  /**
   * New terms version (the old one stays). Sessions already billed keep the
   * version they were billed with; the new one applies from now on.
   */
  async changeTerms(
    referralId: string,
    dto: ReferralTermsInputDto,
    actor: Actor,
  ): Promise<PatientReferralDto> {
    const input = this.normalize(dto);
    await this.dataSource.transaction(async (manager) => {
      const referral = await this.lockActive(referralId, manager);
      const previous = await this.latestTerms(manager, referral.id);
      if (this.sameTerms(previous, input)) return;
      const terms = await this.insertTerms(
        manager,
        referral,
        previous.version + 1,
        input,
        actor,
      );
      await this.audit(
        manager,
        actor,
        AuditAction.PATIENT_REFERRAL_TERMS_CHANGED,
        referral.id,
        {
          oldValues: this.termsValues(previous),
          newValues: this.termsValues(terms),
        },
      );
    });
    return this.findOne(referralId);
  }

  // No new session is covered after this; history and commissions stay.
  async end(
    referralId: string,
    reason: string,
    actor: Actor,
  ): Promise<PatientReferralDto> {
    await this.dataSource.transaction(async (manager) => {
      const referral = await this.lockActive(referralId, manager);
      referral.status = PatientReferralStatus.ENDED;
      referral.endedAt = this.time.now();
      referral.endedById = actor.userId;
      referral.endReason = reason;
      await manager.getRepository(PatientReferral).save(referral);
      await this.audit(
        manager,
        actor,
        AuditAction.PATIENT_REFERRAL_ENDED,
        referral.id,
        {
          oldValues: { status: PatientReferralStatus.ACTIVE },
          newValues: { status: referral.status, reason },
        },
      );
    });
    return this.findOne(referralId);
  }

  // Newest first.
  async forPatient(patientId: string): Promise<PatientReferralDto[]> {
    if (!(await this.dataSource.manager.existsBy(Patient, { id: patientId }))) {
      throw new NotFoundException('Patient not found');
    }
    const referrals = await this.dataSource
      .getRepository(PatientReferral)
      .find({
        where: { patientId },
        order: { assignedAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
      });
    return this.toDtos(referrals.map((r) => r.id));
  }

  async findOne(id: string): Promise<PatientReferralDto> {
    const [dto] = await this.toDtos([id]);
    if (!dto) throw new NotFoundException('Referral not found');
    return dto;
  }

  async toDtos(ids: string[]): Promise<PatientReferralDto[]> {
    if (ids.length === 0) return [];
    const referrals = await this.dataSource
      .getRepository(PatientReferral)
      .find({
        where: { id: In(ids) },
        relations: {
          patient: true,
          referringDoctor: true,
          assignedBy: true,
          endedBy: true,
        },
      });
    const terms = await this.dataSource
      .getRepository(PatientReferralTerms)
      .find({
        where: { patientReferralId: In(ids) },
        relations: { doctorAgreement: true, createdBy: true },
        order: { version: 'DESC' },
      });
    const covered = await this.coveredCounts(this.dataSource.manager, ids);
    const byId = new Map(referrals.map((r) => [r.id, r]));
    const toIso = (d: Date) => this.time.toIso(d);
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is PatientReferral => r !== undefined)
      .map((r) =>
        toPatientReferral(
          r,
          terms.filter((t) => t.patientReferralId === r.id),
          covered.get(r.id) ?? 0,
          toIso,
        ),
      );
  }

  /**
   * Whether the patient's active referral covers one more session on the
   * clinic local date `sessionDate`, and with which terms (its latest).
   * With `lock` the referral row is locked (billing), so parallel attends
   * can't both take the last covered session. Writes nothing.
   */
  async resolveCoverage(
    manager: EntityManager,
    patientId: string,
    sessionDate: string,
    lock: boolean,
  ): Promise<CoverageOption> {
    const referral = await manager.findOne(PatientReferral, {
      where: { patientId, status: PatientReferralStatus.ACTIVE },
      lock: lock ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!referral) return { covered: false, reason: 'NO_ACTIVE_REFERRAL' };
    const terms = await this.latestTerms(manager, referral.id);
    const coveredSoFar =
      (await this.coveredCounts(manager, [referral.id])).get(referral.id) ?? 0;
    if (!coversSession(terms, coveredSoFar, sessionDate)) {
      return { covered: false, reason: 'NOT_COVERED' };
    }
    const doctor = await manager.findOneByOrFail(ReferringDoctor, {
      id: referral.referringDoctorId,
    });
    return { covered: true, referral, terms, doctor, coveredSoFar };
  }

  /**
   * In the caller's transaction, when a session (visit invoice or package
   * sale) is billed: if the patient's active referral covers one more
   * session, pins its latest terms on the invoice. The session date is the
   * invoice's issue date unless given (a replacement invoice: the visit's).
   */
  async coverInvoice(
    manager: EntityManager,
    invoice: Invoice,
    actor: Actor,
    sessionDate = this.time.localDate(invoice.issuedAt),
  ): Promise<Coverage> {
    const coverage = await this.resolveCoverage(
      manager,
      invoice.patientId,
      sessionDate,
      true,
    );
    if (!coverage.covered) return coverage;
    const { referral, terms, doctor, coveredSoFar } = coverage;
    await manager.update(
      Invoice,
      { id: invoice.id },
      { referralTermsId: terms.id },
    );
    invoice.referralTermsId = terms.id;
    await this.auditService.logAction(
      actor,
      AuditAction.REFERRAL_APPLIED,
      AuditEntityType.INVOICE,
      invoice.id,
      {
        newValues: {
          referralId: referral.id,
          referringDoctorId: doctor.id,
          referringDoctor: doctor.name,
          referralTermsId: terms.id,
          termsVersion: terms.version,
          coveredSession: coveredSoFar + 1,
        },
      },
      manager,
    );
    return { covered: true, terms, doctorName: doctor.name };
  }

  // ---------- Internals ----------

  private normalize(dto: ReferralTermsInputDto): TermsInput {
    return {
      commission: normalizeRate(
        'commission',
        dto.commission.type,
        dto.commission.value,
      ),
      discount: normalizeRate(
        'discount',
        dto.discount.type,
        dto.discount.value,
      ),
      ...normalizeApplicability(dto.applicability),
      overrideReason: dto.overrideReason ?? null,
    };
  }

  /**
   * Writes a terms version against the doctor's default in force today.
   * Differing from it is an override: a reason is required, and a
   * RECEPTIONIST's own percent discount stays within the desk discount cap.
   */
  private async insertTerms(
    manager: EntityManager,
    referral: PatientReferral,
    version: number,
    input: TermsInput,
    actor: Actor,
  ): Promise<PatientReferralTerms> {
    const agreement = await this.doctors.currentFor(
      manager,
      referral.referringDoctorId,
    );
    const defaults = {
      commission: commissionRule(agreement),
      discount: discountRule(agreement),
    };
    const override = isOverride(input, defaults);
    if (override && (input.overrideReason?.length ?? 0) < 3) {
      throw unprocessable(
        ErrorCode.OVERRIDE_REASON_REQUIRED,
        "The values differ from the doctor's default: give a reason",
        defaults,
      );
    }
    if (!sameRate(input.discount, defaults.discount)) {
      this.assertDiscountCap(input.discount, actor);
    }
    const repository = manager.getRepository(PatientReferralTerms);
    const terms = await repository.save(
      repository.create({
        patientReferralId: referral.id,
        version,
        doctorAgreementId: agreement.id,
        commissionType: input.commission.type,
        commissionValue: input.commission.value,
        discountType: input.discount.type,
        discountValue: input.discount.value,
        applicability: input.applicability,
        maxSessions: input.maxSessions,
        validFrom: input.validFrom,
        validTo: input.validTo,
        isOverride: override,
        overrideReason: override ? input.overrideReason : null,
        createdById: actor.userId as string,
        recordedAt: this.time.now(),
      }),
    );
    terms.doctorAgreement = agreement;
    return terms;
  }

  private assertDiscountCap(discount: RateRule, actor: Actor): void {
    if (
      actor.role !== UserRole.RECEPTIONIST ||
      discount.type !== ReferralRateType.PERCENT ||
      discount.value === null
    ) {
      return;
    }
    if (compareMoney(discount.value, this.receptionistMaxPercent) > 0) {
      throw unprocessable(
        ErrorCode.DISCOUNT_LIMIT_EXCEEDED,
        `Receptionists can give at most ${this.receptionistMaxPercent}% discount`,
        {
          maxPercent: toMoney(this.receptionistMaxPercent),
          effectivePercent: discount.value,
        },
      );
    }
  }

  private sameTerms(
    previous: PatientReferralTerms,
    input: TermsInput,
  ): boolean {
    return (
      sameRate(commissionRule(previous), input.commission) &&
      sameRate(discountRule(previous), input.discount) &&
      previous.applicability === input.applicability &&
      previous.maxSessions === input.maxSessions &&
      previous.validFrom === input.validFrom &&
      previous.validTo === input.validTo &&
      (!previous.isOverride || previous.overrideReason === input.overrideReason)
    );
  }

  private termsValues(terms: PatientReferralTerms): Record<string, unknown> {
    const agreement = terms.doctorAgreement;
    return {
      referralTermsId: terms.id,
      termsVersion: terms.version,
      defaultAgreementId: terms.doctorAgreementId,
      defaultAgreementVersion: agreement?.version ?? null,
      defaultCommission: agreement ? commissionRule(agreement) : null,
      defaultDiscount: agreement ? discountRule(agreement) : null,
      commission: commissionRule(terms),
      discount: discountRule(terms),
      applicability: terms.applicability,
      maxSessions: terms.maxSessions,
      validFrom: terms.validFrom,
      validTo: terms.validTo,
      isOverride: terms.isOverride,
      overrideReason: terms.overrideReason,
    };
  }

  private async latestTerms(
    manager: EntityManager,
    referralId: string,
  ): Promise<PatientReferralTerms> {
    const terms = await manager.findOne(PatientReferralTerms, {
      where: { patientReferralId: referralId },
      relations: { doctorAgreement: true },
      order: { version: 'DESC' },
    });
    if (!terms) throw new Error('Referral without terms');
    return terms;
  }

  // Sessions each referral covers: non-cancelled invoices pinned to any of
  // its terms versions.
  private async coveredCounts(
    manager: EntityManager,
    referralIds: string[],
  ): Promise<Map<string, number>> {
    const rows: { id: string; covered: string }[] = await manager.query(
      `SELECT t.patient_referral_id AS id, COUNT(i.id) AS covered
         FROM patient_referral_terms t
         JOIN invoices i ON i.referral_terms_id = t.id AND i.status <> 'CANCELLED'
        WHERE t.patient_referral_id = ANY($1)
        GROUP BY t.patient_referral_id`,
      [referralIds],
    );
    return new Map(rows.map((r) => [r.id, Number(r.covered)]));
  }

  private async lockActive(
    id: string,
    manager: EntityManager,
  ): Promise<PatientReferral> {
    const referral = await manager.findOne(PatientReferral, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!referral) throw new NotFoundException('Referral not found');
    if (referral.status !== PatientReferralStatus.ACTIVE) {
      throw unprocessable(ErrorCode.REFERRAL_ENDED, 'The referral has ended');
    }
    return referral;
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    id: string,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.PATIENT_REFERRAL,
      id,
      values,
      manager,
    );
  }
}
