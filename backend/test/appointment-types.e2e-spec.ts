import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import {
  AppointmentStatus,
  AppointmentType,
} from '../src/modules/appointments/appointment.enums.js';
import { AppointmentStatusHistory } from '../src/modules/appointments/entities/appointment-status-history.entity.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { Visit } from '../src/modules/visits/entities/visit.entity.js';
import { VisitStatus } from '../src/modules/visits/visit.enums.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { completeCheckInDetails } from './utils/check-in.js';
import {
  assignService,
  createLoggedInDoctor,
  insertAppointment,
  insertPatient,
  insertService,
  insertVisit,
  insertWeeklySchedule,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Frozen clock: Monday 2026-11-02 08:00 Cairo (+02:00); lead time 60 min.
const MONDAY = '2026-11-02';
const TUESDAY = '2026-11-03';
const at = (time: string, date = TUESDAY) => `${date}T${time}:00+02:00`;
const clock = { current: new Date(at('08:00', MONDAY)) };

type DoctorUser = TestUser & { doctorId: string };

describe('Appointment types (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctor: DoctorUser;
  let serviceId: string;
  let patientId: string;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = new Date(at('08:00', MONDAY));
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        durationMinutes: 30,
        basePrice: '300.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctor.doctorId, serviceId);
    await insertWeeklySchedule(ctx.dataSource, doctor.doctorId, [
      ['08:00', '20:00'],
    ]);
    patientId = (
      await insertPatient(ctx.dataSource, 'Mona Adel', '+201000000001')
    ).id;
    await completeCheckInDetails(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Authorization', bearer(user)),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    patch: (path: string, body: object) =>
      request(server)
        .patch(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });

  const book = (body: object = {}) =>
    as(receptionist).post('/appointments', {
      patientId,
      doctorId: doctor.doctorId,
      serviceId,
      startAt: at('10:00'),
      ...body,
    });

  const auditOf = (entityId: string, action: string) =>
    ctx.dataSource
      .getRepository(AuditLog)
      .find({ where: { entityId, action: action as never } });

  // An appointment inserted directly, in any status (ATTENDED: with its visit).
  async function existing(
    status: AppointmentStatus,
    type: AppointmentType | null,
    hour: number,
  ) {
    const appointment = await insertAppointment(ctx.dataSource, {
      patientId,
      doctorId: doctor.doctorId,
      serviceId,
      startAt: new Date(at(`${String(hour).padStart(2, '0')}:00`, MONDAY)),
      status,
      type,
    });
    const visit =
      status === AppointmentStatus.ATTENDED
        ? await insertVisit(ctx.dataSource, {
            patientId,
            doctorId: doctor.doctorId,
            serviceId,
            attendedById: receptionist.id,
            appointmentId: appointment.id,
          })
        : null;
    return { appointment, visit };
  }

  it('reception and online bookings require a type (no default) and return it', async () => {
    await book().expect(400);
    await book({ type: 'CHECKUP' }).expect(400);
    const booked = await book({ type: 'FOLLOW_UP' }).expect(201);
    expect(booked.body).toMatchObject({
      type: 'FOLLOW_UP',
      status: 'CONFIRMED',
    });
    const [created] = await auditOf(booked.body.id, 'APPOINTMENT_CREATED');
    expect(created.newValues).toMatchObject({ type: 'FOLLOW_UP' });

    const online = {
      name: 'Omar Online',
      phone: '01012345678',
      doctorId: doctor.doctorId,
      serviceId,
      startAt: at('12:00'),
    };
    await request(server)
      .post('/api/v1/public/appointments')
      .send(online)
      .expect(400);
    const res = await request(server)
      .post('/api/v1/public/appointments')
      .send({ ...online, type: 'EXAMINATION' })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'EXAMINATION', status: 'PENDING' });
    const stored = await as(receptionist)
      .get(`/appointments/by-reference/${res.body.referenceCode}`)
      .expect(200);
    expect(stored.body).toMatchObject({
      type: 'EXAMINATION',
      source: 'ONLINE',
    });
  });

  it('a walk-in requires a type chosen at check-in; the visit and the day list show it', async () => {
    const walkIn = { patientId, doctorId: doctor.doctorId, serviceId };
    await as(receptionist).post('/visits/walk-in', walkIn).expect(400);
    const res = await as(receptionist)
      .post('/visits/walk-in', { ...walkIn, type: 'SESSION' })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'SESSION', isWalkIn: true });
    expect((await as(doctor).get(`/visits/${res.body.id}`)).body.type).toBe(
      'SESSION',
    );
    const day = await as(receptionist)
      .get(`/appointments/day?date=${MONDAY}`)
      .expect(200);
    expect(day.body).toMatchObject([{ isWalkIn: true, type: 'SESSION' }]);
  });

  it('reception changes the type in any status: audited (who, old, new), no status change', async () => {
    const rows = [
      await existing(
        AppointmentStatus.CONFIRMED,
        AppointmentType.EXAMINATION,
        9,
      ),
      await existing(
        AppointmentStatus.CANCELLED,
        AppointmentType.EXAMINATION,
        10,
      ),
      await existing(
        AppointmentStatus.NO_SHOW,
        AppointmentType.EXAMINATION,
        11,
      ),
      await existing(
        AppointmentStatus.RESCHEDULED,
        AppointmentType.EXAMINATION,
        12,
      ),
      await existing(
        AppointmentStatus.ATTENDED,
        AppointmentType.EXAMINATION,
        13,
      ),
    ];
    for (const { appointment } of rows) {
      const res = await as(receptionist)
        .patch(`/appointments/${appointment.id}/type`, { type: 'SESSION' })
        .expect(200);
      expect(res.body).toMatchObject({
        type: 'SESSION',
        status: appointment.status,
      });
      const logs = await auditOf(appointment.id, 'APPOINTMENT_TYPE_CHANGED');
      expect(logs).toMatchObject([
        {
          userId: receptionist.id,
          entityType: 'APPOINTMENT',
          oldValues: { type: 'EXAMINATION' },
          newValues: { type: 'SESSION' },
        },
      ]);
    }
    // The attended visit follows its appointment.
    const visitId = rows[4].visit!.id;
    expect((await as(doctor).get(`/visits/${visitId}`)).body.type).toBe(
      'SESSION',
    );
    // The same type again changes nothing (no audit entry).
    await as(receptionist)
      .patch(`/appointments/${rows[0].appointment.id}/type`, {
        type: 'SESSION',
      })
      .expect(200);
    expect(
      await auditOf(rows[0].appointment.id, 'APPOINTMENT_TYPE_CHANGED'),
    ).toHaveLength(1);
    // Not a status change: no status history rows.
    expect(
      await ctx.dataSource.getRepository(AppointmentStatusHistory).count(),
    ).toBe(0);
    await as(receptionist)
      .patch(`/appointments/${rows[0].appointment.id}/type`, { type: 'OTHER' })
      .expect(400);
  });

  it('only reception changes it later: the owner and doctors get 403', async () => {
    const { appointment, visit } = await existing(
      AppointmentStatus.ATTENDED,
      AppointmentType.SESSION,
      9,
    );
    for (const user of [owner, doctor]) {
      await as(user)
        .patch(`/appointments/${appointment.id}/type`, { type: 'EXAMINATION' })
        .expect(403);
      await as(user)
        .patch(`/visits/${visit!.id}/type`, { type: 'EXAMINATION' })
        .expect(403);
    }
    expect(
      (await as(owner).get(`/appointments/${appointment.id}`)).body.type,
    ).toBe('SESSION');
  });

  it('appointments from before types are "not set" until reception sets it; a reschedule inherits the type', async () => {
    const { appointment: legacy } = await existing(
      AppointmentStatus.CONFIRMED,
      null,
      9,
    );
    expect(
      (await as(receptionist).get(`/appointments/${legacy.id}`)).body.type,
    ).toBeNull();
    const day = await as(receptionist)
      .get(`/appointments/day?date=${MONDAY}`)
      .expect(200);
    expect(day.body).toMatchObject([{ id: legacy.id, type: null }]);

    // Rescheduled while not set: still not set.
    const moved = await as(receptionist)
      .post(`/appointments/${legacy.id}/reschedule`, { startAt: at('10:00') })
      .expect(201);
    expect(moved.body).toMatchObject({
      rescheduledFromId: legacy.id,
      type: null,
    });

    await as(receptionist)
      .patch(`/appointments/${moved.body.id}/type`, { type: 'FOLLOW_UP' })
      .expect(200);
    const [set] = await auditOf(moved.body.id, 'APPOINTMENT_TYPE_CHANGED');
    expect(set).toMatchObject({
      oldValues: { type: null },
      newValues: { type: 'FOLLOW_UP' },
    });
    const again = await as(receptionist)
      .post(`/appointments/${moved.body.id}/reschedule`, {
        startAt: at('11:00'),
      })
      .expect(201);
    expect(again.body.type).toBe('FOLLOW_UP');
  });

  it("a walk-in's type changes through its visit (voided too); an appointment's visit changes its appointment", async () => {
    const walkIn = await as(receptionist)
      .post('/visits/walk-in', {
        patientId,
        doctorId: doctor.doctorId,
        serviceId,
        type: 'SESSION',
      })
      .expect(201);
    const changed = await as(receptionist)
      .patch(`/visits/${walkIn.body.id}/type`, { type: 'EXAMINATION' })
      .expect(200);
    expect(changed.body.type).toBe('EXAMINATION');
    expect(await auditOf(walkIn.body.id, 'VISIT_TYPE_CHANGED')).toMatchObject([
      {
        userId: receptionist.id,
        oldValues: { type: 'SESSION' },
        newValues: { type: 'EXAMINATION' },
      },
    ]);
    await as(receptionist)
      .post(`/visits/${walkIn.body.id}/undo-attend`, {
        reason: 'Sent in by mistake',
      })
      .expect(200);
    const voided = await as(receptionist)
      .patch(`/visits/${walkIn.body.id}/type`, { type: 'FOLLOW_UP' })
      .expect(200);
    expect(voided.body).toMatchObject({ status: 'VOIDED', type: 'FOLLOW_UP' });

    const { appointment, visit } = await existing(
      AppointmentStatus.ATTENDED,
      AppointmentType.SESSION,
      9,
    );
    const viaVisit = await as(receptionist)
      .patch(`/visits/${visit!.id}/type`, { type: 'FOLLOW_UP' })
      .expect(200);
    expect(viaVisit.body.type).toBe('FOLLOW_UP');
    expect(
      (await as(receptionist).get(`/appointments/${appointment.id}`)).body.type,
    ).toBe('FOLLOW_UP');
    // One source of truth: the visit row itself never holds a type.
    expect(
      (
        await ctx.dataSource
          .getRepository(Visit)
          .findOneByOrFail({ id: visit!.id })
      ).type,
    ).toBeNull();
    expect(
      await auditOf(appointment.id, 'APPOINTMENT_TYPE_CHANGED'),
    ).toHaveLength(1);
  });

  it('the type never changes the duration or the price', async () => {
    const exam = await book({ type: 'EXAMINATION' }).expect(201);
    const session = await book({
      type: 'SESSION',
      startAt: at('11:00'),
    }).expect(201);
    const minutes = (a: { startAt: string; endAt: string }) =>
      (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000;
    expect(minutes(exam.body)).toBe(30);
    expect(minutes(session.body)).toBe(30);

    clock.current = new Date(at('10:05'));
    const examVisit = await as(receptionist)
      .post(`/appointments/${exam.body.id}/attend`)
      .expect(201);
    clock.current = new Date(at('11:05'));
    const sessionVisit = await as(receptionist)
      .post(`/appointments/${session.body.id}/attend`)
      .expect(201);
    const total = async (invoiceId: string) =>
      (await as(receptionist).get(`/invoices/${invoiceId}`).expect(200)).body
        .total;
    expect(await total(examVisit.body.invoiceId)).toBe('300.00');
    expect(await total(sessionVisit.body.invoiceId)).toBe('300.00');

    // Changing the type of an attended appointment leaves its invoice alone.
    await as(receptionist)
      .patch(`/appointments/${exam.body.id}/type`, { type: 'SESSION' })
      .expect(200);
    expect(await total(examVisit.body.invoiceId)).toBe('300.00');
  });

  it('the database keeps one source of truth: a visit of an appointment never has its own type', async () => {
    const { appointment } = await existing(
      AppointmentStatus.CONFIRMED,
      AppointmentType.SESSION,
      9,
    );
    await expect(
      insertVisit(ctx.dataSource, {
        patientId,
        doctorId: doctor.doctorId,
        serviceId,
        attendedById: receptionist.id,
        appointmentId: appointment.id,
        status: VisitStatus.ACTIVE,
        type: AppointmentType.EXAMINATION,
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
});
