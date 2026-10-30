import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import type { AuditAction, AuditEntityType } from './audit.constants.js';
import {
  AuditLogResponseDto,
  type ListAuditLogsQueryDto,
} from './dto/audit.dto.js';
import { AuditLog, type AuditValues } from './entities/audit-log.entity.js';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  oldValues?: AuditValues | null;
  newValues?: AuditValues | null;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    private readonly time: ClinicTimeService,
  ) {}

  /**
   * Writes an audit entry. Pass the transaction's EntityManager so the entry
   * is committed (or rolled back) together with the change it describes.
   * Prefer logAction(); use log() only for entries without an entity (auth).
   */
  async log(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repository = manager
      ? manager.getRepository(AuditLog)
      : this.auditLogs;
    await repository.save(AuditService.toEntity(entry));
  }

  static toEntity(entry: AuditEntry): AuditLog {
    return Object.assign(new AuditLog(), {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
      ip: entry.ip ?? null,
    });
  }

  // The default: "actor did X to entity Y", in the caller's transaction.
  logAction(
    actor: Actor,
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
    values: { oldValues?: AuditValues | null; newValues?: AuditValues | null },
    manager?: EntityManager,
  ): Promise<void> {
    return this.log(
      {
        userId: actor.userId,
        ip: actor.ip,
        action,
        entityType,
        entityId,
        ...values,
      },
      manager,
    );
  }

  async findAll(
    query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogResponseDto>> {
    const qb = this.auditLogs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.entityType) {
      qb.andWhere('log.entityType = :entityType', {
        entityType: query.entityType,
      });
    }
    if (query.entityId) {
      qb.andWhere('log.entityId = :entityId', { entityId: query.entityId });
    }
    if (query.userId) {
      qb.andWhere('log.userId = :userId', { userId: query.userId });
    }
    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }
    const { start, end } = this.time.dateRange(query.from, query.to);
    if (start) qb.andWhere('log.createdAt >= :start', { start });
    if (end) qb.andWhere('log.createdAt < :end', { end });

    const [logs, total] = await qb.getManyAndCount();
    return toPaginated(logs.map(AuditLogResponseDto.fromEntity), total, query);
  }
}
