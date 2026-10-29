import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
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
import { parseIsoWithOffset } from '../../common/time/clinic-time.util.js';
import {
  isZeroMoney,
  lineTotal,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import { DocumentScope, InvoiceStatus } from './billing.enums.js';
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
import { Invoice, INVOICE_VISIT_UNIQUE } from './entities/invoice.entity.js';
import {
  assertEditable,
  computeTotals,
  deriveInvoiceStatus,
  type DiscountRule,
} from './invoice-math.js';
import { toInvoiceDetail, toInvoiceSummary } from './invoice.mapper.js';
import {
  VISIT_BILLING_POLICY,
  type BillableItem,
  type VisitBillingPolicy,
} from './visit-billing-policy.js';

const toDate = (value: string) => parseIsoWithOffset(value) as Date;
const SYSTEM: Actor = { userId: null, ip: null };

export interface VisitInvoiceResult {
  invoice: InvoiceDetailDto;
  created: boolean;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

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
   * The visit's invoice: created on check-in (event listener) or manually.
   * Idempotent: an existing live invoice is returned, and a concurrent
   * creation losing on the partial unique index is treated as success.
   */
  async createForVisit(
    visitId: string,
    actor: Actor,
  ): Promise<VisitInvoiceResult> {
    try {
      const { id, created } = await this.dataSource.transaction(
        async (manager) => {
          // FOR SHARE: serializes with a concurrent visit cancellation.
          const visit = await manager
            .getRepository(Visit)
            .createQueryBuilder('visit')
            .where('visit.id = :visitId', { visitId })
            .setLock('pessimistic_read')
            .getOne();
          if (!visit) throw new NotFoundException('Visit not found');

          const existing = await this.liveInvoiceOfVisit(visitId, manager);
          if (existing) return { id: existing.id, created: false };
          if (visit.status === VisitStatus.CANCELLED) {
            throw unprocessable(
              ErrorCode.VISIT_CANCELLED,
              'The visit is cancelled',
            );
          }

          const lines = await this.billingPolicy.itemsFor(visit, manager);
          const invoice = await this.insertInvoice(manager, actor, {
            patientId: visit.patientId,
            visitId: visit.id,
            notes: null,
            lines,
          });
          return { id: invoice.id, created: true };
        },
      );
      return { invoice: await this.findOne(id), created };
    } catch (error) {
      if (!isUniqueViolation(error, INVOICE_VISIT_UNIQUE)) throw error;
      const existing = await this.liveInvoiceOfVisit(
        visitId,
        this.dataSource.manager,
      );
      if (!existing) throw error;
      return { invoice: await this.findOne(existing.id), created: false };
    }
  }

  /**
   * After a visit is cancelled: an unpaid invoice is cancelled with the
   * visit's reason. A paid one stays (it shows up in the attention list).
   */
  async cancelForCancelledVisit(visitId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await manager
        .getRepository(Invoice)
        .createQueryBuilder('invoice')
        .where('invoice.visitId = :visitId', { visitId })
        .andWhere('invoice.status <> :cancelled', {
          cancelled: InvoiceStatus.CANCELLED,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!invoice) return;
      if (!isZeroMoney(invoice.amountPaid)) {
        this.logger.warn(
          `Visit ${visitId} was cancelled but invoice ${invoice.invoiceNumber} has payments; left for review`,
        );
        return;
      }
      const visit = await manager
        .getRepository(Visit)
        .findOneByOrFail({ id: visitId });
      await this.markCancelled(
        manager,
        invoice,
        visit.cancelReason ?? 'Visit cancelled',
        SYSTEM,
      );
    });
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
      qb.andWhere('invoice.issuedAt >= :from', { from: toDate(query.from) });
    if (query.to)
      qb.andWhere('invoice.issuedAt < :to', { to: toDate(query.to) });
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
    const invoice = await manager
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .where('invoice.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
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
    const totals = computeTotals(
      items,
      await this.activeDiscountRule(invoice.id, manager),
    );
    invoice.subtotal = totals.subtotal;
    invoice.discountTotal = totals.discountTotal;
    invoice.total = totals.total;
    invoice.status = deriveInvoiceStatus(invoice.total, invoice.amountPaid);
    return manager.getRepository(Invoice).save(invoice);
  }

  // ---------- Internals ----------

  /** Discounts arrive in Stage 6B. */
  protected activeDiscountRule(
    _invoiceId: string,
    _manager: EntityManager,
  ): Promise<DiscountRule | null> {
    return Promise.resolve(null);
  }

  /** Discounts arrive in Stage 6B. */
  protected activeDiscountDto(
    _invoiceId: string,
  ): Promise<InvoiceDiscountDto | null> {
    return Promise.resolve(null);
  }

  /** Payments arrive in Stage 6C. */
  protected paymentsOf(_invoiceId: string): Promise<InvoicePaymentDto[]> {
    return Promise.resolve([]);
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
      assertEditable(invoice);
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

  private liveInvoiceOfVisit(
    visitId: string,
    manager: EntityManager,
  ): Promise<Invoice | null> {
    return manager
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .where('invoice.visitId = :visitId', { visitId })
      .andWhere("invoice.status <> 'CANCELLED'")
      .getOne();
  }

  private summaryQuery(): SelectQueryBuilder<Invoice> {
    return this.invoices
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.patient', 'patient')
      .where('TRUE');
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
