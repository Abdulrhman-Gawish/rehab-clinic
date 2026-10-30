import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isoToDate } from '../../common/time/clinic-time.util.js';
import {
  addMoney,
  compareMoney,
  isPositiveMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import {
  DocumentScope,
  InvoiceStatus,
  PaymentStatus,
  PaymentType,
} from './billing.enums.js';
import { DocumentCounterService } from './document-counter.service.js';
import type {
  ListPaymentsQueryDto,
  PaymentResponseDto,
  ReceiptDto,
  RecordPaymentDto,
  RefundPaymentDto,
} from './dto/payment.dto.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
import { Payment } from './entities/payment.entity.js';
import { InvoicesService } from './invoices.service.js';

@Injectable()
export class PaymentsService {
  private readonly clinicName: string;
  private readonly clinicPhone: string | null;

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly counters: DocumentCounterService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.clinicName = config.get('CLINIC_NAME', { infer: true });
    this.clinicPhone = config.get('CLINIC_PHONE', { infer: true }) || null;
  }

  /**
   * Records money received. The invoice row is locked, so parallel payments
   * are serialized and amount_paid can never exceed the total.
   */
  async record(
    invoiceId: string,
    dto: RecordPaymentDto,
    actor: Actor,
  ): Promise<PaymentResponseDto> {
    const amount = toMoney(dto.amount);
    const id = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.lockInvoice(invoiceId, manager);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw unprocessable(
          ErrorCode.INVOICE_CANCELLED,
          'The invoice is cancelled',
        );
      }
      const balance = subMoney(invoice.total, invoice.amountPaid);
      if (compareMoney(amount, balance) > 0) {
        throw unprocessable(
          ErrorCode.OVERPAYMENT,
          'The amount is more than the remaining balance',
          { balance },
        );
      }

      const payment = await this.insert(manager, invoice, actor, {
        type: PaymentType.PAYMENT,
        amount,
        method: dto.method,
        reference: dto.reference ?? null,
        reason: null,
        refundOfId: null,
      });
      const updated = await this.invoices.refreshAmountPaid(manager, invoice);
      await this.audit(
        manager,
        actor,
        AuditAction.PAYMENT_RECORDED,
        payment,
        updated,
      );
      return payment.id;
    });
    return this.findOne(id);
  }

  /**
   * Money returned (OWNER only, enforced by the route). Refunds point at a
   * VALID payment of the same invoice and can never exceed it in total.
   */
  async refund(
    paymentId: string,
    dto: RefundPaymentDto,
    actor: Actor,
  ): Promise<PaymentResponseDto> {
    const amount = toMoney(dto.amount);
    const id = await this.dataSource.transaction(async (manager) => {
      const { payment: original, invoice } = await this.lockPayment(
        paymentId,
        manager,
      );
      if (
        original.type !== PaymentType.PAYMENT ||
        original.status !== PaymentStatus.VALID
      ) {
        throw unprocessable(
          ErrorCode.REFUND_NOT_ALLOWED,
          'Only a valid payment can be refunded',
        );
      }
      const refunded = await this.refundedSoFar(original.id, manager);
      const refundable = subMoney(original.amount, refunded);
      if (compareMoney(amount, refundable) > 0) {
        throw unprocessable(
          ErrorCode.REFUND_EXCEEDS_PAYMENT,
          'Refunds cannot exceed the payment',
          { refundable },
        );
      }

      const refund = await this.insert(manager, invoice, actor, {
        type: PaymentType.REFUND,
        amount,
        method: dto.method ?? original.method,
        reference: null,
        reason: dto.reason,
        refundOfId: original.id,
      });
      const updated = await this.invoices.refreshAmountPaid(manager, invoice);
      await this.audit(
        manager,
        actor,
        AuditAction.PAYMENT_REFUNDED,
        refund,
        updated,
      );
      return refund.id;
    });
    return this.findOne(id);
  }

  /**
   * A mistake corrected on the same local day it was recorded. A
   * RECEPTIONIST may void only their own payments; OWNER any.
   */
  async void(
    paymentId: string,
    reason: string,
    actor: Actor,
  ): Promise<PaymentResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const { payment, invoice } = await this.lockPayment(paymentId, manager);
      const refuse = (message: string) =>
        unprocessable(ErrorCode.VOID_NOT_ALLOWED, message);

      if (payment.status === PaymentStatus.VOIDED)
        throw refuse('The payment is already voided');
      if (this.time.localDate(payment.receivedAt) !== this.time.today()) {
        throw refuse(
          'Payments can only be voided on the day they were recorded; use a refund',
        );
      }
      if (
        actor.role !== UserRole.OWNER &&
        payment.receivedById !== actor.userId
      ) {
        throw refuse('Receptionists can only void payments they recorded');
      }
      if (invoice.status === InvoiceStatus.CANCELLED)
        throw refuse('The invoice is cancelled');
      if (
        payment.type === PaymentType.PAYMENT &&
        isPositiveMoney(await this.refundedSoFar(payment.id, manager))
      ) {
        throw refuse('The payment has refunds; void the refunds first');
      }
      // Voiding a refund brings its money back: it must still fit the total.
      if (
        payment.type === PaymentType.REFUND &&
        compareMoney(
          addMoney(invoice.amountPaid, payment.amount),
          invoice.total,
        ) > 0
      ) {
        throw refuse('Voiding this refund would make the invoice overpaid');
      }

      payment.status = PaymentStatus.VOIDED;
      payment.voidedAt = this.time.now();
      payment.voidedById = actor.userId;
      payment.voidReason = reason;
      await manager.getRepository(Payment).save(payment);

      const updated = await this.invoices.refreshAmountPaid(manager, invoice);
      await this.audit(
        manager,
        actor,
        AuditAction.PAYMENT_VOIDED,
        payment,
        updated,
        { reason },
      );
    });
    return this.findOne(paymentId);
  }

  async list(
    query: ListPaymentsQueryDto,
  ): Promise<Paginated<PaymentResponseDto>> {
    const qb = this.payments
      .createQueryBuilder('payment')
      .innerJoinAndSelect('payment.invoice', 'invoice')
      .innerJoinAndSelect('payment.patient', 'patient');
    if (query.from)
      qb.andWhere('payment.receivedAt >= :from', {
        from: isoToDate(query.from),
      });
    if (query.to)
      qb.andWhere('payment.receivedAt < :to', { to: isoToDate(query.to) });
    if (query.method)
      qb.andWhere('payment.method = :method', { method: query.method });
    if (query.type) qb.andWhere('payment.type = :type', { type: query.type });
    if (query.status)
      qb.andWhere('payment.status = :status', { status: query.status });
    if (query.receivedBy) {
      qb.andWhere('payment.receivedById = :receivedBy', {
        receivedBy: query.receivedBy,
      });
    }
    if (query.invoiceId) {
      qb.andWhere('payment.invoiceId = :invoiceId', {
        invoiceId: query.invoiceId,
      });
    }
    const [rows, total] = await qb
      .orderBy('payment.receivedAt', 'DESC')
      .addOrderBy('payment.receiptNumber', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();
    return toPaginated(
      rows.map((p) => this.toDto(p)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<PaymentResponseDto> {
    const payment = await this.payments.findOne({
      where: { id },
      relations: { invoice: true, patient: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.toDto(payment);
  }

  // Data for printing; the frontend renders it.
  async receipt(id: string): Promise<ReceiptDto> {
    const payment = await this.payments.findOne({
      where: { id },
      relations: { invoice: true, patient: true, receivedBy: true },
    });
    if (!payment?.invoice || !payment.patient || !payment.receivedBy) {
      throw new NotFoundException('Payment not found');
    }
    const invoice = payment.invoice;
    const items = await this.dataSource
      .getRepository(InvoiceItem)
      .find({ where: { invoiceId: invoice.id }, order: { position: 'ASC' } });
    const discount = await this.invoices.activeDiscount(
      invoice.id,
      this.dataSource.manager,
    );

    return {
      clinicName: this.clinicName,
      clinicPhone: this.clinicPhone,
      receiptNumber: payment.receiptNumber,
      type: payment.type,
      status: payment.status,
      receivedAt: this.time.toIso(payment.receivedAt),
      receivedBy: payment.receivedBy.name,
      patient: {
        id: payment.patient.id,
        name: payment.patient.name,
        phone: payment.patient.phone,
      },
      invoiceNumber: invoice.invoiceNumber,
      items: items.map((item) => ({
        description: item.description,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
      subtotal: invoice.subtotal,
      discount: discount
        ? {
            type: discount.type,
            value: discount.value,
            amount: discount.amount,
            reason: discount.reason,
          }
        : null,
      total: invoice.total,
      method: payment.method,
      reference: payment.reference,
      amount: payment.amount,
      totalPaid: invoice.amountPaid,
      remainingBalance: subMoney(invoice.total, invoice.amountPaid),
    };
  }

  // ---------- Internals ----------

  private async insert(
    manager: EntityManager,
    invoice: Invoice,
    actor: Actor,
    data: Pick<
      Payment,
      'type' | 'amount' | 'method' | 'reference' | 'reason' | 'refundOfId'
    >,
  ): Promise<Payment> {
    const receivedAt = this.time.now();
    const repository = manager.getRepository(Payment);
    return repository.save(
      repository.create({
        ...data,
        receiptNumber: await this.counters.next(
          DocumentScope.RECEIPT,
          manager,
          receivedAt,
        ),
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        status: PaymentStatus.VALID,
        receivedById: actor.userId as string,
        receivedAt,
        voidedAt: null,
        voidedById: null,
        voidReason: null,
      }),
    );
  }

  // Locks the invoice first (same order as payments), then the payment.
  private async lockPayment(
    paymentId: string,
    manager: EntityManager,
  ): Promise<{ payment: Payment; invoice: Invoice }> {
    const found = await manager
      .getRepository(Payment)
      .findOneBy({ id: paymentId });
    if (!found) throw new NotFoundException('Payment not found');
    const invoice = await this.invoices.lockInvoice(found.invoiceId, manager);
    const payment = await manager.findOneOrFail(Payment, {
      where: { id: paymentId },
      lock: { mode: 'pessimistic_write' },
    });
    return { payment, invoice };
  }

  private async refundedSoFar(
    paymentId: string,
    manager: EntityManager,
  ): Promise<string> {
    const row: { refunded: string | null } | undefined = await manager
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .select('SUM(payment.amount)', 'refunded')
      .where('payment.refundOfId = :paymentId', { paymentId })
      .andWhere('payment.status = :valid', { valid: PaymentStatus.VALID })
      .getRawOne();
    return addMoney(row?.refunded ?? ZERO);
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    payment: Payment,
    invoice: Invoice,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.PAYMENT,
      payment.id,
      {
        newValues: {
          receiptNumber: payment.receiptNumber,
          invoiceId: invoice.id,
          type: payment.type,
          status: payment.status,
          amount: payment.amount,
          method: payment.method,
          refundOfId: payment.refundOfId,
          invoiceAmountPaid: invoice.amountPaid,
          invoiceStatus: invoice.status,
          ...extra,
        },
      },
      manager,
    );
  }

  private toDto(payment: Payment): PaymentResponseDto {
    const { invoice, patient } = payment;
    if (!invoice || !patient)
      throw new Error('Payment relations are not loaded');
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      type: payment.type,
      status: payment.status,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      reason: payment.reason,
      refundOfId: payment.refundOfId,
      patient: { id: patient.id, name: patient.name, phone: patient.phone },
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
        balance: subMoney(invoice.total, invoice.amountPaid),
      },
      receivedById: payment.receivedById,
      receivedAt: toIso(payment.receivedAt),
      voidedAt: payment.voidedAt ? toIso(payment.voidedAt) : null,
      voidedById: payment.voidedById,
      voidReason: payment.voidReason,
    };
  }
}
