import { createHash } from 'node:crypto';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity.js';
import {
  bearer,
  createLoggedInUser,
  insertUser,
  login,
  TEST_PASSWORD,
  type TestUser,
} from './utils/auth-helpers.js';
import { insertDoctor } from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const sha256 = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('Auth (e2e)', () => {
  let ctx: TestApp;
  let server: App;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /auth/login', () => {
    it('returns tokens and the user without any password field', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
        .expect(200);

      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        accessToken: expect.any(String),
        accessTokenExpiresIn: 900,
        refreshToken: expect.any(String),
        user: {
          id: user.id,
          email: user.email,
          role: 'RECEPTIONIST',
          doctorId: null,
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'LOGIN', userId: user.id });
      expect(log.entityId).toBe(user.id);
    });

    it('stores only the SHA-256 of the refresh token', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { refreshToken } = await login(ctx.app, user.email);

      const stored = await ctx.dataSource
        .getRepository(RefreshToken)
        .findOneByOrFail({ userId: user.id });
      expect(stored.tokenHash).toBe(
        createHash('sha256').update(refreshToken).digest('hex'),
      );
      expect(stored.tokenHash).not.toBe(refreshToken);
    });

    it('rejects a wrong password with 401 and audits the failure', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'LOGIN_FAILED' });
      expect(log).toMatchObject({
        userId: null,
        entityId: user.id,
        newValues: { email: user.email, reason: 'INVALID_CREDENTIALS' },
      });
    });

    it('gives the same answer for an unknown email', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: 'whatever-123' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects inactive users', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST, {
        isActive: false,
      });

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);
    });

    it('validates the body', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'x', extra: true })
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user; a doctor also gets their doctorId (login too)', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.DOCTOR);
      const doctor = await insertDoctor(ctx.dataSource, { userId: user.id });
      const { accessToken, user: loggedIn } = (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: TEST_PASSWORD })
          .expect(200)
      ).body as { accessToken: string; user: { doctorId: string } };
      expect(loggedIn.doctorId).toBe(doctor.id);

      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: user.id,
        role: 'DOCTOR',
        doctorId: doctor.id,
      });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('requires a valid token', async () => {
      await request(server).get('/api/v1/auth/me').expect(401);
      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates: returns a new pair and revokes the old refresh token', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const first = await login(ctx.app, user.email);

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      expect(res.body.accessToken).toEqual(expect.any(String));

      const tokens = ctx.dataSource.getRepository(RefreshToken);
      const old = await tokens.findOneByOrFail({
        tokenHash: createHash('sha256')
          .update(first.refreshToken)
          .digest('hex'),
      });
      expect(old.revokedAt).not.toBeNull();
      const replacement = await tokens.findOneByOrFail({
        id: old.replacedById ?? '',
      });
      expect(replacement.revokedAt).toBeNull();

      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('sliding expiry: every refresh returns a token valid for 7 more days', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { refreshToken } = await login(ctx.app, user.email);
      // Unused for almost 7 days: one minute left.
      await ctx.dataSource
        .getRepository(RefreshToken)
        .update(
          { userId: user.id },
          { expiresAt: new Date(Date.now() + 60_000) },
        );

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      const expiresIn =
        new Date(res.body.refreshTokenExpiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(7 * DAY_MS - 60_000);
      expect(expiresIn).toBeLessThanOrEqual(7 * DAY_MS);
    });

    it('parallel refreshes with the same token: one rotates, the others get REFRESH_RACE and the session survives', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { refreshToken } = await login(ctx.app, user.email);

      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          request(server).post('/api/v1/auth/refresh').send({ refreshToken }),
        ),
      );
      const ok = responses.filter((r) => r.status === 200);
      const raced = responses.filter((r) => r.status === 401);
      expect(ok).toHaveLength(1);
      expect(raced).toHaveLength(2);
      for (const r of raced) expect(r.body.code).toBe('REFRESH_RACE');

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: ok[0].body.refreshToken })
        .expect(200);
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'REFRESH_TOKEN_REUSE_DETECTED' }),
      ).toBe(0);
    });

    it('reusing a token rotated inside the grace window answers REFRESH_RACE without revoking', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const first = await login(ctx.app, user.email);
      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(res.body.code).toBe('REFRESH_RACE');

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(200);
    });

    it('detects reuse of a token rotated outside the grace window and revokes every session of the user', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const sessionA = await login(ctx.app, user.email);
      const sessionB = await login(ctx.app, user.email);

      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionA.refreshToken })
        .expect(200);
      await ctx.dataSource
        .getRepository(RefreshToken)
        .update(
          { tokenHash: sha256(sessionA.refreshToken) },
          { revokedAt: new Date(Date.now() - 31_000) },
        );

      // Attacker replays the old token.
      const replay = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionA.refreshToken })
        .expect(401);
      expect(replay.body.code).toBeUndefined();

      // Both the rotated token and the other session are now dead.
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionB.refreshToken })
        .expect(401);

      const active = await ctx.dataSource
        .getRepository(RefreshToken)
        .createQueryBuilder('t')
        .where('t.userId = :id AND t.revokedAt IS NULL', { id: user.id })
        .getCount();
      expect(active).toBe(0);

      await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        userId: user.id,
      });
    });

    it('rejects unknown and expired tokens', async () => {
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'x'.repeat(64) })
        .expect(401);

      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { refreshToken } = await login(ctx.app, user.email);
      await ctx.dataSource
        .getRepository(RefreshToken)
        .update(
          { userId: user.id },
          { expiresAt: new Date(Date.now() - 1000) },
        );

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token and is idempotent', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      const { refreshToken } = await login(ctx.app, user.email);

      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);
      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      const logouts = await ctx.dataSource
        .getRepository(AuditLog)
        .countBy({ action: 'LOGOUT', userId: user.id });
      expect(logouts).toBe(1);
    });
  });
});

describe('Rate limiting (e2e)', () => {
  let ctx: TestApp;
  let server: App;

  beforeAll(async () => {
    // e2e runs with throttling off; switch it on for this app instance only,
    // with a small default limit (login keeps its own 5/min).
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(getOptionsToken()).useValue({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 3 }],
      }),
    );
    server = ctx.app.getHttpServer();
    await resetDatabase(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const tryLogin = (email: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-pass' });

  it('login: 5 attempts per minute per email + IP, then 429; another email from the same IP still works', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await tryLogin('typo@test.local').expect(401);
    }
    const res = await tryLogin('typo@test.local').expect(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
    });
    // Same email in another case/spacing is the same account.
    await tryLogin(' TYPO@test.local ').expect(429);
    await tryLogin('colleague@test.local').expect(401);
  });

  it('authenticated routes count per user, not per IP', async () => {
    const [first, second] = await Promise.all([
      createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER),
      createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER),
    ]);
    const me = (user: TestUser) =>
      request(server).get('/api/v1/auth/me').set('Authorization', bearer(user));

    for (let i = 0; i < 3; i++) await me(first).expect(200);
    await me(first).expect(429);
    // Same IP (the whole clinic behind one router), different user.
    await me(second).expect(200);
  });

  it('public routes count per IP (public reads: 30/min)', async () => {
    for (let i = 0; i < 30; i++) {
      await request(server).get('/api/v1/public/services').expect(200);
    }
    await request(server).get('/api/v1/public/services').expect(429);
  });
});
