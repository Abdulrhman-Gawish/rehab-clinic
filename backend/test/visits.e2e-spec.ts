import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import {
  AppointmentSource,
  AppointmentStatus,
} from '../src/modules/appointments/appointment.enums.js';
import { AppointmentStatusHistory } from '../src/modules/appointments/entities/appointment-status-history.entity.js';
import { Appointment } from '../src/modules/appointments/entities/appointment.entity.js';
import { AuditAction } from '../src/modules/audit/audit.constants.js';
import {
  AuditService,
  type AuditEntry,
} from '../src/modules/audit/audit.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import {
  Patient,
  PatientSource,
} from '../src/modules/patients/entities/patient.entity.js';
import { VisitStatusHistory } from '../src/modules/visits/entities/visit-status-history.entity.js';
import { Visit } from '../src/modules/visits/entities/visit.entity.js';
import { VISIT_COMPLETION_POLICY } from '../src/modules/visits/visit-completion-policy.js';
import {
  VisitEvent,
  type VisitEventPayload,
} from '../src/modules/visits/visit.events.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Mutable frozen clock. "Today" is Tuesday 2026-11-03 in Cairo (+02:00).
const TODAY = '2026-11-03';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const iso = (time: string, date = TODAY) => `${date}T${time}:00+02:00`;
const clock = { current: local('09:00') };

const VISIT_KEYS = [
  'appointmentId',
  'appointmentReferenceCode',
  'appointmentStartAt',
  'cancelReason',
  'cancelledAt',
  'cancelledById',
  'checkedInAt',
  'checkedInById',
  'completedAt',
  'completedById',
  'createdAt',
  'doctor',
  'id',
  'isWalkIn',
  'patient',
  'service',
  'startedAt',
  'status',
  'updatedAt',
];

type DoctorUser = TestUser & { doctorId: string };

describe('Visits (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: DoctorUser;
  let doctorB: DoctorUser;
  let serviceId: string;
  let p1: Patient;
  let p2: Patient;
  let p3: Patient;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = local('09:00');
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        durationMinutes: 30,
      })
    ).id;
    await assignService(ctx.dataSource, doctorA.doctorId, serviceId);
    await assignService(ctx.dataSource, doctorB.doctorId, serviceId);
    p1 = await insertPatient('Patient One', '+201000000001');
    p2 = await insertPatient('Patient Two', '+201000000002');
    p3 = await insertPatient('Patient Three', '+201000000003');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // ---------- helpers ----------

  function insertPatient(name: string, phone: string): Promise<Patient> {
    const repo = ctx.dataSource.getRepository(Patient);
    return repo.save(
      repo.create({
        name,
        phone,
        dateOfBirth: null,
        gender: null,
        notes: null,
        createdSource: PatientSource.RECEPTION,
        createdById: null,
      }),
    );
  }

  let codeSeq = 0;
  function insertAppointment(
    patient: Patient,
    doctor: DoctorUser,
    start: Date,
    status = AppointmentStatus.CONFIRMED,
  ): Promise<Appointment> {
    const repo = ctx.dataSource.getRepository(Appointment);
    codeSeq += 1;
    return repo.save(
      repo.create({
        referenceCode: `APT-T${String(codeSeq).padStart(5, '2')}`,
        patientId: patient.id,
        doctorId: doctor.doctorId,
        serviceId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status,
        source: AppointmentSource.RECEPTION,
        bookedName: patient.name,
        bookedById: null,
        rescheduledFromId: null,
        cancelReason: null,
        notes: null,
      }),
    );
  }

  const checkIn = (appointmentId: string, as: TestUser = receptionist) =>
    request(server)
      .post(`/api/v1/appointments/${appointmentId}/check-in`)
      .set('Authorization', bearer(as));

  const walkIn = (body: Record<string, unknown>, as: TestUser = receptionist) =>
    request(server)
      .post('/api/v1/visits/walk-in')
      .set('Authorization', bearer(as))
      .send({ doctorId: doctorA.doctorId, serviceId, ...body });

  const act = (
    visitId: string,
    action: 'start' | 'complete' | 'cancel' | 'undo-check-in',
    as: TestUser,
    body: Record<string, unknown> = {},
  ) =>
    request(server)
      .post(`/api/v1/visits/${visitId}/${action}`)
      .set('Authorization', bearer(as))
      .send(body);

  const appointmentStatus = async (id: string) =>
    (await ctx.dataSource.getRepository(Appointment).findOneByOrFail({ id }))
      .status;

  const appointmentHistory = async (id: string) =>
    (
      await ctx.dataSource.getRepository(AppointmentStatusHistory).find({
        where: { appointmentId: id },
        order: { changedAt: 'ASC' },
      })
    ).map((h) => [h.fromStatus, h.toStatus]);

  const visitHistory = async (id: string) =>
    (
      await ctx.dataSource.getRepository(VisitStatusHistory).find({
        where: { visitId: id },
        order: { changedAt: 'ASC' },
      })
    ).map((h) => [h.fromStatus, h.toStatus]);

  // Test listeners are tracked and removed after each test, leaving the
  // application's own listeners (billing) in place.
  const added: [string, (payload: VisitEventPayload) => void][] = [];
  function listen(name: string, handler: (payload: VisitEventPayload) => void) {
    ctx.app.get(EventEmitter2).on(name, handler);
    added.push([name, handler]);
  }

  function captureEvents(): { name: string; payload: VisitEventPayload }[] {
    const seen: { name: string; payload: VisitEventPayload }[] = [];
    for (const name of Object.values(VisitEvent)) {
      listen(name, (payload) => seen.push({ name, payload }));
    }
    return seen;
  }

  afterEach(() => {
    const emitter = ctx.app.get(EventEmitter2);
    for (const [name, handler] of added.splice(0)) emitter.off(name, handler);
  });

  // ---------- check-in ----------

  describe('check-in', () => {
    it('from CONFIRMED: creates a WAITING visit and moves the appointment to CHECKED_IN', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));

      const res = await checkIn(appointment.id).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(VISIT_KEYS);
      expect(res.body).toMatchObject({
        status: 'WAITING',
        isWalkIn: false,
        appointmentId: appointment.id,
        appointmentStartAt: iso('09:30'),
        patient: { id: p1.id, name: 'Patient One' },
        doctor: { id: doctorA.doctorId },
        service: { id: serviceId },
        checkedInAt: iso('09:00'),
        checkedInById: receptionist.id,
        startedAt: null,
      });

      expect(await appointmentStatus(appointment.id)).toBe('CHECKED_IN');
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['CONFIRMED', 'CHECKED_IN'],
      ]);
      expect(await visitHistory(res.body.id)).toEqual([[null, 'WAITING']]);
      const actions = (await ctx.dataSource.getRepository(AuditLog).find()).map(
        (l) => l.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['APPOINTMENT_CHECKED_IN', 'VISIT_CHECKED_IN']),
      );
    });

    it('from PENDING: confirms on the way with two history rows', async () => {
      const appointment = await insertAppointment(
        p1,
        doctorA,
        local('09:30'),
        AppointmentStatus.PENDING,
      );
      await checkIn(appointment.id).expect(201);
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['PENDING', 'CONFIRMED'],
        ['CONFIRMED', 'CHECKED_IN'],
      ]);
    });

    it("only on the appointment's local day; late arrival the same day is fine", async () => {
      const tomorrow = await insertAppointment(
        p1,
        doctorA,
        local('09:30', '2026-11-04'),
      );
      const res = await checkIn(tomorrow.id).expect(422);
      expect(res.body).toMatchObject({
        code: 'CHECK_IN_WRONG_DAY',
        details: { appointmentDate: '2026-11-04', today: TODAY },
      });
      const yesterday = await insertAppointment(
        p2,
        doctorA,
        local('09:30', '2026-11-02'),
      );
      await checkIn(yesterday.id).expect(422);

      const late = await insertAppointment(p3, doctorA, local('07:00'));
      await checkIn(late.id).expect(201);
    });

    it('a second check-in is 409 ALREADY_CHECKED_IN', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      await checkIn(appointment.id).expect(201);
      const res = await checkIn(appointment.id).expect(409);
      expect(res.body.code).toBe('ALREADY_CHECKED_IN');
    });

    it('5 parallel check-ins of one appointment create exactly one visit', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const results = await Promise.all(
        Array.from({ length: 5 }, () => checkIn(appointment.id)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 409);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) expect(r.body.code).toBe('ALREADY_CHECKED_IN');
      expect(
        await ctx.dataSource
          .getRepository(Visit)
          .countBy({ appointmentId: appointment.id }),
      ).toBe(1);
    });

    it('cancelled or no-show appointments cannot be checked in', async () => {
      const cancelled = await insertAppointment(
        p1,
        doctorA,
        local('09:30'),
        AppointmentStatus.CANCELLED,
      );
      const res = await checkIn(cancelled.id).expect(422);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      const noShow = await insertAppointment(
        p2,
        doctorA,
        local('08:00'),
        AppointmentStatus.NO_SHOW,
      );
      await checkIn(noShow.id).expect(422);
      expect(await ctx.dataSource.getRepository(Visit).count()).toBe(0);
    });

    it('a patient with an open visit cannot be checked in elsewhere', async () => {
      await walkIn({ patientId: p1.id }).expect(201);
      const appointment = await insertAppointment(p1, doctorB, local('09:30'));

      const res = await checkIn(appointment.id).expect(409);
      expect(res.body.code).toBe('PATIENT_HAS_OPEN_VISIT');
      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
      expect(await appointmentHistory(appointment.id)).toEqual([]);
    });

    it('atomicity: a failure after the visit insert rolls back everything (and emits nothing)', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const events = captureEvents();
      const audit = ctx.app.get(AuditService);
      const original = audit.log.bind(audit);
      vi.spyOn(audit, 'log').mockImplementation((entry: AuditEntry, manager) =>
        entry.action === AuditAction.VISIT_CHECKED_IN
          ? Promise.reject(new Error('simulated failure'))
          : original(entry, manager),
      );

      await checkIn(appointment.id).expect(500);

      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
      expect(await ctx.dataSource.getRepository(Visit).count()).toBe(0);
      expect(await appointmentHistory(appointment.id)).toEqual([]);
      expect(
        await ctx.dataSource.getRepository(VisitStatusHistory).count(),
      ).toBe(0);
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'APPOINTMENT_CHECKED_IN' }),
      ).toBe(0);
      expect(events).toEqual([]);
    });
  });

  // ---------- walk-in ----------

  describe('walk-in', () => {
    it('with a new phone creates the patient (RECEPTION) and a WAITING visit without appointment', async () => {
      const res = await walkIn({
        name: 'New Person',
        phone: '0155 555 5555',
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'WAITING',
        isWalkIn: true,
        appointmentId: null,
        appointmentStartAt: null,
        patient: { name: 'New Person', phone: '+201555555555' },
      });
      const patient = await ctx.dataSource
        .getRepository(Patient)
        .findOneByOrFail({ phone: '+201555555555' });
      expect(patient.createdSource).toBe('RECEPTION');
    });

    it('with an existing phone links to that patient without renaming', async () => {
      const res = await walkIn({
        name: 'Someone Else',
        phone: '01000000001',
      }).expect(201);
      expect(res.body.patient).toMatchObject({
        id: p1.id,
        name: 'Patient One',
      });
      expect(await ctx.dataSource.getRepository(Patient).count()).toBe(3);
    });

    it('404 for an inactive doctor, 422 for a service the doctor does not offer', async () => {
      const other = await insertService(ctx.dataSource, { name: 'Other' });
      const res = await walkIn({
        patientId: p1.id,
        serviceId: other.id,
      }).expect(422);
      expect(res.body.code).toBe('SERVICE_NOT_OFFERED');

      await ctx.dataSource
        .getRepository(Doctor)
        .update(doctorA.doctorId, { isActive: false });
      await walkIn({ patientId: p1.id }).expect(404);
    });

    it('requires exactly one way to identify the patient', async () => {
      await walkIn({}).expect(400);
      await walkIn({
        patientId: p1.id,
        name: 'X Y',
        phone: '01000000009',
      }).expect(400);
      await walkIn({ name: 'Only Name' }).expect(400);
    });

    it('does not block booking slots', async () => {
      await walkIn({ patientId: p1.id }).expect(201);
      await request(server)
        .post('/api/v1/appointments')
        .set('Authorization', bearer(receptionist))
        .send({
          patientId: p2.id,
          doctorId: doctorA.doctorId,
          serviceId,
          startAt: iso('09:00'),
          allowOutsideSchedule: true,
        })
        .expect(201);
    });

    it('parallel walk-ins of one patient with two doctors: exactly one succeeds', async () => {
      const [a, b] = await Promise.all([
        walkIn({ patientId: p1.id, doctorId: doctorA.doctorId }),
        walkIn({ patientId: p1.id, doctorId: doctorB.doctorId }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect((a.status === 409 ? a : b).body.code).toBe(
        'PATIENT_HAS_OPEN_VISIT',
      );
      expect(
        await ctx.dataSource.getRepository(Visit).countBy({ patientId: p1.id }),
      ).toBe(1);
    });
  });

  // ---------- doctor actions ----------

  describe('start / complete', () => {
    it('full flow: WAITING -> IN_SESSION -> COMPLETED, appointment COMPLETED, events after commit', async () => {
      const events = captureEvents();
      const seenCommitted: boolean[] = [];
      listen(VisitEvent.CHECKED_IN, (payload: VisitEventPayload) => {
        // Read through another connection: only visible if committed.
        void ctx.dataSource
          .getRepository(Visit)
          .existsBy({ id: payload.visitId })
          .then((exists) => seenCommitted.push(exists));
      });

      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const visit = (await checkIn(appointment.id).expect(201)).body;

      clock.current = local('09:20');
      const started = await act(visit.id, 'start', doctorA).expect(200);
      expect(started.body).toMatchObject({
        status: 'IN_SESSION',
        startedAt: iso('09:20'),
      });

      clock.current = local('09:50');
      const completed = await act(visit.id, 'complete', doctorA).expect(200);
      expect(completed.body).toMatchObject({
        status: 'COMPLETED',
        completedAt: iso('09:50'),
        completedById: doctorA.id,
      });

      expect(await appointmentStatus(appointment.id)).toBe('COMPLETED');
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['CONFIRMED', 'CHECKED_IN'],
        ['CHECKED_IN', 'COMPLETED'],
      ]);
      expect(await visitHistory(visit.id)).toEqual([
        [null, 'WAITING'],
        ['WAITING', 'IN_SESSION'],
        ['IN_SESSION', 'COMPLETED'],
      ]);

      expect(events.map((e) => e.name)).toEqual([
        'visit.checked_in',
        'visit.started',
        'visit.completed',
      ]);
      expect(events[2].payload).toEqual({
        visitId: visit.id,
        appointmentId: appointment.id,
        patientId: p1.id,
        doctorId: doctorA.doctorId,
        serviceId,
        at: local('09:50'),
      });
      await vi.waitFor(() => expect(seenCommitted).toEqual([true]));
    });

    it('forbidden transitions answer 422 INVALID_VISIT_TRANSITION; nothing is reopened', async () => {
      const visit = (await walkIn({ patientId: p1.id }).expect(201)).body;

      const expectInvalid = async (
        action: 'start' | 'complete' | 'cancel' | 'undo-check-in',
        as: TestUser,
      ) => {
        const res = await act(visit.id, action, as, {
          reason: 'some reason',
        }).expect(422);
        expect(res.body.code).toBe('INVALID_VISIT_TRANSITION');
      };

      await expectInvalid('complete', doctorA); // WAITING -> COMPLETED
      await act(visit.id, 'start', doctorA).expect(200);
      await expectInvalid('start', doctorA); // IN_SESSION -> IN_SESSION
      await expectInvalid('cancel', receptionist); // IN_SESSION -> CANCELLED
      await expectInvalid('undo-check-in', receptionist);
      await act(visit.id, 'complete', doctorA).expect(200);
      await expectInvalid('start', doctorA); // COMPLETED -> ...
      await expectInvalid('complete', doctorA);
      await expectInvalid('cancel', receptionist);

      const other = (await walkIn({ patientId: p2.id }).expect(201)).body;
      await act(other.id, 'cancel', receptionist, { reason: 'Left' }).expect(
        200,
      );
      for (const action of [
        'start',
        'complete',
        'cancel',
        'undo-check-in',
      ] as const) {
        const res = await act(
          other.id,
          action,
          action === 'start' || action === 'complete' ? doctorA : receptionist,
          { reason: 'again' },
        );
        expect(res.status).toBe(422);
      }
    });

    it('a doctor can have only one session in progress', async () => {
      const v1 = (await walkIn({ patientId: p1.id }).expect(201)).body;
      const v2 = (await walkIn({ patientId: p2.id }).expect(201)).body;
      await act(v1.id, 'start', doctorA).expect(200);
      const res = await act(v2.id, 'start', doctorA).expect(409);
      expect(res.body.code).toBe('DOCTOR_ALREADY_IN_SESSION');

      await act(v1.id, 'complete', doctorA).expect(200);
      await act(v2.id, 'start', doctorA).expect(200);
    });

    it('parallel starts for one doctor: exactly one succeeds', async () => {
      const v1 = (await walkIn({ patientId: p1.id }).expect(201)).body;
      const v2 = (await walkIn({ patientId: p2.id }).expect(201)).body;
      const v3 = (await walkIn({ patientId: p3.id }).expect(201)).body;
      const results = await Promise.all(
        [v1, v2, v3].map((v: { id: string }) => act(v.id, 'start', doctorA)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 409);
      expect(rejected).toHaveLength(2);
      for (const r of rejected)
        expect(r.body.code).toBe('DOCTOR_ALREADY_IN_SESSION');
    });

    it("only the visit's doctor or the owner: other doctors get 404, reception 403", async () => {
      const visit = (await walkIn({ patientId: p1.id }).expect(201)).body;
      await act(visit.id, 'start', doctorB).expect(404);
      await act(visit.id, 'start', receptionist).expect(403);
      await act(visit.id, 'start', owner).expect(200);
      await act(visit.id, 'complete', doctorB).expect(404);
      await act(visit.id, 'complete', owner).expect(200);
    });
  });

  // ---------- undo / cancel ----------

  describe('undo check-in vs cancel', () => {
    it('undo: visit CANCELLED, appointment back to CONFIRMED, and it can be checked in again', async () => {
      const events = captureEvents();
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const visit = (await checkIn(appointment.id).expect(201)).body;

      await act(visit.id, 'undo-check-in', receptionist, {}).expect(400);
      const res = await act(visit.id, 'undo-check-in', receptionist, {
        reason: 'Wrong patient selected',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Wrong patient selected',
        cancelledById: receptionist.id,
      });
      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['CONFIRMED', 'CHECKED_IN'],
        ['CHECKED_IN', 'CONFIRMED'],
      ]);
      await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'APPOINTMENT_CHECK_IN_UNDONE',
        entityId: appointment.id,
      });

      // The appointment can be checked in again (the cancelled visit doesn't count).
      await checkIn(appointment.id).expect(201);
      expect(events.map((e) => e.name)).toEqual([
        'visit.checked_in',
        'visit.cancelled',
        'visit.checked_in',
      ]);
    });

    it('cancel (patient left): visit and appointment CANCELLED with the same reason', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const visit = (await checkIn(appointment.id).expect(201)).body;

      await act(visit.id, 'cancel', receptionist, {
        reason: 'Patient left',
      }).expect(200);
      const stored = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ id: appointment.id });
      expect(stored).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Patient left',
      });
      await checkIn(appointment.id).expect(422);
    });

    it('the plain appointment endpoints cannot change a CHECKED_IN appointment', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      await checkIn(appointment.id).expect(201);
      for (const [path, body] of [
        ['confirm', {}],
        ['cancel', { reason: 'nope nope' }],
        ['no-show', {}],
      ] as const) {
        await request(server)
          .patch(`/api/v1/appointments/${appointment.id}/${path}`)
          .set('Authorization', bearer(receptionist))
          .send(body)
          .expect(422);
      }
      expect(await appointmentStatus(appointment.id)).toBe('CHECKED_IN');
    });
  });

  // ---------- reading ----------

  describe('queue, day list, open visits and lists', () => {
    async function busyMorning() {
      // 09:00 walk-in p1 (A), 09:10 check-in p2 (A), 09:20 walk-in p3 (B).
      const v1 = (await walkIn({ patientId: p1.id }).expect(201)).body;
      clock.current = local('09:10');
      const appointment = await insertAppointment(p2, doctorA, local('09:15'));
      const v2 = (await checkIn(appointment.id).expect(201)).body;
      clock.current = local('09:20');
      const v3 = (
        await walkIn({ patientId: p3.id, doctorId: doctorB.doctorId }).expect(
          201,
        )
      ).body;
      clock.current = local('09:15');
      await act(v1.id, 'start', doctorA).expect(200);
      clock.current = local('09:30');
      return { v1, v2, v3, appointment };
    }

    it('queue: ordered by check-in time with waitingMinutes', async () => {
      const { v1, v2, v3, appointment } = await busyMorning();

      const res = await request(server)
        .get(`/api/v1/visits/queue?date=${TODAY}`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(res.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v1.id,
        v2.id,
        v3.id,
      ]);
      expect(res.body[0]).toMatchObject({
        status: 'IN_SESSION',
        isWalkIn: true,
        appointmentStartAt: null,
        patient: { name: 'Patient One' },
        service: { name: 'Physio' },
        checkedInAt: iso('09:00'),
        waitingMinutes: 15, // waited until the session started
      });
      expect(res.body[1]).toMatchObject({
        status: 'WAITING',
        isWalkIn: false,
        appointmentId: appointment.id,
        appointmentStartAt: iso('09:15'),
        waitingMinutes: 20,
      });
      expect(res.body[2].waitingMinutes).toBe(10);

      const filtered = await request(server)
        .get(`/api/v1/visits/queue?doctorId=${doctorB.doctorId}`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(filtered.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v3.id,
      ]);

      // Doctors always get their own queue, whatever they ask for.
      const mine = await request(server)
        .get(`/api/v1/visits/queue?doctorId=${doctorB.doctorId}`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(mine.body).toEqual([]);
      const ownQueue = await request(server)
        .get('/api/v1/visits/queue')
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(ownQueue.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v1.id,
        v2.id,
      ]);

      // Finished visits leave the queue.
      await act(v1.id, 'complete', doctorA).expect(200);
      const after = await request(server)
        .get('/api/v1/visits/queue')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(after.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v2.id,
        v3.id,
      ]);
    });

    it('day list includes the visit of each appointment and the walk-ins, ordered by time', async () => {
      const { v1, v2, v3, appointment } = await busyMorning();
      const later = await insertAppointment(p1, doctorB, local('15:00'));

      const res = await request(server)
        .get(`/api/v1/appointments/day?date=${TODAY}`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(
        res.body.map(
          (r: {
            isWalkIn: boolean;
            id: string | null;
            visitId: string | null;
          }) => [r.isWalkIn, r.id, r.visitId],
        ),
      ).toEqual([
        [true, null, v1.id], // 09:00 check-in
        [false, appointment.id, v2.id], // 09:15 start
        [true, null, v3.id], // 09:20 check-in
        [false, later.id, null], // 15:00, not here yet
      ]);
      expect(res.body[1]).toMatchObject({
        status: 'CHECKED_IN',
        visitStatus: 'WAITING',
        checkedInAt: iso('09:10'),
      });
      expect(res.body[0]).toMatchObject({
        referenceCode: null,
        startAt: null,
        visitStatus: 'IN_SESSION',
        checkedInAt: iso('09:00'),
        patient: { name: 'Patient One' },
        nameMismatch: false,
      });
    });

    it('open visits lists forgotten visits from previous days only', async () => {
      clock.current = local('17:00', '2026-11-02');
      const forgotten = (await walkIn({ patientId: p1.id }).expect(201)).body;
      clock.current = local('09:00');
      await walkIn({ patientId: p2.id }).expect(201);

      const res = await request(server)
        .get('/api/v1/visits/open')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(res.body.map((v: { id: string }) => v.id)).toEqual([forgotten.id]);

      await request(server)
        .get('/api/v1/visits/open')
        .set('Authorization', bearer(doctorA))
        .expect(403);
    });

    it('lists with filters; doctors see only their own; history; patient visits across doctors', async () => {
      const { v1, v2, v3 } = await busyMorning();

      const walkIns = await request(server)
        .get('/api/v1/visits?walkIn=true')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(
        walkIns.body.items.map((v: { id: string }) => v.id).sort(),
      ).toEqual([v1.id, v3.id].sort());
      const booked = await request(server)
        .get('/api/v1/visits?walkIn=false&status=WAITING')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(booked.body.items.map((v: { id: string }) => v.id)).toEqual([
        v2.id,
      ]);

      const mine = await request(server)
        .get('/api/v1/visits')
        .set('Authorization', bearer(doctorB))
        .expect(200);
      expect(mine.body.items.map((v: { id: string }) => v.id)).toEqual([v3.id]);

      await request(server)
        .get(`/api/v1/visits/${v1.id}`)
        .set('Authorization', bearer(doctorB))
        .expect(404);
      await request(server)
        .get(`/api/v1/visits/${v1.id}/history`)
        .set('Authorization', bearer(doctorB))
        .expect(404);
      const history = await request(server)
        .get(`/api/v1/visits/${v1.id}/history`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(history.body.map((h: { toStatus: string }) => h.toStatus)).toEqual(
        ['WAITING', 'IN_SESSION'],
      );

      // Patient visits: every doctor's, including for doctors.
      await walkIn({ patientId: p3.id }).expect(409); // p3 still has an open visit
      await act(v3.id, 'cancel', receptionist, { reason: 'Left early' }).expect(
        200,
      );
      await walkIn({ patientId: p3.id }).expect(201);
      const p3Visits = await request(server)
        .get(`/api/v1/patients/${p3.id}/visits`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(p3Visits.body.meta.total).toBe(2);
      expect(
        new Set(
          p3Visits.body.items.map(
            (v: { doctor: { id: string } }) => v.doctor.id,
          ),
        ),
      ).toEqual(new Set([doctorA.doctorId, doctorB.doctorId]));
    });
  });
});

describe('VisitCompletionPolicy hook (e2e)', () => {
  let ctx: TestApp;
  let receptionist: TestUser;
  let doctor: DoctorUser;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder
        .overrideProvider(CLOCK)
        .useValue({ now: () => new Date('2026-11-03T09:00:00+02:00') })
        .overrideProvider(VISIT_COMPLETION_POLICY)
        .useValue({
          check: () =>
            Promise.resolve({
              allowed: false,
              reason: 'A signed clinical note is required',
            }),
        }),
    );
    await resetDatabase(ctx.dataSource);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('a rejecting policy blocks completion with 422 and nothing changes', async () => {
    const server = ctx.app.getHttpServer();
    const service = await insertService(ctx.dataSource);
    await assignService(ctx.dataSource, doctor.doctorId, service.id);
    const emitted: string[] = [];
    ctx.app
      .get(EventEmitter2)
      .on(VisitEvent.COMPLETED, () => emitted.push('completed'));

    const visit = (
      await request(server)
        .post('/api/v1/visits/walk-in')
        .set('Authorization', bearer(receptionist))
        .send({
          name: 'Walk In',
          phone: '01099999999',
          doctorId: doctor.doctorId,
          serviceId: service.id,
        })
        .expect(201)
    ).body;
    await request(server)
      .post(`/api/v1/visits/${visit.id}/start`)
      .set('Authorization', bearer(doctor))
      .expect(200);

    const res = await request(server)
      .post(`/api/v1/visits/${visit.id}/complete`)
      .set('Authorization', bearer(doctor))
      .expect(422);
    expect(res.body).toMatchObject({
      code: 'VISIT_COMPLETION_BLOCKED',
      message: 'A signed clinical note is required',
    });

    const stored = await ctx.dataSource
      .getRepository(Visit)
      .findOneByOrFail({ id: visit.id });
    expect(stored).toMatchObject({ status: 'IN_SESSION', completedAt: null });
    expect(
      await ctx.dataSource
        .getRepository(VisitStatusHistory)
        .countBy({ visitId: visit.id }),
    ).toBe(2);
    expect(
      await ctx.dataSource
        .getRepository(AuditLog)
        .countBy({ action: 'VISIT_COMPLETED' }),
    ).toBe(0);
    expect(emitted).toEqual([]);
  });
});
