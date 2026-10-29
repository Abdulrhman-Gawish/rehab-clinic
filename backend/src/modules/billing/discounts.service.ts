import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import {
  ErrorCode,
  notFound,
  unprocessable,
} from '../../common/errors/app.exception.js';
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
import { Patient } from '../patients/entities/patient.entity.js';
import { DiscountType, InvoiceStatus } from './billing.enums.js';
import type { ApplyDiscountDto, LastDiscountDto } from './dto/discount.dto.js';
import type { InvoiceDetailDto } from './dto/invoice.dto.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
import {
  assertEditable,
  discountAmount,
  type DiscountRule,
} from './invoice-math.js';
import { InvoicesService } from './invoices.service.js';

interface DiscountRequest {
  rule: DiscountRule;
  reason: string;
  repeatedFromId: string | null;
}

@Injectable()
export class DiscountsService {
  private readonly receptionistMaxPercent: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
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
   * discount copies type/value/reason from one of the same patient's
   * discounts and recomputes the amount here; the source is never touched.
   */
  async apply(
    invoiceId: string,
    dto: ApplyDiscountDto,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      assertEditable(invoice);

      const request = await this.resolveRequest(dto, invoice, manager);
      const amount = discountAmount(invoice.subtotal, request.rule);
      this.assertWithinRoleLimit(request.rule, amount, invoice.subtotal, actor);

      const previous = await this.invoices.activeDiscount(invoice.id, manager);
      if (previous) await this.softRemove(manager, previous, 'Replaced', actor);

      const repository = manager.getRepository(InvoiceDiscount);
      const discount = await repository.save(
        repository.create({
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          type: request.rule.type,
          value: toMoney(request.rule.value),
          amount,
          reason: request.reason,
          repeatedFromId: request.repeatedFromId,
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
    });
    return this.invoices.findOne(invoiceId);
  }

  async remove(
    invoiceId: string,
    reason: string,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      assertEditable(invoice);
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
   * The patient's most recent discount that is still applied, on an invoice
   * that is not cancelled.
   */
  async lastForPatient(patientId: string): Promise<LastDiscountDto> {
    if (
      !(await this.dataSource
        .getRepository(Patient)
        .existsBy({ id: patientId }))
    ) {
      throw new NotFoundException('Patient not found');
    }
    const discount = await this.dataSource
      .getRepository(InvoiceDiscount)
      .createQueryBuilder('discount')
      .innerJoinAndSelect('discount.invoice', 'invoice')
      .where('discount.patientId = :patientId', { patientId })
      .andWhere('discount.removedAt IS NULL')
      .andWhere('invoice.status <> :cancelled', {
        cancelled: InvoiceStatus.CANCELLED,
      })
      .orderBy('discount.appliedAt', 'DESC')
      .addOrderBy('discount.createdAt', 'DESC')
      .getOne();
    if (!discount?.invoice) {
      throw notFound(
        ErrorCode.NO_PREVIOUS_DISCOUNT,
        'This patient has no previous discount',
      );
    }
    return {
      id: discount.id,
      invoiceId: discount.invoiceId,
      invoiceNumber: discount.invoice.invoiceNumber,
      type: discount.type,
      value: discount.value,
      amount: discount.amount,
      reason: discount.reason,
      appliedById: discount.appliedById,
      appliedAt: this.time.toIso(discount.appliedAt),
    };
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
      const source = await manager
        .getRepository(InvoiceDiscount)
        .findOneBy({ id: dto.repeatFromDiscountId });
      if (!source) throw new NotFoundException('Discount to repeat not found');
      if (source.patientId !== invoice.patientId) {
        throw unprocessable(
          ErrorCode.DISCOUNT_PATIENT_MISMATCH,
          'A discount can only be repeated for the same patient',
        );
      }
      return {
        rule: { type: source.type, value: source.value },
        reason: source.reason,
        repeatedFromId: source.id,
      };
    }

    const rule = { type: dto.type as DiscountType, value: dto.value as string };
    const value = dec(rule.value);
    if (
      value.lessThanOrEqualTo(0) ||
      (rule.type === DiscountType.PERCENT && value.greaterThan(100))
    ) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'value',
            errors: [
              rule.type === DiscountType.PERCENT
                ? 'A percent discount must be greater than 0 and at most 100'
                : 'A fixed discount must be greater than 0',
            ],
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
    };
  }
}
