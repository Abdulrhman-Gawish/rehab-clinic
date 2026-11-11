import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { PatientReferral } from '../referrals/entities/patient-referral.entity.js';
import { PatientReferralStatus } from '../referrals/referrals.enums.js';
import { AcquisitionChannel } from './acquisition.enums.js';
import {
  toAcquisitionSource,
  toCampaignBooking,
} from './acquisition.mapper.js';
import type {
  AddAcquisitionSourceDto,
  PatientAcquisitionDto,
  UpdateAcquisitionSourceDto,
} from './dto/acquisition.dto.js';
import {
  PatientAcquisitionSource,
  SOURCE_CHANNEL_UNIQUE,
} from './entities/patient-acquisition-source.entity.js';

const AUDITED = ['channel', 'details', 'isPrimary'] as const;

/**
 * How patients found the clinic, recorded at the desk. Writes lock the
 * patient row so the "exactly one primary" rule is kept under concurrent
 * edits (uq_patient_acquisition_sources_primary is the guarantee).
 */
@Injectable()
export class AcquisitionSourcesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async forPatient(patientId: string): Promise<PatientAcquisitionDto> {
    await this.assertPatient(patientId, this.dataSource.manager);
    const toIso = (d: Date) => this.time.toIso(d);
    const rows = await this.dataSource
      .getRepository(PatientAcquisitionSource)
      .find({
        where: { patientId },
        relations: { recordedBy: true, removedBy: true },
        order: { recordedAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
      });
    const current = rows
      .filter((s) => !s.removedAt)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const removed = rows
      .filter((s) => s.removedAt)
      .sort((a, b) => b.removedAt!.getTime() - a.removedAt!.getTime());
    const tagged = await this.dataSource
      .getRepository(Appointment)
      .createQueryBuilder('a')
      .where('a.patientId = :patientId', { patientId })
      .andWhere(
        `(a.utmSource IS NOT NULL OR a.utmMedium IS NOT NULL OR a.utmCampaign IS NOT NULL
          OR a.utmContent IS NOT NULL OR a.utmTerm IS NOT NULL)`,
      )
      .orderBy('a.createdAt', 'DESC')
      .getMany();
    return {
      sources: current.map((s) => toAcquisitionSource(s, toIso)),
      removed: removed.map((s) => toAcquisitionSource(s, toIso)),
      campaignBookings: tagged.map((a) => toCampaignBooking(a, toIso)),
    };
  }

  async add(
    patientId: string,
    dto: AddAcquisitionSourceDto,
    actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lockPatient(patientId, manager);
        await this.insert(
          manager,
          patientId,
          {
            channel: dto.channel,
            details: dto.details ?? null,
            isPrimary: dto.isPrimary ?? false,
          },
          actor,
        );
      });
    } catch (error) {
      throw this.mapConflict(error);
    }
    return this.forPatient(patientId);
  }

  /**
   * Makes sure the channel is among the patient's current sources (in the
   * caller's transaction), and the primary one when `makePrimary`. Used
   * when a doctor referral is assigned, so the DOCTOR_REFERRAL channel is
   * counted in the acquisition reports.
   */
  async ensureChannel(
    manager: EntityManager,
    patientId: string,
    channel: AcquisitionChannel,
    details: string | null,
    makePrimary: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.lockPatient(patientId, manager);
    const repository = manager.getRepository(PatientAcquisitionSource);
    const existing = await repository.findOneBy({
      patientId,
      channel,
      removedAt: IsNull(),
    });
    if (!existing) {
      await this.insert(
        manager,
        patientId,
        { channel, details, isPrimary: makePrimary },
        actor,
      );
      return;
    }
    if (makePrimary && !existing.isPrimary) {
      await this.clearPrimary(manager, patientId);
      existing.isPrimary = true;
      await repository.save(existing);
      await this.audit(
        manager,
        actor,
        AuditAction.ACQUISITION_SOURCE_UPDATED,
        existing.id,
        { oldValues: { isPrimary: false }, newValues: { isPrimary: true } },
      );
    }
  }

  async update(
    id: string,
    dto: UpdateAcquisitionSourceDto,
    actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    const patientId = await this.dataSource.transaction(async (manager) => {
      const found = await this.findCurrent(id, manager);
      await this.lockPatient(found.patientId, manager);
      const source = await this.findCurrent(id, manager);
      const before = pickValues(source, AUDITED);
      if (dto.details !== undefined) source.details = dto.details;
      if (dto.isPrimary && !source.isPrimary) {
        await this.clearPrimary(manager, source.patientId);
        source.isPrimary = true;
      }
      const changes = diffValues(before, pickValues(source, AUDITED), [
        ...AUDITED,
      ]);
      if (!changes) return source.patientId;
      await manager.getRepository(PatientAcquisitionSource).save(source);
      await this.audit(
        manager,
        actor,
        AuditAction.ACQUISITION_SOURCE_UPDATED,
        source.id,
        changes,
      );
      return source.patientId;
    });
    return this.forPatient(patientId);
  }

  /**
   * Removing keeps the row (history). A removed primary hands over to the
   * oldest remaining source. The DOCTOR_REFERRAL source stays while the
   * patient has an active referral (end the referral first).
   */
  async remove(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<PatientAcquisitionDto> {
    const patientId = await this.dataSource.transaction(async (manager) => {
      const found = await this.findCurrent(id, manager);
      await this.lockPatient(found.patientId, manager);
      const source = await this.findCurrent(id, manager);
      if (
        source.channel === AcquisitionChannel.DOCTOR_REFERRAL &&
        (await manager.existsBy(PatientReferral, {
          patientId: source.patientId,
          status: PatientReferralStatus.ACTIVE,
        }))
      ) {
        throw unprocessable(
          ErrorCode.SOURCE_IN_USE,
          'The patient has an active doctor referral; end it before removing this source',
        );
      }
      const repository = manager.getRepository(PatientAcquisitionSource);
      const wasPrimary = source.isPrimary;
      source.isPrimary = false;
      source.removedAt = this.time.now();
      source.removedById = actor.userId;
      source.removalReason = reason;
      await repository.save(source);

      let newPrimaryId: string | null = null;
      if (wasPrimary) {
        const next = await repository.findOne({
          where: { patientId: source.patientId, removedAt: IsNull() },
          order: { recordedAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
        });
        if (next) {
          next.isPrimary = true;
          await repository.save(next);
          newPrimaryId = next.id;
        }
      }
      await this.audit(
        manager,
        actor,
        AuditAction.ACQUISITION_SOURCE_REMOVED,
        source.id,
        {
          oldValues: {
            channel: source.channel,
            details: source.details,
            isPrimary: wasPrimary,
          },
          newValues: { reason, newPrimaryId },
        },
      );
      return source.patientId;
    });
    return this.forPatient(patientId);
  }

  // ---------- Internals ----------

  // The first current source of a patient is primary; `isPrimary` moves it.
  private async insert(
    manager: EntityManager,
    patientId: string,
    data: {
      channel: AcquisitionChannel;
      details: string | null;
      isPrimary: boolean;
    },
    actor: Actor,
  ): Promise<void> {
    const repository = manager.getRepository(PatientAcquisitionSource);
    const hasPrimary = await repository.existsBy({
      patientId,
      isPrimary: true,
      removedAt: IsNull(),
    });
    const isPrimary = data.isPrimary || !hasPrimary;
    if (isPrimary && hasPrimary) await this.clearPrimary(manager, patientId);
    const source = await repository.save(
      repository.create({
        patientId,
        channel: data.channel,
        details: data.details,
        isPrimary,
        recordedById: actor.userId as string,
        recordedAt: this.time.now(),
        removedAt: null,
        removedById: null,
        removalReason: null,
      }),
    );
    await this.audit(
      manager,
      actor,
      AuditAction.ACQUISITION_SOURCE_ADDED,
      source.id,
      { newValues: { patientId, ...pickValues(source, AUDITED) } },
    );
  }

  private async clearPrimary(
    manager: EntityManager,
    patientId: string,
  ): Promise<void> {
    await manager
      .getRepository(PatientAcquisitionSource)
      .update(
        { patientId, isPrimary: true, removedAt: IsNull() },
        { isPrimary: false },
      );
  }

  private async findCurrent(
    id: string,
    manager: EntityManager,
  ): Promise<PatientAcquisitionSource> {
    const source = await manager.findOneBy(PatientAcquisitionSource, {
      id,
      removedAt: IsNull(),
    });
    if (!source) throw new NotFoundException('Acquisition source not found');
    return source;
  }

  private async lockPatient(
    patientId: string,
    manager: EntityManager,
  ): Promise<void> {
    const patient = await manager.findOne(Patient, {
      where: { id: patientId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }

  private async assertPatient(
    patientId: string,
    manager: EntityManager,
  ): Promise<void> {
    if (!(await manager.existsBy(Patient, { id: patientId }))) {
      throw new NotFoundException('Patient not found');
    }
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    id: string,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.ACQUISITION_SOURCE,
      id,
      values,
      manager,
    );
  }

  private mapConflict(error: unknown): unknown {
    if (isUniqueViolation(error, SOURCE_CHANNEL_UNIQUE)) {
      return conflict(
        ErrorCode.SOURCE_ALREADY_RECORDED,
        'This source is already recorded for the patient',
      );
    }
    return error;
  }
}
