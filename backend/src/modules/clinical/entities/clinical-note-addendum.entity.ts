import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Doctor } from '../../doctors/entities/doctor.entity.js';
import { ClinicalNote } from './clinical-note.entity.js';

// Text added to a SIGNED note by any doctor with access to the patient.
// Never edited or deleted (no updated_at on purpose).
@Entity('clinical_note_addenda')
@Index('idx_clinical_note_addenda_note', ['noteId'])
export class ClinicalNoteAddendum {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  noteId: string;

  @ManyToOne(() => ClinicalNote, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_clinical_note_addenda_note' })
  note?: Relation<ClinicalNote>;

  // The author of the addendum (may differ from the note's author).
  @Column({ type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_clinical_note_addenda_doctor' })
  doctor?: Relation<Doctor>;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
