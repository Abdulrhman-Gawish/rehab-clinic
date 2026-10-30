import {
  ConflictException,
  Injectable,
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
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { normalizeEgyptianMobile } from '../../common/utils/phone.util.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { RefreshTokensService } from '../auth/refresh-tokens.service.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { User } from '../users/entities/user.entity.js';
import { rethrowEmailConflict, UsersService } from '../users/users.service.js';
import {
  DoctorResponseDto,
  PublicDoctorDto,
  type AssignServiceDto,
  type CreateDoctorDto,
  type ListDoctorsQueryDto,
  type UpdateDoctorDto,
} from './dto/doctor.dto.js';
import { DoctorClinicService } from './entities/doctor-clinic-service.entity.js';
import { Doctor } from './entities/doctor.entity.js';

// Flattened doctor + user fields, used for audit diffs.
interface DoctorSnapshot {
  name: string;
  email: string;
  phone: string | null;
  specialty: string;
  bio: string | null;
  photoUrl: string | null;
  isPublic: boolean;
  isActive: boolean;
}

const DOCTOR_AUDIT_FIELDS = [
  'name',
  'email',
  'phone',
  'specialty',
  'bio',
  'photoUrl',
  'isPublic',
  'isActive',
] as const satisfies readonly (keyof DoctorSnapshot)[];

function snapshot(doctor: Doctor, user: User): DoctorSnapshot {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    specialty: doctor.specialty,
    bio: doctor.bio,
    photoUrl: doctor.photoUrl,
    isPublic: doctor.isPublic,
    isActive: doctor.isActive,
  };
}

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor) private readonly doctors: Repository<Doctor>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly auditService: AuditService,
  ) {}

  /** Creates the DOCTOR user and the doctor profile atomically. */
  async create(dto: CreateDoctorDto, actor: Actor): Promise<DoctorResponseDto> {
    try {
      const doctorId = await this.dataSource.transaction(async (manager) => {
        const user = await this.usersService.createUser(
          { ...dto, role: UserRole.DOCTOR },
          actor,
          manager,
        );
        const repository = manager.getRepository(Doctor);
        const doctor = await repository.save(
          repository.create({
            userId: user.id,
            specialty: dto.specialty,
            bio: dto.bio ?? null,
            photoUrl: dto.photoUrl ?? null,
            isPublic: dto.isPublic ?? true,
            isActive: true,
          }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.DOCTOR_CREATED,
          AuditEntityType.DOCTOR,
          doctor.id,
          {
            newValues: {
              userId: user.id,
              ...pickValues(snapshot(doctor, user), DOCTOR_AUDIT_FIELDS),
            },
          },
          manager,
        );
        return doctor.id;
      });
      return this.findOne(doctorId);
    } catch (error) {
      rethrowEmailConflict(error);
    }
  }

  async findAll(
    query: ListDoctorsQueryDto,
  ): Promise<Paginated<DoctorResponseDto>> {
    const qb = this.withDetails(this.doctors.createQueryBuilder('doctor'))
      .orderBy('user.name', 'ASC')
      .addOrderBy('doctor.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);

    if (query.isActive !== undefined) {
      qb.andWhere('doctor.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.isPublic !== undefined) {
      qb.andWhere('doctor.isPublic = :isPublic', { isPublic: query.isPublic });
    }
    if (query.search) {
      qb.andWhere('(user.name ILIKE :term OR doctor.specialty ILIKE :term)', {
        term: `%${escapeLike(query.search)}%`,
      });
    }

    const [doctors, total] = await qb.getManyAndCount();
    return toPaginated(doctors.map(DoctorResponseDto.fromEntity), total, query);
  }

  async findOne(id: string): Promise<DoctorResponseDto> {
    return DoctorResponseDto.fromEntity(await this.loadOrFail(id));
  }

  async update(
    id: string,
    dto: UpdateDoctorDto,
    actor: Actor,
  ): Promise<DoctorResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const { doctor, user } = await this.lockDoctorAndUser(id, manager);
        const before = snapshot(doctor, user);

        if (dto.name !== undefined) user.name = dto.name;
        if (dto.email !== undefined) user.email = dto.email.toLowerCase();
        if (dto.phone !== undefined) {
          user.phone =
            dto.phone === null ? null : normalizeEgyptianMobile(dto.phone);
        }
        if (dto.specialty !== undefined) doctor.specialty = dto.specialty;
        if (dto.bio !== undefined) doctor.bio = dto.bio;
        if (dto.photoUrl !== undefined) doctor.photoUrl = dto.photoUrl;
        if (dto.isPublic !== undefined) doctor.isPublic = dto.isPublic;

        const changes = diffValues(
          before,
          snapshot(doctor, user),
          DOCTOR_AUDIT_FIELDS,
        );
        if (!changes) return;

        await manager.getRepository(User).save(user);
        await manager.getRepository(Doctor).save(doctor);
        await this.auditService.logAction(
          actor,
          AuditAction.DOCTOR_UPDATED,
          AuditEntityType.DOCTOR,
          id,
          changes,
          manager,
        );
      });
    } catch (error) {
      rethrowEmailConflict(error);
    }
    return this.findOne(id);
  }

  /**
   * Activates/deactivates the profile AND the login account together.
   * Deactivation also revokes every refresh token of the doctor.
   */
  async setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<DoctorResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const { doctor, user } = await this.lockDoctorAndUser(id, manager);
      if (doctor.isActive === isActive && user.isActive === isActive) return;

      await manager.getRepository(Doctor).update(id, { isActive });
      await manager.getRepository(User).update(user.id, { isActive });
      if (!isActive) {
        await this.refreshTokens.revokeAllForUser(user.id, manager);
      }
      await this.auditService.logAction(
        actor,
        isActive
          ? AuditAction.DOCTOR_ACTIVATED
          : AuditAction.DOCTOR_DEACTIVATED,
        AuditEntityType.DOCTOR,
        id,
        { oldValues: { isActive: doctor.isActive }, newValues: { isActive } },
        manager,
      );
    });
    return this.findOne(id);
  }

  async assignService(
    doctorId: string,
    serviceId: string,
    dto: AssignServiceDto,
    actor: Actor,
  ): Promise<DoctorResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockDoctorAndUser(doctorId, manager);
      const service = await manager
        .getRepository(ClinicService)
        .findOneBy({ id: serviceId });
      if (!service) throw new NotFoundException('Service not found');
      if (!service.isActive) {
        throw new ConflictException('Cannot assign an inactive service');
      }

      const assignments = manager.getRepository(DoctorClinicService);
      const existing = await assignments.findOneBy({ doctorId, serviceId });
      const priceOverride = dto.priceOverride ?? null;

      await assignments.upsert({ doctorId, serviceId, priceOverride }, [
        'doctorId',
        'serviceId',
      ]);
      const saved = await assignments.findOneByOrFail({ doctorId, serviceId });
      if (existing && existing.priceOverride === saved.priceOverride) return;

      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SERVICE_ASSIGNED,
        AuditEntityType.DOCTOR,
        doctorId,
        {
          oldValues: existing
            ? { serviceId, priceOverride: existing.priceOverride }
            : null,
          newValues: { serviceId, priceOverride: saved.priceOverride },
        },
        manager,
      );
    });
    return this.findOne(doctorId);
  }

  // Removes the link row only; the doctor and the service stay untouched and
  // the audit log keeps the history.
  async unassignService(
    doctorId: string,
    serviceId: string,
    actor: Actor,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockDoctorAndUser(doctorId, manager);
      const assignments = manager.getRepository(DoctorClinicService);
      const existing = await assignments.findOneBy({ doctorId, serviceId });
      if (!existing) {
        throw new NotFoundException('Service is not assigned to this doctor');
      }
      await assignments.delete({ doctorId, serviceId });
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SERVICE_UNASSIGNED,
        AuditEntityType.DOCTOR,
        doctorId,
        { oldValues: { serviceId, priceOverride: existing.priceOverride } },
        manager,
      );
    });
  }

  async findPublic(): Promise<PublicDoctorDto[]> {
    const doctors = await this.publicQuery()
      .orderBy('user.name', 'ASC')
      .addOrderBy('doctor.id', 'ASC')
      .getMany();
    return doctors.map(PublicDoctorDto.fromEntity);
  }

  async findPublicOne(id: string): Promise<PublicDoctorDto> {
    const doctor = await this.publicQuery()
      .andWhere('doctor.id = :id', { id })
      .getOne();
    if (!doctor) throw new NotFoundException('Doctor not found');
    return PublicDoctorDto.fromEntity(doctor);
  }

  private withDetails(
    qb: SelectQueryBuilder<Doctor>,
  ): SelectQueryBuilder<Doctor> {
    return qb
      .innerJoinAndSelect('doctor.user', 'user')
      .leftJoinAndSelect('doctor.services', 'assignment')
      .leftJoinAndSelect('assignment.service', 'service');
  }

  private publicQuery(): SelectQueryBuilder<Doctor> {
    return this.withDetails(this.doctors.createQueryBuilder('doctor')).where(
      'doctor.isActive = true AND doctor.isPublic = true AND user.isActive = true',
    );
  }

  private async loadOrFail(id: string): Promise<Doctor> {
    const doctor = await this.withDetails(
      this.doctors.createQueryBuilder('doctor'),
    )
      .where('doctor.id = :id', { id })
      .getOne();
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  // Locks the doctor row, then its user row (always in that order).
  private async lockDoctorAndUser(
    id: string,
    manager: EntityManager,
  ): Promise<{ doctor: Doctor; user: User }> {
    const doctor = await manager.findOne(Doctor, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');

    const user = await manager.findOneOrFail(User, {
      where: { id: doctor.userId },
      lock: { mode: 'pessimistic_write' },
    });
    return { doctor, user };
  }
}
