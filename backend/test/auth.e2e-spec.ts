import { createHash } from 'node:crypto';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity.js';
import {
  accessCookie,
  bearer,
  createLoggedInUser,
  insertUser,
  login,
  refreshCookie,
  TEST_PASSWORD,
  tokensFrom,
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
    it('sets the tokens as HttpOnly cookies and returns the user without any password or token', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
        .expect(200);

      expect(res.body).toMatchObject({
        accessTokenExpiresIn: 900,
        refreshTokenExpiresAt: expect.any(String),
        user: {
          id: user.id,
          email: user.email,
          role: 'RECEPTIONIST',
          doctorId: null,
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const access = cookies.find((c) => c.startsWith('access_token='));
      const refresh = cookies.find((c) => c.startsWith('refresh_token='));
      for (const cookie of [access, refresh]) {
        expect(cookie).toMatch(/; HttpOnly/);
        expect(cookie).toMatch(/; Secure/);
        expect(cookie).toMatch(/; SameSite=Strict/);
      }
      expect(access).toMatch(/; Path=\/api\/v1;/);
      expect(access).toMatch(/; Max-Age=900;/);
      // The refresh token only travels to /auth (refresh, logout).
      expect(refresh).toMatch(/; Path=\/api\/v1\/auth;/);
      expect(refresh).toMatch(/; Expires=/);

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
      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      expect(loginRes.body.user.doctorId).toBe(doctor.id);

      const res = await request(server)
        .get('/api/v1/auth/me')
        .set(accessCookie(tokensFrom(loginRes).accessToken))
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
      await request(server)
        .get('/api/v1/auth/me')
        .set(accessCookie('not-a-jwt'))
        .expect(401);
    });

    it('ignores the access cookie without the X-Requested-With header (CSRF)', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { accessToken } = await login(ctx.app, user.email);

      await request(server)
        .get('/api/v1/auth/me')
        .set('Cookie', `access_token=${accessToken}`)
        .expect(401);
      await request(server)
        .patch('/api/v1/auth/me')
        .set('Cookie', `access_token=${accessToken}`)
        .send({ preferredLanguage: 'en' })
        .expect(401);
      await request(server)
        .get('/api/v1/auth/me')
        .set(accessCookie(accessToken))
        .expect(200);
    });
  });

  describe('language preference (PATCH /auth/me)', () => {
    const me = (token: string) =>
      request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    const setLanguage = (token: string, body: object) =>
      request(server)
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('is Arabic by default: users created by the API and existing rows', async () => {
      const owner = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.OWNER,
      );
      expect((await me(owner.accessToken)).body.preferredLanguage).toBe('ar');

      const created = await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send({
          name: 'New Receptionist',
          email: 'new.receptionist@test.local',
          password: TEST_PASSWORD,
          role: 'RECEPTIONIST',
        })
        .expect(201);
      expect(created.body.preferredLanguage).toBe('ar');

      // A row written without the column gets the database default.
      await ctx.dataSource.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Legacy', 'legacy@test.local', 'x', 'RECEPTIONIST')`,
      );
      const [legacy] = await ctx.dataSource.query(
        `SELECT preferred_language FROM users WHERE email = 'legacy@test.local'`,
      );
      expect(legacy.preferred_language).toBe('ar');
    });

    it('is saved on the account: another device gets it at login and from /auth/me', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      const laptop = await login(ctx.app, user.email);

      const res = await setLanguage(laptop.accessToken, {
        preferredLanguage: 'en',
      }).expect(200);
      expect(res.body).toMatchObject({
        id: user.id,
        preferredLanguage: 'en',
        doctorId: null,
      });
      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'USER_UPDATED', entityId: user.id });
      expect(log).toMatchObject({
        userId: user.id,
        oldValues: { preferredLanguage: 'ar' },
        newValues: { preferredLanguage: 'en' },
      });

      // A second device logs in later, and the first one refreshes.
      const phone = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      expect(phone.body.user.preferredLanguage).toBe('en');
      expect(
        (await me(tokensFrom(phone).accessToken)).body.preferredLanguage,
      ).toBe('en');
      const refreshed = await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(laptop.refreshToken))
        .expect(200);
      expect(
        (await me(tokensFrom(refreshed).accessToken)).body.preferredLanguage,
      ).toBe('en');

      // Logging out does not reset it.
      await request(server)
        .post('/api/v1/auth/logout')
        .set(refreshCookie(tokensFrom(phone).refreshToken))
        .expect(204);
      const again = await login(ctx.app, user.email);
      expect((await me(again.accessToken)).body.preferredLanguage).toBe('en');

      // Setting the same value again changes nothing (no audit entry).
      await setLanguage(again.accessToken, { preferredLanguage: 'en' }).expect(
        200,
      );
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'USER_UPDATED', entityId: user.id }),
      ).toBe(1);
    });

    it("only changes the caller's own account and only to a supported language", async () => {
      const owner = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.OWNER,
      );
      const other = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.DOCTOR,
      );

      const bad = await setLanguage(owner.accessToken, {
        preferredLanguage: 'fr',
      }).expect(400);
      expect(bad.body.details).toEqual([
        expect.objectContaining({
          field: 'preferredLanguage',
          constraints: ['isEnum'],
        }),
      ]);
      await setLanguage(owner.accessToken, {}).expect(400);
      // No way to name another user: unknown fields are rejected.
      for (const body of [
        { preferredLanguage: 'en', id: other.id },
        { preferredLanguage: 'en', userId: other.id },
        { preferredLanguage: 'en', role: 'OWNER' },
      ]) {
        await setLanguage(owner.accessToken, body).expect(400);
      }
      await setLanguage(owner.accessToken, { preferredLanguage: 'en' }).expect(
        200,
      );
      expect((await me(other.accessToken)).body.preferredLanguage).toBe('ar');
      expect((await me(owner.accessToken)).body).toMatchObject({
        role: 'OWNER',
        preferredLanguage: 'en',
      });

      await request(server)
        .patch('/api/v1/auth/me')
        .send({ preferredLanguage: 'en' })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates: sets a new pair of cookies and revokes the old refresh token', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const first = await login(ctx.app, user.email);

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(first.refreshToken))
        .expect(200);
      const next = tokensFrom(res);
      expect(next.refreshToken).not.toBe(first.refreshToken);
      expect(next.accessToken).not.toBe('');
      expect(res.body).toEqual({
        accessTokenExpiresIn: 900,
        refreshTokenExpiresAt: expect.any(String),
      });

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
        .set(accessCookie(next.accessToken))
        .expect(200);
    });

    it('needs the refresh cookie and the X-Requested-With header', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const { refreshToken } = await login(ctx.app, user.email);

      await request(server).post('/api/v1/auth/refresh').expect(401);
      // The old body field no longer counts.
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(refreshToken))
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
        .set(refreshCookie(refreshToken))
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
          request(server)
            .post('/api/v1/auth/refresh')
            .set(refreshCookie(refreshToken)),
        ),
      );
      const ok = responses.filter((r) => r.status === 200);
      const raced = responses.filter((r) => r.status === 401);
      expect(ok).toHaveLength(1);
      expect(raced).toHaveLength(2);
      for (const r of raced) expect(r.body.code).toBe('REFRESH_RACE');

      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(tokensFrom(ok[0]).refreshToken))
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
        .set(refreshCookie(first.refreshToken))
        .expect(200);

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(first.refreshToken))
        .expect(401);
      expect(res.body.code).toBe('REFRESH_RACE');

      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(tokensFrom(rotated).refreshToken))
        .expect(200);
    });

    it('detects reuse of a token rotated outside the grace window and revokes every session of the user', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.OWNER);
      const sessionA = await login(ctx.app, user.email);
      const sessionB = await login(ctx.app, user.email);

      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(sessionA.refreshToken))
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
        .set(refreshCookie(sessionA.refreshToken))
        .expect(401);
      expect(replay.body.code).toBeUndefined();

      // Both the rotated token and the other session are now dead.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(tokensFrom(rotated).refreshToken))
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(sessionB.refreshToken))
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
        .set(refreshCookie('x'.repeat(64)))
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
        .set(refreshCookie(refreshToken))
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token, clears both cookies and is idempotent', async () => {
      const user = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      const { refreshToken } = await login(ctx.app, user.email);

      const res = await request(server)
        .post('/api/v1/auth/logout')
        .set(refreshCookie(refreshToken))
        .expect(204);
      const cleared = res.headers['set-cookie'] as unknown as string[];
      expect(cleared).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^access_token=;.*Path=\/api\/v1;.*Expires=Thu, 01 Jan 1970/,
          ),
          expect.stringMatching(
            /^refresh_token=;.*Path=\/api\/v1\/auth;.*Expires=Thu, 01 Jan 1970/,
          ),
        ]),
      );
      await request(server)
        .post('/api/v1/auth/logout')
        .set(refreshCookie(refreshToken))
        .expect(204);
      // No cookie at all: still 204 (already logged out).
      await request(server).post('/api/v1/auth/logout').expect(204);

      await request(server)
        .post('/api/v1/auth/refresh')
        .set(refreshCookie(refreshToken))
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
