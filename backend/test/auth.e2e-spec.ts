import { createHash } from 'node:crypto';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity.js';
import { insertUser, login, TEST_PASSWORD } from './utils/auth-helpers.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

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
        user: { id: user.id, email: user.email, role: 'RECEPTIONIST' },
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
    it('returns the current user', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.DOCTOR);
      const { accessToken } = await login(ctx.app, user.email);

      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: user.id, role: 'DOCTOR' });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('requires a valid token', async () => {
      await request(server).get('/api/v1/auth/me').expect(401);
      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('stops accepting the access token once the user is deactivated', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      const { accessToken } = await login(ctx.app, user.email);
      await ctx.dataSource
        .getRepository('User')
        .update(user.id, { isActive: false });

      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
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

    it('detects reuse of a revoked token and revokes every session of the user', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const sessionA = await login(ctx.app, user.email);
      const sessionB = await login(ctx.app, user.email);

      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionA.refreshToken })
        .expect(200);

      // Attacker replays the old token.
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionA.refreshToken })
        .expect(401);

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

describe('Login rate limiting (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    // e2e runs with throttling off; switch it on for this app instance only.
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(getOptionsToken()).useValue({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
      }),
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('allows 5 login attempts per minute per IP, then answers 429', async () => {
    const server = ctx.app.getHttpServer();
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: 'wrong-pass' })
        .expect(401);
    }
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'wrong-pass' })
      .expect(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
    });
  });
});
