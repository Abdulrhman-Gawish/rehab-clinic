import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { createLoggedInDoctor, insertDoctor } from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

describe('Doctor schedules & time off (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let receptionist: TestUser;
  let doctorUser: TestUser & { doctorId: string };
  let doctorId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorUser = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorId = doctorUser.doctorId;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const addRange = (
    body: Record<string, unknown>,
    id = doctorId,
    as: TestUser = receptionist,
  ) =>
    request(server)
      .post(`/api/v1/doctors/${id}/schedules`)
      .set('Authorization', bearer(as))
      .send(body);

  describe('schedules', () => {
    it('allows several non-overlapping ranges per day, touching ranges included', async () => {
      await addRange({
        dayOfWeek: 0,
        startTime: '09:00',
        endTime: '13:00',
      }).expect(201);
      await addRange({
        dayOfWeek: 0,
        startTime: '13:00',
        endTime: '15:00',
      }).expect(201);
      const evening = await addRange({
        dayOfWeek: 0,
        startTime: '17:00',
        endTime: '21:00',
      }).expect(201);
      expect(evening.body).toMatchObject({
        doctorId,
        dayOfWeek: 0,
        startTime: '17:00',
        endTime: '21:00',
        isActive: true,
      });
      // Other days are independent.
      await addRange({
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '12:00',
      }).expect(201);

      const list = await request(server)
        .get(`/api/v1/doctors/${doctorId}/schedules`)
        .set('Authorization', bearer(doctorUser))
        .expect(200);
      expect(
        list.body.map((s: { dayOfWeek: number; startTime: string }) => [
          s.dayOfWeek,
          s.startTime,
        ]),
      ).toEqual([
        [0, '09:00'],
        [0, '13:00'],
        [0, '17:00'],
        [1, '10:00'],
      ]);
    });

    it('rejects an overlapping range with 409 SCHEDULE_OVERLAP (exclusion constraint)', async () => {
      await addRange({
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '13:00',
      }).expect(201);

      const res = await addRange({
        dayOfWeek: 2,
        startTime: '12:30',
        endTime: '14:00',
      }).expect(409);
      expect(res.body.code).toBe('SCHEDULE_OVERLAP');
    });

    it('validates times and day', async () => {
      await addRange({
        dayOfWeek: 0,
        startTime: '13:00',
        endTime: '09:00',
      }).expect(400);
      await addRange({
        dayOfWeek: 0,
        startTime: '09:00',
        endTime: '09:00',
      }).expect(400);
      await addRange({
        dayOfWeek: 7,
        startTime: '09:00',
        endTime: '10:00',
      }).expect(400);
      await addRange({
        dayOfWeek: 0,
        startTime: '9am',
        endTime: '10:00',
      }).expect(400);
      await addRange({
        dayOfWeek: 0,
        startTime: '24:00',
        endTime: '10:00',
      }).expect(400);
    });

    it('deactivated ranges do not block; re-activating an overlapping one is refused', async () => {
      const old = await addRange({
        dayOfWeek: 4,
        startTime: '09:00',
        endTime: '13:00',
      }).expect(201);
      await request(server)
        .patch(
          `/api/v1/doctors/${doctorId}/schedules/${old.body.id}/deactivate`,
        )
        .set('Authorization', bearer(receptionist))
        .expect(200)
        .expect(({ body }) => expect(body.isActive).toBe(false));

      await addRange({
        dayOfWeek: 4,
        startTime: '10:00',
        endTime: '14:00',
      }).expect(201);

      const res = await request(server)
        .patch(`/api/v1/doctors/${doctorId}/schedules/${old.body.id}/activate`)
        .set('Authorization', bearer(receptionist))
        .expect(409);
      expect(res.body.code).toBe('SCHEDULE_OVERLAP');

      const all = await request(server)
        .get(`/api/v1/doctors/${doctorId}/schedules?includeInactive=true`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('updates are audited with old and new values', async () => {
      const created = await addRange({
        dayOfWeek: 5,
        startTime: '09:00',
        endTime: '13:00',
      }).expect(201);
      await request(server)
        .patch(`/api/v1/doctors/${doctorId}/schedules/${created.body.id}`)
        .set('Authorization', bearer(receptionist))
        .send({ endTime: '14:00' })
        .expect(200)
        .expect(({ body }) => expect(body.endTime).toBe('14:00'));

      const actions = await ctx.dataSource.getRepository(AuditLog).find({
        where: { entityId: created.body.id },
        order: { createdAt: 'ASC' },
      });
      expect(actions.map((a) => a.action)).toEqual([
        'DOCTOR_SCHEDULE_CREATED',
        'DOCTOR_SCHEDULE_UPDATED',
      ]);
      expect(actions[1]).toMatchObject({
        userId: receptionist.id,
        oldValues: { endTime: '13:00:00' },
        newValues: { endTime: '14:00:00' },
      });
    });

    it("doctors read only their own schedule (others' are 404)", async () => {
      const other = await insertDoctor(ctx.dataSource);

      await request(server)
        .get(`/api/v1/doctors/${doctorId}/schedules`)
        .set('Authorization', bearer(doctorUser))
        .expect(200);
      await request(server)
        .get(`/api/v1/doctors/${other.id}/schedules`)
        .set('Authorization', bearer(doctorUser))
        .expect(404);
    });

    it('returns 404 for an unknown doctor', async () => {
      await addRange(
        { dayOfWeek: 0, startTime: '09:00', endTime: '10:00' },
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
    });
  });

  describe('time off', () => {
    const addTimeOff = (body: Record<string, unknown>) =>
      request(server)
        .post(`/api/v1/doctors/${doctorId}/time-off`)
        .set('Authorization', bearer(receptionist))
        .send(body);

    it('creates time off and returns it in clinic local time with the right DST offset', async () => {
      const winter = await addTimeOff({
        startAt: '2026-11-10T07:00:00Z',
        endAt: '2026-11-10T15:00:00Z',
        reason: 'Conference',
      }).expect(201);
      expect(winter.body).toEqual({
        timeOff: expect.objectContaining({
          doctorId,
          startAt: '2026-11-10T09:00:00+02:00',
          endAt: '2026-11-10T17:00:00+02:00',
          reason: 'Conference',
          createdById: receptionist.id,
        }),
        conflictingAppointments: [],
      });

      const summer = await addTimeOff({
        startAt: '2027-07-10T09:00:00+03:00',
        endAt: '2027-07-10T17:00:00+03:00',
      }).expect(201);
      expect(summer.body.timeOff.startAt).toBe('2027-07-10T09:00:00+03:00');

      await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'DOCTOR_TIME_OFF_CREATED',
        entityId: winter.body.timeOff.id,
      });
    });

    it('requires offsets and a positive period', async () => {
      await addTimeOff({
        startAt: '2026-11-10T09:00:00',
        endAt: '2026-11-10T17:00:00+02:00',
      }).expect(400);
      await addTimeOff({
        startAt: '2026-11-10T17:00:00+02:00',
        endAt: '2026-11-10T09:00:00+02:00',
      }).expect(400);
    });

    it('lists by period, updates and deletes with audit', async () => {
      const a = await addTimeOff({
        startAt: '2026-11-10T09:00:00+02:00',
        endAt: '2026-11-10T17:00:00+02:00',
      }).expect(201);
      await addTimeOff({
        startAt: '2026-12-10T09:00:00+02:00',
        endAt: '2026-12-10T17:00:00+02:00',
      }).expect(201);

      const november = await request(server)
        .get(
          `/api/v1/doctors/${doctorId}/time-off?from=${encodeURIComponent('2026-11-01T00:00:00+02:00')}&to=${encodeURIComponent('2026-12-01T00:00:00+02:00')}`,
        )
        .set('Authorization', bearer(doctorUser))
        .expect(200);
      expect(november.body).toHaveLength(1);

      const id = a.body.timeOff.id as string;
      await request(server)
        .patch(`/api/v1/doctors/${doctorId}/time-off/${id}`)
        .set('Authorization', bearer(receptionist))
        .send({ endAt: '2026-11-10T13:00:00+02:00' })
        .expect(200)
        .expect(({ body }) =>
          expect(body.timeOff.endAt).toBe('2026-11-10T13:00:00+02:00'),
        );
      await request(server)
        .delete(`/api/v1/doctors/${doctorId}/time-off/${id}`)
        .set('Authorization', bearer(receptionist))
        .expect(204);

      const actions = (
        await ctx.dataSource
          .getRepository(AuditLog)
          .find({ where: { entityId: id }, order: { createdAt: 'ASC' } })
      ).map((log) => log.action);
      expect(actions).toEqual([
        'DOCTOR_TIME_OFF_CREATED',
        'DOCTOR_TIME_OFF_UPDATED',
        'DOCTOR_TIME_OFF_DELETED',
      ]);
    });

    it("doctors can't see other doctors' time off (404)", async () => {
      const other = await insertDoctor(ctx.dataSource);
      await request(server)
        .get(`/api/v1/doctors/${other.id}/time-off`)
        .set('Authorization', bearer(doctorUser))
        .expect(404);
    });
  });
});
