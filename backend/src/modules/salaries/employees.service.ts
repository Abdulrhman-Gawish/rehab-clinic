import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { toMoney } from '../../common/utils/money.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { User } from '../users/entities/user.entity.js';
import type {
  CreateEmployeeDto,
  EmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employees.dto.js';
import { EmployeeSalariesService } from './employee-salaries.service.js';
import { EmployeeSalaryTerms } from './entities/employee-salary-terms.entity.js';
import { EMPLOYEE_USER_UNIQUE, Employee } from './entities/employee.entity.js';
import { termsForMonth } from './salary-math.js';

const PROFILE = ['name', 'jobTitle', 'phone', 'notes', 'userId'] as const;

/**
 * The OWNER's directory of the clinic's employees (paid a fixed monthly
 * salary, see EmployeeSalariesService). An employee needs no login; one can
 * be linked to an OWNER or RECEPTIONIST account, never a DOCTOR's.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly salaries: EmployeeSalariesService,
    private readonly time: ClinicTimeService,
  ) {}

  async create(dto: CreateEmployeeDto, actor: Actor): Promise<EmployeeDto> {
    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        if (dto.userId) await this.assertLinkable(manager, dto.userId, null);
        const repository = manager.getRepository(Employee);
        const employee = await repository.save(
          repository.create({
            name: dto.name,
            jobTitle: dto.jobTitle,
            phone: dto.phone ?? null,
            notes: dto.notes ?? null,
            userId: dto.userId ?? null,
            isActive: true,
            createdById: actor.userId as string,
          }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.EMPLOYEE_CREATED,
          AuditEntityType.EMPLOYEE,
          employee.id,
          { newValues: pickValues(employee, PROFILE) },
          manager,
        );
        if (dto.salary) {
          await this.salaries.writeSalary(
            manager,
            employee.id,
            dto.salary,
            actor,
          );
        }
        return employee.id;
      });
    } catch (error) {
      throw await this.mapUserConflict(error, dto.userId);
    }
    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    actor: Actor,
  ): Promise<EmployeeDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const employee = await this.lock(id, manager);
        if (dto.userId && dto.userId !== employee.userId) {
          await this.assertLinkable(manager, dto.userId, id);
        }
        const before = pickValues(employee, PROFILE);
        if (dto.name !== undefined) employee.name = dto.name;
        if (dto.jobTitle !== undefined) employee.jobTitle = dto.jobTitle;
        if (dto.phone !== undefined) employee.phone = dto.phone;
        if (dto.notes !== undefined) employee.notes = dto.notes;
        if (dto.userId !== undefined) employee.userId = dto.userId;
        const changes = diffValues(before, pickValues(employee, PROFILE), [
          ...PROFILE,
        ]);
        if (!changes) return;
        await manager.getRepository(Employee).save(employee);
        await this.auditService.logAction(
          actor,
          AuditAction.EMPLOYEE_UPDATED,
          AuditEntityType.EMPLOYEE,
          id,
          changes,
          manager,
        );
      });
    } catch (error) {
      throw await this.mapUserConflict(error, dto.userId);
    }
    return this.findOne(id);
  }

  /**
   * A status only: deactivating never changes what is owed. To stop paying
   * someone who left, set their salary to 0 from the month after.
   */
  async setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<EmployeeDto> {
    await this.dataSource.transaction(async (manager) => {
      const employee = await this.lock(id, manager);
      if (employee.isActive === isActive) return;
      employee.isActive = isActive;
      await manager.getRepository(Employee).save(employee);
      await this.auditService.logAction(
        actor,
        isActive
          ? AuditAction.EMPLOYEE_ACTIVATED
          : AuditAction.EMPLOYEE_DEACTIVATED,
        AuditEntityType.EMPLOYEE,
        id,
        { oldValues: { isActive: !isActive }, newValues: { isActive } },
        manager,
      );
    });
    return this.findOne(id);
  }

  async list(query: ListEmployeesQueryDto): Promise<Paginated<EmployeeDto>> {
    const qb = this.dataSource
      .getRepository(Employee)
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.user', 'user')
      .orderBy('employee.name', 'ASC')
      .addOrderBy('employee.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (query.isActive !== undefined) {
      qb.andWhere('employee.isActive = :isActive', {
        isActive: query.isActive,
      });
    }
    if (query.search) {
      qb.andWhere(
        '(employee.name ILIKE :search OR employee.jobTitle ILIKE :search OR employee.phone LIKE :search)',
        { search: `%${escapeLike(query.search)}%` },
      );
    }
    const [employees, total] = await qb.getManyAndCount();
    const versions = await this.versionsOf(employees.map((e) => e.id));
    return toPaginated(
      employees.map((e) => this.toDto(e, versions)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<EmployeeDto> {
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id },
      relations: { user: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.toDto(employee, await this.versionsOf([id]));
  }

  // ---------- Internals ----------

  /**
   * The account can be this employee's login: it exists, is not a doctor's
   * (doctors are paid through their own salary terms) and no other employee
   * has it.
   */
  private async assertLinkable(
    manager: EntityManager,
    userId: string,
    employeeId: string | null,
  ): Promise<void> {
    const user = await manager.findOneBy(User, { id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.DOCTOR) {
      throw unprocessable(
        ErrorCode.EMPLOYEE_USER_INVALID,
        "A doctor's account can't be an employee: doctors are paid through their salary terms",
      );
    }
    const other = await manager.findOne(Employee, {
      where: employeeId ? { userId, id: Not(employeeId) } : { userId },
    });
    if (other) {
      throw conflict(
        ErrorCode.EMPLOYEE_USER_TAKEN,
        'Another employee is already linked to this account',
        { employeeId: other.id },
      );
    }
  }

  private async lock(id: string, manager: EntityManager): Promise<Employee> {
    const employee = await manager.findOne(Employee, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  // A concurrent link of the same account loses on the unique index.
  private async mapUserConflict(
    error: unknown,
    userId: string | null | undefined,
  ): Promise<unknown> {
    if (!isUniqueViolation(error, EMPLOYEE_USER_UNIQUE) || !userId) {
      return error;
    }
    const other = await this.dataSource
      .getRepository(Employee)
      .findOneBy({ userId });
    return conflict(
      ErrorCode.EMPLOYEE_USER_TAKEN,
      'Another employee is already linked to this account',
      { employeeId: other?.id ?? null },
    );
  }

  private async versionsOf(
    employeeIds: string[],
  ): Promise<EmployeeSalaryTerms[]> {
    if (employeeIds.length === 0) return [];
    return this.dataSource
      .getRepository(EmployeeSalaryTerms)
      .findBy({ employeeId: In(employeeIds) });
  }

  private toDto(
    employee: Employee,
    allVersions: EmployeeSalaryTerms[],
  ): EmployeeDto {
    const thisMonth = this.time.today().slice(0, 7);
    const versions = allVersions
      .filter((v) => v.employeeId === employee.id)
      .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
    const current = termsForMonth(versions, thisMonth);
    const upcoming = versions.find((v) => v.effectiveMonth > thisMonth);
    const version = (v: EmployeeSalaryTerms | null | undefined) =>
      v
        ? {
            effectiveMonth: v.effectiveMonth,
            fixedSalary: toMoney(v.fixedSalary),
          }
        : null;
    const user = employee.user;
    return {
      id: employee.id,
      name: employee.name,
      jobTitle: employee.jobTitle,
      phone: employee.phone,
      notes: employee.notes,
      isActive: employee.isActive,
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
          }
        : null,
      currentSalary: version(current),
      upcomingSalary: version(upcoming),
      createdAt: this.time.toIso(employee.createdAt),
    };
  }
}
