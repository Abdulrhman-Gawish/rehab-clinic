import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { conflict, ErrorCode } from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { isExclusionViolation } from '../../common/utils/pg-errors.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import {
  ScheduleResponseDto,
  type CreateScheduleDto,
  type UpdateScheduleDto,
} from './dto/schedule.dto.js';
import {
  DoctorSchedule,
  SCHEDULE_OVERLAP_EXCLUSION,
} from './entities/doctor-schedule.entity.js';

const SCHEDULE_AUDIT_FIELDS = [
  'dayOfWeek',
  'startTime',
  'endTime',
  'isActive',
] as const satisfies readonly (keyof DoctorSchedule)[];

// 'HH:mm' or 'HH:mm:ss' -> 'HH:mm:ss' so values compare as strings.
const normalizeTime = (time: string) =>
  time.length === 5 ? `${time}:00` : time;

@Injectable()
export class DoctorSchedulesService {
  constructor(
    @InjectRepository(DoctorSchedule)
    private readonly schedules: Repository<DoctorSchedule>,
    @InjectRepository(Doctor) private readonly doctors: Repository<Doctor>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly access: DoctorAccessService,
  ) {}

  async list(
    doctorId: string,
    user: AuthenticatedUser,
    includeInactive: boolean,
  ): Promise<ScheduleResponseDto[]> {
    await this.access.assertCanAccessDoctor(user, doctorId);
    await this.assertDoctorExists(doctorId);
    const schedules = await this.schedules.find({
      where: { doctorId, ...(includeInactive ? {} : { isActive: true }) },
      order: { dayOfWeek: 'ASC', startTime: 'ASC' },
    });
    return schedules.map(ScheduleResponseDto.fromEntity);
  }

  async create(
    doctorId: string,
    dto: CreateScheduleDto,
    actor: Actor,
  ): Promise<ScheduleResponseDto> {
    await this.assertDoctorExists(doctorId);
    const startTime = normalizeTime(dto.startTime);
    const endTime = normalizeTime(dto.endTime);
    this.assertOrder(startTime, endTime);

    return this.withOverlapMapping(() =>
      this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(DoctorSchedule);
        const saved = await repository.save(
          repository.create({
            doctorId,
            dayOfWeek: dto.dayOfWeek,
            startTime,
            endTime,
            isActive: true,
          }),
        );
        await this.auditService.logAction(
          actor,
          AuditAction.DOCTOR_SCHEDULE_CREATED,
          AuditEntityType.DOCTOR_SCHEDULE,
          saved.id,
          {
            newValues: {
              doctorId,
              ...pickValues(saved, SCHEDULE_AUDIT_FIELDS),
            },
          },
          manager,
        );
        return ScheduleResponseDto.fromEntity(saved);
      }),
    );
  }

  update(
    doctorId: string,
    id: string,
    dto: UpdateScheduleDto,
    actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.mutate(
      doctorId,
      id,
      actor,
      AuditAction.DOCTOR_SCHEDULE_UPDATED,
      (s) => {
        if (dto.dayOfWeek !== undefined) s.dayOfWeek = dto.dayOfWeek;
        if (dto.startTime !== undefined)
          s.startTime = normalizeTime(dto.startTime);
        if (dto.endTime !== undefined) s.endTime = normalizeTime(dto.endTime);
      },
    );
  }

  setActive(
    doctorId: string,
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<ScheduleResponseDto> {
    return this.mutate(
      doctorId,
      id,
      actor,
      isActive
        ? AuditAction.DOCTOR_SCHEDULE_ACTIVATED
        : AuditAction.DOCTOR_SCHEDULE_DEACTIVATED,
      (schedule) => {
        schedule.isActive = isActive;
      },
    );
  }

  private mutate(
    doctorId: string,
    id: string,
    actor: Actor,
    action: AuditAction,
    apply: (schedule: DoctorSchedule) => void,
  ): Promise<ScheduleResponseDto> {
    return this.withOverlapMapping(() =>
      this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(DoctorSchedule);
        const schedule = await repository.findOne({
          where: { id, doctorId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!schedule) throw new NotFoundException('Schedule not found');

        const before = { ...schedule };
        apply(schedule);
        this.assertOrder(schedule.startTime, schedule.endTime);

        const changes = diffValues(before, schedule, SCHEDULE_AUDIT_FIELDS);
        if (!changes) return ScheduleResponseDto.fromEntity(schedule);

        const saved = await repository.save(schedule);
        await this.auditService.logAction(
          actor,
          action,
          AuditEntityType.DOCTOR_SCHEDULE,
          id,
          changes,
          manager,
        );
        return ScheduleResponseDto.fromEntity(saved);
      }),
    );
  }

  private assertOrder(startTime: string, endTime: string): void {
    if (endTime <= startTime) {
      throw new BadRequestException({
        message: 'endTime must be after startTime',
        details: [
          { field: 'endTime', errors: ['endTime must be after startTime'] },
        ],
      });
    }
  }

  // The exclusion constraint on active ranges decides overlaps (also under
  // races); its violation becomes 409 SCHEDULE_OVERLAP.
  private async withOverlapMapping<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isExclusionViolation(error, SCHEDULE_OVERLAP_EXCLUSION)) {
        throw conflict(
          ErrorCode.SCHEDULE_OVERLAP,
          'This range overlaps another active range of the doctor on the same day',
        );
      }
      throw error;
    }
  }

  private async assertDoctorExists(doctorId: string): Promise<void> {
    if (!(await this.doctors.existsBy({ id: doctorId }))) {
      throw new NotFoundException('Doctor not found');
    }
  }
}
