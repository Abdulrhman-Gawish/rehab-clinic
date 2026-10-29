import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { UserRole } from '../../../common/enums/user-role.enum.js';

export const USER_EMAIL_UNIQUE = 'uq_users_email';

// Staff who log in (OWNER, DOCTOR, RECEPTIONIST). Never hard deleted.
@Entity('users')
@Unique(USER_EMAIL_UNIQUE, ['email'])
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Always stored lowercased.
  @Column({ type: 'varchar', length: 254 })
  email: string;

  // Normalized E.164.
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;
}
