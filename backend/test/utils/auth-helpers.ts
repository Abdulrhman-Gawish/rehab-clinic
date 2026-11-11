import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

export interface CookieTokens {
  accessToken: string;
  refreshToken: string;
}

// The token cookies a login/refresh response sets (they are Secure, so
// supertest's agent would not resend them over http: tests send them by hand).
export function tokensFrom(res: {
  headers: Record<string, unknown>;
}): CookieTokens {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const value = (name: string) =>
    cookies
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0]
      .slice(name.length + 1) ?? '';
  return {
    accessToken: value('access_token'),
    refreshToken: value('refresh_token'),
  };
}

// Headers a browser sends with the cookies (X-Requested-With is the CSRF guard).
export const accessCookie = (token: string) => ({
  Cookie: `access_token=${token}`,
  'X-Requested-With': 'XMLHttpRequest',
});
export const refreshCookie = (token: string) => ({
  Cookie: `refresh_token=${token}`,
  'X-Requested-With': 'XMLHttpRequest',
});

export async function login(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<CookieTokens> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return tokensFrom(res);
}

// An access token for an existing user, signed like AuthService does. Skips
// the HTTP login (argon2 + refresh token): real login is covered by
// auth.e2e-spec.ts. Use login() when a test needs a refresh token.
export function accessTokenFor(
  app: INestApplication,
  user: Pick<User, 'id' | 'role'>,
): string {
  return app.get(JwtService).sign({ sub: user.id, role: user.role });
}

export async function createLoggedInUser(
  app: INestApplication,
  dataSource: DataSource,
  role: UserRole,
): Promise<TestUser> {
  const user = await insertUser(dataSource, role);
  return {
    id: user.id,
    email: user.email,
    role,
    accessToken: accessTokenFor(app, user),
  };
}

export const bearer = (user: Pick<TestUser, 'accessToken'>) =>
  `Bearer ${user.accessToken}`;
