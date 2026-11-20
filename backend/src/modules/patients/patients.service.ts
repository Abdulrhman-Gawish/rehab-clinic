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
import {
  conflict,
  ErrorCode,
  forbidden,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  normalizePersonName,
  samePersonName,
} from '../../common/utils/person-name.util.js';
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
import type { Gender } from '../../common/enums/gender.enum.js';
import {
  PatientResponseDto,
  type CheckInDetailsDto,
  type PatientLookupDto,
  type CreatePatientDto,
  type ListPatientsQueryDto,
  type UpdatePatientDto,
} from './dto/patient.dto.js';
import {
  Patient,
  PATIENT_NAME_SEARCH_KEY,
  PATIENT_NATIONAL_ID_UNIQUE,
  PATIENT_PASSPORT_UNIQUE,
  PATIENT_PHONE_UNIQUE,
  PatientSource,
} from './entities/patient.entity.js';
import {
  codeDigits,
  formatPatientCode,
  MAX_CODE_SEQUENCE,
  normalizeNationalId,
  normalizePassport,
  parseNationalId,
  PATIENT_CODE_PATTERN,
} from './patient-identity.js';

const PATIENT_AUDIT_FIELDS = [
  'name',
  'phone',
  'patientCode',
  'nationalId',
  'passportNumber',
  'dateOfBirth',
  'gender',
  'notes',
] as const satisfies readonly (keyof Patient)[];

// Identity and administrative details (create, PATCH, check-in).
export interface PatientDetailsInput {
  nationalId?: string | null;
  passportNumber?: string | null;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  notes?: string | null;
}

// What a patient must have before entering the doctor.
export enum CheckInRequirement {
  IDENTITY_DOCUMENT = 'identityDocument',
  GENDER = 'gender',
  DATE_OF_BIRTH = 'dateOfBirth',
  REFERRAL_SOURCE = 'referralSource',
}

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

// How reception identifies a patient: by id, or by name + phone.
export interface DeskPatientInput {
  patientId?: string;
  name?: string;
  phone?: string;
}

// Exactly one of: patientId, or name + phone. Call before any other work.
export function assertDeskPatientInput(input: DeskPatientInput): void {
  const byPhone = input.name !== undefined || input.phone !== undefined;
  if (input.patientId ? byPhone : !(input.name && input.phone)) {
    throw new BadRequestException(
      'Provide either patientId, or both name and phone',
    );
  }
}

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  /**
   * Returns the patient owning `phone`, creating it if there is none.
   * An existing patient's name is never overwritten.
   *
   * Race-safe: INSERT ... ON CONFLICT (phone) DO NOTHING waits for any
   * concurrent insert of the same phone, then the SELECT sees the winner.
   * Relies on READ COMMITTED (the default) when given a caller's manager.
   * Used by public booking, reception booking and walk-ins.
   */
  async findOrCreateByPhone(
    input: FindOrCreatePatientInput,
    manager?: EntityManager,
  ): Promise<FindOrCreatePatientResult> {
    const run = (m: EntityManager) => this.findOrCreateWith(input, m);
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * Reception booking and walk-ins: the patient by id (404), or find-or-create
   * by phone (source RECEPTION, never renamed). Input already checked with
   * assertDeskPatientInput().
   */
  async resolveForDesk(
    input: DeskPatientInput,
    actor: Actor,
    manager: EntityManager,
  ): Promise<Patient> {
    if (input.patientId) {
      const patient = await manager.findOneBy(Patient, {
        id: input.patientId,
      });
      if (!patient) throw new NotFoundException('Patient not found');
      return patient;
    }
    const { patient } = await this.findOrCreateWith(
      {
        name: input.name as string,
        phone: input.phone as string,
        source: PatientSource.RECEPTION,
        createdBy: actor.userId,
        ip: actor.ip,
      },
      manager,
    );
    return patient;
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
        const draft = repository.create({
          name: normalizePersonName(dto.name),
          phone,
          patientCode: null,
          nationalId: null,
          passportNumber: null,
          dateOfBirth: null,
          gender: null,
          notes: null,
          createdSource: PatientSource.RECEPTION,
          createdById: actor.userId,
        });
        await this.applyDetails(manager, draft, dto, actor);
        const saved = await repository.save(draft);
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
      return this.findOne(patient.id);
    } catch (error) {
      return this.rethrowConflict(error, phone);
    }
  }

  // `byDocument`: also match a National ID or passport number (desk only).
  async findAll(
    query: ListPatientsQueryDto,
    byDocument = true,
  ): Promise<Paginated<PatientResponseDto>> {
    const qb = this.patients
      .createQueryBuilder('patient')
      .leftJoinAndSelect('patient.createdBy', 'createdBy')
      .skip(query.skip)
      .take(query.limit);

    if (query.search) {
      // Name and search text go through the same SQL normalization (Arabic
      // alef/yeh/teh marbuta variants, tatweel, diacritics; lowercase), which
      // idx_patients_name_search_trgm indexes. Stored names are unchanged.
      const conditions = [
        `${PATIENT_NAME_SEARCH_KEY}(patient.name) LIKE ${PATIENT_NAME_SEARCH_KEY}(:name)`,
      ];
      const params: Record<string, string> = {
        name: `%${escapeLike(query.search)}%`,
      };

      // A patient code, National ID or passport number: exact match.
      const code = normalizePassport(query.search);
      if (PATIENT_CODE_PATTERN.test(code)) {
        conditions.push('patient.patientCode = :code');
        params.code = code;
      }
      const nationalId = normalizeNationalId(query.search);
      if (byDocument && /^\d{14}$/.test(nationalId)) {
        conditions.push('patient.nationalId = :nationalId');
        params.nationalId = nationalId;
      }
      if (byDocument && code.length >= 5) {
        conditions.push('patient.passportNumber = :passport');
        params.passport = code;
      }

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

  async findByPhone(phone: string): Promise<PatientLookupDto> {
    const patient = await this.patients.findOne({
      where: { phone: normalizeEgyptianMobile(phone) },
      relations: { createdBy: true },
    });
    return { patient: patient ? PatientResponseDto.fromEntity(patient) : null };
  }

  async findOne(id: string): Promise<PatientResponseDto> {
    const patient = await this.patients.findOne({
      where: { id },
      relations: { createdBy: true },
    });
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
        const patient = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!patient) throw new NotFoundException('Patient not found');

        const before = { ...patient };
        if (dto.name !== undefined)
          patient.name = normalizePersonName(dto.name);
        if (phone !== undefined) patient.phone = phone;
        await this.applyDetails(manager, patient, dto, actor);

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
      return this.findOne(patient.id);
    } catch (error) {
      return this.rethrowConflict(error, phone);
    }
  }

  // ---------- Check-in (visits: attend, walk-in) ----------

  /**
   * Saves the details reception collected at check-in on the patient (in
   * the visit's transaction), with the rules of PATCH /patients/:id: the
   * code is assigned with the first identity document. The referral source
   * is the caller's job (acquisition module).
   */
  async applyCheckInDetails(
    manager: EntityManager,
    patientId: string,
    details: CheckInDetailsDto,
    actor: Actor,
  ): Promise<void> {
    const repository = manager.getRepository(Patient);
    const patient = await repository.findOne({
      where: { id: patientId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    const before = { ...patient };
    await this.applyDetails(manager, patient, details, actor);
    const changes = diffValues(before, patient, PATIENT_AUDIT_FIELDS);
    if (!changes) return;
    await repository.save(patient);
    await this.auditService.logAction(
      actor,
      AuditAction.PATIENT_UPDATED,
      AuditEntityType.PATIENT,
      patient.id,
      changes,
      manager,
    );
  }

  /** What the patient still lacks before entering the doctor. */
  async missingForCheckIn(
    manager: EntityManager,
    patientId: string,
  ): Promise<CheckInRequirement[]> {
    const patient = await manager.findOneByOrFail(Patient, { id: patientId });
    const missing: CheckInRequirement[] = [];
    if (!patient.nationalId && !patient.passportNumber)
      missing.push(CheckInRequirement.IDENTITY_DOCUMENT);
    if (!patient.gender) missing.push(CheckInRequirement.GENDER);
    if (!patient.dateOfBirth) missing.push(CheckInRequirement.DATE_OF_BIRTH);
    const [{ has }]: { has: boolean }[] = await manager.query(
      `SELECT EXISTS (SELECT 1 FROM patient_acquisition_sources
                       WHERE patient_id = $1 AND removed_at IS NULL) AS has`,
      [patientId],
    );
    if (!has) missing.push(CheckInRequirement.REFERRAL_SOURCE);
    return missing;
  }

  /**
   * 422 PATIENT_DETAILS_REQUIRED unless the patient has an identity
   * document, gender, date of birth and a referral source. `details`:
   * `missing`, and `patientId` when the patient existed before this request.
   */
  async assertReadyForCheckIn(
    manager: EntityManager,
    patientId: string,
    reportPatient: boolean,
  ): Promise<void> {
    const missing = await this.missingForCheckIn(manager, patientId);
    if (missing.length === 0) return;
    throw unprocessable(
      ErrorCode.PATIENT_DETAILS_REQUIRED,
      `Before the patient enters the doctor, record: ${missing.join(', ')}`,
      { patientId: reportPatient ? patientId : null, missing },
    );
  }

  // ---------- Internals ----------

  /**
   * Applies identity and administrative details to `patient` (locked or
   * new; not saved): one identity document at a time, a National ID valid
   * and matching the birth date and gender (filled from it when empty),
   * unique, changed only by the OWNER once the patient has a code; the code
   * is assigned with the first identity document.
   */
  private async applyDetails(
    manager: EntityManager,
    patient: Patient,
    input: PatientDetailsInput,
    actor: Actor,
  ): Promise<void> {
    if (input.nationalId && input.passportNumber) {
      throw new BadRequestException(
        'Give either nationalId or passportNumber, not both',
      );
    }
    const nationalChanged =
      input.nationalId !== undefined && input.nationalId !== patient.nationalId;
    const passportChanged =
      input.passportNumber !== undefined &&
      input.passportNumber !== patient.passportNumber;
    if (
      (nationalChanged || passportChanged) &&
      patient.patientCode &&
      actor.role !== UserRole.OWNER
    ) {
      throw forbidden(
        ErrorCode.PATIENT_IDENTITY_LOCKED,
        'Only the owner can change the identity document of a patient who has a patient code',
        { patientCode: patient.patientCode },
      );
    }
    if (input.nationalId !== undefined) {
      patient.nationalId = input.nationalId;
      if (input.nationalId) patient.passportNumber = null;
    }
    if (input.passportNumber !== undefined) {
      patient.passportNumber = input.passportNumber;
      if (input.passportNumber) patient.nationalId = null;
    }
    if (input.gender !== undefined) patient.gender = input.gender;
    if (input.dateOfBirth !== undefined)
      patient.dateOfBirth = input.dateOfBirth;
    if (input.notes !== undefined) patient.notes = input.notes;

    if (patient.nationalId) {
      const info = parseNationalId(patient.nationalId, this.time.today());
      if (!info) {
        throw unprocessable(
          ErrorCode.NATIONAL_ID_INVALID,
          'This is not a valid Egyptian National ID (century, birth date)',
        );
      }
      // The National ID states them: a different value sent with this
      // request is a mistake (422); otherwise they follow it (an empty one,
      // or one typed wrong before the ID was recorded, is replaced).
      for (const field of ['dateOfBirth', 'gender'] as const) {
        const given = input[field];
        if (given != null && given !== info[field]) {
          throw unprocessable(
            ErrorCode.NATIONAL_ID_MISMATCH,
            `The ${field === 'gender' ? 'gender' : 'date of birth'} does not match the National ID`,
            { field, expected: info[field] },
          );
        }
      }
      patient.dateOfBirth = info.dateOfBirth;
      patient.gender = info.gender;
    }
    if (nationalChanged && patient.nationalId) {
      await this.assertDocumentFree(manager, patient, 'national_id');
    }
    if (passportChanged && patient.passportNumber) {
      await this.assertDocumentFree(manager, patient, 'passport_number');
    }
    if (
      !patient.patientCode &&
      (patient.nationalId || patient.passportNumber)
    ) {
      patient.patientCode = await this.nextCode(
        manager,
        codeDigits(patient.nationalId),
      );
    }
  }

  // 409 ID_DOCUMENT_TAKEN when another patient has the same document (the
  // unique constraints are the guarantee under races).
  private async assertDocumentFree(
    manager: EntityManager,
    patient: Patient,
    column: 'national_id' | 'passport_number',
  ): Promise<void> {
    const value =
      column === 'national_id' ? patient.nationalId : patient.passportNumber;
    const [other]: { id: string }[] = await manager.query(
      `SELECT id FROM patients WHERE ${column} = $1 AND ($2::uuid IS NULL OR id <> $2)`,
      [value, patient.id ?? null],
    );
    if (other) {
      throw conflict(
        ErrorCode.ID_DOCUMENT_TAKEN,
        column === 'national_id'
          ? 'Another patient has this National ID'
          : 'Another patient has this passport number',
        {
          patientId: other.id,
          field: column === 'national_id' ? 'nationalId' : 'passportNumber',
        },
      );
    }
  }

  /**
   * The next code of `digits` (RH + digits + 4-digit sequence). The
   * counter row stays locked until the caller's transaction ends, so
   * concurrent registrations get consecutive numbers; a rollback gives the
   * number back.
   */
  private async nextCode(
    manager: EntityManager,
    digits: string,
  ): Promise<string> {
    const rows: { last_value: number }[] = await manager.query(
      `INSERT INTO patient_code_counters (prefix, last_value) VALUES ($1, 1)
       ON CONFLICT (prefix) DO UPDATE
         SET last_value = patient_code_counters.last_value + 1
         WHERE patient_code_counters.last_value < $2
       RETURNING last_value`,
      [digits, MAX_CODE_SEQUENCE],
    );
    if (rows.length === 0) {
      throw unprocessable(
        ErrorCode.PATIENT_CODE_EXHAUSTED,
        `All ${MAX_CODE_SEQUENCE} patient codes RH${digits}#### are used`,
        { digits },
      );
    }
    return formatPatientCode(digits, Number(rows[0].last_value));
  }

  private async findOrCreateWith(
    input: FindOrCreatePatientInput,
    manager: EntityManager,
  ): Promise<FindOrCreatePatientResult> {
    const name = normalizePersonName(input.name);
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
      await this.auditService.logAction(
        { userId: input.createdBy ?? null, ip: input.ip ?? null },
        AuditAction.PATIENT_CREATED,
        AuditEntityType.PATIENT,
        patient.id,
        {
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
      nameMismatch: !samePersonName(patient.name, name),
    };
  }

  // Must run outside the failed transaction (it is aborted after 23505).
  private async rethrowConflict(
    error: unknown,
    phone: string | undefined,
  ): Promise<never> {
    // Two registrations of one document at once: the loser.
    for (const [constraint, field] of [
      [PATIENT_NATIONAL_ID_UNIQUE, 'nationalId'],
      [PATIENT_PASSPORT_UNIQUE, 'passportNumber'],
    ] as const) {
      if (isUniqueViolation(error, constraint)) {
        throw conflict(
          ErrorCode.ID_DOCUMENT_TAKEN,
          'Another patient has this identity document',
          { field },
        );
      }
    }
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
