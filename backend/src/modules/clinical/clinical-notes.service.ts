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
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { NoteStatus } from './clinical.enums.js';
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

const NOTE_FIELDS = [
  'chiefComplaint',
  'assessment',
  'treatmentDone',
  'progress',
  'plan',
  'painScore',
] as const satisfies readonly (keyof ClinicalNote)[];

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
   * Creates the DRAFT or replaces its fields (PUT: a field left out becomes
   * null). Only the visit's doctor; ACTIVE visits only, any day after.
   */
  async saveDraft(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction((manager) =>
      this.upsertDraft(manager, visitId, dto, user, actor),
    );
    return this.reload(visitId, user);
  }

  /**
   * DRAFT -> SIGNED, locked forever. Needs an assessment or the treatment
   * done. Fields sent with it are saved first (like PUT), in the same
   * transaction: save and sign in one call.
   */
  async sign(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const withFields = NOTE_FIELDS.some((field) => dto[field] !== undefined);
      const note = withFields
        ? await this.upsertDraft(manager, visitId, dto, user, actor)
        : await this.lockOwnDraft(visitId, user, manager);
      if (!note?.assessment && !note?.treatmentDone) {
        throw unprocessable(
          ErrorCode.NOTE_INCOMPLETE,
          'Fill in the assessment or the treatment done before signing',
        );
      }
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
   * The visit's note, or null when it has none yet. A DRAFT is visible only
   * to its author; anyone else with access gets 404 NOTE_NOT_VISIBLE until
   * it is signed.
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
    if (!isVisibleTo(note, doctorId)) {
      throw notFound(
        ErrorCode.NOTE_NOT_VISIBLE,
        "This visit's note is another doctor's draft",
      );
    }
    return (await this.withAddenda([note]))[0];
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
    if (!isVisibleTo(note, doctorId)) {
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

  /**
   * Medical info, the patient's SIGNED notes (every doctor's, newest visit
   * first, paginated) with their addenda, and all attachments.
   */
  async history(
    patientId: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<ClinicalHistoryDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    const [notes, total] = await this.noteQuery()
      .where('note.patientId = :patientId', { patientId })
      .andWhere('note.status = :signed', { signed: NoteStatus.SIGNED })
      .orderBy('visit.attendedAt', 'DESC')
      .addOrderBy('note.id', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();
    const attachments = await this.dataSource
      .getRepository(PatientAttachment)
      .find({
        where: { patientId },
        relations: { uploadedBy: true },
        order: { createdAt: 'DESC' },
      });

    return {
      medicalInfo: await this.medicalInfo.load(patientId),
      notes: toPaginated(await this.withAddenda(notes), total, query),
      attachments: attachments.map((a) =>
        toAttachment(a, (d) => this.time.toIso(d)),
      ),
    };
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

  // The caller's own note for the visit (null if none yet), locked, still a
  // DRAFT.
  private async lockOwnDraft(
    visitId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<ClinicalNote | null> {
    await this.ownVisit(visitId, user, manager);
    const note = await manager.findOne(ClinicalNote, {
      where: { visitId },
      lock: { mode: 'pessimistic_write' },
    });
    if (note?.status === NoteStatus.SIGNED) {
      throw unprocessable(
        ErrorCode.NOTE_SIGNED,
        'A signed note cannot change; add an addendum instead',
      );
    }
    return note;
  }

  /**
   * The draft written by the visit's doctor, created on the first save. The
   * visit row lock (ownVisit) serializes two first saves of the same note.
   */
  private async upsertDraft(
    manager: EntityManager,
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNote> {
    const existing = await this.lockOwnDraft(visitId, user, manager);
    const repository = manager.getRepository(ClinicalNote);
    if (existing) {
      const before = { ...existing };
      for (const field of NOTE_FIELDS) setField(existing, field, dto[field]);
      const changes = diffValues(before, existing, NOTE_FIELDS);
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

    // Locked by lockOwnDraft above.
    const visit = await manager.findOneByOrFail(Visit, { id: visitId });
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
    for (const field of NOTE_FIELDS) setField(note, field, dto[field]);
    await repository.save(note);
    await this.audit(manager, actor, AuditAction.CLINICAL_NOTE_CREATED, note, {
      newValues: { visitId, ...pickValues(note, NOTE_FIELDS) },
    });
    return note;
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
    return this.dataSource
      .getRepository(ClinicalNote)
      .createQueryBuilder('note')
      .innerJoinAndSelect('note.visit', 'visit')
      .innerJoinAndSelect('visit.service', 'service')
      .innerJoinAndSelect('note.doctor', 'doctor')
      .innerJoinAndSelect('doctor.user', 'doctorUser');
  }

  private async withAddenda(
    notes: ClinicalNote[],
  ): Promise<ClinicalNoteResponseDto[]> {
    const addenda = notes.length
      ? await this.dataSource.getRepository(ClinicalNoteAddendum).find({
          where: { noteId: In(notes.map((n) => n.id)) },
          relations: { doctor: { user: true } },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    return notes.map((note) =>
      toClinicalNote(
        note,
        addenda.filter((a) => a.noteId === note.id),
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

// A DRAFT is visible only to its author (doctorId null = OWNER).
function isVisibleTo(note: ClinicalNote, doctorId: string | null): boolean {
  return note.status === NoteStatus.SIGNED || note.doctorId === doctorId;
}

function setField<K extends (typeof NOTE_FIELDS)[number]>(
  note: ClinicalNote,
  field: K,
  value: ClinicalNote[K] | undefined,
): void {
  note[field] = value ?? null;
}
