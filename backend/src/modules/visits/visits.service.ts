import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import {
  conflict,
  ErrorCode,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { parseIsoWithOffset } from '../../common/time/clinic-time.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { AppointmentTrigger } from '../appointments/appointment-state-machine.js';
import { AppointmentWriter } from '../appointments/appointment-writer.service.js';
import { AppointmentStatus } from '../appointments/appointment.enums.js';
import { AvailabilityService } from '../appointments/availability/availability.service.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Patient, PatientSource } from '../patients/entities/patient.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import type {
  ListVisitsQueryDto,
  QueueEntryDto,
  QueueQueryDto,
  VisitHistoryEntryDto,
  VisitResponseDto,
  WalkInDto,
} from './dto/visit.dto.js';
import { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import {
  Visit,
  VISIT_APPOINTMENT_UNIQUE,
  VISIT_DOCTOR_IN_SESSION_UNIQUE,
  VISIT_PATIENT_OPEN_UNIQUE,
} from './entities/visit.entity.js';
import {
  VISIT_COMPLETION_POLICY,
  type VisitCompletionPolicy,
} from './visit-completion-policy.js';
import { assertVisitTransition } from './visit-state-machine.js';
import { OPEN_VISIT_STATUSES, VisitStatus } from './visit.enums.js';
import { VisitEvent } from './visit.events.js';
import {
  toEventPayload,
  toQueueEntry,
  toVisitHistoryEntry,
  toVisitResponse,
} from './visit.mapper.js';

const toDate = (value: string) => parseIsoWithOffset(value) as Date;

// Unique-index violations -> stable 409 codes. Mapped outside the failed
// (aborted) transaction.
function mapVisitError(error: unknown): unknown {
  if (isUniqueViolation(error, VISIT_APPOINTMENT_UNIQUE)) {
    return conflict(
      ErrorCode.ALREADY_CHECKED_IN,
      'This appointment is already checked in',
    );
  }
  if (isUniqueViolation(error, VISIT_PATIENT_OPEN_UNIQUE)) {
    return conflict(
      ErrorCode.PATIENT_HAS_OPEN_VISIT,
      'The patient already has an open visit',
    );
  }
  if (isUniqueViolation(error, VISIT_DOCTOR_IN_SESSION_UNIQUE)) {
    return conflict(
      ErrorCode.DOCTOR_ALREADY_IN_SESSION,
      'The doctor already has a session in progress',
    );
  }
  return error;
}

interface Committed {
  visit: Visit;
  event: VisitEvent;
  at: Date;
}

@Injectable()
export class VisitsService {
  constructor(
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(VisitStatusHistory)
    private readonly history: Repository<VisitStatusHistory>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly appointmentWriter: AppointmentWriter,
    private readonly availability: AvailabilityService,
    private readonly patients: PatientsService,
    private readonly access: DoctorAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    private readonly events: EventEmitter2,
    @Inject(VISIT_COMPLETION_POLICY)
    private readonly completionPolicy: VisitCompletionPolicy,
  ) {}

  // ---------- Commands ----------

  /**
   * Check-in on the appointment's local date (late arrival is fine). Creates
   * the WAITING visit and moves the appointment to CHECKED_IN (a PENDING one
   * passes through CONFIRMED: two history rows), all in one transaction.
   */
  checkIn(appointmentId: string, actor: Actor): Promise<VisitResponseDto> {
    return this.execute(async (manager) => {
      const appointment = await manager
        .getRepository(Appointment)
        .createQueryBuilder('appointment')
        .where('appointment.id = :appointmentId', { appointmentId })
        .setLock('pessimistic_write')
        .getOne();
      if (!appointment) throw new NotFoundException('Appointment not found');

      const appointmentDate = this.time.localDate(appointment.startAt);
      const today = this.time.today();
      if (appointmentDate !== today) {
        throw unprocessable(
          ErrorCode.CHECK_IN_WRONG_DAY,
          'Check-in is only possible on the day of the appointment',
          { appointmentDate, today },
        );
      }
      // Friendly answer; the unique index is the real guarantee.
      if (appointment.status === AppointmentStatus.CHECKED_IN) {
        throw conflict(
          ErrorCode.ALREADY_CHECKED_IN,
          'This appointment is already checked in',
        );
      }

      const trigger = AppointmentTrigger.CHECK_IN;
      if (appointment.status === AppointmentStatus.PENDING) {
        await this.appointmentWriter.changeStatus(
          manager,
          appointment,
          AppointmentStatus.CONFIRMED,
          actor,
          { trigger },
        );
      }
      await this.appointmentWriter.changeStatus(
        manager,
        appointment,
        AppointmentStatus.CHECKED_IN,
        actor,
        { trigger },
      );

      const visit = await this.insertVisit(manager, actor, {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        serviceId: appointment.serviceId,
      });
      return { visit, event: VisitEvent.CHECKED_IN, at: visit.checkedInAt };
    });
  }

  // Walk-in: no appointment, never blocks booking slots.
  walkIn(dto: WalkInDto, actor: Actor): Promise<VisitResponseDto> {
    const byPhone = dto.name !== undefined || dto.phone !== undefined;
    if (dto.patientId ? byPhone : !(dto.name && dto.phone)) {
      throw new BadRequestException(
        'Provide either patientId, or both name and phone',
      );
    }

    return this.execute(async (manager) => {
      // Doctor active + offers the active service (404 / 422).
      const context = await this.availability.loadContext(
        dto.doctorId,
        dto.serviceId,
        {},
        manager,
      );

      let patientId: string;
      if (dto.patientId) {
        const found = await manager
          .getRepository(Patient)
          .existsBy({ id: dto.patientId });
        if (!found) throw new NotFoundException('Patient not found');
        patientId = dto.patientId;
      } else {
        const { patient } = await this.patients.findOrCreateByPhone(
          {
            name: dto.name as string,
            phone: dto.phone as string,
            source: PatientSource.RECEPTION,
            createdBy: actor.userId,
            ip: actor.ip,
          },
          manager,
        );
        patientId = patient.id;
      }

      const visit = await this.insertVisit(manager, actor, {
        appointmentId: null,
        patientId,
        doctorId: context.doctor.id,
        serviceId: context.service.id,
      });
      return { visit, event: VisitEvent.CHECKED_IN, at: visit.checkedInAt };
    });
  }

  // Checked in by mistake: visit CANCELLED, appointment back to CONFIRMED.
  undoCheckIn(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.closeWaiting(id, reason, actor, 'undo');
  }

  // Patient left before being seen: visit and appointment CANCELLED.
  cancel(id: string, reason: string, actor: Actor): Promise<VisitResponseDto> {
    return this.closeWaiting(id, reason, actor, 'left');
  }

  // WAITING -> IN_SESSION. The visit's doctor or the OWNER.
  start(
    id: string,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.execute(async (manager) => {
      const visit = await this.lockOwnVisit(id, user, manager);
      const from = visit.status;
      assertVisitTransition(from, VisitStatus.IN_SESSION);

      const now = this.time.now();
      visit.status = VisitStatus.IN_SESSION;
      visit.startedAt = now;
      await manager.getRepository(Visit).save(visit);
      await this.recordHistory(
        manager,
        visit.id,
        from,
        visit.status,
        actor,
        null,
      );
      await this.audit(manager, actor, AuditAction.VISIT_STARTED, visit, {
        oldValues: { status: from },
        newValues: { status: visit.status, startedAt: now.toISOString() },
      });
      return { visit, event: VisitEvent.STARTED, at: now };
    });
  }

  /**
   * IN_SESSION -> COMPLETED (the visit's doctor or the OWNER). The
   * VisitCompletionPolicy is consulted first; the linked appointment becomes
   * COMPLETED in the same transaction.
   */
  complete(
    id: string,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<VisitResponseDto> {
    return this.execute(async (manager) => {
      const visit = await this.lockOwnVisit(id, user, manager);
      const from = visit.status;
      assertVisitTransition(from, VisitStatus.COMPLETED);

      const decision = await this.completionPolicy.check(
        { visit, actor },
        manager,
      );
      if (!decision.allowed) {
        throw unprocessable(
          ErrorCode.VISIT_COMPLETION_BLOCKED,
          decision.reason,
        );
      }

      const now = this.time.now();
      visit.status = VisitStatus.COMPLETED;
      visit.completedAt = now;
      visit.completedById = actor.userId;
      await manager.getRepository(Visit).save(visit);
      await this.recordHistory(
        manager,
        visit.id,
        from,
        visit.status,
        actor,
        null,
      );
      await this.audit(manager, actor, AuditAction.VISIT_COMPLETED, visit, {
        oldValues: { status: from },
        newValues: { status: visit.status, completedAt: now.toISOString() },
      });

      if (visit.appointmentId) {
        const appointment = await this.lockAppointment(
          visit.appointmentId,
          manager,
        );
        await this.appointmentWriter.changeStatus(
          manager,
          appointment,
          AppointmentStatus.COMPLETED,
          actor,
          { trigger: AppointmentTrigger.VISIT_COMPLETE },
        );
      }
      return { visit, event: VisitEvent.COMPLETED, at: now };
    });
  }

  // ---------- Queries ----------

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<VisitResponseDto> {
    const visit = await (
      await this.scopedQuery(user)
    )
      .andWhere('visit.id = :id', { id })
      .getOne();
    // 404 also for another doctor's visit.
    if (!visit) throw new NotFoundException('Visit not found');
    return this.toDto(visit);
  }

  async statusHistory(
    id: string,
    user: AuthenticatedUser,
  ): Promise<VisitHistoryEntryDto[]> {
    await this.findOne(id, user);
    const entries = await this.history.find({
      where: { visitId: id },
      order: { changedAt: 'ASC', id: 'ASC' },
    });
    return entries.map((entry) =>
      toVisitHistoryEntry(entry, (d) => this.time.toIso(d)),
    );
  }

  async list(
    query: ListVisitsQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<VisitResponseDto>> {
    const qb = await this.scopedQuery(user);
    if (query.from)
      qb.andWhere('visit.checkedInAt >= :from', { from: toDate(query.from) });
    if (query.to)
      qb.andWhere('visit.checkedInAt < :to', { to: toDate(query.to) });
    if (query.doctorId)
      qb.andWhere('visit.doctorId = :doctorId', { doctorId: query.doctorId });
    if (query.patientId) {
      qb.andWhere('visit.patientId = :patientId', {
        patientId: query.patientId,
      });
    }
    if (query.status)
      qb.andWhere('visit.status = :status', { status: query.status });
    if (query.walkIn !== undefined) {
      qb.andWhere(
        query.walkIn
          ? 'visit.appointmentId IS NULL'
          : 'visit.appointmentId IS NOT NULL',
      );
    }
    return this.paginate(qb, query);
  }

  // WAITING/IN_SESSION visits of a local day, oldest check-in first.
  async queue(
    query: QueueQueryDto,
    user: AuthenticatedUser,
  ): Promise<QueueEntryDto[]> {
    const { start, end } = this.time.dayBounds(query.date ?? this.time.today());
    const qb = (await this.scopedQuery(user))
      .andWhere('visit.status IN (:...open)', { open: OPEN_VISIT_STATUSES })
      .andWhere('visit.checkedInAt >= :start AND visit.checkedInAt < :end', {
        start,
        end,
      })
      .orderBy('visit.checkedInAt', 'ASC')
      .addOrderBy('visit.id', 'ASC');
    if (query.doctorId)
      qb.andWhere('visit.doctorId = :doctorId', { doctorId: query.doctorId });

    const now = this.time.now();
    return (await qb.getMany()).map((visit) =>
      toQueueEntry(visit, now, (d) => this.time.toIso(d)),
    );
  }

  // Visits still WAITING/IN_SESSION from previous days (forgotten ones).
  async openFromPreviousDays(): Promise<VisitResponseDto[]> {
    const { start } = this.time.dayBounds(this.time.today());
    const visits = await this.baseQuery()
      .where('visit.status IN (:...open)', { open: OPEN_VISIT_STATUSES })
      .andWhere('visit.checkedInAt < :start', { start })
      .orderBy('visit.checkedInAt', 'ASC')
      .getMany();
    return visits.map((visit) => this.toDto(visit));
  }

  // Visit metadata of a patient across all doctors (no clinical data).
  async forPatient(
    patientId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<VisitResponseDto>> {
    await this.patients.findOne(patientId);
    const qb = this.baseQuery().where('visit.patientId = :patientId', {
      patientId,
    });
    return this.paginate(qb, query);
  }

  // ---------- Internals ----------

  /**
   * Runs `work` in a transaction, maps unique violations to 409s and emits
   * the domain event ONLY after the commit succeeded.
   */
  private async execute(
    work: (manager: EntityManager) => Promise<Committed>,
  ): Promise<VisitResponseDto> {
    let committed: Committed;
    try {
      committed = await this.dataSource.transaction(work);
    } catch (error) {
      throw mapVisitError(error);
    }
    this.events.emit(
      committed.event,
      toEventPayload(committed.visit, committed.at),
    );
    return this.load(committed.visit.id);
  }

  private closeWaiting(
    id: string,
    reason: string,
    actor: Actor,
    mode: 'undo' | 'left',
  ): Promise<VisitResponseDto> {
    return this.execute(async (manager) => {
      const visit = await this.lockVisit(id, manager);
      const from = visit.status;
      // Only WAITING visits can be undone/cancelled.
      assertVisitTransition(from, VisitStatus.CANCELLED);

      const now = this.time.now();
      visit.status = VisitStatus.CANCELLED;
      visit.cancelledAt = now;
      visit.cancelledById = actor.userId;
      visit.cancelReason = reason;
      await manager.getRepository(Visit).save(visit);
      await this.recordHistory(
        manager,
        visit.id,
        from,
        visit.status,
        actor,
        reason,
      );
      await this.audit(
        manager,
        actor,
        mode === 'undo'
          ? AuditAction.VISIT_CHECK_IN_UNDONE
          : AuditAction.VISIT_CANCELLED,
        visit,
        {
          oldValues: { status: from },
          newValues: { status: visit.status, reason },
        },
      );

      if (visit.appointmentId) {
        const appointment = await this.lockAppointment(
          visit.appointmentId,
          manager,
        );
        await this.appointmentWriter.changeStatus(
          manager,
          appointment,
          mode === 'undo'
            ? AppointmentStatus.CONFIRMED
            : AppointmentStatus.CANCELLED,
          actor,
          {
            reason,
            trigger:
              mode === 'undo'
                ? AppointmentTrigger.UNDO_CHECK_IN
                : AppointmentTrigger.VISIT_CANCEL,
          },
        );
      }
      return { visit, event: VisitEvent.CANCELLED, at: now };
    });
  }

  private async insertVisit(
    manager: EntityManager,
    actor: Actor,
    data: Pick<Visit, 'appointmentId' | 'patientId' | 'doctorId' | 'serviceId'>,
  ): Promise<Visit> {
    const repository = manager.getRepository(Visit);
    const visit = await repository.save(
      repository.create({
        ...data,
        status: VisitStatus.WAITING,
        checkedInAt: this.time.now(),
        checkedInById: actor.userId as string,
        startedAt: null,
        completedAt: null,
        completedById: null,
        cancelledAt: null,
        cancelledById: null,
        cancelReason: null,
      }),
    );
    await this.recordHistory(
      manager,
      visit.id,
      null,
      visit.status,
      actor,
      null,
    );
    await this.audit(manager, actor, AuditAction.VISIT_CHECKED_IN, visit, {
      newValues: {
        appointmentId: visit.appointmentId,
        patientId: visit.patientId,
        doctorId: visit.doctorId,
        serviceId: visit.serviceId,
        walkIn: visit.appointmentId === null,
        checkedInAt: visit.checkedInAt.toISOString(),
      },
    });
    return visit;
  }

  private async recordHistory(
    manager: EntityManager,
    visitId: string,
    fromStatus: VisitStatus | null,
    toStatus: VisitStatus,
    actor: Actor,
    reason: string | null,
  ): Promise<void> {
    await manager.getRepository(VisitStatusHistory).insert({
      visitId,
      fromStatus,
      toStatus,
      changedById: actor.userId as string,
      reason,
    });
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    visit: Visit,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.VISIT,
      visit.id,
      values,
      manager,
    );
  }

  private async lockVisit(id: string, manager: EntityManager): Promise<Visit> {
    const visit = await manager
      .getRepository(Visit)
      .createQueryBuilder('visit')
      .where('visit.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  // Only the visit's doctor (or OWNER) may act; other doctors get 404.
  private async lockOwnVisit(
    id: string,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<Visit> {
    const visit = await this.lockVisit(id, manager);
    const ownDoctorId = await this.access.scopeFor(user);
    if (ownDoctorId !== null && visit.doctorId !== ownDoctorId) {
      throw new NotFoundException('Visit not found');
    }
    return visit;
  }

  private async lockAppointment(
    id: string,
    manager: EntityManager,
  ): Promise<Appointment> {
    return manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .where('appointment.id = :id', { id })
      .setLock('pessimistic_write')
      .getOneOrFail();
  }

  private baseQuery(): SelectQueryBuilder<Visit> {
    return this.visits
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .innerJoinAndSelect('visit.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser')
      .innerJoinAndSelect('visit.service', 'service')
      .leftJoinAndSelect('visit.appointment', 'appointment');
  }

  // DOCTOR users only ever see their own visits.
  private async scopedQuery(
    user: AuthenticatedUser,
  ): Promise<SelectQueryBuilder<Visit>> {
    const qb = this.baseQuery().where('TRUE');
    const ownDoctorId = await this.access.scopeFor(user);
    if (ownDoctorId) {
      qb.andWhere('visit.doctorId = :ownDoctorId', { ownDoctorId });
    }
    return qb;
  }

  private async paginate(
    qb: SelectQueryBuilder<Visit>,
    page: PaginationQueryDto,
  ): Promise<Paginated<VisitResponseDto>> {
    const [rows, total] = await qb
      .orderBy('visit.checkedInAt', 'DESC')
      .addOrderBy('visit.id', 'DESC')
      .skip(page.skip)
      .take(page.limit)
      .getManyAndCount();
    return toPaginated(
      rows.map((visit) => this.toDto(visit)),
      total,
      page,
    );
  }

  private async load(id: string): Promise<VisitResponseDto> {
    const visit = await this.baseQuery()
      .where('visit.id = :id', { id })
      .getOneOrFail();
    return this.toDto(visit);
  }

  private toDto(visit: Visit): VisitResponseDto {
    return toVisitResponse(visit, (d) => this.time.toIso(d));
  }
}
