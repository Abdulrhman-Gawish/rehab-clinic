import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditAction } from '../src/modules/audit/audit.constants.js';
import {
  AuditService,
  type AuditEntry,
} from '../src/modules/audit/audit.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import {
  bearer,
  createLoggedInUser,
  login,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

const PUBLIC_DOCTOR_KEYS = [
  'bio',
  'id',
  'name',
  'photoUrl',
  'services',
  'specialty',
];
const PUBLIC_DOCTOR_SERVICE_KEYS = [
  'description',
  'durationMinutes',
  'id',
  'name',
  'price',
];
const PUBLIC_SERVICE_KEYS = [
  'basePrice',
  'description',
  'durationMinutes',
  'id',
  'name',
];

describe('Doctors & clinic services (e2e)', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const doctorBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Dr. Mona Adel',
    email: 'Mona@Clinic.com',
    phone: '01012345678',
    password: 'Doct0r-pass',
    specialty: 'Sports physiotherapy',
    bio: 'Ten years of experience.',
    photoUrl: 'https://cdn.clinic.com/mona.jpg',
    ...overrides,
  });

  const createDoctor = (overrides: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/doctors')
      .set('Authorization', bearer(owner))
      .send(doctorBody(overrides));

  const createService = (overrides: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/clinic-services')
      .set('Authorization', bearer(owner))
      .send({
        name: 'Physiotherapy session',
        durationMinutes: 45,
        basePrice: '350',
        ...overrides,
      })
      .expect(201);

  describe('POST /doctors', () => {
    it('creates the DOCTOR user and the profile, both audited, and the doctor can log in', async () => {
      const res = await createDoctor().expect(201);

      expect(res.body).toMatchObject({
        name: 'Dr. Mona Adel',
        email: 'mona@clinic.com',
        phone: '+201012345678',
        specialty: 'Sports physiotherapy',
        isPublic: true,
        isActive: true,
        services: [],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const user = await ctx.dataSource
        .getRepository(User)
        .findOneByOrFail({ id: res.body.userId });
      expect(user.role).toBe(UserRole.DOCTOR);

      const actions = (
        await ctx.dataSource
          .getRepository(AuditLog)
          .find({ where: { userId: owner.id }, order: { createdAt: 'ASC' } })
      ).map((log) => log.action);
      expect(actions).toEqual(
        expect.arrayContaining(['USER_CREATED', 'DOCTOR_CREATED']),
      );

      const tokens = await login(ctx.app, 'mona@clinic.com', 'Doct0r-pass');
      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.role).toBe('DOCTOR'));
    });

    it('rolls back the user row when the profile step fails', async () => {
      const audit = ctx.app.get(AuditService);
      const original = audit.log.bind(audit);
      vi.spyOn(audit, 'log').mockImplementation(
        (entry: AuditEntry, manager) => {
          if (entry.action === AuditAction.DOCTOR_CREATED) {
            return Promise.reject(new Error('simulated failure'));
          }
          return original(entry, manager);
        },
      );

      await createDoctor().expect(500);

      expect(
        await ctx.dataSource
          .getRepository(User)
          .countBy({ email: 'mona@clinic.com' }),
      ).toBe(0);
      expect(await ctx.dataSource.getRepository(Doctor).count()).toBe(0);
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'USER_CREATED' }),
      ).toBe(0);
    });

    it('returns 409 on a duplicate email and creates nothing', async () => {
      await createDoctor().expect(201);
      await createDoctor({ email: 'MONA@clinic.com' }).expect(409);
      expect(await ctx.dataSource.getRepository(Doctor).count()).toBe(1);
    });

    it('rejects non-https photo URLs', async () => {
      await createDoctor({ photoUrl: 'javascript:alert(1)' }).expect(400);
    });
  });

  describe('managing doctors', () => {
    it('updates profile + account fields together and audits them', async () => {
      const { body: doctor } = await createDoctor().expect(201);

      const res = await request(server)
        .patch(`/api/v1/doctors/${doctor.id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'Dr. Mona A.', specialty: 'Neuro rehab', bio: null })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Dr. Mona A.',
        specialty: 'Neuro rehab',
        bio: null,
      });

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'DOCTOR_UPDATED', entityId: doctor.id });
      expect(log.oldValues).toEqual({
        name: 'Dr. Mona Adel',
        specialty: 'Sports physiotherapy',
        bio: 'Ten years of experience.',
      });
    });

    it('deactivation disables the login and hides the doctor publicly; activation restores', async () => {
      const { body: doctor } = await createDoctor().expect(201);
      const tokens = await login(ctx.app, 'mona@clinic.com', 'Doct0r-pass');

      await request(server)
        .patch(`/api/v1/doctors/${doctor.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200)
        .expect(({ body }) => expect(body.isActive).toBe(false));

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'mona@clinic.com', password: 'Doct0r-pass' })
        .expect(403);
      await request(server)
        .get(`/api/v1/public/doctors/${doctor.id}`)
        .expect(404);

      await request(server)
        .patch(`/api/v1/doctors/${doctor.id}/activate`)
        .set('Authorization', bearer(owner))
        .expect(200);
      await login(ctx.app, 'mona@clinic.com', 'Doct0r-pass');
      await request(server)
        .get(`/api/v1/public/doctors/${doctor.id}`)
        .expect(200);
    });

    it('assigns services with an optional price override, and unassigns them', async () => {
      const { body: doctor } = await createDoctor().expect(201);
      const { body: service } = await createService();
      expect(service.basePrice).toBe('350.00');

      const assigned = await request(server)
        .put(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({ priceOverride: '400.5' })
        .expect(200);
      expect(assigned.body.services).toEqual([
        {
          serviceId: service.id,
          name: 'Physiotherapy session',
          durationMinutes: 45,
          basePrice: '350.00',
          priceOverride: '400.50',
          price: '400.50',
          isActive: true,
        },
      ]);

      // Clearing the override falls back to the base price.
      const cleared = await request(server)
        .put(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({ priceOverride: null })
        .expect(200);
      expect(cleared.body.services[0]).toMatchObject({
        priceOverride: null,
        price: '350.00',
      });

      await request(server)
        .delete(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .expect(204);
      await request(server)
        .delete(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);

      const actions = (
        await ctx.dataSource
          .getRepository(AuditLog)
          .find({ where: { entityId: doctor.id }, order: { createdAt: 'ASC' } })
      ).map((log) => log.action);
      expect(actions).toEqual([
        'DOCTOR_CREATED',
        'DOCTOR_SERVICE_ASSIGNED',
        'DOCTOR_SERVICE_ASSIGNED',
        'DOCTOR_SERVICE_UNASSIGNED',
      ]);
    });

    it('refuses to assign an inactive service or an invalid price', async () => {
      const { body: doctor } = await createDoctor().expect(201);
      const { body: service } = await createService();

      await request(server)
        .put(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({ priceOverride: 400.5 })
        .expect(400);
      await request(server)
        .put(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({ priceOverride: '-1' })
        .expect(400);

      await request(server)
        .patch(`/api/v1/clinic-services/${service.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200);
      await request(server)
        .put(`/api/v1/doctors/${doctor.id}/services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({})
        .expect(409);
    });
  });

  describe('clinic services', () => {
    it('validates duration and price, keeps prices as strings', async () => {
      await request(server)
        .post('/api/v1/clinic-services')
        .set('Authorization', bearer(owner))
        .send({ name: 'Bad', durationMinutes: 0, basePrice: '10' })
        .expect(400);
      await request(server)
        .post('/api/v1/clinic-services')
        .set('Authorization', bearer(owner))
        .send({ name: 'Bad', durationMinutes: 30, basePrice: '10.999' })
        .expect(400);

      const { body: service } = await createService({ basePrice: '0.1' });
      const updated = await request(server)
        .patch(`/api/v1/clinic-services/${service.id}`)
        .set('Authorization', bearer(owner))
        .send({ basePrice: '0.2' })
        .expect(200);
      expect(updated.body.basePrice).toBe('0.20');

      const log = await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'CLINIC_SERVICE_UPDATED',
        entityId: service.id,
      });
      expect(log.oldValues).toEqual({ basePrice: '0.10' });
      expect(log.newValues).toEqual({ basePrice: '0.20' });
    });

    it('deactivates instead of deleting', async () => {
      const { body: service } = await createService();
      await request(server)
        .delete(`/api/v1/clinic-services/${service.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
      await request(server)
        .patch(`/api/v1/clinic-services/${service.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200)
        .expect(({ body }) => expect(body.isActive).toBe(false));
    });
  });

  describe('public endpoints', () => {
    it('list only active + public doctors with safe fields and active services', async () => {
      const { body: visible } = await createDoctor().expect(201);
      const { body: hidden } = await createDoctor({
        email: 'hidden@clinic.com',
        isPublic: false,
      }).expect(201);
      const { body: inactive } = await createDoctor({
        email: 'inactive@clinic.com',
      }).expect(201);
      await request(server)
        .patch(`/api/v1/doctors/${inactive.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200);

      const { body: active } = await createService({ name: 'Active service' });
      const { body: retired } = await createService({
        name: 'Retired service',
      });
      for (const service of [active, retired]) {
        await request(server)
          .put(`/api/v1/doctors/${visible.id}/services/${service.id}`)
          .set('Authorization', bearer(owner))
          .send({ priceOverride: '500.00' })
          .expect(200);
      }
      await request(server)
        .patch(`/api/v1/clinic-services/${retired.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200);

      const list = await request(server)
        .get('/api/v1/public/doctors')
        .expect(200);
      expect(list.body).toHaveLength(1);
      const [doctor] = list.body;
      expect(Object.keys(doctor).sort()).toEqual(PUBLIC_DOCTOR_KEYS);
      expect(doctor).toMatchObject({ id: visible.id, name: 'Dr. Mona Adel' });
      expect(doctor.services).toHaveLength(1);
      expect(Object.keys(doctor.services[0]).sort()).toEqual(
        PUBLIC_DOCTOR_SERVICE_KEYS,
      );
      expect(doctor.services[0]).toMatchObject({
        name: 'Active service',
        price: '500.00',
      });

      const serialized = JSON.stringify(list.body);
      expect(serialized).not.toContain('mona@clinic.com');
      expect(serialized).not.toContain('+201012345678');
      expect(serialized).not.toContain(visible.userId);

      const one = await request(server)
        .get(`/api/v1/public/doctors/${visible.id}`)
        .expect(200);
      expect(Object.keys(one.body).sort()).toEqual(PUBLIC_DOCTOR_KEYS);

      await request(server)
        .get(`/api/v1/public/doctors/${hidden.id}`)
        .expect(404);
      await request(server)
        .get(`/api/v1/public/doctors/${inactive.id}`)
        .expect(404);
    });

    it('list only active services with safe fields', async () => {
      await createService({ name: 'Active service' });
      const { body: retired } = await createService({
        name: 'Retired service',
      });
      await request(server)
        .patch(`/api/v1/clinic-services/${retired.id}/deactivate`)
        .set('Authorization', bearer(owner))
        .expect(200);

      const res = await request(server)
        .get('/api/v1/public/services')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual(PUBLIC_SERVICE_KEYS);
      expect(res.body[0]).toMatchObject({
        name: 'Active service',
        basePrice: '350.00',
      });
    });
  });
});
