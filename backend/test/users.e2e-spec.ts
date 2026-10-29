import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import {
  bearer,
  createLoggedInUser,
  insertUser,
  login,
  TEST_PASSWORD,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

describe('Users & audit logs (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const newUser = (overrides: Record<string, unknown> = {}) => ({
    name: '  Sara   Mahmoud ',
    email: 'Sara@Clinic.COM',
    phone: '0111 234 5678',
    password: 'Sup3r-secret',
    role: 'RECEPTIONIST',
    ...overrides,
  });

  describe('POST /users', () => {
    it('creates a receptionist, normalizes input and never returns the hash', async () => {
      const res = await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send(newUser())
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Sara Mahmoud',
        email: 'sara@clinic.com',
        phone: '+201112345678',
        role: 'RECEPTIONIST',
        isActive: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'USER_CREATED', entityId: res.body.id });
      expect(log.userId).toBe(owner.id);
      expect(JSON.stringify(log.newValues)).not.toMatch(/password/i);

      await login(ctx.app, 'sara@clinic.com', 'Sup3r-secret');
    });

    it('refuses DOCTOR (doctors are created via /doctors)', async () => {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send(newUser({ role: 'DOCTOR' }))
        .expect(400);
    });

    it('returns 409 for a duplicate email, whatever the case', async () => {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send(newUser())
        .expect(201);
      const res = await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send(newUser({ email: 'SARA@clinic.com' }))
        .expect(409);
      expect(res.body.message).toBe('A user with this email already exists');
    });
  });

  describe('GET /users', () => {
    it('paginates and filters by role', async () => {
      for (let i = 0; i < 3; i++) {
        await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      }
      await insertUser(ctx.dataSource, UserRole.DOCTOR);

      const res = await request(server)
        .get('/api/v1/users?role=RECEPTIONIST&page=1&limit=2')
        .set('Authorization', bearer(owner))
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(
        (res.body.items as { role: string }[]).every(
          (u) => u.role === 'RECEPTIONIST',
        ),
      ).toBe(true);
    });

    it('rejects an invalid page size', async () => {
      await request(server)
        .get('/api/v1/users?limit=1000')
        .set('Authorization', bearer(owner))
        .expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates and audits only the changed fields', async () => {
      const target = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);

      await request(server)
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'New Name', email: target.email })
        .expect(200);

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'USER_UPDATED', entityId: target.id });
      expect(log.oldValues).toEqual({ name: target.name });
      expect(log.newValues).toEqual({ name: 'New Name' });
    });

    it('rejects null for required fields', async () => {
      const target = await insertUser(ctx.dataSource, UserRole.RECEPTIONIST);
      await request(server)
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', bearer(owner))
        .send({ name: null })
        .expect(400);
    });

    it('does not manage doctor accounts', async () => {
      const doctor = await insertUser(ctx.dataSource, UserRole.DOCTOR);
      await request(server)
        .patch(`/api/v1/users/${doctor.id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'X Y' })
        .expect(409);
    });

    it('cannot demote the last active OWNER', async () => {
      const res = await request(server)
        .patch(`/api/v1/users/${owner.id}`)
        .set('Authorization', bearer(owner))
        .send({ role: 'RECEPTIONIST' })
        .expect(409);
      expect(res.body.message).toBe('At least one active OWNER must remain');
    });
  });

  describe('activate / deactivate', () => {
    it('cannot deactivate yourself', async () => {
      await request(server)
        .patch(`/api/v1/users/${owner.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(400);
    });

    it('deactivation signs the user out and blocks login; activation restores it', async () => {
      const staff = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.RECEPTIONIST,
      );

      await request(server)
        .patch(`/api/v1/users/${staff.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200)
        .expect(({ body }) => expect(body.isActive).toBe(false));

      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(staff))
        .expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: staff.refreshToken })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: staff.email, password: TEST_PASSWORD })
        .expect(403);

      await request(server)
        .patch(`/api/v1/users/${staff.id}/activate`)
        .set('Authorization', bearer(owner))
        .expect(200);
      await login(ctx.app, staff.email);
    });

    it('two owners deactivating each other at once leave exactly one active owner', async () => {
      const other = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.OWNER,
      );

      const [a, b] = await Promise.all([
        request(server)
          .patch(`/api/v1/users/${other.id}/deactivate`)
          .set('Authorization', bearer(owner)),
        request(server)
          .patch(`/api/v1/users/${owner.id}/deactivate`)
          .set('Authorization', bearer(other)),
      ]);

      const statuses = [a.status, b.status].sort();
      // Either one wins and the other is refused (409), or the loser's token
      // is already invalid by the time its guard runs (401).
      expect(statuses[0]).toBe(200);
      expect([401, 409]).toContain(statuses[1]);

      const activeOwners = await ctx.dataSource
        .getRepository('User')
        .countBy({ role: UserRole.OWNER, isActive: true });
      expect(activeOwners).toBe(1);
    });
  });

  describe('POST /users/:id/reset-password', () => {
    it('sets the new password and revokes existing sessions', async () => {
      const staff = await createLoggedInUser(
        ctx.app,
        ctx.dataSource,
        UserRole.DOCTOR,
      );

      await request(server)
        .post(`/api/v1/users/${staff.id}/reset-password`)
        .set('Authorization', bearer(owner))
        .send({ newPassword: 'Brand-new-pass1' })
        .expect(204);

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: staff.refreshToken })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: staff.email, password: TEST_PASSWORD })
        .expect(401);
      await login(ctx.app, staff.email, 'Brand-new-pass1');
    });
  });

  describe('GET /audit-logs', () => {
    it('filters by entity and returns newest first', async () => {
      const created = await request(server)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send(newUser())
        .expect(201);
      await request(server)
        .patch(`/api/v1/users/${created.body.id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'Renamed Person' })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/audit-logs?entityType=USER&entityId=${created.body.id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      expect(res.body.meta.total).toBe(2);
      expect(res.body.items.map((l: { action: string }) => l.action)).toEqual([
        'USER_UPDATED',
        'USER_CREATED',
      ]);
      expect(res.body.items[0]).toMatchObject({
        userId: owner.id,
        oldValues: { name: 'Sara Mahmoud' },
        newValues: { name: 'Renamed Person' },
      });
    });

    it('filters by acting user and date range', async () => {
      const res = await request(server)
        .get(
          `/api/v1/audit-logs?userId=${owner.id}&from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z`,
        )
        .set('Authorization', bearer(owner))
        .expect(200);
      // The owner's own LOGIN from the beforeEach.
      expect(res.body.items.map((l: { action: string }) => l.action)).toEqual([
        'LOGIN',
      ]);
    });
  });
});
