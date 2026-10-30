import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { toPaginated } from '../../common/dto/pagination.dto.js';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import {
  FileStorage,
  type StoredFile,
} from '../../common/storage/file-storage.service.js';
import {
  checkUpload,
  mimeTypeOf,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { addDays } from '../../common/time/clinic-time.util.js';
import { toMoney, ZERO } from '../../common/utils/money.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { diffValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentScope } from '../billing/billing.enums.js';
import { DocumentCounterService } from '../billing/document-counter.service.js';
import type {
  CreateExpenseDto,
  ExpenseListDto,
  ExpenseResponseDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';
import { ExpenseCategory } from './entities/expense-category.entity.js';
import { Expense, ExpenseStatus } from './entities/expense.entity.js';

const EXPENSE_AUDIT_FIELDS = [
  'categoryId',
  'description',
  'amount',
  'expenseDate',
  'vendorName',
  'paymentMethod',
  'reference',
] as const satisfies readonly (keyof Expense)[];

export interface ReceiptFile extends StoredFile {
  mimeType: string;
  fileName: string;
}

@Injectable()
export class ExpensesService {
  private readonly backdateMaxDays: number;

  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly counters: DocumentCounterService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    private readonly storage: FileStorage,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.backdateMaxDays = config.get('BACKDATE_MAX_DAYS', { infer: true });
  }

  async create(
    dto: CreateExpenseDto,
    actor: Actor,
  ): Promise<ExpenseResponseDto> {
    this.assertExpenseDate(dto.expenseDate, actor);
    const amount = toMoney(dto.amount);

    const id = await this.dataSource.transaction(async (manager) => {
      await this.assertActiveCategory(dto.categoryId, manager);
      const now = this.time.now();
      const repository = manager.getRepository(Expense);
      const expense = await repository.save(
        repository.create({
          expenseNumber: await this.counters.next(
            DocumentScope.EXPENSE,
            manager,
            now,
          ),
          categoryId: dto.categoryId,
          description: dto.description,
          amount,
          expenseDate: dto.expenseDate,
          vendorName: dto.vendorName ?? null,
          paymentMethod: dto.paymentMethod,
          reference: dto.reference ?? null,
          receiptFileKey: null,
          status: ExpenseStatus.VALID,
          createdById: actor.userId as string,
          // From the clinic clock: decides the same-day edit window.
          createdAt: now,
          voidedAt: null,
          voidedById: null,
          voidReason: null,
        }),
      );
      await this.audit(manager, actor, AuditAction.EXPENSE_CREATED, expense, {
        newValues: {
          expenseNumber: expense.expenseNumber,
          ...this.values(expense),
        },
      });
      return expense.id;
    });
    return this.findOne(id);
  }

  // Creator on the same local day, or OWNER any time.
  async update(
    id: string,
    dto: UpdateExpenseDto,
    actor: Actor,
  ): Promise<ExpenseResponseDto> {
    if (dto.expenseDate !== undefined)
      this.assertExpenseDate(dto.expenseDate, actor);
    await this.dataSource.transaction(async (manager) => {
      const expense = await this.lockModifiable(id, actor, manager);
      if (
        dto.categoryId !== undefined &&
        dto.categoryId !== expense.categoryId
      ) {
        await this.assertActiveCategory(dto.categoryId, manager);
      }
      const before = this.values(expense);
      if (dto.categoryId !== undefined) expense.categoryId = dto.categoryId;
      if (dto.description !== undefined) expense.description = dto.description;
      if (dto.amount !== undefined) expense.amount = toMoney(dto.amount);
      if (dto.expenseDate !== undefined) expense.expenseDate = dto.expenseDate;
      if (dto.vendorName !== undefined) expense.vendorName = dto.vendorName;
      if (dto.paymentMethod !== undefined)
        expense.paymentMethod = dto.paymentMethod;
      if (dto.reference !== undefined) expense.reference = dto.reference;

      const changes = diffValues(
        before,
        this.values(expense),
        EXPENSE_AUDIT_FIELDS,
      );
      if (!changes) return;
      // Relation object would override categoryId on save.
      delete expense.category;
      await manager.getRepository(Expense).save(expense);
      await this.audit(
        manager,
        actor,
        AuditAction.EXPENSE_UPDATED,
        expense,
        changes,
      );
    });
    return this.findOne(id);
  }

  async void(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<ExpenseResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const expense = await this.lockModifiable(id, actor, manager);
      expense.status = ExpenseStatus.VOIDED;
      expense.voidedAt = this.time.now();
      expense.voidedById = actor.userId;
      expense.voidReason = reason;
      delete expense.category;
      await manager.getRepository(Expense).save(expense);
      await this.audit(manager, actor, AuditAction.EXPENSE_VOIDED, expense, {
        oldValues: { status: ExpenseStatus.VALID },
        newValues: { status: ExpenseStatus.VOIDED, reason },
      });
    });
    return this.findOne(id);
  }

  /**
   * Attaches (or replaces) the receipt file. The type is decided by the
   * file's magic bytes; the old file is kept in storage (nothing is deleted).
   */
  async uploadReceipt(
    id: string,
    upload: UploadedFileData | undefined,
    actor: Actor,
  ): Promise<ExpenseResponseDto> {
    // Size: the upload interceptor already answered 413 above MAX_UPLOAD_BYTES.
    const { file, type: detected } = checkUpload(upload);

    await this.dataSource.transaction(async (manager) => {
      const expense = await this.lockModifiable(id, actor, manager);
      const key = `expenses/${expense.id}/${randomUUID()}.${detected.extension}`;
      await this.storage.put(key, file.buffer);
      const previous = expense.receiptFileKey;
      expense.receiptFileKey = key;
      delete expense.category;
      await manager.getRepository(Expense).save(expense);
      await this.audit(
        manager,
        actor,
        AuditAction.EXPENSE_RECEIPT_UPLOADED,
        expense,
        {
          oldValues: { receiptFileKey: previous },
          newValues: {
            receiptFileKey: key,
            size: file.size,
            type: detected.mimeType,
          },
        },
      );
    });
    return this.findOne(id);
  }

  async receipt(id: string): Promise<ReceiptFile> {
    const expense = await this.expenses.findOneBy({ id });
    if (!expense) throw new NotFoundException('Expense not found');
    if (!expense.receiptFileKey)
      throw new NotFoundException('This expense has no receipt');
    const extension = expense.receiptFileKey.slice(
      expense.receiptFileKey.lastIndexOf('.') + 1,
    );
    return {
      ...(await this.storage.get(expense.receiptFileKey)),
      mimeType: mimeTypeOf(extension),
      fileName: `${expense.expenseNumber}.${extension}`,
    };
  }

  async findOne(id: string): Promise<ExpenseResponseDto> {
    const expense = await this.expenses.findOne({
      where: { id },
      relations: { category: true, createdBy: true, voidedBy: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return this.toDto(expense);
  }

  async list(query: ListExpensesQueryDto): Promise<ExpenseListDto> {
    const qb = this.expenses
      .createQueryBuilder('expense')
      .innerJoinAndSelect('expense.category', 'category')
      .innerJoinAndSelect('expense.createdBy', 'createdBy')
      .leftJoinAndSelect('expense.voidedBy', 'voidedBy');
    if (query.from)
      qb.andWhere('expense.expenseDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('expense.expenseDate <= :to', { to: query.to });
    if (query.categoryId) {
      qb.andWhere('expense.categoryId = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.method)
      qb.andWhere('expense.paymentMethod = :method', { method: query.method });
    if (query.status)
      qb.andWhere('expense.status = :status', { status: query.status });
    if (query.createdBy) {
      qb.andWhere('expense.createdById = :createdBy', {
        createdBy: query.createdBy,
      });
    }

    const sum: { total: string | null } | undefined = await qb
      .clone()
      .select('SUM(expense.amount)', 'total')
      .andWhere('expense.status = :valid', { valid: ExpenseStatus.VALID })
      .getRawOne();
    const [rows, total] = await qb
      .orderBy('expense.expenseDate', 'DESC')
      .addOrderBy('expense.expenseNumber', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();
    return {
      ...toPaginated(
        rows.map((e) => this.toDto(e)),
        total,
        query,
      ),
      totalAmount: toMoney(sum?.total ?? ZERO),
    };
  }

  // ---------- Internals ----------

  /**
   * Not in the future; a RECEPTIONIST may go back at most BACKDATE_MAX_DAYS.
   */
  private assertExpenseDate(date: string, actor: Actor): void {
    const today = this.time.today();
    if (date > today) {
      throw unprocessable(
        ErrorCode.EXPENSE_DATE_IN_FUTURE,
        'The expense date cannot be in the future',
      );
    }
    const earliestDate = addDays(today, -this.backdateMaxDays);
    if (actor.role !== UserRole.OWNER && date < earliestDate) {
      throw unprocessable(
        ErrorCode.BACKDATE_LIMIT_EXCEEDED,
        `Only the owner can record expenses before ${earliestDate}`,
        { earliestDate },
      );
    }
  }

  // Edit / void / receipt: creator on the same local day, or OWNER.
  private async lockModifiable(
    id: string,
    actor: Actor,
    manager: EntityManager,
  ): Promise<Expense> {
    const expense = await manager.findOne(Expense, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!expense) throw new NotFoundException('Expense not found');

    const refuse = (message: string) =>
      unprocessable(ErrorCode.EXPENSE_EDIT_NOT_ALLOWED, message);
    if (expense.status === ExpenseStatus.VOIDED)
      throw refuse('The expense is voided');
    if (actor.role !== UserRole.OWNER) {
      if (expense.createdById !== actor.userId) {
        throw refuse(
          'Only the person who recorded the expense (or the owner) can change it',
        );
      }
      if (this.time.localDate(expense.createdAt) !== this.time.today()) {
        throw refuse(
          'Expenses can only be changed on the day they were recorded',
        );
      }
    }
    return expense;
  }

  private async assertActiveCategory(
    id: string,
    manager: EntityManager,
  ): Promise<void> {
    const category = await manager
      .getRepository(ExpenseCategory)
      .findOneBy({ id });
    if (!category) throw new NotFoundException('Expense category not found');
    if (!category.isActive) {
      throw unprocessable(
        ErrorCode.CATEGORY_INACTIVE,
        'The expense category is inactive',
      );
    }
  }

  private values(
    expense: Expense,
  ): Record<(typeof EXPENSE_AUDIT_FIELDS)[number], unknown> {
    return {
      categoryId: expense.categoryId,
      description: expense.description,
      amount: toMoney(expense.amount),
      expenseDate: expense.expenseDate,
      vendorName: expense.vendorName,
      paymentMethod: expense.paymentMethod,
      reference: expense.reference,
    };
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    expense: Expense,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.EXPENSE,
      expense.id,
      values,
      manager,
    );
  }

  private toDto(expense: Expense): ExpenseResponseDto {
    const { category } = expense;
    if (!category) throw new Error('Expense category is not loaded');
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      id: expense.id,
      expenseNumber: expense.expenseNumber,
      category: {
        id: category.id,
        name: category.name,
        isActive: category.isActive,
      },
      description: expense.description,
      amount: expense.amount,
      expenseDate: expense.expenseDate,
      vendorName: expense.vendorName,
      paymentMethod: expense.paymentMethod,
      reference: expense.reference,
      hasReceipt: expense.receiptFileKey !== null,
      status: expense.status,
      createdBy: UserRefDto.fromEntity(expense.createdBy),
      createdAt: toIso(expense.createdAt),
      voidedAt: expense.voidedAt ? toIso(expense.voidedAt) : null,
      voidedBy: UserRefDto.fromNullable(expense.voidedBy),
      voidReason: expense.voidReason,
    };
  }
}
