import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { Visit } from '../../visits/entities/visit.entity.js';
import { NoteStatus } from '../clinical.enums.js';

export const CLINICAL_NOTE_VISIT_UNIQUE = 'uq_clinical_notes_visit';

/**
 * What the doctor recorded for one visit (at most one note per visit). Only
 * the visit's doctor writes it. A SIGNED note never changes again: later
 * additions are ClinicalNoteAddendum rows.
 */
@Entity('clinical_notes')
@Unique(CLINICAL_NOTE_VISIT_UNIQUE, ['visitId'])
@Index('idx_clinical_notes_patient_status', ['patientId', 'status'])
@Check(
  'chk_clinical_notes_pain_score',
  `"pain_score" IS NULL OR "pain_score" BETWEEN 0 AND 10`,
)
@Check(
  'chk_clinical_notes_signed',
  `"status" <> 'SIGNED' OR "signed_at" IS NOT NULL`,
)
export class ClinicalNote extends BaseEntity {
  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_clinical_notes_visit' })
  visit?: Relation<Visit>;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_clinical_notes_patient' })
  patient?: Relation<Patient>;

  // The author: always the visit's doctor.
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_clinical_notes_doctor' })
  doctor?: Relation<Doctor>;

  @Column({ type: 'text', nullable: true })
  chiefComplaint: string | null;

  @Column({ type: 'text', nullable: true })
  assessment: string | null;

  @Column({ type: 'text', nullable: true })
  treatmentDone: string | null;

  @Column({ type: 'text', nullable: true })
  progress: string | null;

  // Next steps and home exercises.
  @Column({ type: 'text', nullable: true })
  plan: string | null;

  @Column({ type: 'smallint', nullable: true })
  painScore: number | null;

  @Column({ type: 'enum', enum: NoteStatus, enumName: 'note_status' })
  status: NoteStatus;

  @Column({ type: 'timestamptz', nullable: true })
  signedAt: Date | null;
}
