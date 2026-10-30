import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
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
import { isZeroMoney } from '../../common/utils/money.util.js';
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import {
  assertDeskAction,
  assertWalkInUndo,
  DeskAction,
} from '../appointments/appointment-actions.js';
import { AppointmentTrigger } from '../appointments/appointment-state-machine.js';
import {
  AppointmentWriter,
  mapBookingError,
} from '../appointments/appointment-writer.service.js';
import { AppointmentStatus } from '../appointments/appointment.enums.js';
import { AvailabilityService } from '../appointments/availability/availability.service.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type { Invoice } from '../billing/entities/invoice.entity.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { ClinicalNote } from '../clinical/entities/clinical-note.entity.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import {
  assertDeskPatientInput,
  PatientsService,
} from '../patients/patients.service.js';
import type {
  AttendResponseDto,
  ListVisitsQueryDto,
  QueueEntryDto,
  QueueQueryDto,
  VisitHistoryEntryDto,
  VisitResponseDto,
  WalkInDto,
} from './dto/visit.dto.js';
import { VisitStatusHistory } from './entities/visit-status-history.entity.js';
import { Visit, VISIT_APPOINTMENT_UNIQUE } from './entities/visit.entity.js';
import { VisitStatus } from './visit.enums.js';
import {
  toQueueEntry,
  toVisitHistoryEntry,
  toVisitResponse,
} from './visit.mapper.js';

// Unique-index and exclusion violations -> stable 409 codes. Mapped outside
// the failed (aborted) transaction.
function mapVisitError(error: unknown): unknown {
  if (isUniqueViolation(error, VISIT_APPOINTMENT_UNIQUE)) {
    return conflict(
      ErrorCode.ALREADY_ATTENDED,
      'This appointment has already attended',
    );
  }
  return mapBookingError(error);
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
    private readonly invoices: InvoicesService,
    private readonly access: DoctorAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Commands (OWNER, RECEPTIONIST) ----------

  /**
   * The patient entered the doctor: on the appointment's local date only.
   * The appointment becomes ATTENDED (from PENDING or CONFIRMED), and the
   * ACTIVE visit and its invoice are created, all in one transaction.
   */
  async attend(
    appointmentId: string,
    actor: Actor,
  ): Promise<AttendResponseDto> {
    return this.execute(async (manager) => {
      const appointment = await this.lockAppointment(appointmentId, manager);
      // Friendly answer; the unique index is the real guarantee.
      if (appointment.status === AppointmentStatus.ATTENDED) {
        throw conflict(
          ErrorCode.ALREADY_ATTENDED,
          'This appointment has already attended',
        );
      }
      assertDeskAction(DeskAction.ATTEND, appointment.status, {
        isToday: this.isToday(appointment.startAt),
      });
      await this.appointmentWriter.changeStatus(
        manager,
        appointment,
        AppointmentStatus.ATTENDED,
        actor,
        { trigger: AppointmentTrigger.ATTEND },
      );
      return this.insertVisit(manager, actor, {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        serviceId: appointment.serviceId,
      });
    });
  }

  // Walk-in: attended now, with its invoice, no appointment. Never blocks
  // booking slots.
  walkIn(dto: WalkInDto, actor: Actor): Promise<AttendResponseDto> {
    assertDeskPatientInput(dto);

    return this.execute(async (manager) => {
      // Doctor active + offers the active service (404 / 422).
      const context = await this.availability.loadContext(
        dto.doctorId,
        dto.serviceId,
        {},
        manager,
      );
      const patient = await this.patients.resolveForDesk(dto, actor, manager);
      return this.insertVisit(manager, actor, {
        appointmentId: null,
        patientId: patient.id,
        doctorId: context.doctor.id,
        serviceId: context.service.id,
      });
    });
  }

  /**
   * Attended by mistake (same local day, no note, nothing paid): the visit
   * is VOIDED, its invoice CANCELLED and the appointment back to CONFIRMED.
   */
  async undoAttend(
    appointmentId: string,
    reason: string,
    actor: Actor,
  ): Promise<VisitResponseDto> {
    const visit = await this.run((manager) =>
      this.undoAppointmentAttend(manager, appointmentId, reason, actor),
    );
    return this.load(visit.id);
  }

  /**
   * Undo through the visit: the way to undo a walk-in. A visit of an
   * appointment is undone exactly like POST /appointments/:id/undo-attend.
   */
  async undoVisit(
    visitId: string,
    reason: string,
    actor: Actor,
  ): Promise<VisitResponseDto> {
    await this.run(async (manager) => {
      const found = await manager.findOneBy(Visit, { id: visitId });
      if (!found) throw new NotFoundException('Visit not found');
      if (found.appointmentId) {
        // Same lock order as every appointment write: appointment first.
        return this.undoAppointmentAttend(
          manager,
          found.appointmentId,
          reason,
          actor,
          visitId,
        );
      }
      const visit = await manager.findOneOrFail(Visit, {
        where: { id: visitId },
        lock: { mode: 'pessimistic_write' },
      });
      if (visit.status === VisitStatus.VOIDED) {
        throw unprocessable(
          ErrorCode.VISIT_VOIDED,
          'The visit is already voided',
        );
      }
      const invoice = await this.invoices.lockLiveInvoiceOfVisit(
        visit.id,
        manager,
      );
      assertWalkInUndo({
        isToday: this.isToday(visit.attendedAt),
        visitHasNote: await this.hasNote(visit.id, manager),
        invoiceHasPayments:
          invoice !== null && !isZeroMoney(invoice.amountPaid),
      });
      return this.voidVisit(manager, visit, invoice, reason, actor);
    });
    return this.load(visitId);
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
      relations: { changedBy: true },
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
    const { start, end } = this.time.dateRange(query.from, query.to);
    if (start) qb.andWhere('visit.attendedAt >= :start', { start });
    if (end) qb.andWhere('visit.attendedAt < :end', { end });
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

  // ACTIVE visits of a local day, in the order they attended.
  async queue(
    query: QueueQueryDto,
    user: AuthenticatedUser,
  ): Promise<QueueEntryDto[]> {
    const { start, end } = this.time.dayBounds(query.date ?? this.time.today());
    // A doctor always gets their own queue, whatever doctorId says.
    const doctorId = (await this.access.scopeFor(user)) ?? query.doctorId;
    const qb = this.baseQuery()
      .where('visit.status = :active', { active: VisitStatus.ACTIVE })
      .andWhere('visit.attendedAt >= :start AND visit.attendedAt < :end', {
        start,
        end,
      })
      .orderBy('visit.attendedAt', 'ASC')
      .addOrderBy('visit.id', 'ASC');
    if (doctorId) qb.andWhere('visit.doctorId = :doctorId', { doctorId });

    const visits = await qb.getMany();
    const notes = visits.length
      ? await this.dataSource.getRepository(ClinicalNote).find({
          where: { visitId: In(visits.map((v) => v.id)) },
          select: { visitId: true, status: true },
        })
      : [];
    const noteStatus = new Map(notes.map((n) => [n.visitId, n.status]));
    return visits.map((visit) =>
      toQueueEntry(visit, noteStatus.get(visit.id) ?? null, (d) =>
        this.time.toIso(d),
      ),
    );
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

  // Runs `work` in a transaction and maps constraint violations to 409s.
  private async run<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw mapVisitError(error);
    }
  }

  private async execute(
    work: (
      manager: EntityManager,
    ) => Promise<{ visit: Visit; invoiceId: string }>,
  ): Promise<AttendResponseDto> {
    const { visit, invoiceId } = await this.run(work);
    return { ...(await this.load(visit.id)), invoiceId };
  }

  private async undoAppointmentAttend(
    manager: EntityManager,
    appointmentId: string,
    reason: string,
    actor: Actor,
    expectedVisitId?: string,
  ): Promise<Visit> {
    const appointment = await this.lockAppointment(appointmentId, manager);
    const visit = await manager.findOne(Visit, {
      where: { appointmentId, status: VisitStatus.ACTIVE },
      lock: { mode: 'pessimistic_write' },
    });
    if (expectedVisitId && visit?.id !== expectedVisitId) {
      throw unprocessable(
        ErrorCode.VISIT_VOIDED,
        'The visit is already voided',
      );
    }
    const invoice = visit
      ? await this.invoices.lockLiveInvoiceOfVisit(visit.id, manager)
      : null;
    assertDeskAction(DeskAction.UNDO_ATTEND, appointment.status, {
      isToday: this.isToday(appointment.startAt),
      visitHasNote: visit ? await this.hasNote(visit.id, manager) : false,
      invoiceHasPayments: invoice !== null && !isZeroMoney(invoice.amountPaid),
    });
    // ATTENDED always has its ACTIVE visit (same transaction).
    if (!visit)
      throw new Error(`Attended appointment ${appointmentId} has no visit`);

    await this.voidVisit(manager, visit, invoice, reason, actor);
    await this.appointmentWriter.changeStatus(
      manager,
      appointment,
      AppointmentStatus.CONFIRMED,
      actor,
      { reason, trigger: AppointmentTrigger.UNDO_ATTEND },
    );
    return visit;
  }

  // ACTIVE -> VOIDED, and its invoice (locked and checked unpaid by the
  // caller) cancelled with the same reason.
  private async voidVisit(
    manager: EntityManager,
    visit: Visit,
    invoice: Invoice | null,
    reason: string,
    actor: Actor,
  ): Promise<Visit> {
    if (invoice) {
      await this.invoices.cancelForVoidedVisit(manager, invoice, reason, actor);
    }

    visit.status = VisitStatus.VOIDED;
    visit.voidedAt = this.time.now();
    visit.voidedById = actor.userId;
    visit.voidReason = reason;
    await manager.getRepository(Visit).save(visit);
    await this.recordHistory(
      manager,
      visit.id,
      VisitStatus.ACTIVE,
      VisitStatus.VOIDED,
      actor,
      reason,
    );
    await this.audit(manager, actor, AuditAction.VISIT_VOIDED, visit, {
      oldValues: { status: VisitStatus.ACTIVE },
      newValues: { status: visit.status, reason, invoiceId: invoice?.id },
    });
    return visit;
  }

  private async insertVisit(
    manager: EntityManager,
    actor: Actor,
    data: Pick<Visit, 'appointmentId' | 'patientId' | 'doctorId' | 'serviceId'>,
  ): Promise<{ visit: Visit; invoiceId: string }> {
    const repository = manager.getRepository(Visit);
    const visit = await repository.save(
      repository.create({
        ...data,
        status: VisitStatus.ACTIVE,
        attendedAt: this.time.now(),
        attendedById: actor.userId as string,
        voidedAt: null,
        voidedById: null,
        voidReason: null,
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
    await this.audit(manager, actor, AuditAction.VISIT_ATTENDED, visit, {
      newValues: {
        appointmentId: visit.appointmentId,
        patientId: visit.patientId,
        doctorId: visit.doctorId,
        serviceId: visit.serviceId,
        walkIn: visit.appointmentId === null,
        attendedAt: visit.attendedAt.toISOString(),
      },
    });
    const invoice = await this.invoices.createForVisit(manager, visit, actor);
    return { visit, invoiceId: invoice.id };
  }

  private isToday(instant: Date): boolean {
    return this.time.localDate(instant) === this.time.today();
  }

  private hasNote(visitId: string, manager: EntityManager): Promise<boolean> {
    return manager.getRepository(ClinicalNote).existsBy({ visitId });
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

  private async lockAppointment(
    id: string,
    manager: EntityManager,
  ): Promise<Appointment> {
    const appointment = await manager.findOne(Appointment, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private baseQuery(): SelectQueryBuilder<Visit> {
    return this.visits
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .innerJoinAndSelect('visit.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser')
      .innerJoinAndSelect('visit.service', 'service')
      .innerJoinAndSelect('visit.attendedBy', 'attendedBy')
      .leftJoinAndSelect('visit.voidedBy', 'voidedBy')
      .leftJoinAndSelect('visit.appointment', 'appointment');
  }

  // DOCTOR users only ever see their own visits.
  private async scopedQuery(
    user: AuthenticatedUser,
  ): Promise<SelectQueryBuilder<Visit>> {
    const qb = this.baseQuery();
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
      .orderBy('visit.attendedAt', 'DESC')
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
