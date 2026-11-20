import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
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
import { UserRole } from '../../common/enums/user-role.enum.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type { AppointmentType } from '../appointments/appointment.enums.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { NoteStatus } from './clinical.enums.js';
import {
  fieldsOutsideType,
  NOTE_FIELDS,
  noteFieldsFor,
  type NoteField,
} from './note-fields.js';
import {
  toAttachment,
  toClinicalNote,
  toNeedsAttentionEntry,
} from './clinical.mapper.js';
import type {
  AddendumInputDto,
  ClinicalHistoryDto,
  ClinicalNoteInputDto,
  ClinicalNoteResponseDto,
  NeedsAttentionEntryDto,
  NeedsAttentionQueryDto,
} from './dto/clinical.dto.js';
import { ClinicalNoteAddendum } from './entities/clinical-note-addendum.entity.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { PatientAttachment } from './entities/patient-attachment.entity.js';
import { MedicalInfoService } from './medical-info.service.js';

@Injectable()
export class ClinicalNotesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClinicalAccessService,
    private readonly doctors: DoctorAccessService,
    private readonly medicalInfo: MedicalInfoService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Notes (only the visit's doctor writes) ----------

  /**
   * Creates the note (a DRAFT) on the first save, or replaces the fields of
   * the visit's appointment type (a field left out becomes null); the other
   * types' fields are read-only and kept. A SIGNED note stays SIGNED and can
   * still be edited: every change is audited (old and new values). Only the
   * visit's doctor; a new note only on an ACTIVE visit, any day after.
   */
  async save(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const { visit, note } = await this.lockOwnNote(visitId, user, manager);
      await this.saveFields(manager, visit, note, dto, actor);
    });
    return this.reload(visitId, user);
  }

  /**
   * DRAFT -> SIGNED. No field is required. Fields sent with it are saved
   * first (like PUT), in the same transaction: save and sign in one call.
   * Without a note yet, an empty one is created and signed. Signing twice is
   * NOTE_SIGNED (a signed note is edited with PUT).
   */
  async sign(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const locked = await this.lockOwnNote(visitId, user, manager);
      if (locked.note?.status === NoteStatus.SIGNED) {
        throw unprocessable(
          ErrorCode.NOTE_SIGNED,
          'The note is already signed; save changes with PUT',
        );
      }
      const withFields = NOTE_FIELDS.some((field) => dto[field] !== undefined);
      const note =
        withFields || !locked.note
          ? await this.saveFields(
              manager,
              locked.visit,
              locked.note,
              dto,
              actor,
            )
          : locked.note;
      note.status = NoteStatus.SIGNED;
      note.signedAt = this.time.now();
      await manager.getRepository(ClinicalNote).save(note);
      await this.audit(manager, actor, AuditAction.CLINICAL_NOTE_SIGNED, note, {
        oldValues: { status: NoteStatus.DRAFT },
        newValues: {
          status: note.status,
          signedAt: note.signedAt.toISOString(),
        },
      });
    });
    return this.reload(visitId, user);
  }

  /**
   * The visit's note, or null when it has none yet. A DRAFT is visible to
   * its author and (read-only) to the OWNER; other doctors get 404
   * NOTE_NOT_VISIBLE until it is signed.
   */
  async findForVisit(
    visitId: string,
    user: AuthenticatedUser,
  ): Promise<ClinicalNoteResponseDto | null> {
    const visit = await this.dataSource
      .getRepository(Visit)
      .findOneBy({ id: visitId });
    if (!visit) throw new NotFoundException('Visit not found');
    const doctorId = await this.access.assertCanAccessPatient(
      user,
      visit.patientId,
    );
    const note = await this.noteQuery()
      .where('note.visitId = :visitId', { visitId })
      .getOne();
    if (!note) return null;
    if (!isVisibleTo(note, user, doctorId)) {
      throw notFound(
        ErrorCode.NOTE_NOT_VISIBLE,
        "This visit's note is another doctor's draft",
      );
    }
    return (await this.withDetails([note]))[0];
  }

  // ---------- Addenda (any doctor with access, once SIGNED) ----------

  async addAddendum(
    noteId: string,
    dto: AddendumInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    const note = await this.dataSource
      .getRepository(ClinicalNote)
      .findOneBy({ id: noteId });
    if (!note) throw new NotFoundException('Note not found');
    const doctorId = await this.access.assertCanAccessPatient(
      user,
      note.patientId,
    );
    if (!isVisibleTo(note, user, doctorId)) {
      throw new NotFoundException('Note not found');
    }
    if (note.status !== NoteStatus.SIGNED) {
      throw unprocessable(
        ErrorCode.NOTE_NOT_SIGNED,
        'Addenda are for signed notes; edit the draft instead',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ClinicalNoteAddendum);
      const addendum = await repository.save(
        repository.create({
          noteId,
          doctorId: doctorId as string,
          content: dto.content,
        }),
      );
      await this.audit(
        manager,
        actor,
        AuditAction.CLINICAL_NOTE_ADDENDUM_ADDED,
        note,
        { newValues: { addendumId: addendum.id, content: addendum.content } },
      );
    });
    return this.reload(note.visitId, user);
  }

  // ---------- History ----------

  /** One page of the patient's notes (see `notesPage`), on its own. */
  async listForPatient(
    patientId: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<ClinicalNoteResponseDto>> {
    await this.access.assertCanAccessPatient(user, patientId);
    return this.notesPage(patientId, query, user);
  }

  /**
   * Medical info, one page of the patient's notes (see `notesPage`), and all
   * attachments.
   */
  async history(
    patientId: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<ClinicalHistoryDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    const notes = await this.notesPage(patientId, query, user);
    const attachments = await this.dataSource
      .getRepository(PatientAttachment)
      .find({
        where: { patientId },
        relations: { uploadedBy: true },
        order: { createdAt: 'DESC' },
      });

    return {
      medicalInfo: await this.medicalInfo.load(patientId),
      notes,
      attachments: attachments.map((a) =>
        toAttachment(a, (d) => this.time.toIso(d)),
      ),
    };
  }

  /**
   * The patient's notes (every doctor's, newest visit first, paginated) with
   * their addenda. Doctors get SIGNED notes only; the OWNER also gets the
   * DRAFTs (read-only, `status` tells). The caller checked access.
   */
  private async notesPage(
    patientId: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<ClinicalNoteResponseDto>> {
    const qb = this.noteQuery().where('note.patientId = :patientId', {
      patientId,
    });
    if (user.role !== UserRole.OWNER) {
      qb.andWhere('note.status = :signed', { signed: NoteStatus.SIGNED });
    }
    const [notes, total] = await qb
      .orderBy('visit.attendedAt', 'DESC')
      .addOrderBy('note.id', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();
    return toPaginated(await this.withDetails(notes), total, query);
  }

  /**
   * ACTIVE visits whose note is missing or still a DRAFT, oldest first.
   * A DOCTOR sees only their own; the OWNER all (optionally one doctor's).
   */
  async needsAttention(
    query: NeedsAttentionQueryDto,
    user: AuthenticatedUser,
  ): Promise<Paginated<NeedsAttentionEntryDto>> {
    const doctorId = (await this.doctors.scopeFor(user)) ?? query.doctorId;
    const qb = this.dataSource
      .getRepository(Visit)
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .innerJoinAndSelect('visit.service', 'service')
      .innerJoinAndSelect('visit.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser')
      .where('visit.status = :active', { active: VisitStatus.ACTIVE })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM clinical_notes signed WHERE signed.visit_id = visit.id AND signed.status = :signed)',
        { signed: NoteStatus.SIGNED },
      );
    if (doctorId) qb.andWhere('visit.doctorId = :doctorId', { doctorId });
    const [visits, total] = await qb
      .orderBy('visit.attendedAt', 'ASC')
      .addOrderBy('visit.id', 'ASC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    // Any note left on these visits is a DRAFT.
    const drafts = visits.length
      ? await this.dataSource.getRepository(ClinicalNote).find({
          where: { visitId: In(visits.map((v) => v.id)) },
          select: { visitId: true },
        })
      : [];
    const hasDraft = new Set(drafts.map((note) => note.visitId));
    return toPaginated(
      visits.map((visit) =>
        toNeedsAttentionEntry(
          visit,
          hasDraft.has(visit.id) ? NoteStatus.DRAFT : null,
          (d) => this.time.toIso(d),
        ),
      ),
      total,
      query,
    );
  }

  // ---------- Internals ----------

  // The visit, if the caller is its doctor (404 otherwise, also for others).
  private async ownVisit(
    visitId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<Visit> {
    const doctorId = await this.doctors.scopeFor(user);
    const visit = await manager.findOne(Visit, {
      where: { id: visitId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!visit || visit.doctorId !== doctorId) {
      throw new NotFoundException('Visit not found');
    }
    return visit;
  }

  // The caller's own visit and its note (null if none yet), both locked.
  private async lockOwnNote(
    visitId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<{ visit: Visit; note: ClinicalNote | null }> {
    const visit = await this.ownVisit(visitId, user, manager);
    const note = await manager.findOne(ClinicalNote, {
      where: { visitId },
      lock: { mode: 'pessimistic_write' },
    });
    return { visit, note };
  }

  /**
   * Writes the fields of the visit's type (DRAFT or SIGNED), creating the
   * DRAFT on the first save. Fields of other types are refused
   * (NOTE_FIELDS_NOT_IN_TYPE): they are read-only and keep their values, so
   * a type change never loses clinical data. The visit row lock (ownVisit)
   * serializes two first saves of the same note.
   */
  private async saveFields(
    manager: EntityManager,
    visit: Visit,
    existing: ClinicalNote | null,
    dto: ClinicalNoteInputDto,
    actor: Actor,
  ): Promise<ClinicalNote> {
    const type = await this.typeOf(visit, manager);
    const outside = fieldsOutsideType(type, dto);
    if (outside.length > 0) {
      throw unprocessable(
        ErrorCode.NOTE_FIELDS_NOT_IN_TYPE,
        `These fields are not part of a ${type} note and are read-only: ${outside.join(', ')}`,
        { type, fields: outside },
      );
    }
    const editable = noteFieldsFor(type);
    const repository = manager.getRepository(ClinicalNote);
    if (existing) {
      const before = { ...existing };
      for (const field of editable) setField(existing, field, dto[field]);
      const changes = diffValues(before, existing, editable);
      if (!changes) return existing;
      await repository.save(existing);
      await this.audit(
        manager,
        actor,
        AuditAction.CLINICAL_NOTE_UPDATED,
        existing,
        changes,
      );
      return existing;
    }

    // Any day after the visit, as long as it wasn't voided.
    if (visit.status !== VisitStatus.ACTIVE) {
      throw unprocessable(
        ErrorCode.NOTE_NOT_ALLOWED,
        'A note can only be written for an ACTIVE visit',
        { visitStatus: visit.status },
      );
    }
    const note = repository.create({
      visitId: visit.id,
      patientId: visit.patientId,
      doctorId: visit.doctorId,
      status: NoteStatus.DRAFT,
      signedAt: null,
    });
    for (const field of NOTE_FIELDS) {
      setField(note, field, editable.includes(field) ? dto[field] : null);
    }
    await repository.save(note);
    await this.audit(manager, actor, AuditAction.CLINICAL_NOTE_CREATED, note, {
      newValues: { visitId: visit.id, ...pickValues(note, NOTE_FIELDS) },
    });
    return note;
  }

  /**
   * The visit's type now: its appointment's, or its own for a walk-in. The
   * appointment row isn't locked (every appointment write locks the
   * appointment before the visit, so locking it here could deadlock); a type
   * changed meanwhile only moves which fields are editable, nothing is lost.
   */
  private async typeOf(
    visit: Visit,
    manager: EntityManager,
  ): Promise<AppointmentType | null> {
    if (visit.appointmentId === null) return visit.type;
    const appointment = await manager.findOneOrFail(Appointment, {
      where: { id: visit.appointmentId },
      select: { id: true, type: true },
    });
    return appointment.type;
  }

  // After a write by the caller: the note exists and they can see it.
  private async reload(
    visitId: string,
    user: AuthenticatedUser,
  ): Promise<ClinicalNoteResponseDto> {
    const note = await this.findForVisit(visitId, user);
    if (!note) throw new Error(`Visit ${visitId} has no note after a write`);
    return note;
  }

  private noteQuery() {
    return (
      this.dataSource
        .getRepository(ClinicalNote)
        .createQueryBuilder('note')
        .innerJoinAndSelect('note.visit', 'visit')
        .innerJoinAndSelect('visit.service', 'service')
        // The type (visitType): the appointment's, or the walk-in's own.
        .leftJoinAndSelect('visit.appointment', 'appointment')
        .innerJoinAndSelect('note.doctor', 'doctor')
        .innerJoinAndSelect('doctor.user', 'doctorUser')
    );
  }

  // Each note with its addenda (oldest first) and its visit's attachments
  // (newest first, as in the patient's attachment list).
  private async withDetails(
    notes: ClinicalNote[],
  ): Promise<ClinicalNoteResponseDto[]> {
    if (notes.length === 0) return [];
    const addenda = await this.dataSource
      .getRepository(ClinicalNoteAddendum)
      .find({
        where: { noteId: In(notes.map((n) => n.id)) },
        relations: { doctor: { user: true } },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    const attachments = await this.dataSource
      .getRepository(PatientAttachment)
      .find({
        where: { visitId: In(notes.map((n) => n.visitId)) },
        relations: { uploadedBy: true },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    return notes.map((note) =>
      toClinicalNote(
        note,
        addenda.filter((a) => a.noteId === note.id),
        attachments.filter((a) => a.visitId === note.visitId),
        (d) => this.time.toIso(d),
      ),
    );
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    note: ClinicalNote,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.CLINICAL_NOTE,
      note.id,
      values,
      manager,
    );
  }
}

/**
 * Reading a note (writing is separate: only the visit's doctor, by route and
 * ownVisit). A SIGNED note is visible to everyone with access to the
 * patient. A DRAFT is visible to its author and, read-only, to the OWNER;
 * other doctors get 404 until it is signed.
 */
function isVisibleTo(
  note: ClinicalNote,
  user: AuthenticatedUser,
  doctorId: string | null,
): boolean {
  return (
    note.status === NoteStatus.SIGNED ||
    user.role === UserRole.OWNER ||
    (doctorId !== null && note.doctorId === doctorId)
  );
}

function setField<K extends NoteField>(
  note: ClinicalNote,
  field: K,
  value: ClinicalNote[K] | undefined,
): void {
  note[field] = value ?? null;
}
