import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  toPaginated,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  compareMoney,
  dec,
  percentageOfBase,
  toMoney,
} from '../../common/utils/money.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { PackageUsage } from '../packages/entities/package-usage.entity.js';
import { PatientPackage } from '../packages/entities/patient-package.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type { PatientReferralTerms } from '../referrals/entities/patient-referral-terms.entity.js';
import { PatientReferralsService } from '../referrals/patient-referrals.service.js';
import { referralDiscountRule } from '../referrals/referral-math.js';
import { referralDiscountReason } from '../referrals/referrals.constants.js';
import { DiscountType, InvoiceStatus } from './billing.enums.js';
import type {
  ApplyDiscountDto,
  DiscountHistoryEntryDto,
  LastDiscountDto,
} from './dto/discount.dto.js';
import type { InvoiceDetailDto } from './dto/invoice.dto.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
import { discountAmount, type DiscountRule } from './invoice-math.js';
import { InvoicesService } from './invoices.service.js';

interface DiscountRequest {
  rule: DiscountRule;
  reason: string;
  repeatedFromId: string | null;
}

// previewReferral: `terms` has patientReferral.referringDoctor set.
export type ReferralPreview =
  | {
      covered: true;
      terms: PatientReferralTerms;
      discount: {
        type: DiscountType;
        value: string;
        amount: string;
        reason: string;
      } | null;
    }
  | { covered: false; reason: string };

@Injectable()
export class DiscountsService {
  private readonly receptionistMaxPercent: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly referrals: PatientReferralsService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.receptionistMaxPercent = String(
      config.get('RECEPTIONIST_MAX_DISCOUNT_PERCENT', { infer: true }),
    );
  }

  /**
   * Applies (or replaces) the invoice's discount. Replacing soft-removes the
   * current row and inserts a new one, so the history is kept. A repeated
   * discount copies type/value/reason from one of the same patient's desk
   * discounts (not a referral's, not on a cancelled invoice) and recomputes
   * the amount here; the source is never touched.
   */
  async apply(
    invoiceId: string,
    dto: ApplyDiscountDto,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      await this.invoices.assertInvoiceEditable(invoice, manager);

      const request = await this.resolveRequest(dto, invoice, manager);
      const amount = discountAmount(invoice.subtotal, request.rule);
      this.assertWithinRoleLimit(request.rule, amount, invoice.subtotal, actor);
      await this.write(manager, invoice, { ...request, amount }, actor);
    });
    return this.invoices.findOne(invoiceId);
  }

  /**
   * In the caller's transaction, right after a session's invoice (attend,
   * walk-in) or a package sale's invoice is created: if the patient's active
   * referral covers it, pins the terms on the invoice and applies the
   * referral discount (applied by the caller's actor). Visits paid by a
   * package session (0.00) and manual invoices are never covered.
   */
  async applyReferral(
    manager: EntityManager,
    invoice: Invoice,
    actor: Actor,
    sessionDate?: string,
  ): Promise<{ applied: true } | { applied: false; reason: string }> {
    if (invoice.referralTermsId) {
      return { applied: false, reason: 'ALREADY_APPLIED' };
    }
    if (
      !invoice.visitId &&
      !(await manager.existsBy(PatientPackage, { invoiceId: invoice.id }))
    ) {
      return { applied: false, reason: 'MANUAL_INVOICE' };
    }
    if (
      invoice.visitId &&
      (await this.isPackageSession(manager, invoice.visitId))
    ) {
      return { applied: false, reason: 'PACKAGE_SESSION' };
    }
    const coverage = await this.referrals.coverInvoice(
      manager,
      invoice,
      actor,
      sessionDate,
    );
    if (!coverage.covered) return { applied: false, reason: coverage.reason };

    const rule = referralDiscountRule(
      {
        type: coverage.terms.discountType,
        value: coverage.terms.discountValue,
      },
      invoice.subtotal,
    );
    if (rule) {
      await this.write(
        manager,
        invoice,
        {
          rule,
          amount: discountAmount(invoice.subtotal, rule),
          reason: referralDiscountReason(coverage.doctorName),
          repeatedFromId: null,
          referralTermsId: coverage.terms.id,
        },
        actor,
      );
    }
    return { applied: true };
  }

  /**
   * What applyReferral would give a new invoice of the visit `visitId`
   * (subtotal `subtotal`, session on the local date `sessionDate`): the
   * covering terms and the referral discount, or why it is not covered.
   * Writes nothing (the billing correction preview).
   */
  async previewReferral(
    manager: EntityManager,
    data: {
      patientId: string;
      visitId: string;
      subtotal: string;
      sessionDate: string;
    },
  ): Promise<ReferralPreview> {
    if (await this.isPackageSession(manager, data.visitId)) {
      return { covered: false, reason: 'PACKAGE_SESSION' };
    }
    const coverage = await this.referrals.resolveCoverage(
      manager,
      data.patientId,
      data.sessionDate,
      false,
    );
    if (!coverage.covered) return coverage;
    const { terms, doctor } = coverage;
    const rule = referralDiscountRule(
      { type: terms.discountType, value: terms.discountValue },
      data.subtotal,
    );
    return {
      covered: true,
      terms: Object.assign(terms, {
        patientReferral: { ...coverage.referral, referringDoctor: doctor },
      }),
      discount: rule && {
        type: rule.type,
        value: toMoney(rule.value),
        amount: discountAmount(data.subtotal, rule),
        reason: referralDiscountReason(doctor.name),
      },
    };
  }

  private isPackageSession(
    manager: EntityManager,
    visitId: string,
  ): Promise<boolean> {
    return manager.existsBy(PackageUsage, { visitId, restoredAt: IsNull() });
  }

  /**
   * The referral was recorded after the invoice was issued: covers it now,
   * if nothing has been paid yet (same rule as any discount).
   */
  async applyReferralToInvoice(
    invoiceId: string,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      await this.invoices.assertInvoiceEditable(invoice, manager);
      const result = await this.applyReferral(manager, invoice, actor);
      if (!result.applied) {
        throw unprocessable(
          ErrorCode.REFERRAL_NOT_APPLICABLE,
          'The referral does not cover this invoice',
          { reason: result.reason },
        );
      }
    });
    return this.invoices.findOne(invoiceId);
  }

  // Replaces the active discount (history kept), recalculates, audits.
  private async write(
    manager: EntityManager,
    invoice: Invoice,
    request: DiscountRequest & { amount: string; referralTermsId?: string },
    actor: Actor,
  ): Promise<void> {
    const previous = await this.invoices.activeDiscount(invoice.id, manager);
    if (previous) await this.softRemove(manager, previous, 'Replaced', actor);

    const repository = manager.getRepository(InvoiceDiscount);
    const discount = await repository.save(
      repository.create({
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        type: request.rule.type,
        value: toMoney(request.rule.value),
        amount: request.amount,
        reason: request.reason,
        repeatedFromId: request.repeatedFromId,
        referralTermsId: request.referralTermsId ?? null,
        appliedById: actor.userId as string,
        appliedAt: this.time.now(),
        removedAt: null,
        removedById: null,
        removalReason: null,
      }),
    );
    const updated = await this.invoices.recalculate(manager, invoice);

    await this.auditService.logAction(
      actor,
      AuditAction.DISCOUNT_APPLIED,
      AuditEntityType.INVOICE,
      invoice.id,
      {
        oldValues: previous ? this.values(previous) : null,
        newValues: { ...this.values(discount), invoiceTotal: updated.total },
      },
      manager,
    );
  }

  async remove(
    invoiceId: string,
    reason: string,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      await this.invoices.assertInvoiceEditable(invoice, manager);
      const discount = await this.invoices.activeDiscount(invoice.id, manager);
      if (!discount) throw new NotFoundException('The invoice has no discount');

      await this.softRemove(manager, discount, reason, actor);
      const updated = await this.invoices.recalculate(manager, invoice);
      await this.auditService.logAction(
        actor,
        AuditAction.DISCOUNT_REMOVED,
        AuditEntityType.INVOICE,
        invoice.id,
        {
          oldValues: this.values(discount),
          newValues: { reason, invoiceTotal: updated.total },
        },
        manager,
      );
    });
    return this.invoices.findOne(invoiceId);
  }

  /**
   * The patient's most recent desk discount (not a doctor referral's) that
   * is still applied, on an invoice that is not cancelled (and not
   * `excludeInvoiceId`); null if none. Exactly what `apply` can repeat.
   */
  async lastForPatient(
    patientId: string,
    excludeInvoiceId?: string,
  ): Promise<LastDiscountDto | null> {
    await this.assertPatientExists(patientId);
    const qb = this.dataSource
      .getRepository(InvoiceDiscount)
      .createQueryBuilder('discount')
      .innerJoinAndSelect('discount.invoice', 'invoice')
      .innerJoinAndSelect('discount.appliedBy', 'appliedBy')
      .where('discount.patientId = :patientId', { patientId })
      .andWhere('discount.removedAt IS NULL')
      .andWhere('discount.referralTermsId IS NULL')
      .andWhere('invoice.status <> :cancelled', {
        cancelled: InvoiceStatus.CANCELLED,
      })
      .orderBy('discount.appliedAt', 'DESC')
      .addOrderBy('discount.createdAt', 'DESC');
    if (excludeInvoiceId) {
      qb.andWhere('discount.invoiceId <> :excludeInvoiceId', {
        excludeInvoiceId,
      });
    }
    const discount = await qb.getOne();
    if (!discount?.invoice) return null;
    return {
      id: discount.id,
      invoiceId: discount.invoiceId,
      invoiceNumber: discount.invoice.invoiceNumber,
      type: discount.type,
      value: discount.value,
      amount: discount.amount,
      reason: discount.reason,
      appliedBy: UserRefDto.fromEntity(discount.appliedBy),
      appliedAt: this.time.toIso(discount.appliedAt),
    };
  }

  /**
   * Every discount of the patient, newest first: active, removed and
   * replaced ones, also on cancelled invoices (invoiceStatus tells).
   */
  async historyForPatient(
    patientId: string,
    page: PaginationQueryDto,
  ): Promise<Paginated<DiscountHistoryEntryDto>> {
    await this.assertPatientExists(patientId);
    const [rows, total] = await this.dataSource
      .getRepository(InvoiceDiscount)
      .createQueryBuilder('discount')
      .innerJoinAndSelect('discount.invoice', 'invoice')
      .innerJoinAndSelect('discount.appliedBy', 'appliedBy')
      .leftJoinAndSelect('discount.removedBy', 'removedBy')
      .where('discount.patientId = :patientId', { patientId })
      .orderBy('discount.appliedAt', 'DESC')
      .addOrderBy('discount.createdAt', 'DESC')
      .addOrderBy('discount.id', 'DESC')
      .skip(page.skip)
      .take(page.limit)
      .getManyAndCount();
    const toIso = (d: Date) => this.time.toIso(d);
    return toPaginated(
      rows.map((discount) => ({
        id: discount.id,
        invoiceId: discount.invoiceId,
        invoiceNumber: discount.invoice!.invoiceNumber,
        invoiceStatus: discount.invoice!.status,
        type: discount.type,
        value: discount.value,
        amount: discount.amount,
        reason: discount.reason,
        appliedBy: UserRefDto.fromEntity(discount.appliedBy),
        appliedAt: toIso(discount.appliedAt),
        removedAt: discount.removedAt && toIso(discount.removedAt),
        removedBy: discount.removedBy
          ? UserRefDto.fromEntity(discount.removedBy)
          : null,
        removalReason: discount.removalReason,
      })),
      total,
      page,
    );
  }

  private async assertPatientExists(patientId: string): Promise<void> {
    const exists = await this.dataSource
      .getRepository(Patient)
      .existsBy({ id: patientId });
    if (!exists) throw new NotFoundException('Patient not found');
  }

  private async resolveRequest(
    dto: ApplyDiscountDto,
    invoice: Invoice,
    manager: EntityManager,
  ): Promise<DiscountRequest> {
    if (dto.repeatFromDiscountId !== undefined) {
      if (
        dto.type !== undefined ||
        dto.value !== undefined ||
        dto.reason !== undefined
      ) {
        throw new BadRequestException(
          'Send either { type, value, reason } or { repeatFromDiscountId }, not both',
        );
      }
      const source = await manager.getRepository(InvoiceDiscount).findOne({
        where: { id: dto.repeatFromDiscountId },
        relations: { invoice: true },
      });
      if (!source) throw new NotFoundException('Discount to repeat not found');
      if (source.patientId !== invoice.patientId) {
        throw unprocessable(
          ErrorCode.DISCOUNT_PATIENT_MISMATCH,
          'A discount can only be repeated for the same patient',
        );
      }
      // A referral discount belongs to the referral terms pinned on its
      // invoice (a new session gets the current referral's discount by
      // itself), and a cancelled invoice is history: copying either would
      // put another doctor's or a voided invoice's values on this invoice.
      if (
        source.referralTermsId ||
        source.invoice?.status === InvoiceStatus.CANCELLED
      ) {
        throw unprocessable(
          ErrorCode.DISCOUNT_NOT_REPEATABLE,
          'Only a desk discount on an invoice that is not cancelled can be repeated',
          {
            reason: source.referralTermsId
              ? 'REFERRAL_DISCOUNT'
              : 'INVOICE_CANCELLED',
          },
        );
      }
      return {
        rule: { type: source.type, value: source.value },
        reason: source.reason,
        repeatedFromId: source.id,
      };
    }

    // value > 0 is checked by the DTO; the upper bound depends on the type.
    const rule = { type: dto.type as DiscountType, value: dto.value as string };
    if (
      rule.type === DiscountType.PERCENT &&
      dec(rule.value).greaterThan(100)
    ) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'value',
            errors: [
              'A percent discount must be greater than 0 and at most 100',
            ],
            constraints: ['max'],
          },
        ],
      });
    }
    return { rule, reason: dto.reason as string, repeatedFromId: null };
  }

  /**
   * RECEPTIONIST discounts are capped (RECEPTIONIST_MAX_DISCOUNT_PERCENT).
   * The effective percentage is the percent value itself, or the fixed
   * amount relative to the subtotal. OWNER has no limit.
   */
  private assertWithinRoleLimit(
    rule: DiscountRule,
    amount: string,
    subtotal: string,
    actor: Actor,
  ): void {
    if (actor.role !== UserRole.RECEPTIONIST) return;
    const effective =
      rule.type === DiscountType.PERCENT
        ? dec(rule.value)
        : percentageOfBase(amount, subtotal);
    if (compareMoney(effective, this.receptionistMaxPercent) > 0) {
      throw unprocessable(
        ErrorCode.DISCOUNT_LIMIT_EXCEEDED,
        `Receptionists can give at most ${this.receptionistMaxPercent}% discount`,
        {
          maxPercent: toMoney(this.receptionistMaxPercent),
          effectivePercent: toMoney(effective),
        },
      );
    }
  }

  private async softRemove(
    manager: EntityManager,
    discount: InvoiceDiscount,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    discount.removedAt = this.time.now();
    discount.removedById = actor.userId;
    discount.removalReason = reason;
    await manager.getRepository(InvoiceDiscount).save(discount);
  }

  private values(discount: InvoiceDiscount): Record<string, unknown> {
    return {
      discountId: discount.id,
      type: discount.type,
      value: discount.value,
      amount: discount.amount,
      reason: discount.reason,
      repeatedFromId: discount.repeatedFromId,
      referralTermsId: discount.referralTermsId,
    };
  }
}
