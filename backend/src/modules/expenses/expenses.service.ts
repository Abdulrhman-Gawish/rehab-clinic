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
import { DocumentScope, type PaymentMethod } from '../billing/billing.enums.js';
import { DocumentCounterService } from '../billing/document-counter.service.js';
import { ReferralPayout } from '../referrals/entities/referral-payout.entity.js';
import {
  ExpenseSource,
  type CreateExpenseDto,
  type ExpenseListDto,
  type ExpenseResponseDto,
  type ListExpensesQueryDto,
  type UpdateExpenseDto,
} from './dto/expense.dto.js';
import {
  ExpenseCategory,
  ExpenseCategoryKey,
  SYSTEM_CATEGORY_NAMES,
} from './entities/expense-category.entity.js';
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

// The expense of a payout to a referring doctor.
export interface PayoutExpenseInput {
  payoutId: string;
  doctorName: string;
  amount: string;
  // Clinic local date of the payout.
  date: string;
  method: PaymentMethod;
  reference: string | null;
}

// With the payout it records (list and detail queries).
type ExpenseRow = Expense & { referralPayout?: ReferralPayout | null };

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
      await this.assertManualCategory(dto.categoryId, manager);
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
        await this.assertManualCategory(dto.categoryId, manager);
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
      await this.markVoided(manager, expense, reason, actor);
    });
    return this.findOne(id);
  }

  /**
   * The expense of a referral payout, in the payout's transaction: same
   * amount, method, date and reference, in the REFERRAL_COMMISSION
   * category, paid to the doctor. The date follows the expense rules
   * (never in the future).
   */
  async createForPayout(
    manager: EntityManager,
    input: PayoutExpenseInput,
    actor: Actor,
  ): Promise<Expense> {
    this.assertExpenseDate(input.date, actor);
    const category = await this.systemCategory(
      ExpenseCategoryKey.REFERRAL_COMMISSION,
      manager,
    );
    const now = this.time.now();
    const repository = manager.getRepository(Expense);
    const expense = await repository.save(
      repository.create({
        expenseNumber: await this.counters.next(
          DocumentScope.EXPENSE,
          manager,
          now,
        ),
        categoryId: category.id,
        description: `Referral commission: ${input.doctorName}`.slice(0, 255),
        amount: toMoney(input.amount),
        expenseDate: input.date,
        vendorName: input.doctorName.slice(0, 120),
        paymentMethod: input.method,
        reference: input.reference,
        receiptFileKey: null,
        status: ExpenseStatus.VALID,
        createdById: actor.userId as string,
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
        referralPayoutId: input.payoutId,
      },
    });
    return expense;
  }

  // A voided payout voids its expense, in the payout's transaction.
  async voidForPayout(
    manager: EntityManager,
    expenseId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    const expense = await manager.findOneOrFail(Expense, {
      where: { id: expenseId },
      lock: { mode: 'pessimistic_write' },
    });
    if (expense.status === ExpenseStatus.VALID) {
      await this.markVoided(manager, expense, reason, actor);
    }
  }

  /**
   * Attaches (or replaces) the receipt file. The type is decided by the
   * file's magic bytes; the old file is kept in storage (nothing is deleted).
   * If the transaction fails, only the file of this request is removed.
   */
  async uploadReceipt(
    id: string,
    upload: UploadedFileData | undefined,
    actor: Actor,
  ): Promise<ExpenseResponseDto> {
    // Size: the upload interceptor already answered 413 above MAX_UPLOAD_BYTES.
    const { file, type: detected } = checkUpload(upload);

    // A fresh key per upload: discarding it can never touch a kept receipt.
    const key = `expenses/${id}/${randomUUID()}.${detected.extension}`;
    await this.dataSource
      .transaction(async (manager) => {
        // A payout's expense may get a receipt (the transfer slip) too.
        const expense = await this.lockModifiable(id, actor, manager, true);
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
      })
      .catch(async (error: unknown) => {
        await this.storage.discard(key);
        throw error;
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
    const expense = await this.query()
      .where('expense.id = :id', { id })
      .getOne();
    if (!expense) throw new NotFoundException('Expense not found');
    return this.toDto(expense);
  }

  async list(query: ListExpensesQueryDto): Promise<ExpenseListDto> {
    const qb = this.query();
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
    if (query.source === ExpenseSource.MANUAL) qb.andWhere('payout.id IS NULL');
    if (query.source === ExpenseSource.REFERRAL_PAYOUT) {
      qb.andWhere('payout.id IS NOT NULL');
    }
    if (query.referringDoctorId) {
      qb.andWhere('payout.referringDoctorId = :referringDoctorId', {
        referringDoctorId: query.referringDoctorId,
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

  // An expense with its category, people and payout (if any).
  private query() {
    return this.expenses
      .createQueryBuilder('expense')
      .innerJoinAndSelect('expense.category', 'category')
      .innerJoinAndSelect('expense.createdBy', 'createdBy')
      .leftJoinAndSelect('expense.voidedBy', 'voidedBy')
      .leftJoinAndMapOne(
        'expense.referralPayout',
        ReferralPayout,
        'payout',
        'payout.expenseId = expense.id',
      )
      .leftJoinAndSelect('payout.referringDoctor', 'referringDoctor');
  }

  private async markVoided(
    manager: EntityManager,
    expense: Expense,
    reason: string,
    actor: Actor,
  ): Promise<void> {
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
  }

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

  /**
   * Edit / void / receipt: creator on the same local day, or OWNER. An
   * expense the system wrote (a payout's) changes only with its payout,
   * apart from its receipt (`receiptOnly`).
   */
  private async lockModifiable(
    id: string,
    actor: Actor,
    manager: EntityManager,
    receiptOnly = false,
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
    if (!receiptOnly) {
      const category = await manager.findOneByOrFail(ExpenseCategory, {
        id: expense.categoryId,
      });
      if (category.systemKey) {
        throw refuse(
          'This expense records a referral payout: void the payout instead',
        );
      }
    }
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

  // A category typed expenses can use: active, and not a system one.
  private async assertManualCategory(
    id: string,
    manager: EntityManager,
  ): Promise<void> {
    const category = await manager
      .getRepository(ExpenseCategory)
      .findOneBy({ id });
    if (!category) throw new NotFoundException('Expense category not found');
    if (category.systemKey) {
      throw unprocessable(
        ErrorCode.CATEGORY_RESERVED,
        'Only the system records expenses in this category',
      );
    }
    if (!category.isActive) {
      throw unprocessable(
        ErrorCode.CATEGORY_INACTIVE,
        'The expense category is inactive',
      );
    }
  }

  // Seeded by the migration; created here if missing (an emptied database).
  private async systemCategory(
    key: ExpenseCategoryKey,
    manager: EntityManager,
  ): Promise<ExpenseCategory> {
    const find = () => manager.findOneBy(ExpenseCategory, { systemKey: key });
    const found = await find();
    if (found) return found;
    await manager.query(
      `INSERT INTO expense_categories (name, system_key) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [SYSTEM_CATEGORY_NAMES[key], key],
    );
    const created = await find();
    if (!created) throw new Error(`Expense category ${key} is missing`);
    return created;
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

  private toDto(expense: ExpenseRow): ExpenseResponseDto {
    const { category, referralPayout: payout } = expense;
    if (!category) throw new Error('Expense category is not loaded');
    const toIso = (d: Date) => this.time.toIso(d);
    const doctor = payout?.referringDoctor;
    return {
      id: expense.id,
      expenseNumber: expense.expenseNumber,
      category: {
        id: category.id,
        name: category.name,
        isActive: category.isActive,
        systemKey: category.systemKey,
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
      referralPayout:
        payout && doctor
          ? {
              id: payout.id,
              referringDoctor: { id: doctor.id, name: doctor.name },
              notes: payout.notes,
            }
          : null,
    };
  }
}
