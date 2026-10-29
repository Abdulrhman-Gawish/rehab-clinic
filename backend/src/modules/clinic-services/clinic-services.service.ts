import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ClinicServiceResponseDto,
  PublicClinicServiceDto,
  type CreateClinicServiceDto,
  type ListClinicServicesQueryDto,
  type UpdateClinicServiceDto,
} from './dto/clinic-service.dto.js';
import { ClinicService } from './entities/clinic-service.entity.js';

const CLINIC_SERVICE_AUDIT_FIELDS = [
  'name',
  'description',
  'durationMinutes',
  'basePrice',
  'isActive',
] as const satisfies readonly (keyof ClinicService)[];

@Injectable()
export class ClinicServicesService {
  constructor(
    @InjectRepository(ClinicService)
    private readonly services: Repository<ClinicService>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateClinicServiceDto,
    actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    const service = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ClinicService);
      const saved = await repository.save(
        repository.create({
          name: dto.name,
          description: dto.description ?? null,
          durationMinutes: dto.durationMinutes,
          basePrice: dto.basePrice,
          isActive: true,
        }),
      );
      // Re-read so numeric columns come back in canonical form ("350.00").
      const created = await repository.findOneByOrFail({ id: saved.id });
      await this.auditService.logAction(
        actor,
        AuditAction.CLINIC_SERVICE_CREATED,
        AuditEntityType.CLINIC_SERVICE,
        created.id,
        { newValues: pickValues(created, CLINIC_SERVICE_AUDIT_FIELDS) },
        manager,
      );
      return created;
    });
    return ClinicServiceResponseDto.fromEntity(service);
  }

  async findAll(
    query: ListClinicServicesQueryDto,
  ): Promise<Paginated<ClinicServiceResponseDto>> {
    const qb = this.services
      .createQueryBuilder('service')
      .orderBy('service.name', 'ASC')
      .addOrderBy('service.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (query.isActive !== undefined) {
      qb.andWhere('service.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      qb.andWhere('service.name ILIKE :term', {
        term: `%${escapeLike(query.search)}%`,
      });
    }
    const [services, total] = await qb.getManyAndCount();
    return toPaginated(
      services.map(ClinicServiceResponseDto.fromEntity),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<ClinicServiceResponseDto> {
    const service = await this.services.findOneBy({ id });
    if (!service) throw new NotFoundException('Service not found');
    return ClinicServiceResponseDto.fromEntity(service);
  }

  async findPublic(): Promise<PublicClinicServiceDto[]> {
    const services = await this.services.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    return services.map(PublicClinicServiceDto.fromEntity);
  }

  update(
    id: string,
    dto: UpdateClinicServiceDto,
    actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.mutate(
      id,
      actor,
      AuditAction.CLINIC_SERVICE_UPDATED,
      (service) => {
        if (dto.name !== undefined) service.name = dto.name;
        if (dto.description !== undefined)
          service.description = dto.description;
        if (dto.durationMinutes !== undefined) {
          service.durationMinutes = dto.durationMinutes;
        }
        if (dto.basePrice !== undefined) service.basePrice = dto.basePrice;
      },
    );
  }

  // No hard delete: deactivated services disappear from public listings and
  // can't be newly assigned, but history keeps pointing at them.
  setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    return this.mutate(
      id,
      actor,
      isActive
        ? AuditAction.CLINIC_SERVICE_ACTIVATED
        : AuditAction.CLINIC_SERVICE_DEACTIVATED,
      (service) => {
        service.isActive = isActive;
      },
    );
  }

  private async mutate(
    id: string,
    actor: Actor,
    action: AuditAction,
    apply: (service: ClinicService) => void,
  ): Promise<ClinicServiceResponseDto> {
    const service = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const repository = manager.getRepository(ClinicService);
        const service = await repository
          .createQueryBuilder('service')
          .where('service.id = :id', { id })
          .setLock('pessimistic_write')
          .getOne();
        if (!service) throw new NotFoundException('Service not found');

        const before = { ...service };
        apply(service);
        await repository.save(service);
        const after = await repository.findOneByOrFail({ id });

        const changes = diffValues(before, after, CLINIC_SERVICE_AUDIT_FIELDS);
        if (changes) {
          await this.auditService.logAction(
            actor,
            action,
            AuditEntityType.CLINIC_SERVICE,
            id,
            changes,
            manager,
          );
        }
        return after;
      },
    );
    return ClinicServiceResponseDto.fromEntity(service);
  }
}
