import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { subMoney, ZERO } from '../../common/utils/money.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type { PatientReferralTerms } from '../referrals/entities/patient-referral-terms.entity.js';
import { Visit } from '../visits/entities/visit.entity.js';
import {
  InvoiceStatus,
  PaymentStatus,
  ReplacementAction,
  ReplacementBlocker,
} from './billing.enums.js';
import { DiscountsService } from './discounts.service.js';
import type {
  InvoiceCorrectionSideDto,
  InvoiceDetailDto,
  InvoiceReplacementPreviewDto,
} from './dto/invoice.dto.js';
import {
  Invoice,
  INVOICE_REPLACES_UNIQUE,
  INVOICE_VISIT_UNIQUE,
} from './entities/invoice.entity.js';
import { Payment } from './entities/payment.entity.js';
import { toCorrectionSide } from './invoice.mapper.js';
import { InvoicesService } from './invoices.service.js';

type Facts = Awaited<ReturnType<InvoicesService['replacementFacts']>>;

// details.reason of INVOICE_NOT_REPLACEABLE, with its message.
const NOT_REPLACEABLE: Record<string, string> = {
  [ReplacementBlocker.NOT_A_SESSION_INVOICE]:
    'Only the invoice of a session (attend or walk-in) can be replaced',
  [ReplacementBlocker.VISIT_VOIDED]:
    'The attendance was undone; there is no session to invoice',
  [ReplacementBlocker.HAS_PAYMENTS]:
    'The invoice has payments or refunds; only an invoice whose receipts were all voided can be corrected',
  [ReplacementBlocker.NO_REFERRAL]:
    'The invoice has no doctor referral; record the referral and apply it to the invoice instead',
  [ReplacementBlocker.REFERRAL_ACTIVE]:
    'The referral on the invoice is still active; end it (and record the correct one) first',
  CANCELLED: 'The invoice is already cancelled; reissue it instead',
  NOT_CANCELLED:
    'Only a cancelled invoice is reissued; correct or cancel this one first',
};

/**
 * Replacement invoices: a new invoice of the SAME visit, linked to the one
 * it replaces (replaces_invoice_id), with the same lines and the patient's
 * current referral and discount. The replaced invoice keeps everything it
 * had (number, referral, discount, receipts, commission rows) and the
 * attendance never changes.
 * - correct: a live invoice billed with a referral recorded by mistake
 *   (ended since), every receipt voided: cancelled, then replaced.
 * - reissue: a cancelled invoice of a visit still attended: replaced.
 * Which one applies is replacementOption (invoice-math.ts).
 */
@Injectable()
export class InvoiceReplacementsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly discounts: DiscountsService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  // What the replacement would be, and which action applies; writes nothing.
  async preview(id: string): Promise<InvoiceReplacementPreviewDto> {
    const manager = this.dataSource.manager;
    const invoice = await manager.findOneBy(Invoice, { id });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const facts = await this.invoices.replacementFacts(invoice, manager);
    const result = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      ...facts.option,
      current: await this.sideOf(manager, invoice, facts.terms),
    };
    if (!facts.option.action || !facts.visit) {
      return { ...result, replacement: null, replacementNotCovered: null };
    }

    const preview = await this.discounts.previewReferral(manager, {
      patientId: invoice.patientId,
      visitId: facts.visit.id,
      subtotal: invoice.subtotal,
      sessionDate: this.time.localDate(facts.visit.attendedAt),
    });
    const discount = preview.covered ? preview.discount : null;
    const discountTotal = discount?.amount ?? ZERO;
    return {
      ...result,
      replacement: toCorrectionSide(
        {
          subtotal: invoice.subtotal,
          discountTotal,
          total: subMoney(invoice.subtotal, discountTotal),
        },
        preview.covered ? preview.terms : null,
        discount,
      ),
      replacementNotCovered: preview.covered ? null : preview.reason,
    };
  }

  correct(id: string, reason: string, actor: Actor): Promise<InvoiceDetailDto> {
    return this.replace(id, ReplacementAction.CORRECT, reason, actor);
  }

  reissue(id: string, actor: Actor): Promise<InvoiceDetailDto> {
    return this.replace(id, ReplacementAction.REISSUE, null, actor);
  }

  /**
   * One transaction: (CORRECT) the original is cancelled with `reason`;
   * the replacement is issued and covered by the current referral as of the
   * session date; INVOICE_CORRECTED / INVOICE_REISSUED is audited on the
   * original with both sides and its voided receipts. Parallel requests are
   * serialized by the row locks; uq_invoices_replaces and
   * uq_invoices_visit_live are the guarantee. Returns the replacement.
   */
  private async replace(
    id: string,
    action: ReplacementAction,
    reason: string | null,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    let replacementId: string;
    try {
      replacementId = await this.dataSource.transaction(async (manager) => {
        const found = await manager.findOneBy(Invoice, { id });
        if (!found) throw new NotFoundException('Invoice not found');
        // Same lock order as attend / undo attend: appointment, visit, invoice.
        if (found.visitId) await this.lockVisit(manager, found.visitId);
        const original = await this.invoices.lockInvoice(id, manager);
        const facts = await this.invoices.replacementFacts(original, manager);
        this.assertAction(facts, original, action);
        const visit = facts.visit as Visit;

        const from = {
          invoiceNumber: original.invoiceNumber,
          status: original.status,
          cancelReason: original.cancelReason,
          ...(await this.sideOf(manager, original, facts.terms)),
        };
        const receipts = await manager.find(Payment, {
          where: { invoiceId: original.id, status: PaymentStatus.VOIDED },
          order: { receivedAt: 'ASC', receiptNumber: 'ASC' },
        });

        if (action === ReplacementAction.CORRECT) {
          await this.invoices.cancelForCorrection(
            manager,
            original,
            reason as string,
            actor,
          );
        }
        const replacement = await this.invoices.issueReplacement(
          manager,
          original,
          actor,
        );
        await this.discounts.applyReferral(
          manager,
          replacement,
          actor,
          this.time.localDate(visit.attendedAt),
        );
        const to = await this.sideOf(
          manager,
          replacement,
          (await this.invoices.replacementFacts(replacement, manager)).terms,
        );

        await this.auditService.logAction(
          actor,
          action === ReplacementAction.CORRECT
            ? AuditAction.INVOICE_CORRECTED
            : AuditAction.INVOICE_REISSUED,
          AuditEntityType.INVOICE,
          original.id,
          {
            oldValues: from,
            newValues: {
              ...(reason !== null && { reason }),
              visitId: visit.id,
              replacementInvoiceId: replacement.id,
              replacementInvoiceNumber: replacement.invoiceNumber,
              ...to,
              voidedReceipts: receipts.map((p) => ({
                paymentId: p.id,
                receiptNumber: p.receiptNumber,
                type: p.type,
                amount: p.amount,
                voidedAt: p.voidedAt?.toISOString() ?? null,
                voidReason: p.voidReason,
              })),
            },
          },
          manager,
        );
        return replacement.id;
      });
    } catch (error) {
      if (
        isUniqueViolation(error, INVOICE_REPLACES_UNIQUE) ||
        isUniqueViolation(error, INVOICE_VISIT_UNIQUE)
      ) {
        throw conflict(
          ErrorCode.INVOICE_ALREADY_REPLACED,
          'The invoice has already been replaced',
        );
      }
      throw error;
    }
    return this.invoices.findOne(replacementId);
  }

  private assertAction(
    facts: Facts,
    invoice: Invoice,
    action: ReplacementAction,
  ): void {
    const { option, replacement } = facts;
    if (option.action === action) return;
    if (option.blockedBy === ReplacementBlocker.ALREADY_REPLACED) {
      throw conflict(
        ErrorCode.INVOICE_ALREADY_REPLACED,
        'The invoice has already been replaced',
        {
          replacementInvoiceId: replacement?.id,
          replacementInvoiceNumber: replacement?.invoiceNumber,
        },
      );
    }
    const cancelled = invoice.status === InvoiceStatus.CANCELLED;
    let reason: string = option.blockedBy ?? '';
    if (action === ReplacementAction.CORRECT && cancelled) reason = 'CANCELLED';
    if (action === ReplacementAction.REISSUE && !cancelled) {
      reason = 'NOT_CANCELLED';
    }
    throw unprocessable(
      ErrorCode.INVOICE_NOT_REPLACEABLE,
      NOT_REPLACEABLE[reason],
      { reason },
    );
  }

  // Locks the visit's appointment (if any), then the visit.
  private async lockVisit(
    manager: EntityManager,
    visitId: string,
  ): Promise<void> {
    const { appointmentId } = await manager.findOneByOrFail(Visit, {
      id: visitId,
    });
    if (appointmentId) {
      await manager.findOne(Appointment, {
        where: { id: appointmentId },
        lock: { mode: 'pessimistic_write' },
      });
    }
    await manager.findOne(Visit, {
      where: { id: visitId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async sideOf(
    manager: EntityManager,
    invoice: Invoice,
    terms: PatientReferralTerms | null,
  ): Promise<InvoiceCorrectionSideDto> {
    return toCorrectionSide(
      invoice,
      terms,
      await this.invoices.activeDiscount(invoice.id, manager),
    );
  }
}
