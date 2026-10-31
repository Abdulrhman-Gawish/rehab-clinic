import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { compareMoney, dec } from '../../common/utils/money.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DiscountType } from '../billing/billing.enums.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../doctors/entities/doctor-clinic-service.entity.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import type {
  CreatePackageDto,
  ListPackagesQueryDto,
  PackageOfferDto,
  PackageResponseDto,
  PublicPackageDto,
  UpdatePackageDto,
} from './dto/package.dto.js';
import { PackageDoctor } from './entities/package-doctor.entity.js';
import { Package } from './entities/package.entity.js';
import { toPackageResponse, toPublicPackage } from './package.mapper.js';

const PACKAGE_AUDIT_FIELDS = [
  'name',
  'serviceId',
  'sessionsCount',
  'price',
  'allDoctors',
  'doctorIds',
  'offerType',
  'offerValue',
  'offerStartsOn',
  'offerEndsOn',
  'isPublic',
  'isActive',
] as const;

type PackageSnapshot = Record<(typeof PACKAGE_AUDIT_FIELDS)[number], unknown>;

function snapshot(pkg: Package, doctorIds: string[]): PackageSnapshot {
  return {
    name: pkg.name,
    serviceId: pkg.serviceId,
    sessionsCount: pkg.sessionsCount,
    price: pkg.price,
    allDoctors: pkg.allDoctors,
    // A string, so diffValues can compare it.
    doctorIds: [...doctorIds].sort().join(','),
    offerType: pkg.offerType,
    offerValue: pkg.offerValue,
    offerStartsOn: pkg.offerStartsOn,
    offerEndsOn: pkg.offerEndsOn,
    isPublic: pkg.isPublic,
    isActive: pkg.isActive,
  };
}

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    details: [{ field, errors: [message] }],
  });
}

// The package catalog (OWNER writes, RECEPTIONIST reads, public listing).
@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async create(
    dto: CreatePackageDto,
    actor: Actor,
  ): Promise<PackageResponseDto> {
    if (!hasDoctorsInput(dto)) {
      throw new BadRequestException('Provide either doctorIds or allDoctors');
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Package);
      const pkg = repository.create({
        name: dto.name,
        serviceId: dto.serviceId,
        sessionsCount: dto.sessionsCount,
        price: dto.price,
        allDoctors: dto.allDoctors ?? false,
        isPublic: dto.isPublic ?? true,
        isActive: true,
      });
      applyOffer(pkg, dto.offer ?? null);
      const doctorIds = dto.allDoctors ? [] : (dto.doctorIds ?? []);
      await this.assertValid(pkg, doctorIds, manager);

      const saved = await repository.save(pkg);
      await this.saveDoctors(saved.id, doctorIds, manager);
      const created = await repository.findOneByOrFail({ id: saved.id });
      await this.auditService.logAction(
        actor,
        AuditAction.PACKAGE_CREATED,
        AuditEntityType.PACKAGE,
        created.id,
        {
          newValues: pickValues(
            snapshot(created, doctorIds),
            PACKAGE_AUDIT_FIELDS,
          ),
        },
        manager,
      );
      return created.id;
    });
    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdatePackageDto,
    actor: Actor,
  ): Promise<PackageResponseDto> {
    hasDoctorsInput(dto);
    await this.mutate(id, actor, AuditAction.PACKAGE_UPDATED, (pkg) => {
      if (dto.name !== undefined) pkg.name = dto.name;
      if (dto.serviceId !== undefined) pkg.serviceId = dto.serviceId;
      if (dto.sessionsCount !== undefined) {
        pkg.sessionsCount = dto.sessionsCount;
      }
      if (dto.price !== undefined) pkg.price = dto.price;
      if (dto.isPublic !== undefined) pkg.isPublic = dto.isPublic;
      if (dto.offer !== undefined) applyOffer(pkg, dto.offer);
      if (dto.allDoctors) {
        pkg.allDoctors = true;
        return [];
      }
      if (dto.doctorIds !== undefined) {
        pkg.allDoctors = false;
        return dto.doctorIds;
      }
      return undefined;
    });
    return this.findOne(id);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<PackageResponseDto> {
    await this.mutate(
      id,
      actor,
      isActive
        ? AuditAction.PACKAGE_ACTIVATED
        : AuditAction.PACKAGE_DEACTIVATED,
      (pkg) => {
        pkg.isActive = isActive;
        return undefined;
      },
    );
    return this.findOne(id);
  }

  // Deleted for good: gone from every list and never sold again. Sold
  // packages keep their sessions and doctor list.
  async remove(id: string, actor: Actor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const pkg = await manager.findOne(Package, {
        where: { id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      const wasActive = pkg.isActive;
      pkg.isActive = false;
      pkg.deletedAt = this.time.now();
      await manager.getRepository(Package).save(pkg);
      await this.auditService.logAction(
        actor,
        AuditAction.PACKAGE_DELETED,
        AuditEntityType.PACKAGE,
        id,
        { oldValues: { isActive: wasActive }, newValues: { deleted: true } },
        manager,
      );
    });
  }

  async findAll(
    query: ListPackagesQueryDto,
  ): Promise<Paginated<PackageResponseDto>> {
    const qb = this.detailQuery()
      .orderBy('pkg.name', 'ASC')
      .addOrderBy('pkg.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (query.isActive !== undefined) {
      qb.andWhere('pkg.isActive = :isActive', { isActive: query.isActive });
    }
    const [rows, total] = await qb.getManyAndCount();
    const today = this.time.today();
    return toPaginated(
      rows.map((pkg) => toPackageResponse(pkg, today)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<PackageResponseDto> {
    const pkg = await this.detailQuery()
      .andWhere('pkg.id = :id', { id })
      .getOne();
    if (!pkg) throw new NotFoundException('Package not found');
    return toPackageResponse(pkg, this.time.today());
  }

  // Active, public packages of an active service.
  async findPublic(): Promise<PublicPackageDto[]> {
    const rows = await this.packages
      .createQueryBuilder('pkg')
      .innerJoinAndSelect('pkg.service', 'service')
      .leftJoinAndSelect('pkg.doctors', 'link')
      .leftJoinAndSelect('link.doctor', 'doctor')
      .leftJoinAndSelect('doctor.user', 'doctorUser')
      .where('pkg.isActive = true AND pkg.isPublic = true')
      .andWhere('service.isActive = true')
      .orderBy('pkg.name', 'ASC')
      .addOrderBy('pkg.id', 'ASC')
      .getMany();
    const today = this.time.today();
    return rows.map((pkg) => toPublicPackage(pkg, today));
  }

  // ---------- Internals ----------

  /**
   * `change` edits the locked row and returns the new doctor list, or
   * undefined to keep it. Everything is re-validated, saved and audited
   * with only the fields that changed.
   */
  private async mutate(
    id: string,
    actor: Actor,
    action: AuditAction,
    change: (pkg: Package) => string[] | undefined,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Package);
      const pkg = await repository.findOne({
        where: { id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      const currentIds = (
        await manager.findBy(PackageDoctor, { packageId: id })
      ).map((link) => link.doctorId);
      const before = snapshot(pkg, currentIds);

      const newIds = change(pkg);
      const doctorIds = pkg.allDoctors ? [] : (newIds ?? currentIds);
      // Only a package that can be sold must be valid (activating re-checks).
      if (pkg.isActive) await this.assertValid(pkg, doctorIds, manager);

      await repository.save(pkg);
      if (newIds !== undefined || pkg.allDoctors) {
        await manager.delete(PackageDoctor, { packageId: id });
        await this.saveDoctors(id, doctorIds, manager);
      }
      const after = await repository.findOneByOrFail({ id });
      const changes = diffValues(
        before,
        snapshot(after, doctorIds),
        PACKAGE_AUDIT_FIELDS,
      );
      if (changes) {
        await this.auditService.logAction(
          actor,
          action,
          AuditEntityType.PACKAGE,
          id,
          changes,
          manager,
        );
      }
    });
  }

  // Service active, every listed doctor offers it, offer within the price.
  private async assertValid(
    pkg: Package,
    doctorIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    const service = await manager.findOneBy(ClinicService, {
      id: pkg.serviceId,
    });
    if (!service) throw new NotFoundException('Service not found');
    if (!service.isActive) {
      throw unprocessable(
        ErrorCode.SERVICE_NOT_OFFERED,
        'The service is inactive',
      );
    }

    if (doctorIds.length > 0) {
      const found = await manager.countBy(Doctor, { id: In(doctorIds) });
      if (found !== doctorIds.length) {
        throw new NotFoundException('Doctor not found');
      }
      const offering = await manager.findBy(DoctorClinicService, {
        serviceId: pkg.serviceId,
        doctorId: In(doctorIds),
      });
      const missing = doctorIds.filter(
        (doctorId) => !offering.some((row) => row.doctorId === doctorId),
      );
      if (missing.length > 0) {
        throw unprocessable(
          ErrorCode.SERVICE_NOT_OFFERED,
          "Every listed doctor must offer the package's service",
          { doctorIds: missing },
        );
      }
    } else if (!pkg.allDoctors) {
      throw new BadRequestException(
        'A package needs doctorIds or allDoctors: true',
      );
    }

    if (pkg.offerType === null || pkg.offerValue === null) return;
    if (
      pkg.offerType === DiscountType.PERCENT &&
      dec(pkg.offerValue).greaterThan(100)
    ) {
      throw validationError(
        'offer.value',
        'A percent offer must be greater than 0 and at most 100',
      );
    }
    if (
      pkg.offerType === DiscountType.FIXED &&
      compareMoney(pkg.offerValue, pkg.price) > 0
    ) {
      throw unprocessable(
        ErrorCode.OFFER_EXCEEDS_PRICE,
        'The offer cannot make the price negative',
        { price: pkg.price, offer: pkg.offerValue },
      );
    }
    if (
      pkg.offerStartsOn &&
      pkg.offerEndsOn &&
      pkg.offerStartsOn > pkg.offerEndsOn
    ) {
      throw validationError(
        'offer.endsOn',
        'The offer cannot end before it starts',
      );
    }
  }

  private async saveDoctors(
    packageId: string,
    doctorIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    if (doctorIds.length === 0) return;
    await manager.insert(
      PackageDoctor,
      doctorIds.map((doctorId) => ({ packageId, doctorId })),
    );
  }

  private detailQuery(): SelectQueryBuilder<Package> {
    return this.packages
      .createQueryBuilder('pkg')
      .innerJoinAndSelect('pkg.service', 'service')
      .leftJoinAndSelect('pkg.doctors', 'link')
      .leftJoinAndSelect('link.doctor', 'doctor')
      .leftJoinAndSelect('doctor.user', 'doctorUser')
      .where('pkg.deletedAt IS NULL');
  }
}

// doctorIds and allDoctors are exclusive. Returns whether one was given.
function hasDoctorsInput(dto: {
  doctorIds?: string[];
  allDoctors?: true;
}): boolean {
  if (dto.doctorIds !== undefined && dto.allDoctors !== undefined) {
    throw new BadRequestException(
      'Provide either doctorIds or allDoctors, not both',
    );
  }
  return dto.doctorIds !== undefined || dto.allDoctors !== undefined;
}

function applyOffer(pkg: Package, offer: PackageOfferDto | null): void {
  pkg.offerType = offer?.type ?? null;
  pkg.offerValue = offer?.value ?? null;
  pkg.offerStartsOn = offer?.startsOn ?? null;
  pkg.offerEndsOn = offer?.endsOn ?? null;
}
