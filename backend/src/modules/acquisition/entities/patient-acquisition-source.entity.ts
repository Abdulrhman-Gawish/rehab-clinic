import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { AcquisitionChannel } from '../acquisition.enums.js';

export const SOURCE_PRIMARY_UNIQUE = 'uq_patient_acquisition_sources_primary';
export const SOURCE_CHANNEL_UNIQUE = 'uq_patient_acquisition_sources_channel';

/**
 * How the patient found the clinic, as told to reception. A patient can
 * have several channels; exactly one of the current ones is the primary
 * (the service keeps one whenever there is any). Removing keeps the row
 * (removed_*), so the history is never lost.
 */
@Entity('patient_acquisition_sources')
@Index(SOURCE_PRIMARY_UNIQUE, ['patientId'], {
  unique: true,
  where: '"is_primary" AND "removed_at" IS NULL',
})
@Index(SOURCE_CHANNEL_UNIQUE, ['patientId', 'channel'], {
  unique: true,
  where: '"removed_at" IS NULL',
})
@Check(
  'chk_patient_acquisition_sources_removed',
  `("removed_at" IS NULL AND "removed_by" IS NULL AND "removal_reason" IS NULL)
   OR ("removed_at" IS NOT NULL AND "removed_by" IS NOT NULL AND "removal_reason" IS NOT NULL AND NOT "is_primary")`,
)
export class PatientAcquisitionSource extends BaseEntity {
  @Column({ type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_patient_acquisition_sources_patient',
  })
  patient?: Relation<Patient>;

  @Column({
    type: 'enum',
    enum: AcquisitionChannel,
    enumName: 'acquisition_channel',
  })
  channel: AcquisitionChannel;

  // e.g. which ad, which friend, which website.
  @Column({ type: 'varchar', length: 255, nullable: true })
  details: string | null;

  @Column({ type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ type: 'uuid', name: 'recorded_by' })
  recordedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'recorded_by',
    foreignKeyConstraintName: 'fk_patient_acquisition_sources_recorded_by',
  })
  recordedBy?: Relation<User>;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'uuid', name: 'removed_by', nullable: true })
  removedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'removed_by',
    foreignKeyConstraintName: 'fk_patient_acquisition_sources_removed_by',
  })
  removedBy?: Relation<User> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  removalReason: string | null;
}
