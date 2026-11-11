import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';

// One row per patient, created on the first save. Any doctor with access to
// the patient keeps it up to date; every change is audited.
@Entity('patient_medical_info')
export class PatientMedicalInfo {
  @PrimaryColumn({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_patient_medical_info_patient' })
  patient?: Relation<Patient>;

  @Column({ type: 'text', nullable: true })
  allergies: string | null;

  @Column({ type: 'text', nullable: true })
  chronicConditions: string | null;

  @Column({ type: 'text', nullable: true })
  pastSurgeries: string | null;

  @Column({ type: 'text', nullable: true })
  currentMedications: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', name: 'updated_by' })
  updatedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_patient_medical_info_updated_by',
  })
  updatedBy?: Relation<User>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
