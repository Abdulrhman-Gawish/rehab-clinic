import {
  BadRequestException,
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
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { parseIsoWithOffset } from '../../common/time/clinic-time.util.js';
import { normalizePersonName } from '../../common/utils/person-name.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Patient, PatientSource } from '../patients/entities/patient.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import { assertTransition } from './appointment-state-machine.js';
import { AppointmentWriter } from './appointment-writer.service.js';
import { toAppointmentResponse, toHistoryEntry } from './appointment.mapper.js';
import { AppointmentSource, AppointmentStatus } from './appointment.enums.js';
import { AvailabilityService } from './availability/availability.service.js';
import type {
  AppointmentResponseDto,
  CreateAppointmentDto,
  DayListQueryDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  StatusHistoryEntryDto,
} from './dto/appointment.dto.js';
import { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import { Appointment } from './entities/appointment.entity.js';
import { normalizeReferenceCode } from './reference-code.util.js';

// DTO validation already guarantees the format.
const toDate = (value: string) => parseIsoWithOffset(value) as Date;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(AppointmentStatusHistory)
    private readonly history: Repository<AppointmentStatusHistory>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly writer: AppointmentWriter,
    private readonly availability: AvailabilityService,
    private readonly patients: PatientsService,
    private readonly access: DoctorAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Commands (OWNER, RECEPTIONIST) ----------

  /**
   * Reception booking: CONFIRMED immediately. With allowOutsideSchedule the
   * schedule / time-off / lead-time checks are skipped (and audited), but
   * the overlap constraints always apply.
   */
  async create(
    dto: CreateAppointmentDto,
    actor: Actor,
  ): Promise<AppointmentResponseDto> {
    const byPhone = dto.name !== undefined || dto.phone !== undefined;
    if (dto.patientId ? byPhone : !(dto.name && dto.phone)) {
      throw new BadRequestException(
        'Provide either patientId, or both name and phone',
      );
    }
    const startAt = toDate(dto.startAt);
    const outside = dto.allowOutsideSchedule ?? false;

    const id = await this.writer.runBooking(() =>
      this.dataSource.transaction(async (manager) => {
        const context = await this.availability.loadContext(
          dto.doctorId,
          dto.serviceId,
          {},
          manager,
        );
        if (!outside) {
          await this.availability.assertBookable(context, startAt, manager);
        }

        let patient: Patient;
        let bookedName: string;
        if (dto.patientId) {
          const found = await manager
            .getRepository(Patient)
            .findOneBy({ id: dto.patientId });
          if (!found) throw new NotFoundException('Patient not found');
          patient = found;
          bookedName = found.name;
        } else {
          patient = (
            await this.patients.findOrCreateByPhone(
              {
                name: dto.name as string,
                phone: dto.phone as string,
                source: PatientSource.RECEPTION,
                createdBy: actor.userId,
                ip: actor.ip,
              },
              manager,
            )
          ).patient;
          bookedName = normalizePersonName(dto.name as string);
        }

        const appointment = await this.writer.insert(
          manager,
          {
            patientId: patient.id,
            doctorId: context.doctor.id,
            serviceId: context.service.id,
            startAt,
            durationMinutes: context.service.durationMinutes,
            status: AppointmentStatus.CONFIRMED,
            source: AppointmentSource.RECEPTION,
            bookedName,
            bookedById: actor.userId,
            notes: dto.notes ?? null,
          },
          actor,
        );
        if (outside) await this.auditOverride(manager, appointment, actor);
        return appointment.id;
      }),
    );
    return this.load(id);
  }

  confirm(id: string, actor: Actor): Promise<AppointmentResponseDto> {
    return this.transition(id, AppointmentStatus.CONFIRMED, actor, null);
  }

  cancel(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<AppointmentResponseDto> {
    // The DTO requires it too; checked here for non-HTTP callers.
    if (!reason?.trim()) {
      throw new BadRequestException('A cancellation reason is required');
    }
    return this.transition(
      id,
      AppointmentStatus.CANCELLED,
      actor,
      reason.trim(),
    );
  }

  noShow(id: string, actor: Actor): Promise<AppointmentResponseDto> {
    return this.transition(id, AppointmentStatus.NO_SHOW, actor, null, (a) => {
      if (this.time.now().getTime() < a.startAt.getTime()) {
        throw unprocessable(
          ErrorCode.NO_SHOW_TOO_EARLY,
          'An appointment can be marked as no-show only after it has started',
        );
      }
    });
  }

  /**
   * One transaction: the old appointment becomes RESCHEDULED (so it stops
   * blocking its slot) and a new CONFIRMED one is inserted pointing back to
   * it. If the new slot is taken the whole transaction rolls back.
   */
  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    actor: Actor,
  ): Promise<AppointmentResponseDto> {
    const startAt = toDate(dto.startAt);
    const outside = dto.allowOutsideSchedule ?? false;

    const newId = await this.writer.runBooking(() =>
      this.dataSource.transaction(async (manager) => {
        const old = await this.lockOrFail(id, manager);
        assertTransition(old.status, AppointmentStatus.RESCHEDULED);
        const context = await this.availability.loadContext(
          dto.doctorId ?? old.doctorId,
          old.serviceId,
          {},
          manager,
        );
        if (!outside) {
          await this.availability.assertBookable(context, startAt, manager);
        }

        // Old first, so it stops blocking before the new row is inserted.
        await this.writer.changeStatus(
          manager,
          old,
          AppointmentStatus.RESCHEDULED,
          actor,
          dto.reason ?? null,
        );
        const created = await this.writer.insert(
          manager,
          {
            patientId: old.patientId,
            doctorId: context.doctor.id,
            serviceId: old.serviceId,
            startAt,
            durationMinutes: context.service.durationMinutes,
            status: AppointmentStatus.CONFIRMED,
            source: AppointmentSource.RECEPTION,
            bookedName: old.bookedName,
            bookedById: actor.userId,
            rescheduledFromId: old.id,
            notes: old.notes,
          },
          actor,
        );
        if (outside) await this.auditOverride(manager, created, actor);
        return created.id;
      }),
    );
    return this.load(newId);
  }

  // ---------- Queries ----------

  async list(
    query: ListAppointmentsQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<AppointmentResponseDto>> {
    const qb = await this.scopedQuery(user);
    if (query.from)
      qb.andWhere('appointment.startAt >= :from', { from: toDate(query.from) });
    if (query.to)
      qb.andWhere('appointment.startAt < :to', { to: toDate(query.to) });
    if (query.doctorId)
      qb.andWhere('appointment.doctorId = :doctorId', {
        doctorId: query.doctorId,
      });
    if (query.patientId) {
      qb.andWhere('appointment.patientId = :patientId', {
        patientId: query.patientId,
      });
    }
    if (query.status)
      qb.andWhere('appointment.status = :status', { status: query.status });
    if (query.source)
      qb.andWhere('appointment.source = :source', { source: query.source });
    return this.paginate(qb, query);
  }

  // The reception day list (clinic local date).
  async day(query: DayListQueryDto): Promise<AppointmentResponseDto[]> {
    const { start, end } = this.time.dayBounds(query.date);
    const qb = this.baseQuery()
      .where('appointment.startAt >= :start AND appointment.startAt < :end', {
        start,
        end,
      })
      .orderBy('appointment.startAt', 'ASC')
      .addOrderBy('appointment.id', 'ASC');
    if (query.doctorId)
      qb.andWhere('appointment.doctorId = :doctorId', {
        doctorId: query.doctorId,
      });
    return (await qb.getMany()).map((a) => this.toDto(a));
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const qb = (await this.scopedQuery(user)).andWhere('appointment.id = :id', {
      id,
    });
    return this.toDto(await this.oneOrNotFound(qb));
  }

  async findByReference(
    code: string,
    user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const qb = (await this.scopedQuery(user)).andWhere(
      'appointment.referenceCode = :code',
      { code: normalizeReferenceCode(code) },
    );
    return this.toDto(await this.oneOrNotFound(qb));
  }

  async statusHistory(
    id: string,
    user: AuthenticatedUser,
  ): Promise<StatusHistoryEntryDto[]> {
    await this.findOne(id, user);
    const entries = await this.history.find({
      where: { appointmentId: id },
      order: { changedAt: 'ASC', id: 'ASC' },
    });
    return entries.map((entry) =>
      toHistoryEntry(entry, (d) => this.time.toIso(d)),
    );
  }

  // All appointments of a patient across doctors (a doctor sees only theirs).
  async forPatient(
    patientId: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<AppointmentResponseDto>> {
    await this.patients.findOne(patientId);
    const qb = (await this.scopedQuery(user)).andWhere(
      'appointment.patientId = :patientId',
      { patientId },
    );
    return this.paginate(qb, query);
  }

  // ---------- Internals ----------

  private async transition(
    id: string,
    to: AppointmentStatus,
    actor: Actor,
    reason: string | null,
    guard?: (appointment: Appointment) => void,
  ): Promise<AppointmentResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const appointment = await this.lockOrFail(id, manager);
      guard?.(appointment);
      await this.writer.changeStatus(manager, appointment, to, actor, reason);
    });
    return this.load(id);
  }

  private async auditOverride(
    manager: EntityManager,
    appointment: Appointment,
    actor: Actor,
  ): Promise<void> {
    await this.auditService.logAction(
      actor,
      AuditAction.APPOINTMENT_SCHEDULE_OVERRIDE,
      AuditEntityType.APPOINTMENT,
      appointment.id,
      {
        newValues: {
          allowOutsideSchedule: true,
          startAt: appointment.startAt.toISOString(),
          doctorId: appointment.doctorId,
        },
      },
      manager,
    );
  }

  private async lockOrFail(
    id: string,
    manager: EntityManager,
  ): Promise<Appointment> {
    const appointment = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .where('appointment.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private baseQuery(): SelectQueryBuilder<Appointment> {
    return this.appointments
      .createQueryBuilder('appointment')
      .innerJoinAndSelect('appointment.patient', 'patient')
      .innerJoinAndSelect('appointment.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser')
      .innerJoinAndSelect('appointment.service', 'service');
  }

  // DOCTOR users only ever see their own appointments.
  private async scopedQuery(
    user: AuthenticatedUser,
  ): Promise<SelectQueryBuilder<Appointment>> {
    const qb = this.baseQuery().where('TRUE');
    const ownDoctorId = await this.access.scopeFor(user);
    if (ownDoctorId) {
      qb.andWhere('appointment.doctorId = :ownDoctorId', { ownDoctorId });
    }
    return qb;
  }

  private async paginate(
    qb: SelectQueryBuilder<Appointment>,
    page: PaginationQueryDto,
  ): Promise<Paginated<AppointmentResponseDto>> {
    const [rows, total] = await qb
      .orderBy('appointment.startAt', 'ASC')
      .addOrderBy('appointment.id', 'ASC')
      .skip(page.skip)
      .take(page.limit)
      .getManyAndCount();
    return toPaginated(
      rows.map((a) => this.toDto(a)),
      total,
      page,
    );
  }

  private async oneOrNotFound(
    qb: SelectQueryBuilder<Appointment>,
  ): Promise<Appointment> {
    const appointment = await qb.getOne();
    // 404 also when it exists but belongs to another doctor.
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private async load(id: string): Promise<AppointmentResponseDto> {
    const appointment = await this.baseQuery()
      .where('appointment.id = :id', { id })
      .getOneOrFail();
    return this.toDto(appointment);
  }

  private toDto(appointment: Appointment): AppointmentResponseDto {
    return toAppointmentResponse(appointment, (d) => this.time.toIso(d));
  }
}
