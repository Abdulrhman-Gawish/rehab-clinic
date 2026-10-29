import {
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
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import {
  normalizeEgyptianMobile,
  toAsciiDigits,
  tryNormalizeEgyptianMobile,
} from '../../common/utils/phone.util.js';
import { escapeLike } from '../../common/utils/sql.util.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import {
  PatientResponseDto,
  type CreatePatientDto,
  type ListPatientsQueryDto,
  type UpdatePatientDto,
} from './dto/patient.dto.js';
import {
  Patient,
  PATIENT_PHONE_UNIQUE,
  PatientSource,
} from './entities/patient.entity.js';

const PATIENT_AUDIT_FIELDS = [
  'name',
  'phone',
  'dateOfBirth',
  'gender',
  'notes',
] as const satisfies readonly (keyof Patient)[];

export interface FindOrCreatePatientInput {
  name: string;
  phone: string;
  source: PatientSource;
  createdBy?: string | null;
  ip?: string | null;
}

export interface FindOrCreatePatientResult {
  patient: Patient;
  created: boolean;
  // The phone already belonged to a patient registered under another name.
  // The stored name is NOT changed; staff can reconcile it.
  nameMismatch: boolean;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function sameName(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns the patient owning `phone`, creating it if there is none.
   * An existing patient's name is never overwritten.
   *
   * Race-safe: INSERT ... ON CONFLICT (phone) DO NOTHING waits for any
   * concurrent insert of the same phone, then the SELECT sees the winner.
   * Relies on READ COMMITTED (the default) when given a caller's manager.
   * Intended for public booking (Stage 4+).
   */
  async findOrCreateByPhone(
    input: FindOrCreatePatientInput,
    manager?: EntityManager,
  ): Promise<FindOrCreatePatientResult> {
    const run = (m: EntityManager) => this.findOrCreateWith(input, m);
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  async create(
    dto: CreatePatientDto,
    actor: Actor,
  ): Promise<PatientResponseDto> {
    // Normalized again here (defense in depth): callers other than the HTTP
    // layer may bypass the DTO transformer.
    const phone = normalizeEgyptianMobile(dto.phone);
    try {
      const patient = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Patient);
        const saved = await repository.save(
          repository.create({
            name: normalizeName(dto.name),
            phone,
            dateOfBirth: dto.dateOfBirth ?? null,
            gender: dto.gender ?? null,
            notes: dto.notes ?? null,
            createdSource: PatientSource.RECEPTION,
            createdById: actor.userId,
          }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.PATIENT_CREATED,
          AuditEntityType.PATIENT,
          saved.id,
          { newValues: pickValues(saved, PATIENT_AUDIT_FIELDS) },
          manager,
        );
        return saved;
      });
      return PatientResponseDto.fromEntity(patient);
    } catch (error) {
      return this.rethrowPhoneConflict(error, phone);
    }
  }

  async findAll(
    query: ListPatientsQueryDto,
  ): Promise<Paginated<PatientResponseDto>> {
    const qb = this.patients
      .createQueryBuilder('patient')
      .skip(query.skip)
      .take(query.limit);

    if (query.search) {
      const conditions = ['patient.name ILIKE :name'];
      const params: Record<string, string> = {
        name: `%${escapeLike(query.search)}%`,
      };

      const fullPhone = tryNormalizeEgyptianMobile(query.search);
      const digits = toAsciiDigits(query.search).replace(/\D/g, '');
      if (fullPhone) {
        conditions.push('patient.phone = :phone');
        params.phone = fullPhone;
      } else if (digits.length >= 3) {
        // Local numbers start with 0; stored ones with +20.
        conditions.push('patient.phone LIKE :phoneLike');
        params.phoneLike = `%${digits.replace(/^0+/, '')}%`;
      }
      qb.where(`(${conditions.join(' OR ')})`, params).orderBy(
        'patient.name',
        'ASC',
      );
    } else {
      qb.orderBy('patient.createdAt', 'DESC');
    }
    qb.addOrderBy('patient.id', 'ASC');

    const [patients, total] = await qb.getManyAndCount();
    return toPaginated(
      patients.map(PatientResponseDto.fromEntity),
      total,
      query,
    );
  }

  async findByPhone(phone: string): Promise<PatientResponseDto> {
    const patient = await this.patients.findOneBy({
      phone: normalizeEgyptianMobile(phone),
    });
    if (!patient) {
      throw new NotFoundException('No patient with this phone number');
    }
    return PatientResponseDto.fromEntity(patient);
  }

  async findOne(id: string): Promise<PatientResponseDto> {
    const patient = await this.patients.findOneBy({ id });
    if (!patient) throw new NotFoundException('Patient not found');
    return PatientResponseDto.fromEntity(patient);
  }

  async update(
    id: string,
    dto: UpdatePatientDto,
    actor: Actor,
  ): Promise<PatientResponseDto> {
    const phone =
      dto.phone === undefined ? undefined : normalizeEgyptianMobile(dto.phone);
    try {
      const patient = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Patient);
        const patient = await repository
          .createQueryBuilder('patient')
          .where('patient.id = :id', { id })
          .setLock('pessimistic_write')
          .getOne();
        if (!patient) throw new NotFoundException('Patient not found');

        const before = { ...patient };
        if (dto.name !== undefined) patient.name = normalizeName(dto.name);
        if (phone !== undefined) patient.phone = phone;
        if (dto.dateOfBirth !== undefined)
          patient.dateOfBirth = dto.dateOfBirth;
        if (dto.gender !== undefined) patient.gender = dto.gender;
        if (dto.notes !== undefined) patient.notes = dto.notes;

        const changes = diffValues(before, patient, PATIENT_AUDIT_FIELDS);
        if (!changes) return patient;

        const saved = await repository.save(patient);
        await this.auditService.logAction(
          actor,
          AuditAction.PATIENT_UPDATED,
          AuditEntityType.PATIENT,
          id,
          changes,
          manager,
        );
        return saved;
      });
      return PatientResponseDto.fromEntity(patient);
    } catch (error) {
      return this.rethrowPhoneConflict(error, phone);
    }
  }

  private async findOrCreateWith(
    input: FindOrCreatePatientInput,
    manager: EntityManager,
  ): Promise<FindOrCreatePatientResult> {
    const name = normalizeName(input.name);
    const phone = normalizeEgyptianMobile(input.phone);

    const inserted: { id: string }[] = await manager.query(
      `INSERT INTO patients (name, phone, created_source, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO NOTHING
       RETURNING id`,
      [name, phone, input.source, input.createdBy ?? null],
    );
    const repository = manager.getRepository(Patient);

    if (inserted.length > 0) {
      const patient = await repository.findOneByOrFail({ id: inserted[0].id });
      await this.auditService.log(
        {
          userId: input.createdBy ?? null,
          ip: input.ip ?? null,
          action: AuditAction.PATIENT_CREATED,
          entityType: AuditEntityType.PATIENT,
          entityId: patient.id,
          newValues: {
            ...pickValues(patient, PATIENT_AUDIT_FIELDS),
            createdSource: patient.createdSource,
          },
        },
        manager,
      );
      return { patient, created: true, nameMismatch: false };
    }

    const patient = await repository.findOneByOrFail({ phone });
    return {
      patient,
      created: false,
      nameMismatch: !sameName(patient.name, name),
    };
  }

  // Must run outside the failed transaction (it is aborted after 23505).
  private async rethrowPhoneConflict(
    error: unknown,
    phone: string | undefined,
  ): Promise<never> {
    if (phone && isUniqueViolation(error, PATIENT_PHONE_UNIQUE)) {
      const existing = await this.patients.findOneBy({ phone });
      throw new ConflictException({
        message: 'A patient with this phone number already exists',
        details: { patientId: existing?.id ?? null },
      });
    }
    throw error;
  }
}
