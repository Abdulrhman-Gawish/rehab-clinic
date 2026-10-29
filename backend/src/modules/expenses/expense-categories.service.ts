import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { conflict, ErrorCode } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type { ExpenseCategoryDto } from './dto/expense.dto.js';
import {
  EXPENSE_CATEGORY_NAME_UNIQUE,
  ExpenseCategory,
} from './entities/expense-category.entity.js';

const toDto = (category: ExpenseCategory): ExpenseCategoryDto => ({
  id: category.id,
  name: category.name,
  isActive: category.isActive,
});

function rethrowNameTaken(error: unknown): never {
  if (isUniqueViolation(error, EXPENSE_CATEGORY_NAME_UNIQUE)) {
    throw conflict(
      ErrorCode.CATEGORY_NAME_TAKEN,
      'A category with this name already exists',
    );
  }
  throw error;
}

// OWNER manages categories (no hard delete: deactivate instead).
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectRepository(ExpenseCategory)
    private readonly categories: Repository<ExpenseCategory>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<ExpenseCategoryDto[]> {
    const rows = await this.categories.find({
      where: includeInactive ? {} : { isActive: true },
      order: { name: 'ASC' },
    });
    return rows.map(toDto);
  }

  async create(name: string, actor: Actor): Promise<ExpenseCategoryDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ExpenseCategory);
        const category = await repository.save(
          repository.create({ name, isActive: true }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.EXPENSE_CATEGORY_CREATED,
          AuditEntityType.EXPENSE_CATEGORY,
          category.id,
          { newValues: { name } },
          manager,
        );
        return toDto(category);
      });
    } catch (error) {
      rethrowNameTaken(error);
    }
  }

  async rename(
    id: string,
    name: string,
    actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    try {
      return await this.change(
        id,
        actor,
        AuditAction.EXPENSE_CATEGORY_UPDATED,
        (c) => {
          const old = c.name;
          c.name = name;
          return { oldValues: { name: old }, newValues: { name } };
        },
      );
    } catch (error) {
      rethrowNameTaken(error);
    }
  }

  setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<ExpenseCategoryDto> {
    return this.change(
      id,
      actor,
      isActive
        ? AuditAction.EXPENSE_CATEGORY_ACTIVATED
        : AuditAction.EXPENSE_CATEGORY_DEACTIVATED,
      (c) => {
        const old = c.isActive;
        c.isActive = isActive;
        return { oldValues: { isActive: old }, newValues: { isActive } };
      },
    );
  }

  private change(
    id: string,
    actor: Actor,
    action: AuditAction,
    apply: (
      category: ExpenseCategory,
    ) => Parameters<AuditService['logAction']>[4],
  ): Promise<ExpenseCategoryDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ExpenseCategory);
      const category = await repository
        .createQueryBuilder('category')
        .where('category.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (!category) throw new NotFoundException('Expense category not found');
      const values = apply(category);
      await repository.save(category);
      await this.auditService.logAction(
        actor,
        action,
        AuditEntityType.EXPENSE_CATEGORY,
        id,
        values,
        manager,
      );
      return toDto(category);
    });
  }
}
