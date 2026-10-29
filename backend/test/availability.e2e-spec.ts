import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import { DoctorSchedule } from '../src/modules/schedules/entities/doctor-schedule.entity.js';
import { DoctorTimeOff } from '../src/modules/schedules/entities/doctor-time-off.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertDoctor,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Frozen "now": Monday 2026-11-02 08:00 in Cairo (+02:00, winter).
const NOW = new Date('2026-11-02T08:00:00+02:00');
const MONDAY = '2026-11-02';

describe('Availability (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let receptionist: TestUser;
  let doctorId: string;
  let serviceId: string;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => NOW }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorId = (await insertDoctor(ctx.dataSource)).id;
    serviceId = (await insertService(ctx.dataSource, { durationMinutes: 30 }))
      .id;
    await assignService(ctx.dataSource, doctorId, serviceId);
    // Mondays: morning + evening.
    await ctx.dataSource.getRepository(DoctorSchedule).insert([
      {
        doctorId,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:30',
        isActive: true,
      },
      {
        doctorId,
        dayOfWeek: 1,
        startTime: '17:00',
        endTime: '18:00',
        isActive: true,
      },
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const publicSlots = (date: string, id = doctorId, service = serviceId) =>
    request(server).get(
      `/api/v1/public/doctors/${id}/slots?serviceId=${service}&date=${date}`,
    );

  const startTimes = (body: { startAt: string }[]) =>
    body.map((s) => s.startAt);

  it('returns { startAt, endAt } in clinic local time for every range', async () => {
    const res = await publicSlots(MONDAY).expect(200);
    expect(res.body[0]).toEqual({
      startAt: '2026-11-02T09:00:00+02:00',
      endAt: '2026-11-02T09:30:00+02:00',
    });
    expect(startTimes(res.body)).toEqual([
      '2026-11-02T09:00:00+02:00',
      '2026-11-02T09:15:00+02:00',
      '2026-11-02T09:30:00+02:00',
      '2026-11-02T09:45:00+02:00',
      '2026-11-02T10:00:00+02:00',
      '2026-11-02T17:00:00+02:00',
      '2026-11-02T17:15:00+02:00',
      '2026-11-02T17:30:00+02:00',
    ]);
  });

  it('applies the minimum lead time to today', async () => {
    // now 08:00 + 60 min lead: 09:00 is the first allowed start. Move "now".
    const later = await createTestApp((builder) =>
      builder
        .overrideProvider(CLOCK)
        .useValue({ now: () => new Date('2026-11-02T08:20:00+02:00') }),
    );
    try {
      const res = await request(later.app.getHttpServer())
        .get(
          `/api/v1/public/doctors/${doctorId}/slots?serviceId=${serviceId}&date=${MONDAY}`,
        )
        .expect(200);
      expect(startTimes(res.body)[0]).toBe('2026-11-02T09:30:00+02:00');
    } finally {
      await later.app.close();
    }
  });

  it('excludes time off', async () => {
    const creator = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.OWNER,
    );
    await ctx.dataSource.getRepository(DoctorTimeOff).insert({
      doctorId,
      startAt: new Date('2026-11-02T09:20:00+02:00'),
      endAt: new Date('2026-11-02T17:10:00+02:00'),
      reason: null,
      createdById: creator.id,
    });
    const res = await publicSlots(MONDAY).expect(200);
    expect(startTimes(res.body)).toEqual([
      '2026-11-02T17:15:00+02:00',
      '2026-11-02T17:30:00+02:00',
    ]);
  });

  it('returns no slots on a day without schedule', async () => {
    const res = await publicSlots('2026-11-03').expect(200);
    expect(res.body).toEqual([]);
  });

  it('rejects past dates and dates beyond the max days ahead with 422', async () => {
    const past = await publicSlots('2026-11-01').expect(422);
    expect(past.body).toMatchObject({
      code: 'DATE_OUT_OF_RANGE',
      details: { from: '2026-11-02', to: '2026-12-02' },
    });
    await publicSlots('2026-12-02').expect(200);
    await publicSlots('2026-12-03').expect(422);
  });

  it('validates the query', async () => {
    await publicSlots('02-11-2026').expect(400);
    await publicSlots('2026-02-30').expect(400);
    await request(server)
      .get(`/api/v1/public/doctors/${doctorId}/slots?date=${MONDAY}`)
      .expect(400);
  });

  it('422 when the doctor does not offer the service (or it is inactive)', async () => {
    const other = await insertService(ctx.dataSource, { name: 'Other' });
    const res = await publicSlots(MONDAY, doctorId, other.id).expect(422);
    expect(res.body.code).toBe('SERVICE_NOT_OFFERED');

    const inactive = await insertService(ctx.dataSource, { isActive: false });
    await assignService(ctx.dataSource, doctorId, inactive.id);
    await publicSlots(MONDAY, doctorId, inactive.id).expect(422);
  });

  it('404 for inactive doctors, and for hidden doctors on the public endpoint', async () => {
    await ctx.dataSource
      .getRepository(Doctor)
      .update(doctorId, { isPublic: false });
    await publicSlots(MONDAY).expect(404);
    // Staff can still see a hidden doctor.
    await request(server)
      .get(
        `/api/v1/appointments/availability?doctorId=${doctorId}&serviceId=${serviceId}&date=${MONDAY}`,
      )
      .set('Authorization', bearer(receptionist))
      .expect(200);

    await ctx.dataSource
      .getRepository(Doctor)
      .update(doctorId, { isActive: false });
    await request(server)
      .get(
        `/api/v1/appointments/availability?doctorId=${doctorId}&serviceId=${serviceId}&date=${MONDAY}`,
      )
      .set('Authorization', bearer(receptionist))
      .expect(404);
  });

  it('reception can include times outside the schedule (whole day, from now)', async () => {
    const res = await request(server)
      .get(
        `/api/v1/appointments/availability?doctorId=${doctorId}&serviceId=${serviceId}&date=${MONDAY}&includeOutsideSchedule=true`,
      )
      .set('Authorization', bearer(receptionist))
      .expect(200);
    const starts = startTimes(res.body);
    // From "now" (08:00, no lead time) to 23:30, every 15 minutes.
    expect(starts[0]).toBe('2026-11-02T08:00:00+02:00');
    expect(starts.at(-1)).toBe('2026-11-02T23:30:00+02:00');
    expect(starts).toHaveLength(63);
  });

  it('doctors query only their own availability (others 404) and cannot widen it', async () => {
    const doctorUser = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    await assignService(ctx.dataSource, doctorUser.doctorId, serviceId);

    await request(server)
      .get(
        `/api/v1/appointments/availability?doctorId=${doctorUser.doctorId}&serviceId=${serviceId}&date=${MONDAY}&includeOutsideSchedule=true`,
      )
      .set('Authorization', bearer(doctorUser))
      .expect(200)
      // No schedule and the flag is ignored for doctors -> nothing.
      .expect(({ body }) => expect(body).toEqual([]));

    await request(server)
      .get(
        `/api/v1/appointments/availability?doctorId=${doctorId}&serviceId=${serviceId}&date=${MONDAY}`,
      )
      .set('Authorization', bearer(doctorUser))
      .expect(404);
  });
});
