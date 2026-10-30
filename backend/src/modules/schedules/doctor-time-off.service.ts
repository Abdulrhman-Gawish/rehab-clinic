import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { isoToDate } from '../../common/time/clinic-time.util.js';
import { diffValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { ACTIVE_STATUSES } from '../appointments/appointment.enums.js';
import { toAppointmentSummary } from '../appointments/appointment.mapper.js';
import type { AppointmentSummaryDto } from '../appointments/dto/appointment-summary.dto.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import {
  TimeOffResponseDto,
  type CreateTimeOffDto,
  type ListTimeOffQueryDto,
  type TimeOffMutationResponseDto,
  type UpdateTimeOffDto,
} from './dto/time-off.dto.js';
import { DoctorTimeOff } from './entities/doctor-time-off.entity.js';

const TIME_OFF_AUDIT_FIELDS = [
  'startAt',
  'endAt',
  'reason',
] as const satisfies readonly (keyof DoctorTimeOff)[];

@Injectable()
export class DoctorTimeOffService {
  constructor(
    @InjectRepository(DoctorTimeOff)
    private readonly timeOff: Repository<DoctorTimeOff>,
    @InjectRepository(Doctor) private readonly doctors: Repository<Doctor>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly access: DoctorAccessService,
    private readonly time: ClinicTimeService,
  ) {}

  async list(
    doctorId: string,
    user: AuthenticatedUser,
    query: ListTimeOffQueryDto,
  ): Promise<TimeOffResponseDto[]> {
    await this.access.assertCanAccessDoctor(user, doctorId);
    await this.assertDoctorExists(doctorId);

    const qb = this.timeOff
      .createQueryBuilder('off')
      .where('off.doctorId = :doctorId', { doctorId })
      .orderBy('off.startAt', 'ASC');
    if (query.from)
      qb.andWhere('off.endAt > :from', { from: isoToDate(query.from) });
    if (query.to) qb.andWhere('off.startAt < :to', { to: isoToDate(query.to) });

    return (await qb.getMany()).map((row) => this.toDto(row));
  }

  /**
   * Time off is always created, even over booked appointments. Those are
   * returned as `conflictingAppointments` and are never cancelled here.
   */
  async create(
    doctorId: string,
    dto: CreateTimeOffDto,
    actor: Actor,
  ): Promise<TimeOffMutationResponseDto> {
    await this.assertDoctorExists(doctorId);
    const startAt = isoToDate(dto.startAt);
    const endAt = isoToDate(dto.endAt);
    this.assertPeriod(startAt, endAt);

    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(DoctorTimeOff);
      const row = await repository.save(
        repository.create({
          doctorId,
          startAt,
          endAt,
          reason: dto.reason ?? null,
          createdById: actor.userId as string,
        }),
      );
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_TIME_OFF_CREATED,
        AuditEntityType.DOCTOR_TIME_OFF,
        row.id,
        {
          newValues: {
            doctorId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            reason: row.reason,
          },
        },
        manager,
      );
      return row;
    });
    return this.withConflicts(saved);
  }

  async update(
    doctorId: string,
    id: string,
    dto: UpdateTimeOffDto,
    actor: Actor,
  ): Promise<TimeOffMutationResponseDto> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(DoctorTimeOff);
      const row = await repository.findOne({
        where: { id, doctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Time off not found');

      const before = { ...row };
      if (dto.startAt !== undefined) row.startAt = isoToDate(dto.startAt);
      if (dto.endAt !== undefined) row.endAt = isoToDate(dto.endAt);
      if (dto.reason !== undefined) row.reason = dto.reason;
      this.assertPeriod(row.startAt, row.endAt);

      const changes = diffValues(before, row, TIME_OFF_AUDIT_FIELDS);
      if (!changes) return row;
      const updated = await repository.save(row);
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_TIME_OFF_UPDATED,
        AuditEntityType.DOCTOR_TIME_OFF,
        id,
        changes,
        manager,
      );
      return updated;
    });
    return this.withConflicts(saved);
  }

  // Time off is schedule configuration, not business history: removing it is
  // allowed, and the audit log keeps what was removed.
  async remove(doctorId: string, id: string, actor: Actor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(DoctorTimeOff);
      const row = await repository.findOneBy({ id, doctorId });
      if (!row) throw new NotFoundException('Time off not found');
      await repository.delete({ id });
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_TIME_OFF_DELETED,
        AuditEntityType.DOCTOR_TIME_OFF,
        id,
        {
          oldValues: {
            doctorId,
            startAt: row.startAt.toISOString(),
            endAt: row.endAt.toISOString(),
            reason: row.reason,
          },
        },
        manager,
      );
    });
  }

  private async withConflicts(
    row: DoctorTimeOff,
  ): Promise<TimeOffMutationResponseDto> {
    return {
      timeOff: this.toDto(row),
      conflictingAppointments: await this.findConflictingAppointments(row),
    };
  }

  // Active appointments of the doctor overlapping the period. Reported only;
  // reception decides what to do with them.
  private async findConflictingAppointments(
    row: DoctorTimeOff,
  ): Promise<AppointmentSummaryDto[]> {
    const appointments = await this.appointments
      .createQueryBuilder('appointment')
      .innerJoinAndSelect('appointment.patient', 'patient')
      .where('appointment.doctorId = :doctorId', { doctorId: row.doctorId })
      .andWhere('appointment.status IN (:...active)', {
        active: ACTIVE_STATUSES,
      })
      .andWhere('appointment.startAt < :end AND appointment.endAt > :start', {
        start: row.startAt,
        end: row.endAt,
      })
      .orderBy('appointment.startAt', 'ASC')
      .getMany();
    return appointments.map((appointment) =>
      toAppointmentSummary(appointment, (d) => this.time.toIso(d)),
    );
  }

  private toDto(row: DoctorTimeOff): TimeOffResponseDto {
    return TimeOffResponseDto.fromEntity(row, (d) => this.time.toIso(d));
  }

  private assertPeriod(startAt: Date, endAt: Date): void {
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException({
        message: 'endAt must be after startAt',
        details: [{ field: 'endAt', errors: ['endAt must be after startAt'] }],
      });
    }
  }

  private async assertDoctorExists(doctorId: string): Promise<void> {
    if (!(await this.doctors.existsBy({ id: doctorId }))) {
      throw new NotFoundException('Doctor not found');
    }
  }
}
