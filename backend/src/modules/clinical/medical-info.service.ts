import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { diffValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { toMedicalInfo } from './clinical.mapper.js';
import type {
  MedicalInfoDto,
  MedicalInfoResponseDto,
} from './dto/clinical.dto.js';
import { PatientMedicalInfo } from './entities/patient-medical-info.entity.js';

const MEDICAL_INFO_FIELDS = [
  'allergies',
  'chronicConditions',
  'pastSurgeries',
  'currentMedications',
  'notes',
] as const satisfies readonly (keyof PatientMedicalInfo)[];

@Injectable()
export class MedicalInfoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClinicalAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async get(
    patientId: string,
    user: AuthenticatedUser,
  ): Promise<MedicalInfoResponseDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    return this.load(patientId);
  }

  // Without the access check: callers have done it.
  async load(patientId: string): Promise<MedicalInfoResponseDto> {
    const info = await this.dataSource
      .getRepository(PatientMedicalInfo)
      .findOneBy({ patientId });
    return toMedicalInfo(patientId, info, (d) => this.time.toIso(d));
  }

  /**
   * Replaces the whole record (a field left out becomes null); created on
   * the first save. Any doctor with access to the patient may update it.
   */
  async replace(
    patientId: string,
    dto: MedicalInfoDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<MedicalInfoResponseDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    await this.dataSource.transaction(async (manager) => {
      // The patient row lock serializes two "first saves" of the same record.
      await manager.findOne(Patient, {
        where: { id: patientId },
        select: { id: true },
        lock: { mode: 'pessimistic_write' },
      });
      const repository = manager.getRepository(PatientMedicalInfo);
      const existing = await repository.findOneBy({ patientId });
      const info = existing ?? repository.create({ patientId });
      const before = { ...info };
      for (const field of MEDICAL_INFO_FIELDS) info[field] = dto[field] ?? null;

      const changes = diffValues(before, info, MEDICAL_INFO_FIELDS);
      if (existing && !changes) return;
      info.updatedById = actor.userId as string;
      await repository.save(info);
      await this.auditService.logAction(
        actor,
        AuditAction.PATIENT_MEDICAL_INFO_UPDATED,
        AuditEntityType.PATIENT,
        patientId,
        changes ?? { newValues: {} },
        manager,
      );
    });
    return this.load(patientId);
  }
}
