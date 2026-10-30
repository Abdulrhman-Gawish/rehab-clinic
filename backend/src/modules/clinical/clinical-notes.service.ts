import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  toPaginated,
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
import { isUniqueViolation } from '../../common/utils/pg-errors.js';
import { diffValues, pickValues } from '../audit/audit-diff.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { NoteStatus } from './clinical.enums.js';
import { toAttachment, toClinicalNote } from './clinical.mapper.js';
import type {
  AddendumInputDto,
  ClinicalHistoryDto,
  ClinicalNoteInputDto,
  ClinicalNoteResponseDto,
} from './dto/clinical.dto.js';
import { ClinicalNoteAddendum } from './entities/clinical-note-addendum.entity.js';
import {
  CLINICAL_NOTE_VISIT_UNIQUE,
  ClinicalNote,
} from './entities/clinical-note.entity.js';
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

// Notes can be written once the session has started.
const WRITABLE_VISIT_STATUSES = [VisitStatus.IN_SESSION, VisitStatus.COMPLETED];

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

  async create(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const visit = await this.ownVisit(visitId, user, manager);
        if (!WRITABLE_VISIT_STATUSES.includes(visit.status)) {
          throw unprocessable(
            ErrorCode.NOTE_NOT_ALLOWED,
            'A note can only be written once the session has started (IN_SESSION or COMPLETED)',
            { visitStatus: visit.status },
          );
        }
        const repository = manager.getRepository(ClinicalNote);
        const note = repository.create({
          visitId: visit.id,
          patientId: visit.patientId,
          doctorId: visit.doctorId,
          status: NoteStatus.DRAFT,
          signedAt: null,
        });
        for (const field of NOTE_FIELDS) setField(note, field, dto[field]);
        await repository.save(note);
        await this.audit(
          manager,
          actor,
          AuditAction.CLINICAL_NOTE_CREATED,
          note,
          {
            newValues: { visitId, ...pickValues(note, NOTE_FIELDS) },
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, CLINICAL_NOTE_VISIT_UNIQUE)) {
        throw conflict(
          ErrorCode.NOTE_ALREADY_EXISTS,
          'This visit already has a note; edit it instead',
        );
      }
      throw error;
    }
    return this.findForVisit(visitId, user);
  }

  // DRAFT only; fields left out are unchanged, null clears a field.
  async update(
    visitId: string,
    dto: ClinicalNoteInputDto,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockOwnDraft(visitId, user, manager);
      const before = { ...note };
      for (const field of NOTE_FIELDS) {
        if (dto[field] !== undefined) setField(note, field, dto[field]);
      }
      const changes = diffValues(before, note, NOTE_FIELDS);
      if (!changes) return;
      await manager.getRepository(ClinicalNote).save(note);
      await this.audit(
        manager,
        actor,
        AuditAction.CLINICAL_NOTE_UPDATED,
        note,
        changes,
      );
    });
    return this.findForVisit(visitId, user);
  }

  // DRAFT -> SIGNED, locked forever. Needs an assessment or the treatment done.
  async sign(
    visitId: string,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<ClinicalNoteResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockOwnDraft(visitId, user, manager);
      if (!note.assessment && !note.treatmentDone) {
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
    return this.findForVisit(visitId, user);
  }

  /**
   * The visit's note. A DRAFT is visible only to its author; everyone else
   * with access to the patient sees it once SIGNED (404 before).
   */
  async findForVisit(
    visitId: string,
    user: AuthenticatedUser,
  ): Promise<ClinicalNoteResponseDto> {
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
    if (!note || !isVisibleTo(note, doctorId)) {
      throw new NotFoundException('This visit has no note');
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
    return this.findForVisit(note.visitId, user);
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
      .orderBy('visit.checkedInAt', 'DESC')
      .addOrderBy('note.id', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();
    const attachments = await this.dataSource
      .getRepository(PatientAttachment)
      .find({ where: { patientId }, order: { createdAt: 'DESC' } });

    return {
      medicalInfo: await this.medicalInfo.load(patientId),
      notes: toPaginated(await this.withAddenda(notes), total, query),
      attachments: attachments.map((a) =>
        toAttachment(a, (d) => this.time.toIso(d)),
      ),
    };
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

  // The caller's own note for the visit, locked, still a DRAFT.
  private async lockOwnDraft(
    visitId: string,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<ClinicalNote> {
    await this.ownVisit(visitId, user, manager);
    const note = await manager.findOne(ClinicalNote, {
      where: { visitId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!note) throw new NotFoundException('This visit has no note');
    if (note.status === NoteStatus.SIGNED) {
      throw unprocessable(
        ErrorCode.NOTE_SIGNED,
        'A signed note cannot change; add an addendum instead',
      );
    }
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
