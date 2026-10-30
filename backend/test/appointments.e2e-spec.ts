import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { AppointmentStatus } from '../src/modules/appointments/appointment.enums.js';
import { AppointmentStatusHistory } from '../src/modules/appointments/entities/appointment-status-history.entity.js';
import { Appointment } from '../src/modules/appointments/entities/appointment.entity.js';
import { AuditAction } from '../src/modules/audit/audit.constants.js';
import {
  AuditService,
  type AuditEntry,
} from '../src/modules/audit/audit.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import { Patient } from '../src/modules/patients/entities/patient.entity.js';
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
  insertWeeklySchedule,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Frozen "now": Monday 2026-11-02 08:00 Cairo (+02:00). Lead time 60 min.
const NOW = new Date('2026-11-02T08:00:00+02:00');
const TUESDAY = '2026-11-03';
const at = (time: string, date = TUESDAY) => `${date}T${time}:00+02:00`;

const PUBLIC_RESPONSE_KEYS = [
  'doctorName',
  'endAt',
  'referenceCode',
  'serviceName',
  'startAt',
  'status',
];

describe('Appointments (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let receptionist: TestUser;
  let doctorA: TestUser & { doctorId: string };
  let doctorBId: string;
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
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorBId = (await insertDoctor(ctx.dataSource)).id;
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'Physio session',
        durationMinutes: 30,
      })
    ).id;
    for (const id of [doctorA.doctorId, doctorBId]) {
      await assignService(ctx.dataSource, id, serviceId);
      await insertWeeklySchedule(ctx.dataSource, id, [['08:00', '20:00']]);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const publicBook = (overrides: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/public/appointments')
      .send({
        name: 'Mona Ali',
        phone: '01012345678',
        doctorId: doctorA.doctorId,
        serviceId,
        startAt: at('10:00'),
        ...overrides,
      });

  const staffBook = (
    overrides: Record<string, unknown> = {},
    as = receptionist,
  ) =>
    request(server)
      .post('/api/v1/appointments')
      .set('Authorization', bearer(as))
      .send({
        name: 'Ahmed Hassan',
        phone: '01112345678',
        doctorId: doctorA.doctorId,
        serviceId,
        startAt: at('11:00'),
        ...overrides,
      });

  const patch = (
    id: string,
    action: string,
    body: Record<string, unknown> = {},
  ) =>
    request(server)
      .patch(`/api/v1/appointments/${id}/${action}`)
      .set('Authorization', bearer(receptionist))
      .send(body);

  const appointmentRow = (id: string) =>
    ctx.dataSource.getRepository(Appointment).findOneByOrFail({ id });

  const historyOf = async (id: string) =>
    (
      await ctx.dataSource.getRepository(AppointmentStatusHistory).find({
        where: { appointmentId: id },
        order: { changedAt: 'ASC', id: 'ASC' },
      })
    ).map((h) => [h.fromStatus, h.toStatus]);

  describe('public booking', () => {
    it('creates a PENDING ONLINE appointment and returns ONLY the booking', async () => {
      const res = await publicBook().expect(201);

      expect(Object.keys(res.body).sort()).toEqual(PUBLIC_RESPONSE_KEYS);
      expect(res.body).toMatchObject({
        startAt: '2026-11-03T10:00:00+02:00',
        endAt: '2026-11-03T10:30:00+02:00',
        status: 'PENDING',
        serviceName: 'Physio session',
      });
      expect(res.body.referenceCode).toMatch(/^APT-[A-Z2-9]{6}$/);

      const appointment = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: res.body.referenceCode });
      expect(appointment).toMatchObject({
        status: 'PENDING',
        source: 'ONLINE',
        bookedName: 'Mona Ali',
        bookedById: null,
      });
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(appointment.patientId);
      expect(serialized).not.toContain('+201012345678');

      expect(await historyOf(appointment.id)).toEqual([[null, 'PENDING']]);
      const audit = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({
          action: 'APPOINTMENT_CREATED',
          entityId: appointment.id,
        });
      expect(audit.userId).toBeNull();
    });

    it('never accepts an end time from the client', async () => {
      await publicBook({ endAt: at('12:00') }).expect(400);
    });

    it('links an existing phone to the existing patient without renaming, and flags it for reception', async () => {
      const first = await staffBook({
        name: 'Ahmed Hassan',
        phone: '01012345678',
      }).expect(201);
      const newPhone = await publicBook({
        phone: '01512345678',
        startAt: at('12:00'),
      }).expect(201);

      const res = await publicBook({
        name: 'Mohamed Ali',
        startAt: at('14:00'),
      }).expect(201);
      // Same response shape whether or not the phone existed.
      expect(Object.keys(res.body).sort()).toEqual(
        Object.keys(newPhone.body).sort(),
      );

      const patients = ctx.dataSource.getRepository(Patient);
      expect(await patients.countBy({ phone: '+201012345678' })).toBe(1);
      const patient = await patients.findOneByOrFail({
        phone: '+201012345678',
      });
      expect(patient.name).toBe('Ahmed Hassan');
      expect(patient.id).toBe(first.body.patient.id);

      const day = await request(server)
        .get(`/api/v1/appointments/day?date=${TUESDAY}`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      const row = day.body.find(
        (a: { referenceCode: string }) =>
          a.referenceCode === res.body.referenceCode,
      );
      expect(row).toMatchObject({
        bookedName: 'Mohamed Ali',
        nameMismatch: true,
        patient: { name: 'Ahmed Hassan', phone: '+201012345678' },
        doctor: { id: doctorA.doctorId },
        service: { name: 'Physio session' },
        status: 'PENDING',
      });
      const staffRow = day.body.find(
        (a: { referenceCode: string }) =>
          a.referenceCode === first.body.referenceCode,
      );
      expect(staffRow.nameMismatch).toBe(false);
    });

    it('rejects a filled honeypot', async () => {
      await publicBook({ website: 'http://spam.example' }).expect(400);
      expect(await ctx.dataSource.getRepository(Appointment).count()).toBe(0);
      expect(await ctx.dataSource.getRepository(Patient).count()).toBe(0);
    });

    it('allows at most 3 active future appointments per phone', async () => {
      for (const time of ['09:00', '10:00', '11:00']) {
        await publicBook({ startAt: at(time) }).expect(201);
      }
      const res = await publicBook({ startAt: at('12:00') }).expect(409);
      expect(res.body).toMatchObject({ code: 'BOOKING_LIMIT_REACHED' });
      expect(JSON.stringify(res.body)).not.toMatch(/patient/i);

      // Cancelling one frees a place.
      const one = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ startAt: new Date(at('09:00')) });
      await patch(one.id, 'cancel', { reason: 'Patient called' }).expect(200);
      await publicBook({ startAt: at('12:00') }).expect(201);
    });

    it('10 parallel bookings of one slot: exactly 1 succeeds, 9 get SLOT_UNAVAILABLE', async () => {
      const phones = Array.from({ length: 10 }, (_, i) =>
        `0101234560${i}`.slice(0, 11),
      );
      const results = await Promise.all(
        phones.map((phone, i) =>
          publicBook({ phone, name: `Racer Number${i}` }),
        ),
      );

      const created = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(9);
      for (const res of conflicts)
        expect(res.body.code).toBe('SLOT_UNAVAILABLE');

      expect(await ctx.dataSource.getRepository(Appointment).count()).toBe(1);
      // Losers' patients were rolled back with their transactions.
      expect(await ctx.dataSource.getRepository(Patient).count()).toBe(1);
    });

    it('same phone with two doctors at overlapping times -> PATIENT_OVERLAP', async () => {
      await publicBook({ startAt: at('10:00') }).expect(201);
      const res = await publicBook({
        doctorId: doctorBId,
        startAt: at('10:15'),
      }).expect(409);
      expect(res.body.code).toBe('PATIENT_OVERLAP');
      // Back-to-back is fine.
      await publicBook({ doctorId: doctorBId, startAt: at('10:30') }).expect(
        201,
      );
    });

    it('validates the slot against schedule, grid, lead time and range', async () => {
      const outside = await publicBook({ startAt: at('07:00') }).expect(422);
      expect(outside.body.code).toBe('OUTSIDE_SCHEDULE');
      await publicBook({ startAt: at('10:07') }).expect(422);
      // Today 08:30 is inside the 60 min lead time ("now" is 08:00).
      await publicBook({ startAt: at('08:30', '2026-11-02') }).expect(422);
      const far = await publicBook({
        startAt: at('10:00', '2026-12-10'),
      }).expect(422);
      expect(far.body.code).toBe('DATE_OUT_OF_RANGE');
      await publicBook({ startAt: '2026-11-03T10:00:00' }).expect(400);
      // Same instant expressed in UTC is accepted.
      await publicBook({ startAt: '2026-11-03T08:00:00Z' }).expect(201);
    });

    it('404 for doctors not listed publicly; 422 for services not offered', async () => {
      await ctx.dataSource
        .getRepository(Doctor)
        .update(doctorBId, { isPublic: false });
      await publicBook({ doctorId: doctorBId }).expect(404);
      const other = await insertService(ctx.dataSource, { name: 'Other' });
      const res = await publicBook({ serviceId: other.id }).expect(422);
      expect(res.body.code).toBe('SERVICE_NOT_OFFERED');
    });

    it('booked slots disappear from availability', async () => {
      await publicBook({ startAt: at('10:00') }).expect(201);
      const res = await request(server)
        .get(
          `/api/v1/public/doctors/${doctorA.doctorId}/slots?serviceId=${serviceId}&date=${TUESDAY}`,
        )
        .expect(200);
      const starts = res.body.map((s: { startAt: string }) => s.startAt);
      expect(starts).toContain(at('09:30'));
      expect(starts).not.toContain(at('09:45'));
      expect(starts).not.toContain(at('10:00'));
      expect(starts).not.toContain(at('10:15'));
      expect(starts).toContain(at('10:30'));
    });
  });

  describe('staff booking', () => {
    it('creates CONFIRMED RECEPTION appointments by name + phone or patientId', async () => {
      const res = await staffBook().expect(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        source: 'RECEPTION',
        bookedName: 'Ahmed Hassan',
        bookedById: receptionist.id,
        nameMismatch: false,
        startAt: at('11:00'),
        endAt: at('11:30'),
        patient: { name: 'Ahmed Hassan', phone: '+201112345678' },
      });

      const second = await request(server)
        .post('/api/v1/appointments')
        .set('Authorization', bearer(receptionist))
        .send({
          patientId: res.body.patient.id,
          doctorId: doctorBId,
          serviceId,
          startAt: at('15:00'),
          notes: 'Prefers the ground floor room',
        })
        .expect(201);
      expect(second.body.notes).toBe('Prefers the ground floor room');
    });

    it('requires exactly one way to identify the patient', async () => {
      await staffBook({
        patientId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);
      await request(server)
        .post('/api/v1/appointments')
        .set('Authorization', bearer(receptionist))
        .send({ doctorId: doctorA.doctorId, serviceId, startAt: at('11:00') })
        .expect(400);
      await staffBook({ phone: undefined }).expect(400);
    });

    describe('backdating with allowOutsideSchedule (BACKDATE_MAX_DAYS = 7)', () => {
      // "now" is 2026-11-02, so the oldest local date a receptionist may use is 2026-10-26.
      it('a receptionist may go back up to 7 local days, not further', async () => {
        await staffBook({
          startAt: at('10:00', '2026-10-26'),
          allowOutsideSchedule: true,
        }).expect(201);

        const res = await staffBook({
          phone: '01212345678',
          // Cairo is still on summer time (+03:00) before 2026-10-29.
          startAt: '2026-10-25T23:30:00+03:00',
          allowOutsideSchedule: true,
        }).expect(422);
        expect(res.body).toMatchObject({
          code: 'BACKDATE_LIMIT_EXCEEDED',
          details: { earliestDate: '2026-10-26' },
        });
      });

      it('the owner may backdate further', async () => {
        const owner = await createLoggedInUser(
          ctx.app,
          ctx.dataSource,
          UserRole.OWNER,
        );
        await staffBook(
          { startAt: at('10:00', '2026-10-01'), allowOutsideSchedule: true },
          owner,
        ).expect(201);
      });

      it('the same limit applies to rescheduling into the past', async () => {
        const booked = await staffBook().expect(201);
        await request(server)
          .post(`/api/v1/appointments/${booked.body.id}/reschedule`)
          .set('Authorization', bearer(receptionist))
          .send({
            startAt: at('10:00', '2026-10-20'),
            allowOutsideSchedule: true,
          })
          .expect(422)
          .expect(({ body }) =>
            expect(body.code).toBe('BACKDATE_LIMIT_EXCEEDED'),
          );
        expect((await appointmentRow(booked.body.id)).status).toBe('CONFIRMED');
      });
    });

    it('allowOutsideSchedule skips schedule checks (audited) but never the overlap rules', async () => {
      await staffBook({ startAt: at('22:00') }).expect(422);

      const res = await staffBook({
        startAt: at('22:00'),
        allowOutsideSchedule: true,
      }).expect(201);
      await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'APPOINTMENT_SCHEDULE_OVERRIDE',
        entityId: res.body.id,
      });

      const clash = await staffBook({
        phone: '01212345678',
        name: 'Someone Else',
        startAt: at('22:15'),
        allowOutsideSchedule: true,
      }).expect(409);
      expect(clash.body.code).toBe('SLOT_UNAVAILABLE');
    });
  });

  describe('status changes', () => {
    it('PENDING -> CONFIRMED -> CANCELLED with history and audit', async () => {
      const booked = await publicBook().expect(201);
      const { id } = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: booked.body.referenceCode });

      await patch(id, 'confirm')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('CONFIRMED'));
      const again = await patch(id, 'confirm').expect(422);
      expect(again.body).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        details: { from: 'CONFIRMED', to: 'CONFIRMED' },
      });

      await patch(id, 'cancel', {}).expect(400);
      const cancelled = await patch(id, 'cancel', {
        reason: 'Patient travelling',
      }).expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Patient travelling',
      });
      await patch(id, 'confirm').expect(422);

      const history = await request(server)
        .get(`/api/v1/appointments/${id}/history`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(
        history.body.map(
          (h: { fromStatus: string | null; toStatus: string }) => [
            h.fromStatus,
            h.toStatus,
          ],
        ),
      ).toEqual([
        [null, 'PENDING'],
        ['PENDING', 'CONFIRMED'],
        ['CONFIRMED', 'CANCELLED'],
      ]);
      expect(history.body[2]).toMatchObject({
        reason: 'Patient travelling',
        changedById: receptionist.id,
      });

      const actions = (
        await ctx.dataSource
          .getRepository(AuditLog)
          .find({ where: { entityId: id }, order: { createdAt: 'ASC' } })
      ).map((log) => log.action);
      expect(actions).toEqual([
        'APPOINTMENT_CREATED',
        'APPOINTMENT_CONFIRMED',
        'APPOINTMENT_CANCELLED',
      ]);

      // A cancelled appointment no longer blocks its slot.
      await publicBook({ phone: '01512345678' }).expect(201);
    });

    it('PENDING cannot become NO_SHOW or RESCHEDULED', async () => {
      const booked = await publicBook().expect(201);
      const { id } = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: booked.body.referenceCode });
      await patch(id, 'no-show').expect(422);
      await request(server)
        .post(`/api/v1/appointments/${id}/reschedule`)
        .set('Authorization', bearer(receptionist))
        .send({ startAt: at('12:00') })
        .expect(422)
        .expect(({ body }) =>
          expect(body.code).toBe('INVALID_STATUS_TRANSITION'),
        );
    });

    it('NO_SHOW only after the start time', async () => {
      const future = await staffBook().expect(201);
      const early = await patch(future.body.id, 'no-show').expect(422);
      expect(early.body.code).toBe('NO_SHOW_TOO_EARLY');

      // 07:00 today is before "now" (08:00); booked at the desk after the fact.
      const past = await staffBook({
        phone: '01212345678',
        startAt: at('07:00', '2026-11-02'),
        allowOutsideSchedule: true,
      }).expect(201);
      await patch(past.body.id, 'no-show')
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('NO_SHOW'));
      await patch(past.body.id, 'cancel', { reason: 'too late' }).expect(422);
    });

    it('a failure after the update leaves no trace (status, history and audit roll back together)', async () => {
      const booked = await publicBook().expect(201);
      const { id } = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: booked.body.referenceCode });

      const audit = ctx.app.get(AuditService);
      const original = audit.log.bind(audit);
      vi.spyOn(audit, 'log').mockImplementation((entry: AuditEntry, manager) =>
        entry.action === AuditAction.APPOINTMENT_CONFIRMED
          ? Promise.reject(new Error('simulated failure'))
          : original(entry, manager),
      );

      await patch(id, 'confirm').expect(500);

      expect((await appointmentRow(id)).status).toBe(AppointmentStatus.PENDING);
      expect(await historyOf(id)).toEqual([[null, 'PENDING']]);
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'APPOINTMENT_CONFIRMED' }),
      ).toBe(0);
    });
  });

  describe('reschedule', () => {
    it('creates the new CONFIRMED appointment and marks the old one RESCHEDULED atomically', async () => {
      const original = await staffBook({ startAt: at('11:00') }).expect(201);

      // Overlaps the old time by 15 minutes: fine, the old one stops blocking first.
      const res = await request(server)
        .post(`/api/v1/appointments/${original.body.id}/reschedule`)
        .set('Authorization', bearer(receptionist))
        .send({ startAt: at('11:15'), reason: 'Patient asked' })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        rescheduledFromId: original.body.id,
        startAt: at('11:15'),
        patient: { id: original.body.patient.id },
        bookedName: 'Ahmed Hassan',
      });
      expect((await appointmentRow(original.body.id)).status).toBe(
        'RESCHEDULED',
      );
      expect(await historyOf(original.body.id)).toEqual([
        [null, 'CONFIRMED'],
        ['CONFIRMED', 'RESCHEDULED'],
      ]);

      // Can move to another doctor offering the same service.
      const moved = await request(server)
        .post(`/api/v1/appointments/${res.body.id}/reschedule`)
        .set('Authorization', bearer(receptionist))
        .send({ startAt: at('16:00'), doctorId: doctorBId })
        .expect(201);
      expect(moved.body.doctor.id).toBe(doctorBId);
    });

    it('rolls everything back when the new slot is taken', async () => {
      const mine = await staffBook({ startAt: at('11:00') }).expect(201);
      await staffBook({
        phone: '01212345678',
        name: 'Other Patient',
        startAt: at('13:00'),
      }).expect(201);

      const res = await request(server)
        .post(`/api/v1/appointments/${mine.body.id}/reschedule`)
        .set('Authorization', bearer(receptionist))
        .send({ startAt: at('13:00') })
        .expect(409);
      expect(res.body.code).toBe('SLOT_UNAVAILABLE');

      expect((await appointmentRow(mine.body.id)).status).toBe('CONFIRMED');
      expect(await historyOf(mine.body.id)).toEqual([[null, 'CONFIRMED']]);
      expect(await ctx.dataSource.getRepository(Appointment).count()).toBe(2);
      expect(
        await ctx.dataSource
          .getRepository(AuditLog)
          .countBy({ action: 'APPOINTMENT_RESCHEDULED' }),
      ).toBe(0);
    });
  });

  describe('reading', () => {
    it('lists with filters, finds by id and by reference code, and per patient', async () => {
      const a = await staffBook({ startAt: at('11:00') }).expect(201);
      await staffBook({ startAt: at('15:00'), doctorId: doctorBId }).expect(
        201,
      );
      const online = await publicBook({ startAt: at('09:00') }).expect(201);

      const byDoctor = await request(server)
        .get(`/api/v1/appointments?doctorId=${doctorBId}`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(byDoctor.body.meta.total).toBe(1);

      const bySource = await request(server)
        .get('/api/v1/appointments?source=ONLINE&status=PENDING')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(
        bySource.body.items.map(
          (x: { referenceCode: string }) => x.referenceCode,
        ),
      ).toEqual([online.body.referenceCode]);

      const range = await request(server)
        .get(
          `/api/v1/appointments?from=${encodeURIComponent(at('10:00'))}&to=${encodeURIComponent(at('12:00'))}`,
        )
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(range.body.items.map((x: { id: string }) => x.id)).toEqual([
        a.body.id,
      ]);

      await request(server)
        .get(
          `/api/v1/appointments/by-reference/${online.body.referenceCode.toLowerCase()}`,
        )
        .set('Authorization', bearer(receptionist))
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('PENDING'));

      const history = await request(server)
        .get(`/api/v1/patients/${a.body.patient.id}/appointments`)
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(history.body.meta.total).toBe(2);
      expect(
        history.body.items.map((x: { startAt: string }) => x.startAt),
      ).toEqual([at('11:00'), at('15:00')]);
    });

    it("doctors see only their own appointments; others' are 404", async () => {
      const mine = await staffBook({ startAt: at('11:00') }).expect(201);
      const theirs = await staffBook({
        startAt: at('15:00'),
        doctorId: doctorBId,
      }).expect(201);

      const list = await request(server)
        .get('/api/v1/appointments')
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([
        mine.body.id,
      ]);

      const filtered = await request(server)
        .get(`/api/v1/appointments?doctorId=${doctorBId}`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(filtered.body.meta.total).toBe(0);

      await request(server)
        .get(`/api/v1/appointments/${mine.body.id}`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      for (const path of [
        `/api/v1/appointments/${theirs.body.id}`,
        `/api/v1/appointments/${theirs.body.id}/history`,
        `/api/v1/appointments/by-reference/${theirs.body.referenceCode}`,
      ]) {
        await request(server)
          .get(path)
          .set('Authorization', bearer(doctorA))
          .expect(404);
      }

      const patientHistory = await request(server)
        .get(`/api/v1/patients/${mine.body.patient.id}/appointments`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(
        patientHistory.body.items.map((x: { id: string }) => x.id),
      ).toEqual([mine.body.id]);
    });
  });

  it('time off over booked appointments is created and reports them without cancelling', async () => {
    const booked = await staffBook({ startAt: at('11:00') }).expect(201);

    const res = await request(server)
      .post(`/api/v1/doctors/${doctorA.doctorId}/time-off`)
      .set('Authorization', bearer(receptionist))
      .send({ startAt: at('10:00'), endAt: at('12:00'), reason: 'Emergency' })
      .expect(201);
    expect(res.body.conflictingAppointments).toEqual([
      {
        id: booked.body.id,
        referenceCode: booked.body.referenceCode,
        startAt: at('11:00'),
        endAt: at('11:30'),
        status: 'CONFIRMED',
        patientName: 'Ahmed Hassan',
      },
    ]);
    expect((await appointmentRow(booked.body.id)).status).toBe('CONFIRMED');
  });
});

describe('Public booking rate limiting (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(getOptionsToken()).useValue({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
      }),
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('allows 5 booking attempts per IP per 15 minutes, then 429', async () => {
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/v1/public/appointments')
        .send({})
        .expect(400);
    }
    await request(server)
      .post('/api/v1/public/appointments')
      .send({})
      .expect(429);
  });
});
