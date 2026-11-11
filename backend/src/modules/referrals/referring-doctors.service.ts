import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  toPaginated,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  AgreementDto,
  CreateAgreementDto,
  CreateReferringDoctorDto,
  ListReferringDoctorsQueryDto,
  ReferringDoctorDto,
  UpdateReferringDoctorDto,
} from './dto/referrals.dto.js';
import { ReferringDoctorAgreement } from './entities/referring-doctor-agreement.entity.js';
import {
  REFERRING_DOCTOR_PHONE_UNIQUE,
  ReferringDoctor,
} from './entities/referring-doctor.entity.js';
import {
  currentAgreement,
  normalizeRate,
  type RateRule,
} from './referral-math.js';
import { toAgreement, toReferringDoctor } from './referral.mapper.js';

const PROFILE = ['name', 'phone', 'specialty', 'workplace', 'notes'] as const;

/**
 * The OWNER's directory of outside doctors who refer patients, and their
 * default agreements (immutable versions). Reception reads it to pick a
 * doctor and load the defaults.
 */
@Injectable()
export class ReferringDoctorsService {
  constructor(
    @InjectRepository(ReferringDoctor)
    private readonly doctors: Repository<ReferringDoctor>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async create(
    dto: CreateReferringDoctorDto,
    actor: Actor,
  ): Promise<ReferringDoctorDto> {
    const commission = normalizeRate(
      'commission',
      dto.commission.type,
      dto.commission.value,
    );
    const discount = normalizeRate(
      'discount',
      dto.discount.type,
      dto.discount.value,
    );
    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ReferringDoctor);
        const doctor = await repository.save(
          repository.create({
            name: dto.name,
            phone: dto.phone ?? null,
            specialty: dto.specialty ?? null,
            workplace: dto.workplace ?? null,
            notes: dto.notes ?? null,
            isActive: true,
            createdById: actor.userId as string,
          }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.REFERRING_DOCTOR_CREATED,
          AuditEntityType.REFERRING_DOCTOR,
          doctor.id,
          { newValues: pickValues(doctor, PROFILE) },
          manager,
        );
        await this.insertAgreement(
          manager,
          doctor.id,
          1,
          {
            commission,
            discount,
            effectiveFrom: this.time.today(),
            notes: dto.agreementNotes ?? null,
          },
          null,
          actor,
        );
        return doctor.id;
      });
    } catch (error) {
      throw await this.mapPhoneConflict(error, dto.phone);
    }
    return this.findOne(id);
  }

  async update(
    id: string,
    dto: UpdateReferringDoctorDto,
    actor: Actor,
  ): Promise<ReferringDoctorDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const doctor = await this.lock(id, manager);
        const before = pickValues(doctor, PROFILE);
        for (const key of PROFILE) {
          const value = dto[key];
          if (value === undefined) continue;
          if (key === 'name') doctor.name = value as string;
          else doctor[key] = value;
        }
        const changes = diffValues(before, pickValues(doctor, PROFILE), [
          ...PROFILE,
        ]);
        if (!changes) return;
        await manager.getRepository(ReferringDoctor).save(doctor);
        await this.auditService.logAction(
          actor,
          AuditAction.REFERRING_DOCTOR_UPDATED,
          AuditEntityType.REFERRING_DOCTOR,
          doctor.id,
          changes,
          manager,
        );
      });
    } catch (error) {
      throw await this.mapPhoneConflict(error, dto.phone);
    }
    return this.findOne(id);
  }

  // Deactivating stops new referrals; current ones keep their terms.
  async setActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<ReferringDoctorDto> {
    await this.dataSource.transaction(async (manager) => {
      const doctor = await this.lock(id, manager);
      if (doctor.isActive === isActive) return;
      doctor.isActive = isActive;
      await manager.getRepository(ReferringDoctor).save(doctor);
      await this.auditService.logAction(
        actor,
        isActive
          ? AuditAction.REFERRING_DOCTOR_ACTIVATED
          : AuditAction.REFERRING_DOCTOR_DEACTIVATED,
        AuditEntityType.REFERRING_DOCTOR,
        doctor.id,
        {
          oldValues: { isActive: !isActive },
          newValues: { isActive },
        },
        manager,
      );
    });
    return this.findOne(id);
  }

  /**
   * A new default agreement version. Effective today by default; never in
   * the past and never before the latest version, so versions stay in
   * date order. Existing patient terms keep pointing at the version they
   * were made with.
   */
  async addAgreement(
    id: string,
    dto: CreateAgreementDto,
    actor: Actor,
  ): Promise<ReferringDoctorDto> {
    const commission = normalizeRate(
      'commission',
      dto.commission.type,
      dto.commission.value,
    );
    const discount = normalizeRate(
      'discount',
      dto.discount.type,
      dto.discount.value,
    );
    await this.dataSource.transaction(async (manager) => {
      await this.lock(id, manager);
      const versions = await manager.find(ReferringDoctorAgreement, {
        where: { referringDoctorId: id },
        order: { version: 'DESC' },
      });
      const latest = versions[0];
      const today = this.time.today();
      const minDate =
        latest && latest.effectiveFrom > today ? latest.effectiveFrom : today;
      const effectiveFrom = dto.effectiveFrom ?? today;
      if (effectiveFrom < minDate) {
        throw unprocessable(
          ErrorCode.AGREEMENT_DATE_INVALID,
          'The agreement cannot start in the past or before the latest version',
          { minDate },
        );
      }
      await this.insertAgreement(
        manager,
        id,
        (latest?.version ?? 0) + 1,
        { commission, discount, effectiveFrom, notes: dto.notes ?? null },
        currentAgreement(versions, today),
        actor,
      );
    });
    return this.findOne(id);
  }

  async list(
    query: ListReferringDoctorsQueryDto,
  ): Promise<Paginated<ReferringDoctorDto>> {
    const qb = this.doctors
      .createQueryBuilder('doctor')
      .orderBy('doctor.name', 'ASC')
      .addOrderBy('doctor.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (query.isActive !== undefined) {
      qb.andWhere('doctor.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      qb.andWhere('(doctor.name ILIKE :search OR doctor.phone LIKE :search)', {
        search: `%${escapeLike(query.search)}%`,
      });
    }
    const [doctors, total] = await qb.getManyAndCount();
    const agreements = await this.agreementsOf(doctors.map((d) => d.id));
    return toPaginated(
      doctors.map((doctor) =>
        this.toDto(doctor, agreements.get(doctor.id) ?? []),
      ),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<ReferringDoctorDto> {
    const doctor = await this.doctors.findOneBy({ id });
    if (!doctor) throw new NotFoundException('Referring doctor not found');
    const agreements = await this.agreementsOf([id]);
    return this.toDto(doctor, agreements.get(id) ?? []);
  }

  // Every version, newest first.
  async agreements(id: string): Promise<AgreementDto[]> {
    if (!(await this.doctors.existsBy({ id }))) {
      throw new NotFoundException('Referring doctor not found');
    }
    const versions = (await this.agreementsOf([id])).get(id) ?? [];
    return versions.map((v) => toAgreement(v, (d) => this.time.toIso(d)));
  }

  /**
   * The doctor's default in force today, for new patient terms. Every
   * doctor has version 1 from the day it was created, so there always is
   * one.
   */
  async currentFor(
    manager: EntityManager,
    referringDoctorId: string,
  ): Promise<ReferringDoctorAgreement> {
    const versions = await manager.find(ReferringDoctorAgreement, {
      where: { referringDoctorId },
    });
    const current = currentAgreement(versions, this.time.today());
    if (!current) throw new Error('Referring doctor without an agreement');
    return current;
  }

  // ---------- Internals ----------

  private async insertAgreement(
    manager: EntityManager,
    referringDoctorId: string,
    version: number,
    data: {
      commission: RateRule;
      discount: RateRule;
      effectiveFrom: string;
      notes: string | null;
    },
    previous: ReferringDoctorAgreement | null,
    actor: Actor,
  ): Promise<void> {
    const repository = manager.getRepository(ReferringDoctorAgreement);
    await repository.save(
      repository.create({
        referringDoctorId,
        version,
        effectiveFrom: data.effectiveFrom,
        commissionType: data.commission.type,
        commissionValue: data.commission.value,
        discountType: data.discount.type,
        discountValue: data.discount.value,
        notes: data.notes,
        createdById: actor.userId as string,
        recordedAt: this.time.now(),
      }),
    );
    const values = (a: {
      commission: RateRule;
      discount: RateRule;
      effectiveFrom: string;
    }) => ({
      commission: { ...a.commission },
      discount: { ...a.discount },
      effectiveFrom: a.effectiveFrom,
    });
    await this.auditService.logAction(
      actor,
      AuditAction.REFERRAL_AGREEMENT_CREATED,
      AuditEntityType.REFERRING_DOCTOR,
      referringDoctorId,
      {
        oldValues: previous
          ? {
              version: previous.version,
              ...values({
                commission: {
                  type: previous.commissionType,
                  value: previous.commissionValue,
                },
                discount: {
                  type: previous.discountType,
                  value: previous.discountValue,
                },
                effectiveFrom: previous.effectiveFrom,
              }),
            }
          : null,
        newValues: { version, ...values(data), notes: data.notes },
      },
      manager,
    );
  }

  private async agreementsOf(
    doctorIds: string[],
  ): Promise<Map<string, ReferringDoctorAgreement[]>> {
    const byDoctor = new Map<string, ReferringDoctorAgreement[]>();
    if (doctorIds.length === 0) return byDoctor;
    const rows = await this.dataSource
      .getRepository(ReferringDoctorAgreement)
      .find({
        where: { referringDoctorId: In(doctorIds) },
        relations: { createdBy: true },
        order: { version: 'DESC' },
      });
    for (const row of rows) {
      const list = byDoctor.get(row.referringDoctorId) ?? [];
      list.push(row);
      byDoctor.set(row.referringDoctorId, list);
    }
    return byDoctor;
  }

  // `versions` newest first.
  private toDto(
    doctor: ReferringDoctor,
    versions: ReferringDoctorAgreement[],
  ): ReferringDoctorDto {
    const today = this.time.today();
    const current = currentAgreement(versions, today);
    const upcoming = versions.find((v) => v.effectiveFrom > today) ?? null;
    return toReferringDoctor(doctor, current, upcoming, (d) =>
      this.time.toIso(d),
    );
  }

  private async lock(
    id: string,
    manager: EntityManager,
  ): Promise<ReferringDoctor> {
    const doctor = await manager.findOne(ReferringDoctor, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!doctor) throw new NotFoundException('Referring doctor not found');
    return doctor;
  }

  private async mapPhoneConflict(
    error: unknown,
    phone: string | null | undefined,
  ): Promise<unknown> {
    if (!isUniqueViolation(error, REFERRING_DOCTOR_PHONE_UNIQUE) || !phone) {
      return error;
    }
    const existing = await this.doctors.findOneBy({ phone });
    return conflict(
      ErrorCode.REFERRING_DOCTOR_PHONE_TAKEN,
      'A referring doctor with this phone number already exists',
      { referringDoctorId: existing?.id ?? null },
    );
  }
}
