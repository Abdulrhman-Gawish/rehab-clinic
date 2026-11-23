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

export const EMPLOYEE_USER_UNIQUE = 'uq_employees_user';

/**
 * A member of the clinic's staff paid a fixed monthly salary (OWNER only):
 * receptionist, office boy, accountant, assistant... An employee is not a
 * login: linking one to a user account is optional, and an account belongs
 * to at most one employee (never a DOCTOR's account: doctors are paid by
 * their own salary terms). Never deleted; is_active is only a status, the
 * salary versions decide what is owed.
 */
@Entity('employees')
@Index(EMPLOYEE_USER_UNIQUE, ['userId'], {
  unique: true,
  where: '"user_id" IS NOT NULL',
})
export class Employee extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Free text: "Receptionist", "Office boy", "Accountant"...
  @Column({ type: 'varchar', length: 80 })
  jobTitle: string;

  // Normalized +201XXXXXXXXX.
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // The login account of this employee, if they have one.
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ foreignKeyConstraintName: 'fk_employees_user' })
  user?: Relation<User> | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_employees_created_by',
  })
  createdBy?: Relation<User>;
}
