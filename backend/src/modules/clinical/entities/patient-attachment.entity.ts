import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { Visit } from '../../visits/entities/visit.entity.js';

// An X-ray, report or lab result. The file lives in FileStorage under
// file_key and is only ever streamed to authorized users.
@Entity('patient_attachments')
@Index('idx_patient_attachments_patient_created', ['patientId', 'createdAt'])
@Check('chk_patient_attachments_size_positive', '"size_bytes" > 0')
export class PatientAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_attachments_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  @ManyToOne(() => Visit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_attachments_visit' })
  visit?: Relation<Visit> | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  fileKey: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'uuid', name: 'uploaded_by' })
  uploadedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'uploaded_by',
    foreignKeyConstraintName: 'fk_patient_attachments_uploaded_by',
  })
  uploadedBy?: Relation<User>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
