import Joi from 'joi';
import type { DataSource } from 'typeorm';
import { validateWith } from '../../config/env.validation.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { hashPassword } from '../../common/utils/password.util.js';
import {
  AuditAction,
  AuditEntityType,
} from '../../modules/audit/audit.constants.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity.js';
import { User } from '../../modules/users/entities/user.entity.js';

interface SeedOwnerEnv {
  SEED_OWNER_NAME: string;
  SEED_OWNER_EMAIL: string;
  SEED_OWNER_PASSWORD: string;
}

const seedOwnerSchema = Joi.object<SeedOwnerEnv>({
  SEED_OWNER_NAME: Joi.string().trim().min(2).max(120).required(),
  SEED_OWNER_EMAIL: Joi.string().trim().lowercase().email().required(),
  SEED_OWNER_PASSWORD: Joi.string().min(8).max(128).required(),
});

/**
 * Creates the first OWNER from SEED_OWNER_* env vars. Idempotent: does
 * nothing if a user with that email already exists.
 */
export async function seedOwner(dataSource: DataSource): Promise<void> {
  const env = validateWith(seedOwnerSchema, process.env);

  await dataSource.transaction(async (manager) => {
    const users = manager.getRepository(User);
    const existing = await users.findOneBy({ email: env.SEED_OWNER_EMAIL });
    if (existing) {
      console.log(
        `Owner seed skipped: ${env.SEED_OWNER_EMAIL} already exists (role ${existing.role}).`,
      );
      return;
    }

    const owner = await users.save(
      users.create({
        name: env.SEED_OWNER_NAME,
        email: env.SEED_OWNER_EMAIL,
        phone: null,
        passwordHash: await hashPassword(env.SEED_OWNER_PASSWORD),
        role: UserRole.OWNER,
        isActive: true,
        lastLoginAt: null,
      }),
    );
    // userId null = system action.
    await manager.getRepository(AuditLog).save(
      AuditService.toEntity({
        userId: null,
        action: AuditAction.USER_CREATED,
        entityType: AuditEntityType.USER,
        entityId: owner.id,
        newValues: {
          name: owner.name,
          email: owner.email,
          role: owner.role,
          source: 'seed',
        },
      }),
    );
    console.log(`Owner ${owner.email} created.`);
  });
}
