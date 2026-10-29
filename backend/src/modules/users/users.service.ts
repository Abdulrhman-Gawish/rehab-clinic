import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { hashPassword } from '../../common/utils/password.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { normalizeEgyptianMobile } from '../../common/utils/phone.util.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { RefreshTokensService } from '../auth/refresh-tokens.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { User, USER_EMAIL_UNIQUE } from './entities/user.entity.js';

// Fields recorded in audit entries. Never includes passwordHash.
export const USER_AUDIT_FIELDS = [
  'name',
  'email',
  'phone',
  'role',
  'isActive',
] as const satisfies readonly (keyof User)[];

export interface NewUserData {
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  role: UserRole;
}

// Converts the email unique violation into a 409. Call it in a catch block
// OUTSIDE the failed transaction.
export function rethrowEmailConflict(error: unknown): never {
  if (isUniqueViolation(error, USER_EMAIL_UNIQUE)) {
    throw new ConflictException('A user with this email already exists');
  }
  throw error;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly refreshTokens: RefreshTokensService,
  ) {}

  async create(dto: CreateUserDto, actor: Actor): Promise<UserResponseDto> {
    try {
      const user = await this.dataSource.transaction((manager) =>
        this.createUser(dto, actor, manager),
      );
      return UserResponseDto.fromEntity(user);
    } catch (error) {
      rethrowEmailConflict(error);
    }
  }

  /**
   * Inserts a user and its audit entry using the caller's transaction.
   * Also used by DoctorsService. Uniqueness is enforced by the DB constraint.
   */
  async createUser(
    data: NewUserData,
    actor: Actor,
    manager: EntityManager,
  ): Promise<User> {
    const repository = manager.getRepository(User);
    const user = await repository.save(
      repository.create({
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        phone: data.phone ? normalizeEgyptianMobile(data.phone) : null,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        isActive: true,
        lastLoginAt: null,
      }),
    );
    await this.auditService.logAction(
      actor,
      AuditAction.USER_CREATED,
      AuditEntityType.USER,
      user.id,
      { newValues: pickValues(user, USER_AUDIT_FIELDS) },
      manager,
    );
    return user;
  }

  async findAll(query: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const qb = this.users
      .createQueryBuilder('user')
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      qb.andWhere('(user.name ILIKE :term OR user.email ILIKE :term)', {
        term: `%${escapeLike(query.search)}%`,
      });
    }

    const [users, total] = await qb.getManyAndCount();
    return toPaginated(users.map(UserResponseDto.fromEntity), total, query);
  }

  async findOne(id: string): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.getOrFail(id));
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: Actor,
  ): Promise<UserResponseDto> {
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const demotesOwner =
          dto.role !== undefined && dto.role !== UserRole.OWNER;
        if (demotesOwner) await this.lockActiveOwners(manager);

        const user = await this.getForUpdate(id, manager);
        this.assertNotDoctor(user);
        if (demotesOwner && user.role === UserRole.OWNER && user.isActive) {
          await this.assertAnotherActiveOwner(id, manager);
        }

        const before = { ...user };
        if (dto.name !== undefined) user.name = dto.name;
        if (dto.email !== undefined) user.email = dto.email.toLowerCase();
        if (dto.phone !== undefined) {
          user.phone =
            dto.phone === null ? null : normalizeEgyptianMobile(dto.phone);
        }
        if (dto.role !== undefined) user.role = dto.role;

        const changes = diffValues(before, user, USER_AUDIT_FIELDS);
        if (!changes) return user;

        const saved = await manager.getRepository(User).save(user);
        await this.auditService.logAction(
          actor,
          AuditAction.USER_UPDATED,
          AuditEntityType.USER,
          id,
          changes,
          manager,
        );
        return saved;
      });
      return UserResponseDto.fromEntity(user);
    } catch (error) {
      rethrowEmailConflict(error);
    }
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<UserResponseDto> {
    if (!isActive && id === actor.userId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const user = await this.dataSource.transaction(async (manager) => {
      if (!isActive) await this.lockActiveOwners(manager);

      const user = await this.getForUpdate(id, manager);
      this.assertNotDoctor(user);
      if (user.isActive === isActive) return user;

      if (!isActive && user.role === UserRole.OWNER) {
        await this.assertAnotherActiveOwner(id, manager);
      }

      user.isActive = isActive;
      const saved = await manager.getRepository(User).save(user);
      if (!isActive) {
        await this.refreshTokens.revokeAllForUser(id, manager);
      }
      await this.auditService.logAction(
        actor,
        isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
        AuditEntityType.USER,
        id,
        { oldValues: { isActive: !isActive }, newValues: { isActive } },
        manager,
      );
      return saved;
    });
    return UserResponseDto.fromEntity(user);
  }

  // Works for every role (including doctors). Signs the user out everywhere.
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actor: Actor,
  ): Promise<void> {
    const passwordHash = await hashPassword(dto.newPassword);
    await this.dataSource.transaction(async (manager) => {
      await this.getForUpdate(id, manager);
      await manager.getRepository(User).update(id, { passwordHash });
      await this.refreshTokens.revokeAllForUser(id, manager);
      await this.auditService.logAction(
        actor,
        AuditAction.USER_PASSWORD_RESET,
        AuditEntityType.USER,
        id,
        {},
        manager,
      );
    });
  }

  private async getOrFail(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async getForUpdate(
    id: string,
    manager: EntityManager,
  ): Promise<User> {
    const user = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Doctor accounts are kept in sync with their profile by DoctorsService.
  private assertNotDoctor(user: User): void {
    if (user.role === UserRole.DOCTOR) {
      throw new ConflictException(
        'Doctor accounts are managed through the /doctors endpoints',
      );
    }
  }

  /**
   * Locks every active OWNER row (in id order, so concurrent callers can't
   * deadlock). Two owners deactivating each other at the same time are thus
   * serialized and the second one sees the first one's change.
   */
  private async lockActiveOwners(manager: EntityManager): Promise<void> {
    await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .select('user.id')
      .where('user.role = :role AND user.isActive = true', {
        role: UserRole.OWNER,
      })
      .orderBy('user.id')
      .setLock('pessimistic_write')
      .getMany();
  }

  private async assertAnotherActiveOwner(
    excludeId: string,
    manager: EntityManager,
  ): Promise<void> {
    const others = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.role = :role AND user.isActive = true AND user.id <> :id', {
        role: UserRole.OWNER,
        id: excludeId,
      })
      .getCount();
    if (others === 0) {
      throw new ConflictException('At least one active OWNER must remain');
    }
  }
}
