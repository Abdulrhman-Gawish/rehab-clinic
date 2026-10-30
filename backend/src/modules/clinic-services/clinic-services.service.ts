import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import type { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorClinicService } from '../doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import {
  ClinicServiceResponseDto,
  PublicClinicServiceDto,
  type CreateClinicServiceDto,
  type ListClinicServicesQueryDto,
  type ServiceDoctorsDto,
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

// doctorIds and allDoctors are exclusive; `required` for PUT .../doctors.
// Returns whether the doctor list should change.
function wantsDoctors(dto: ServiceDoctorsDto, required: boolean): boolean {
  const given = dto.doctorIds !== undefined || dto.allDoctors !== undefined;
  if (dto.doctorIds !== undefined && dto.allDoctors !== undefined) {
    throw new BadRequestException(
      'Provide either doctorIds or allDoctors, not both',
    );
  }
  if (required && !given) {
    throw new BadRequestException('Provide either doctorIds or allDoctors');
  }
  return given;
}

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
    const withDoctors = wantsDoctors(dto, false);
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
      if (withDoctors) {
        await this.replaceDoctors(created, dto, actor, manager);
      }
      return created;
    });
    return this.toResponse(service);
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
    const doctors = await this.doctorsByService(services.map((s) => s.id));
    return toPaginated(
      services.map((s) =>
        ClinicServiceResponseDto.fromEntity(s, doctors.get(s.id) ?? []),
      ),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<ClinicServiceResponseDto> {
    const service = await this.services.findOneBy({ id });
    if (!service) throw new NotFoundException('Service not found');
    return this.toResponse(service);
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
    const withDoctors = wantsDoctors(dto, false);
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
      withDoctors ? dto : undefined,
    );
  }

  // Replaces the list of doctors offering the service.
  setDoctors(
    id: string,
    dto: ServiceDoctorsDto,
    actor: Actor,
  ): Promise<ClinicServiceResponseDto> {
    wantsDoctors(dto, true);
    return this.mutate(
      id,
      actor,
      AuditAction.CLINIC_SERVICE_UPDATED,
      () => undefined,
      dto,
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
    doctors?: ServiceDoctorsDto,
  ): Promise<ClinicServiceResponseDto> {
    const service = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const repository = manager.getRepository(ClinicService);
        const service = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
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
        if (doctors) {
          await this.replaceDoctors(after, doctors, actor, manager);
        }
        return after;
      },
    );
    return this.toResponse(service);
  }

  /**
   * Makes the doctor_services rows of `service` match the requested doctors.
   * Rows that stay keep their price_override; each added/removed doctor is
   * audited like PUT/DELETE /doctors/:id/services/:serviceId.
   */
  private async replaceDoctors(
    service: ClinicService,
    dto: ServiceDoctorsDto,
    actor: Actor,
    manager: EntityManager,
  ): Promise<void> {
    let target: string[];
    if (dto.allDoctors) {
      const active = await manager.find(Doctor, {
        where: { isActive: true },
        select: { id: true },
      });
      target = active.map((doctor) => doctor.id);
    } else {
      target = dto.doctorIds ?? [];
      const found = await manager.countBy(Doctor, { id: In(target) });
      if (found !== target.length) {
        throw new NotFoundException('Doctor not found');
      }
    }

    const rows = manager.getRepository(DoctorClinicService);
    const current = await rows.findBy({ serviceId: service.id });
    const removed = current.filter((row) => !target.includes(row.doctorId));
    const added = target.filter(
      (doctorId) => !current.some((row) => row.doctorId === doctorId),
    );
    if (added.length > 0 && !service.isActive) {
      throw new ConflictException('Cannot assign an inactive service');
    }

    if (removed.length > 0) {
      await rows.delete({
        serviceId: service.id,
        doctorId: In(removed.map((row) => row.doctorId)),
      });
    }
    if (added.length > 0) {
      await rows
        .createQueryBuilder()
        .insert()
        .values(
          added.map((doctorId) => ({
            doctorId,
            serviceId: service.id,
            priceOverride: null,
          })),
        )
        .orIgnore()
        .execute();
    }

    for (const row of removed) {
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SERVICE_UNASSIGNED,
        AuditEntityType.DOCTOR,
        row.doctorId,
        {
          oldValues: {
            serviceId: service.id,
            priceOverride: row.priceOverride,
          },
        },
        manager,
      );
    }
    for (const doctorId of added) {
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SERVICE_ASSIGNED,
        AuditEntityType.DOCTOR,
        doctorId,
        { newValues: { serviceId: service.id, priceOverride: null } },
        manager,
      );
    }
  }

  private async toResponse(
    service: ClinicService,
  ): Promise<ClinicServiceResponseDto> {
    const doctors = await this.doctorsByService([service.id]);
    return ClinicServiceResponseDto.fromEntity(
      service,
      doctors.get(service.id) ?? [],
    );
  }

  // { id: doctor id, name } of every doctor offering each service, by name.
  private async doctorsByService(
    serviceIds: string[],
  ): Promise<Map<string, UserRefDto[]>> {
    const byService = new Map<string, UserRefDto[]>();
    if (serviceIds.length === 0) return byService;
    const rows = await this.dataSource.getRepository(DoctorClinicService).find({
      where: { serviceId: In(serviceIds) },
      relations: { doctor: { user: true } },
    });
    rows.sort((a, b) =>
      (a.doctor?.user.name ?? '').localeCompare(b.doctor?.user.name ?? ''),
    );
    for (const row of rows) {
      if (!row.doctor) throw new Error('Doctor relation is not loaded');
      const list = byService.get(row.serviceId) ?? [];
      list.push({ id: row.doctor.id, name: row.doctor.user.name });
      byService.set(row.serviceId, list);
    }
    return byService;
  }
}
