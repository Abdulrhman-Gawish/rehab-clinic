import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  toPaginated,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isoToDate } from '../../common/time/clinic-time.util.js';
import {
  isZeroMoney,
  lineTotal,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import {
  DocumentScope,
  InvoiceStatus,
  PaymentStatus,
  PaymentType,
} from './billing.enums.js';
import { DocumentCounterService } from './document-counter.service.js';
import type {
  CreateInvoiceDto,
  InvoiceDetailDto,
  InvoiceDiscountDto,
  InvoiceItemInputDto,
  InvoicePaymentDto,
  InvoiceSummaryDto,
  ListInvoicesQueryDto,
  PatientBalanceDto,
  UpdateInvoiceItemDto,
} from './dto/invoice.dto.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import { Payment } from './entities/payment.entity.js';
import {
  assertEditable,
  computeTotals,
  deriveInvoiceStatus,
} from './invoice-math.js';
import {
  toInvoiceDetail,
  toInvoiceDiscount,
  toInvoicePayment,
  toInvoiceSummary,
} from './invoice.mapper.js';
import {
  VISIT_BILLING_POLICY,
  type BillableItem,
  type VisitBillingPolicy,
} from './visit-billing-policy.js';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private readonly items: Repository<InvoiceItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly counters: DocumentCounterService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    @Inject(VISIT_BILLING_POLICY)
    private readonly billingPolicy: VisitBillingPolicy,
  ) {}

  // ---------- Creation ----------

  // Manual invoice (e.g. a medical report fee). Totals computed server-side.
  async create(dto: CreateInvoiceDto, actor: Actor): Promise<InvoiceDetailDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      if (
        !(await manager.getRepository(Patient).existsBy({ id: dto.patientId }))
      ) {
        throw new NotFoundException('Patient not found');
      }
      const lines = await Promise.all(
        dto.items.map((item) => this.resolveItem(item, manager)),
      );
      const invoice = await this.insertInvoice(manager, actor, {
        patientId: dto.patientId,
        visitId: null,
        notes: dto.notes ?? null,
        lines,
      });
      return invoice.id;
    });
    return this.findOne(id);
  }

  /**
   * The visit's invoice, written in the caller's transaction (attend and
   * walk-in): if anything fails, neither the visit nor the invoice exists.
   * The items come from the VisitBillingPolicy.
   */
  async createForVisit(
    manager: EntityManager,
    visit: Visit,
    actor: Actor,
  ): Promise<Invoice> {
    const lines = await this.billingPolicy.itemsFor(visit, manager);
    return this.insertInvoice(manager, actor, {
      patientId: visit.patientId,
      visitId: visit.id,
      notes: null,
      lines,
    });
  }

  // The visit's live (not cancelled) invoice, locked; null if none.
  lockLiveInvoiceOfVisit(
    visitId: string,
    manager: EntityManager,
  ): Promise<Invoice | null> {
    return manager
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .where('invoice.visitId = :visitId', { visitId })
      .andWhere('invoice.status <> :cancelled', {
        cancelled: InvoiceStatus.CANCELLED,
      })
      .setLock('pessimistic_write')
      .getOne();
  }

  // Undo attend: the caller has locked the invoice and checked it is unpaid.
  cancelForVoidedVisit(
    manager: EntityManager,
    invoice: Invoice,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    return this.markCancelled(manager, invoice, reason, actor);
  }

  // ---------- Items ----------

  addItem(
    id: string,
    dto: InvoiceItemInputDto,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.editItems(id, actor, async (invoice, manager) => {
      const line = await this.resolveItem(dto, manager);
      const position = await this.nextPosition(invoice.id, manager);
      const item = await manager
        .getRepository(InvoiceItem)
        .save(this.newItem(invoice.id, line, position));
      return {
        action: AuditAction.INVOICE_ITEM_ADDED,
        values: { newValues: this.itemValues(item) },
      };
    });
  }

  updateItem(
    id: string,
    itemId: string,
    dto: UpdateInvoiceItemDto,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.editItems(id, actor, async (invoice, manager) => {
      const repository = manager.getRepository(InvoiceItem);
      const item = await repository.findOneBy({
        id: itemId,
        invoiceId: invoice.id,
      });
      if (!item) throw new NotFoundException('Invoice item not found');
      if (
        item.serviceId &&
        (dto.description !== undefined || dto.unitPrice !== undefined)
      ) {
        throw new BadRequestException(
          'Description and price of a service item are fixed; only quantity can change',
        );
      }
      const before = this.itemValues(item);
      if (dto.description !== undefined) item.description = dto.description;
      if (dto.unitPrice !== undefined) item.unitPrice = toMoney(dto.unitPrice);
      if (dto.quantity !== undefined) item.quantity = dto.quantity;
      item.lineTotal = lineTotal(item.unitPrice, item.quantity);
      await repository.save(item);
      return {
        action: AuditAction.INVOICE_ITEM_UPDATED,
        values: { oldValues: before, newValues: this.itemValues(item) },
      };
    });
  }

  removeItem(
    id: string,
    itemId: string,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    return this.editItems(id, actor, async (invoice, manager) => {
      const repository = manager.getRepository(InvoiceItem);
      const item = await repository.findOneBy({
        id: itemId,
        invoiceId: invoice.id,
      });
      if (!item) throw new NotFoundException('Invoice item not found');
      if ((await repository.countBy({ invoiceId: invoice.id })) <= 1) {
        throw unprocessable(
          ErrorCode.INVOICE_NEEDS_ITEMS,
          'An invoice must keep at least one item (cancel the invoice instead)',
        );
      }
      // Line items are not business history on their own: while nothing is
      // paid they can be removed; the audit log keeps the removed line.
      await repository.delete({ id: item.id });
      return {
        action: AuditAction.INVOICE_ITEM_REMOVED,
        values: { oldValues: this.itemValues(item) },
      };
    });
  }

  // ---------- Cancel ----------

  async cancel(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(id, manager);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw unprocessable(
          ErrorCode.INVOICE_CANCELLED,
          'The invoice is already cancelled',
        );
      }
      if (!isZeroMoney(invoice.amountPaid)) {
        throw unprocessable(
          ErrorCode.INVOICE_HAS_PAYMENTS,
          'The invoice has payments; refund them before cancelling',
        );
      }
      await this.markCancelled(manager, invoice, reason, actor);
    });
    return this.findOne(id);
  }

  // ---------- Queries ----------

  async findOne(id: string): Promise<InvoiceDetailDto> {
    const invoice = await this.invoices.findOne({
      where: { id },
      relations: { patient: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const items = await this.items.find({
      where: { invoiceId: id },
      order: { position: 'ASC' },
    });
    return toInvoiceDetail(
      invoice,
      items,
      await this.activeDiscountDto(id),
      await this.paymentsOf(id),
      (d) => this.time.toIso(d),
    );
  }

  async list(
    query: ListInvoicesQueryDto,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    const qb = this.summaryQuery();
    if (query.from)
      qb.andWhere('invoice.issuedAt >= :from', {
        from: isoToDate(query.from),
      });
    if (query.to)
      qb.andWhere('invoice.issuedAt < :to', { to: isoToDate(query.to) });
    if (query.patientId) {
      qb.andWhere('invoice.patientId = :patientId', {
        patientId: query.patientId,
      });
    }
    if (query.status)
      qb.andWhere('invoice.status = :status', { status: query.status });
    if (query.hasBalance !== undefined) {
      qb.andWhere(
        query.hasBalance
          ? "invoice.status <> 'CANCELLED' AND invoice.amountPaid < invoice.total"
          : "(invoice.status = 'CANCELLED' OR invoice.amountPaid >= invoice.total)",
      );
    }
    return this.paginate(qb, query);
  }

  async forPatient(
    patientId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    await this.assertPatientExists(patientId);
    return this.paginate(
      this.summaryQuery().andWhere('invoice.patientId = :patientId', {
        patientId,
      }),
      query,
    );
  }

  // Across non-cancelled invoices.
  async balance(patientId: string): Promise<PatientBalanceDto> {
    await this.assertPatientExists(patientId);
    const row: { invoiced: string | null; paid: string | null } | undefined =
      await this.invoices
        .createQueryBuilder('invoice')
        .select('SUM(invoice.total)', 'invoiced')
        .addSelect('SUM(invoice.amountPaid)', 'paid')
        .where('invoice.patientId = :patientId', { patientId })
        .andWhere("invoice.status <> 'CANCELLED'")
        .getRawOne();
    const totalInvoiced = toMoney(row?.invoiced ?? ZERO);
    const totalPaid = toMoney(row?.paid ?? ZERO);
    return {
      patientId,
      totalInvoiced,
      totalPaid,
      balance: subMoney(totalInvoiced, totalPaid),
    };
  }

  // ---------- Shared with discounts / payments ----------

  async lockInvoice(id: string, manager: EntityManager): Promise<Invoice> {
    const invoice = await manager.findOne(Invoice, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /**
   * Recomputes subtotal, discount (percent re-derived from the new
   * subtotal), total and status from the stored rows. Caller holds the lock.
   */
  async recalculate(
    manager: EntityManager,
    invoice: Invoice,
  ): Promise<Invoice> {
    const items = await manager
      .getRepository(InvoiceItem)
      .findBy({ invoiceId: invoice.id });
    const discount = await this.activeDiscount(invoice.id, manager);
    const totals = computeTotals(items, discount);
    // Keep the stored discount amount in line (percent follows the subtotal).
    if (discount && discount.amount !== totals.discountTotal) {
      discount.amount = totals.discountTotal;
      await manager.getRepository(InvoiceDiscount).save(discount);
    }
    invoice.subtotal = totals.subtotal;
    invoice.discountTotal = totals.discountTotal;
    invoice.total = totals.total;
    invoice.status = deriveInvoiceStatus(invoice.total, invoice.amountPaid);
    return manager.getRepository(Invoice).save(invoice);
  }

  // ---------- Internals ----------

  // The invoice's current (not removed) discount, if any.
  activeDiscount(
    invoiceId: string,
    manager: EntityManager,
  ): Promise<InvoiceDiscount | null> {
    return manager
      .getRepository(InvoiceDiscount)
      .findOneBy({ invoiceId, removedAt: IsNull() });
  }

  private async activeDiscountDto(
    invoiceId: string,
  ): Promise<InvoiceDiscountDto | null> {
    const discount = await this.activeDiscount(
      invoiceId,
      this.dataSource.manager,
    );
    return discount
      ? toInvoiceDiscount(discount, (d) => this.time.toIso(d))
      : null;
  }

  private async paymentsOf(invoiceId: string): Promise<InvoicePaymentDto[]> {
    const payments = await this.dataSource.getRepository(Payment).find({
      where: { invoiceId },
      order: { receivedAt: 'ASC', receiptNumber: 'ASC' },
    });
    return payments.map((payment) =>
      toInvoicePayment(payment, (d) => this.time.toIso(d)),
    );
  }

  /**
   * Items and discount can change only while nothing has been paid: not
   * cancelled, amount_paid = 0 and no valid payment at all (an invoice
   * whose payments were fully refunded stays locked; it can be cancelled).
   */
  async assertInvoiceEditable(
    invoice: Invoice,
    manager: EntityManager,
  ): Promise<void> {
    assertEditable(invoice);
    const paid = await manager.getRepository(Payment).existsBy({
      invoiceId: invoice.id,
      type: PaymentType.PAYMENT,
      status: PaymentStatus.VALID,
    });
    if (paid) {
      throw unprocessable(
        ErrorCode.INVOICE_LOCKED,
        'The invoice has payments; items and discount can no longer change',
      );
    }
  }

  /**
   * amount_paid = valid payments - valid refunds (voided ones excluded),
   * recomputed from the rows; status re-derived. Caller holds the lock.
   */
  async refreshAmountPaid(
    manager: EntityManager,
    invoice: Invoice,
  ): Promise<Invoice> {
    const row: { paid: string | null } | undefined = await manager
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .select(
        `SUM(CASE WHEN payment.type = 'PAYMENT' THEN payment.amount ELSE -payment.amount END)`,
        'paid',
      )
      .where('payment.invoiceId = :invoiceId', { invoiceId: invoice.id })
      .andWhere('payment.status = :valid', { valid: PaymentStatus.VALID })
      .getRawOne();
    invoice.amountPaid = toMoney(row?.paid ?? ZERO);
    if (invoice.status !== InvoiceStatus.CANCELLED) {
      invoice.status = deriveInvoiceStatus(invoice.total, invoice.amountPaid);
    }
    return manager.getRepository(Invoice).save(invoice);
  }

  private async editItems(
    id: string,
    actor: Actor,
    change: (
      invoice: Invoice,
      manager: EntityManager,
    ) => Promise<{
      action: AuditAction;
      values: Parameters<AuditService['logAction']>[4];
    }>,
  ): Promise<InvoiceDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(id, manager);
      await this.assertInvoiceEditable(invoice, manager);
      const before = { subtotal: invoice.subtotal, total: invoice.total };
      const { action, values } = await change(invoice, manager);
      const updated = await this.recalculate(manager, invoice);
      await this.auditService.logAction(
        actor,
        action,
        AuditEntityType.INVOICE,
        invoice.id,
        {
          oldValues: { ...values.oldValues, invoice: before },
          newValues: {
            ...values.newValues,
            invoice: { subtotal: updated.subtotal, total: updated.total },
          },
        },
        manager,
      );
    });
    return this.findOne(id);
  }

  private async insertInvoice(
    manager: EntityManager,
    actor: Actor,
    data: {
      patientId: string;
      visitId: string | null;
      notes: string | null;
      lines: BillableItem[];
    },
  ): Promise<Invoice> {
    const totals = computeTotals(data.lines, null);
    const issuedAt = this.time.now();
    const repository = manager.getRepository(Invoice);
    const invoice = await repository.save(
      repository.create({
        invoiceNumber: await this.counters.next(
          DocumentScope.INVOICE,
          manager,
          issuedAt,
        ),
        patientId: data.patientId,
        visitId: data.visitId,
        status: deriveInvoiceStatus(totals.total, ZERO),
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        amountPaid: ZERO,
        notes: data.notes,
        issuedById: actor.userId,
        issuedAt,
        cancelledAt: null,
        cancelledById: null,
        cancelReason: null,
      }),
    );
    await manager
      .getRepository(InvoiceItem)
      .save(
        data.lines.map((line, index) =>
          this.newItem(invoice.id, line, index + 1),
        ),
      );

    await this.auditService.logAction(
      actor,
      AuditAction.INVOICE_CREATED,
      AuditEntityType.INVOICE,
      invoice.id,
      {
        newValues: {
          invoiceNumber: invoice.invoiceNumber,
          patientId: invoice.patientId,
          visitId: invoice.visitId,
          total: invoice.total,
          items: data.lines.map((l) => ({ ...l })),
        },
      },
      manager,
    );
    return invoice;
  }

  private async markCancelled(
    manager: EntityManager,
    invoice: Invoice,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    const from = invoice.status;
    invoice.status = InvoiceStatus.CANCELLED;
    invoice.cancelledAt = this.time.now();
    invoice.cancelledById = actor.userId;
    invoice.cancelReason = reason;
    await manager.getRepository(Invoice).save(invoice);
    await this.auditService.logAction(
      actor,
      AuditAction.INVOICE_CANCELLED,
      AuditEntityType.INVOICE,
      invoice.id,
      {
        oldValues: { status: from },
        newValues: { status: invoice.status, reason },
      },
      manager,
    );
  }

  // Service items take name and base price from the catalog.
  private async resolveItem(
    input: InvoiceItemInputDto,
    manager: EntityManager,
  ): Promise<BillableItem> {
    if (input.serviceId) {
      const service = await manager
        .getRepository(ClinicService)
        .findOneBy({ id: input.serviceId });
      if (!service) throw new NotFoundException('Service not found');
      if (!service.isActive) {
        throw unprocessable(
          ErrorCode.SERVICE_NOT_OFFERED,
          'The service is inactive',
        );
      }
      return {
        serviceId: service.id,
        description: service.name,
        unitPrice: toMoney(service.basePrice),
        quantity: input.quantity,
      };
    }
    if (!input.description || input.unitPrice === undefined) {
      throw new BadRequestException(
        'Free-text items need a description and a unitPrice',
      );
    }
    return {
      serviceId: null,
      description: input.description,
      unitPrice: toMoney(input.unitPrice),
      quantity: input.quantity,
    };
  }

  private newItem(
    invoiceId: string,
    line: BillableItem,
    position: number,
  ): InvoiceItem {
    return Object.assign(new InvoiceItem(), {
      invoiceId,
      serviceId: line.serviceId,
      description: line.description,
      unitPrice: toMoney(line.unitPrice),
      quantity: line.quantity,
      lineTotal: lineTotal(line.unitPrice, line.quantity),
      position,
    });
  }

  private itemValues(item: InvoiceItem): Record<string, unknown> {
    return {
      itemId: item.id,
      serviceId: item.serviceId,
      description: item.description,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    };
  }

  private async nextPosition(
    invoiceId: string,
    manager: EntityManager,
  ): Promise<number> {
    const row: { max: number | null } | undefined = await manager
      .getRepository(InvoiceItem)
      .createQueryBuilder('item')
      .select('MAX(item.position)', 'max')
      .where('item.invoiceId = :invoiceId', { invoiceId })
      .getRawOne();
    return (row?.max ?? 0) + 1;
  }

  private summaryQuery(): SelectQueryBuilder<Invoice> {
    return this.invoices
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.patient', 'patient');
  }

  private async paginate(
    qb: SelectQueryBuilder<Invoice>,
    page: PaginationQueryDto,
  ): Promise<Paginated<InvoiceSummaryDto>> {
    const [rows, total] = await qb
      .orderBy('invoice.issuedAt', 'DESC')
      .addOrderBy('invoice.invoiceNumber', 'DESC')
      .skip(page.skip)
      .take(page.limit)
      .getManyAndCount();
    return toPaginated(
      rows.map((invoice) =>
        toInvoiceSummary(invoice, (d) => this.time.toIso(d)),
      ),
      total,
      page,
    );
  }

  private async assertPatientExists(patientId: string): Promise<void> {
    if (
      !(await this.dataSource
        .getRepository(Patient)
        .existsBy({ id: patientId }))
    ) {
      throw new NotFoundException('Patient not found');
    }
  }
}
