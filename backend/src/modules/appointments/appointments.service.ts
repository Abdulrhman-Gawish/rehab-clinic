import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  Not,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  toPaginated,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import {
  ErrorCode,
  notFound,
  unprocessable,
} from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { addDays, isoToDate } from '../../common/time/clinic-time.util.js';
import { isZeroMoney } from '../../common/utils/money.util.js';
import { normalizePersonName } from '../../common/utils/person-name.util.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import {
  assertDeskPatientInput,
  PatientsService,
} from '../patients/patients.service.js';
import {
  allowedDeskActions,
  allowedWalkInActions,
  assertDeskAction,
  deskTransition,
  DeskAction,
  DoctorAction,
  type ActionFacts,
} from './appointment-actions.js';
import {
  AppointmentWriter,
  mapBookingError,
} from './appointment-writer.service.js';
import { InvoiceStatus } from '../billing/billing.enums.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { NoteStatus } from '../clinical/clinical.enums.js';
import { ClinicalNote } from '../clinical/entities/clinical-note.entity.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import {
  toAppointmentResponse,
  toDayListEntry,
  toHistoryEntry,
  toWalkInDayListEntry,
  type DayVisitInfo,
} from './appointment.mapper.js';
import { AppointmentSource, AppointmentStatus } from './appointment.enums.js';
import { AvailabilityService } from './availability/availability.service.js';
import type {
  AppointmentResponseDto,
  CreateAppointmentDto,
  DayListEntryDto,
  DayListQueryDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  StatusHistoryEntryDto,
} from './dto/appointment.dto.js';
import { AppointmentStatusHistory } from './entities/appointment-status-history.entity.js';
import { Appointment } from './entities/appointment.entity.js';
import { normalizeReferenceCode } from './reference-code.util.js';

@Injectable()
export class AppointmentsService {
  private readonly backdateMaxDays: number;

  constructor(
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(AppointmentStatusHistory)
    private readonly history: Repository<AppointmentStatusHistory>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly writer: AppointmentWriter,
    private readonly availability: AvailabilityService,
    private readonly patients: PatientsService,
    private readonly access: DoctorAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.backdateMaxDays = config.get('BACKDATE_MAX_DAYS', { infer: true });
  }

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
    assertDeskPatientInput(dto);
    const startAt = isoToDate(dto.startAt);
    const outside = dto.allowOutsideSchedule ?? false;
    if (outside) this.assertBackdateAllowed(startAt, actor);

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

        const patient = await this.patients.resolveForDesk(dto, actor, manager);
        const bookedName = dto.patientId
          ? patient.name
          : normalizePersonName(dto.name as string);

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
    return this.transition(id, DeskAction.CONFIRM, actor, null);
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
    return this.transition(id, DeskAction.CANCEL, actor, reason.trim());
  }

  // Only once the start time has passed.
  noShow(id: string, actor: Actor): Promise<AppointmentResponseDto> {
    return this.transition(id, DeskAction.NO_SHOW, actor, null);
  }

  /**
   * Marked as no-show by mistake: back to CONFIRMED, same local day only.
   * The slot was freed meanwhile, so it can collide (409 SLOT_UNAVAILABLE).
   */
  undoNoShow(id: string, actor: Actor): Promise<AppointmentResponseDto> {
    return this.transition(id, DeskAction.UNDO_NO_SHOW, actor, null);
  }

  /**
   * From PENDING or CONFIRMED, in one transaction: the old appointment
   * becomes RESCHEDULED (so it stops blocking its slot) and a new CONFIRMED
   * one is inserted pointing back to it. If the new slot is taken the whole
   * transaction rolls back.
   */
  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    actor: Actor,
  ): Promise<AppointmentResponseDto> {
    const startAt = isoToDate(dto.startAt);
    const outside = dto.allowOutsideSchedule ?? false;
    if (outside) this.assertBackdateAllowed(startAt, actor);

    const newId = await this.writer.runBooking(() =>
      this.dataSource.transaction(async (manager) => {
        const old = await this.lockOrFail(id, manager);
        assertDeskAction(DeskAction.RESCHEDULE, old.status, this.facts(old));
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
          { reason: dto.reason ?? null },
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
    const { start, end } = this.time.dateRange(query.from, query.to);
    if (start) qb.andWhere('appointment.startAt >= :start', { start });
    if (end) qb.andWhere('appointment.startAt < :end', { end });
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

  /**
   * The day list (clinic local date): the day's appointments with their
   * visit (if attended), plus the day's walk-ins, ordered by time (start
   * time, or attended time for walk-ins). Each row says what the caller may
   * do with it. A DOCTOR gets only their own rows, without billing columns.
   */
  async day(
    query: DayListQueryDto,
    user: AuthenticatedUser,
  ): Promise<DayListEntryDto[]> {
    const { start, end } = this.time.dayBounds(query.date);
    const ownDoctorId = await this.access.scopeFor(user);
    const doctorId = ownDoctorId ?? query.doctorId;
    const statuses = query.status ?? [];

    const qb = this.baseQuery().where(
      'appointment.startAt >= :start AND appointment.startAt < :end',
      { start, end },
    );
    if (doctorId) qb.andWhere('appointment.doctorId = :doctorId', { doctorId });
    if (statuses.length) {
      qb.andWhere('appointment.status IN (:...statuses)', { statuses });
    }
    const appointments = await qb.getMany();
    const visitByAppointment = await this.visitsOf(
      appointments.map((a) => a.id),
    );

    // Walk-ins count as ATTENDED for the status filter.
    let walkInVisits: Visit[] = [];
    if (!statuses.length || statuses.includes(AppointmentStatus.ATTENDED)) {
      const walkIns = this.visits
        .createQueryBuilder('visit')
        .innerJoinAndSelect('visit.patient', 'patient')
        .innerJoinAndSelect('visit.doctor', 'doctor')
        .innerJoinAndSelect('doctor.user', 'doctorUser')
        .innerJoinAndSelect('visit.service', 'service')
        .where('visit.appointmentId IS NULL')
        .andWhere('visit.attendedAt >= :start AND visit.attendedAt < :end', {
          start,
          end,
        });
      if (doctorId)
        walkIns.andWhere('visit.doctorId = :doctorId', { doctorId });
      if (statuses.length) {
        walkIns.andWhere('visit.status = :active', {
          active: VisitStatus.ACTIVE,
        });
      }
      walkInVisits = await walkIns.getMany();
    }

    const visitIds = [
      ...[...visitByAppointment.values()].map((visit) => visit.id),
      ...walkInVisits.map((visit) => visit.id),
    ];
    const invoiceByVisit = await this.invoicesOf(visitIds);
    const noteByVisit = await this.noteStatusesOf(visitIds);

    const now = this.time.now();
    const today = this.time.today();
    const toIso = (d: Date) => this.time.toIso(d);
    const isDoctor = ownDoctorId !== null;
    const visitInfo = (visit: Visit | null): DayVisitInfo | null => {
      if (!visit) return null;
      const invoice = invoiceByVisit.get(visit.id) ?? null;
      return {
        visit,
        invoice: isDoctor ? null : invoice,
        noteStatus: noteByVisit.get(visit.id) ?? null,
        hasPayments: invoice !== null && !isZeroMoney(invoice.amountPaid),
      };
    };

    const rows = [
      ...appointments.map((appointment) => {
        const info = visitInfo(visitByAppointment.get(appointment.id) ?? null);
        const actions = isDoctor
          ? doctorActions(info)
          : allowedDeskActions(appointment.status, {
              isToday: this.time.localDate(appointment.startAt) === today,
              hasStarted: now.getTime() >= appointment.startAt.getTime(),
              visitHasNote: (info?.noteStatus ?? null) !== null,
              invoiceHasPayments: info?.hasPayments ?? false,
            });
        return {
          at: appointment.startAt.getTime(),
          entry: toDayListEntry(appointment, info, actions, !isDoctor, toIso),
        };
      }),
      ...walkInVisits.map((visit) => {
        const info = visitInfo(visit) as DayVisitInfo;
        const actions = isDoctor
          ? doctorActions(info)
          : allowedWalkInActions(visit.status === VisitStatus.ACTIVE, {
              isToday: this.time.localDate(visit.attendedAt) === today,
              visitHasNote: info.noteStatus !== null,
              invoiceHasPayments: info.hasPayments,
            });
        return {
          at: visit.attendedAt.getTime(),
          entry: toWalkInDayListEntry(info, actions, !isDoctor, toIso),
        };
      }),
    ];
    return rows.sort((a, b) => a.at - b.at).map((row) => row.entry);
  }

  // Live (not cancelled) invoice of each visit.
  private async invoicesOf(visitIds: string[]): Promise<Map<string, Invoice>> {
    if (visitIds.length === 0) return new Map();
    const invoices = await this.dataSource.getRepository(Invoice).find({
      where: { visitId: In(visitIds), status: Not(InvoiceStatus.CANCELLED) },
    });
    return new Map(
      invoices.map((invoice) => [invoice.visitId as string, invoice]),
    );
  }

  private async noteStatusesOf(
    visitIds: string[],
  ): Promise<Map<string, NoteStatus>> {
    if (visitIds.length === 0) return new Map();
    const notes = await this.dataSource.getRepository(ClinicalNote).find({
      where: { visitId: In(visitIds) },
      select: { visitId: true, status: true },
    });
    return new Map(notes.map((note) => [note.visitId, note.status]));
  }

  // The visit shown for each appointment: the ACTIVE one if any (at most
  // one by constraint), otherwise the latest voided one.
  private async visitsOf(
    appointmentIds: string[],
  ): Promise<Map<string, Visit>> {
    const result = new Map<string, Visit>();
    if (appointmentIds.length === 0) return result;
    const visits = await this.visits.find({
      where: { appointmentId: In(appointmentIds) },
      order: { attendedAt: 'ASC' },
    });
    for (const visit of visits) {
      const current = result.get(visit.appointmentId as string);
      if (!current || current.status === VisitStatus.VOIDED) {
        result.set(visit.appointmentId as string, visit);
      }
    }
    return result;
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
    // A mistyped code read out on the phone is a normal answer at the desk.
    const appointment = await qb.getOne();
    if (!appointment) {
      throw notFound(
        ErrorCode.REFERENCE_NOT_FOUND,
        'No appointment with this reference code',
      );
    }
    return this.toDto(appointment);
  }

  async statusHistory(
    id: string,
    user: AuthenticatedUser,
  ): Promise<StatusHistoryEntryDto[]> {
    await this.findOne(id, user);
    const entries = await this.history.find({
      where: { appointmentId: id },
      relations: { changedBy: true },
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

  // The oldest local date the role may book into (null = no limit).
  earliestBackdate(role: UserRole | undefined): string | null {
    if (role === UserRole.OWNER) return null;
    return addDays(this.time.today(), -this.backdateMaxDays);
  }

  // ---------- Internals ----------

  /**
   * allowOutsideSchedule lets the desk record appointments in the past
   * (e.g. a walk-in noted afterwards). A RECEPTIONIST may go back at most
   * BACKDATE_MAX_DAYS local days; anything older needs the OWNER.
   */
  private assertBackdateAllowed(startAt: Date, actor: Actor): void {
    const earliestDate = this.earliestBackdate(actor.role);
    if (earliestDate !== null && this.time.localDate(startAt) < earliestDate) {
      throw unprocessable(
        ErrorCode.BACKDATE_LIMIT_EXCEEDED,
        `Only the owner can book appointments before ${earliestDate}`,
        { earliestDate },
      );
    }
  }

  private async transition(
    id: string,
    action: DeskAction,
    actor: Actor,
    reason: string | null,
  ): Promise<AppointmentResponseDto> {
    const { to, trigger } = deskTransition(action);
    try {
      await this.dataSource.transaction(async (manager) => {
        const appointment = await this.lockOrFail(id, manager);
        assertDeskAction(action, appointment.status, this.facts(appointment));
        await this.writer.changeStatus(manager, appointment, to, actor, {
          reason,
          trigger,
        });
      });
    } catch (error) {
      throw mapBookingError(error);
    }
    return this.load(id);
  }

  // Time facts of the action rules (see appointment-actions.ts).
  private facts(appointment: Appointment): ActionFacts {
    return {
      isToday: this.time.localDate(appointment.startAt) === this.time.today(),
      hasStarted: this.time.now().getTime() >= appointment.startAt.getTime(),
    };
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
    const appointment = await manager.findOne(Appointment, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private baseQuery(): SelectQueryBuilder<Appointment> {
    return this.appointments
      .createQueryBuilder('appointment')
      .innerJoinAndSelect('appointment.patient', 'patient')
      .innerJoinAndSelect('appointment.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser')
      .innerJoinAndSelect('appointment.service', 'service')
      .leftJoinAndSelect('appointment.bookedBy', 'bookedBy');
  }

  // DOCTOR users only ever see their own appointments.
  private async scopedQuery(
    user: AuthenticatedUser,
  ): Promise<SelectQueryBuilder<Appointment>> {
    const qb = this.baseQuery();
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

// A doctor writes the note of an ACTIVE visit until it is signed, then
// reads it.
function doctorActions(info: DayVisitInfo | null): DoctorAction[] {
  if (!info) return [];
  if (info.noteStatus === NoteStatus.SIGNED) return [DoctorAction.VIEW_NOTE];
  return info.visit.status === VisitStatus.ACTIVE
    ? [DoctorAction.WRITE_NOTE]
    : [];
}
