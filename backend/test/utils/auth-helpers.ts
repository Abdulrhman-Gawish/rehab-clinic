import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { UserRole } from '../../src/common/enums/user-role.enum.js';
import { hashPassword } from '../../src/common/utils/password.util.js';
import { User } from '../../src/modules/users/entities/user.entity.js';

export const TEST_PASSWORD = 'Test-passw0rd!';

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

let cachedHash: Promise<string> | undefined;

// Inserts a user straight into the DB (bypassing the API) for test setup.
export async function insertUser(
  dataSource: DataSource,
  role: UserRole,
  overrides: Partial<Pick<User, 'name' | 'email' | 'isActive'>> = {},
): Promise<User> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  const repository = dataSource.getRepository(User);
  return repository.save(
    repository.create({
      name: `${role} ${randomUUID().slice(0, 6)}`,
      email: `${role.toLowerCase()}-${randomUUID()}@test.local`,
      phone: null,
      passwordHash: await cachedHash,
      role,
      isActive: true,
      lastLoginAt: null,
      ...overrides,
    }),
  );
}

export async function login(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body as { accessToken: string; refreshToken: string };
}

export async function createLoggedInUser(
  app: INestApplication,
  dataSource: DataSource,
  role: UserRole,
): Promise<TestUser> {
  const user = await insertUser(dataSource, role);
  const tokens = await login(app, user.email);
  return { id: user.id, email: user.email, role, ...tokens };
}

export const bearer = (user: Pick<TestUser, 'accessToken'>) =>
  `Bearer ${user.accessToken}`;
