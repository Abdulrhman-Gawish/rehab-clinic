import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';

export const REFERRING_DOCTOR_PHONE_UNIQUE = 'uq_referring_doctors_phone';

/**
 * A doctor outside the clinic who sends patients to it. Not a staff doctor
 * (`doctors`): no login, never bookable. Deactivating stops new referrals;
 * patients already referred keep their terms until they are ended.
 */
@Entity('referring_doctors')
@Index(REFERRING_DOCTOR_PHONE_UNIQUE, ['phone'], {
  unique: true,
  where: '"phone" IS NOT NULL',
})
export class ReferringDoctor extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Normalized +201XXXXXXXXX; unique so one doctor isn't entered twice.
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  specialty: string | null;

  // Hospital or clinic where the doctor works.
  @Column({ type: 'varchar', length: 200, nullable: true })
  workplace: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_referring_doctors_created_by',
  })
  createdBy?: Relation<User>;
}
