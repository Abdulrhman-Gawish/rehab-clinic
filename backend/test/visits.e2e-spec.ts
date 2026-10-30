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
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { InvoicesService } from '../src/modules/billing/invoices.service.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import {
  Patient,
  PatientSource,
} from '../src/modules/patients/entities/patient.entity.js';
import { VisitStatusHistory } from '../src/modules/visits/entities/visit-status-history.entity.js';
import { Visit } from '../src/modules/visits/entities/visit.entity.js';
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
  'attendedAt',
  'attendedBy',
  'createdAt',
  'doctor',
  'id',
  'isWalkIn',
  'patient',
  'service',
  'status',
  'updatedAt',
  'voidReason',
  'voidedAt',
  'voidedBy',
];

type DoctorUser = TestUser & { doctorId: string };

describe('Desk workflow: attend, walk-in, undo, day list (e2e)', () => {
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

  const attend = (appointmentId: string, as: TestUser = receptionist) =>
    request(server)
      .post(`/api/v1/appointments/${appointmentId}/attend`)
      .set('Authorization', bearer(as));

  const undoAttend = (
    appointmentId: string,
    body: Record<string, unknown> = { reason: 'Sent in by mistake' },
  ) =>
    request(server)
      .post(`/api/v1/appointments/${appointmentId}/undo-attend`)
      .set('Authorization', bearer(receptionist))
      .send(body);

  const undoVisit = (visitId: string, reason = 'Registered by mistake') =>
    request(server)
      .post(`/api/v1/visits/${visitId}/undo-attend`)
      .set('Authorization', bearer(receptionist))
      .send({ reason });

  const walkIn = (body: Record<string, unknown>, as: TestUser = receptionist) =>
    request(server)
      .post('/api/v1/visits/walk-in')
      .set('Authorization', bearer(as))
      .send({ doctorId: doctorA.doctorId, serviceId, ...body });

  const dayList = (as: TestUser = receptionist, query = '') =>
    request(server)
      .get(`/api/v1/appointments/day?date=${TODAY}${query}`)
      .set('Authorization', bearer(as))
      .expect(200);

  const writeNote = (visitId: string, as: DoctorUser) =>
    request(server)
      .put(`/api/v1/visits/${visitId}/note`)
      .set('Authorization', bearer(as))
      .send({ assessment: 'Seen' })
      .expect(200);

  const pay = (invoiceId: string, amount = '100') =>
    request(server)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer(receptionist))
      .send({ amount, method: 'CASH' })
      .expect(201);

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

  const invoiceOf = (id: string) =>
    ctx.dataSource.getRepository(Invoice).findOneByOrFail({ id });

  // ---------- attend ----------

  describe('attend', () => {
    it('from CONFIRMED: appointment ATTENDED, ACTIVE visit and its invoice, in one go', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));

      const res = await attend(appointment.id).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(
        [...VISIT_KEYS, 'invoiceId', 'package'].sort(),
      );
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        isWalkIn: false,
        appointmentId: appointment.id,
        appointmentStartAt: iso('09:30'),
        patient: { id: p1.id, name: 'Patient One' },
        doctor: { id: doctorA.doctorId },
        service: { id: serviceId },
        attendedAt: iso('09:00'),
        attendedBy: { id: receptionist.id, name: expect.any(String) },
        voidedAt: null,
        invoiceId: expect.any(String),
      });
      expect(await invoiceOf(res.body.invoiceId)).toMatchObject({
        visitId: res.body.id,
        patientId: p1.id,
        status: 'ISSUED',
      });

      expect(await appointmentStatus(appointment.id)).toBe('ATTENDED');
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['CONFIRMED', 'ATTENDED'],
      ]);
      expect(await visitHistory(res.body.id)).toEqual([[null, 'ACTIVE']]);
      const actions = (await ctx.dataSource.getRepository(AuditLog).find()).map(
        (l) => l.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'APPOINTMENT_ATTENDED',
          'VISIT_ATTENDED',
          'INVOICE_CREATED',
        ]),
      );
    });

    it('from PENDING directly (confirming is optional)', async () => {
      const appointment = await insertAppointment(
        p1,
        doctorA,
        local('09:30'),
        AppointmentStatus.PENDING,
      );
      await attend(appointment.id).expect(201);
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['PENDING', 'ATTENDED'],
      ]);
    });

    it("only on the appointment's local day; late arrival the same day is fine", async () => {
      const tomorrow = await insertAppointment(
        p1,
        doctorA,
        local('09:30', '2026-11-04'),
      );
      const res = await attend(tomorrow.id).expect(422);
      expect(res.body.code).toBe('ATTEND_WRONG_DAY');
      const yesterday = await insertAppointment(
        p2,
        doctorA,
        local('09:30', '2026-11-02'),
      );
      await attend(yesterday.id).expect(422);

      const late = await insertAppointment(p3, doctorA, local('07:00'));
      await attend(late.id).expect(201);
    });

    it('cancelled, rescheduled or no-show appointments cannot attend', async () => {
      for (const [patient, status] of [
        [p1, AppointmentStatus.CANCELLED],
        [p2, AppointmentStatus.RESCHEDULED],
        [p3, AppointmentStatus.NO_SHOW],
      ] as const) {
        const appointment = await insertAppointment(
          patient,
          doctorA,
          local('08:00'),
          status,
        );
        const res = await attend(appointment.id).expect(422);
        expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      }
      expect(await ctx.dataSource.getRepository(Visit).count()).toBe(0);
    });

    it('5 parallel attends of one appointment create exactly one visit and one invoice', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const results = await Promise.all(
        Array.from({ length: 5 }, () => attend(appointment.id)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 409);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) expect(r.body.code).toBe('ALREADY_ATTENDED');
      expect(
        await ctx.dataSource
          .getRepository(Visit)
          .countBy({ appointmentId: appointment.id }),
      ).toBe(1);
      expect(await ctx.dataSource.getRepository(Invoice).count()).toBe(1);
    });

    it('the invoice is part of the transaction: if it fails, nothing persists (attend and walk-in)', async () => {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      vi.spyOn(
        ctx.app.get(InvoicesService),
        'createForVisit',
      ).mockRejectedValue(new Error('billing is down'));

      await attend(appointment.id).expect(500);
      await walkIn({ patientId: p2.id }).expect(500);

      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
      expect(await appointmentHistory(appointment.id)).toEqual([]);
      expect(await ctx.dataSource.getRepository(Visit).count()).toBe(0);
      expect(
        await ctx.dataSource.getRepository(VisitStatusHistory).count(),
      ).toBe(0);
      expect(await ctx.dataSource.getRepository(Invoice).count()).toBe(0);
      expect(
        await ctx.dataSource.getRepository(AuditLog).countBy({
          action: 'VISIT_ATTENDED',
        }),
      ).toBe(0);
    });
  });

  // ---------- walk-in ----------

  describe('walk-in', () => {
    it('with a new phone creates the patient and an ACTIVE visit with its invoice', async () => {
      const res = await walkIn({
        name: 'New Person',
        phone: '0155 555 5555',
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        isWalkIn: true,
        appointmentId: null,
        appointmentStartAt: null,
        attendedAt: iso('09:00'),
        patient: { name: 'New Person', phone: '+201555555555' },
        invoiceId: expect.any(String),
      });
      expect((await invoiceOf(res.body.invoiceId)).visitId).toBe(res.body.id);
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
  });

  // ---------- undo attend ----------

  describe('undo attend', () => {
    async function attended(): Promise<{
      appointment: Appointment;
      visitId: string;
      invoiceId: string;
    }> {
      const appointment = await insertAppointment(p1, doctorA, local('09:30'));
      const res = await attend(appointment.id).expect(201);
      return {
        appointment,
        visitId: res.body.id,
        invoiceId: res.body.invoiceId,
      };
    }

    it('voids the visit, cancels the unpaid invoice and puts the appointment back to CONFIRMED', async () => {
      const { appointment, visitId, invoiceId } = await attended();

      await undoAttend(appointment.id, {}).expect(400); // reason required
      clock.current = local('09:10');
      const res = await undoAttend(appointment.id, {
        reason: 'Wrong patient sent in',
      }).expect(200);
      expect(res.body).toMatchObject({
        id: visitId,
        status: 'VOIDED',
        voidedAt: iso('09:10'),
        voidedBy: { id: receptionist.id, name: expect.any(String) },
        voidReason: 'Wrong patient sent in',
      });
      expect(await invoiceOf(invoiceId)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Wrong patient sent in',
        cancelledById: receptionist.id,
      });
      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
      expect(await appointmentHistory(appointment.id)).toEqual([
        ['CONFIRMED', 'ATTENDED'],
        ['ATTENDED', 'CONFIRMED'],
      ]);
      expect(await visitHistory(visitId)).toEqual([
        [null, 'ACTIVE'],
        ['ACTIVE', 'VOIDED'],
      ]);
      const actions = (await ctx.dataSource.getRepository(AuditLog).find()).map(
        (l) => l.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'APPOINTMENT_ATTEND_UNDONE',
          'VISIT_VOIDED',
          'INVOICE_CANCELLED',
        ]),
      );

      // It can attend again: a new visit and a new invoice.
      const again = await attend(appointment.id).expect(201);
      expect(again.body.id).not.toBe(visitId);
      expect(again.body.invoiceId).not.toBe(invoiceId);
    });

    it('blocked once the doctor has written a note', async () => {
      const { appointment, visitId } = await attended();
      await writeNote(visitId, doctorA);
      const res = await undoAttend(appointment.id).expect(422);
      expect(res.body.code).toBe('VISIT_HAS_NOTE');
      expect(await appointmentStatus(appointment.id)).toBe('ATTENDED');
    });

    it('blocked while the invoice has payments; allowed after voiding them', async () => {
      const { appointment, invoiceId } = await attended();
      const payment = await pay(invoiceId);
      const res = await undoAttend(appointment.id).expect(422);
      expect(res.body.code).toBe('INVOICE_HAS_PAYMENTS');
      expect((await invoiceOf(invoiceId)).status).toBe('PARTIALLY_PAID');

      await request(server)
        .post(`/api/v1/payments/${payment.body.id}/void`)
        .set('Authorization', bearer(receptionist))
        .send({ reason: 'Typed the wrong amount' })
        .expect(200);
      await undoAttend(appointment.id).expect(200);
      expect((await invoiceOf(invoiceId)).status).toBe('CANCELLED');
    });

    it('same local day only; only an ATTENDED appointment', async () => {
      const { appointment } = await attended();
      clock.current = local('09:00', '2026-11-04');
      const res = await undoAttend(appointment.id).expect(422);
      expect(res.body.code).toBe('UNDO_WRONG_DAY');

      clock.current = local('09:00');
      const confirmed = await insertAppointment(p2, doctorA, local('10:00'));
      const wrong = await undoAttend(confirmed.id).expect(422);
      expect(wrong.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('a walk-in is undone through its visit (same rules); an appointment visit too', async () => {
      const walk = await walkIn({ patientId: p2.id }).expect(201);
      const res = await undoVisit(walk.body.id).expect(200);
      expect(res.body).toMatchObject({
        status: 'VOIDED',
        voidReason: 'Registered by mistake',
      });
      expect((await invoiceOf(walk.body.invoiceId)).status).toBe('CANCELLED');
      const again = await undoVisit(walk.body.id).expect(422);
      expect(again.body.code).toBe('VISIT_VOIDED');

      const paid = await walkIn({ patientId: p3.id }).expect(201);
      await pay(paid.body.invoiceId);
      expect((await undoVisit(paid.body.id).expect(422)).body.code).toBe(
        'INVOICE_HAS_PAYMENTS',
      );

      const { appointment, visitId } = await attended();
      await undoVisit(visitId).expect(200);
      expect(await appointmentStatus(appointment.id)).toBe('CONFIRMED');
    });
  });

  // ---------- day list ----------

  describe('day list', () => {
    it('appointments with their visit plus walk-ins, ordered by time, with billing', async () => {
      const early = await insertAppointment(p1, doctorA, local('08:30'));
      clock.current = local('08:40');
      const visit = (await attend(early.id).expect(201)).body;
      clock.current = local('09:20');
      const walk = (
        await walkIn({ patientId: p3.id, doctorId: doctorB.doctorId }).expect(
          201,
        )
      ).body;
      const later = await insertAppointment(p2, doctorB, local('15:00'));

      const res = await dayList();
      expect(
        res.body.map(
          (r: {
            isWalkIn: boolean;
            id: string | null;
            visitId: string | null;
          }) => [r.isWalkIn, r.id, r.visitId],
        ),
      ).toEqual([
        [false, early.id, visit.id], // 08:30 start
        [true, null, walk.id], // 09:20 attended
        [false, later.id, null], // 15:00, not here yet
      ]);
      expect(res.body[0]).toMatchObject({
        status: 'ATTENDED',
        visitStatus: 'ACTIVE',
        attendedAt: iso('08:40'),
        noteStatus: null,
        invoiceId: visit.invoiceId,
        invoiceTotal: '300.00',
        paymentStatus: 'UNPAID',
      });
      expect(res.body[1]).toMatchObject({
        referenceCode: null,
        startAt: null,
        visitStatus: 'ACTIVE',
        attendedAt: iso('09:20'),
        patient: { name: 'Patient Three' },
        nameMismatch: false,
      });
      expect(res.body[2]).toMatchObject({ paymentStatus: 'NOT_INVOICED' });
    });

    it('status filter takes several values (repeated or comma-separated); walk-ins count as ATTENDED', async () => {
      const pending = await insertAppointment(
        p1,
        doctorA,
        local('10:00'),
        AppointmentStatus.PENDING,
      );
      const confirmed = await insertAppointment(p2, doctorA, local('11:00'));
      await insertAppointment(
        p3,
        doctorB,
        local('12:00'),
        AppointmentStatus.CANCELLED,
      );
      const walk = (await walkIn({ patientId: p3.id }).expect(201)).body;

      const ids = (body: { id: string | null; visitId: string | null }[]) =>
        body.map((r) => r.id ?? r.visitId);
      expect(
        ids((await dayList(receptionist, '&status=PENDING,CONFIRMED')).body),
      ).toEqual([pending.id, confirmed.id]);
      expect(
        ids(
          (await dayList(receptionist, '&status=PENDING&status=ATTENDED')).body,
        ),
      ).toEqual([walk.id, pending.id]);
      await request(server)
        .get(`/api/v1/appointments/day?date=${TODAY}&status=WAITING`)
        .set('Authorization', bearer(receptionist))
        .expect(400);
    });

    it('allowedActions follow the status, the time and the undo rules', async () => {
      clock.current = local('11:00');
      const futurePending = await insertAppointment(
        p1,
        doctorA,
        local('16:00'),
        AppointmentStatus.PENDING,
      );
      const startedConfirmed = await insertAppointment(
        p2,
        doctorA,
        local('10:00'),
      );
      const attendedFree = await insertAppointment(p3, doctorA, local('09:00'));
      await attend(attendedFree.id).expect(201);
      const p4 = await insertPatient('Patient Four', '+201000000004');
      const attendedWithNote = await insertAppointment(
        p4,
        doctorB,
        local('09:00'),
      );
      const noted = (await attend(attendedWithNote.id).expect(201)).body;
      await writeNote(noted.id, doctorB);
      const p5 = await insertPatient('Patient Five', '+201000000005');
      const noShow = await insertAppointment(
        p5,
        doctorB,
        local('08:00'),
        AppointmentStatus.NO_SHOW,
      );
      const p6 = await insertPatient('Patient Six', '+201000000006');
      const cancelled = await insertAppointment(
        p6,
        doctorB,
        local('13:00'),
        AppointmentStatus.CANCELLED,
      );
      const walk = (
        await walkIn({ name: 'Walk In', phone: '01099999999' }).expect(201)
      ).body;

      const rows = (await dayList()).body as {
        id: string | null;
        visitId: string | null;
        allowedActions: string[];
      }[];
      const actionsOf = (id: string) =>
        rows.find((r) => (r.id ?? r.visitId) === id)?.allowedActions;
      expect(actionsOf(futurePending.id)).toEqual([
        'confirm',
        'cancel',
        'reschedule',
        'attend',
      ]);
      expect(actionsOf(startedConfirmed.id)).toEqual([
        'cancel',
        'reschedule',
        'noShow',
        'attend',
      ]);
      expect(actionsOf(attendedFree.id)).toEqual(['undoAttend']);
      expect(actionsOf(attendedWithNote.id)).toEqual([]);
      expect(actionsOf(noShow.id)).toEqual(['undoNoShow']);
      expect(actionsOf(cancelled.id)).toEqual([]);
      expect(actionsOf(walk.id)).toEqual(['undoAttend']);

      // The next day, nothing can be undone any more.
      clock.current = local('09:00', '2026-11-04');
      const nextDay = (await dayList()).body as typeof rows;
      expect(
        nextDay.find((r) => r.id === attendedFree.id)?.allowedActions,
      ).toEqual([]);
      expect(nextDay.find((r) => r.id === noShow.id)?.allowedActions).toEqual(
        [],
      );
    });

    it('a doctor gets only their own rows, PENDING included, without billing fields', async () => {
      const pending = await insertAppointment(
        p1,
        doctorA,
        local('10:00'),
        AppointmentStatus.PENDING,
      );
      const seen = await insertAppointment(p2, doctorA, local('08:30'));
      const visit = (await attend(seen.id).expect(201)).body;
      const signedVisit = (await walkIn({ patientId: p3.id }).expect(201)).body;
      await writeNote(signedVisit.id, doctorA);
      await request(server)
        .post(`/api/v1/visits/${signedVisit.id}/note/sign`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      await insertAppointment(p3, doctorB, local('11:00'));

      // A doctor's doctorId filter is always their own.
      const res = await dayList(doctorA, `&doctorId=${doctorB.doctorId}`);
      expect(
        res.body.map(
          (r: { id: string | null; visitId: string | null }) =>
            r.id ?? r.visitId,
        ),
      ).toEqual([seen.id, signedVisit.id, pending.id]);
      for (const row of res.body) {
        expect(row).not.toHaveProperty('invoiceId');
        expect(row).not.toHaveProperty('invoiceTotal');
        expect(row).not.toHaveProperty('amountPaid');
        expect(row).not.toHaveProperty('balance');
        expect(row).not.toHaveProperty('paymentStatus');
      }
      expect(res.body[0]).toMatchObject({
        visitId: visit.id,
        noteStatus: null,
        allowedActions: ['writeNote'],
      });
      expect(res.body[1]).toMatchObject({
        noteStatus: 'SIGNED',
        allowedActions: ['viewNote'],
      });
      expect(res.body[2]).toMatchObject({
        status: 'PENDING',
        allowedActions: [],
      });
    });
  });

  // ---------- queue and lists ----------

  describe('queue and lists', () => {
    async function busyMorning() {
      // 09:00 walk-in p1 (A), 09:10 attend p2 (A), 09:20 walk-in p3 (B).
      const v1 = (await walkIn({ patientId: p1.id }).expect(201)).body;
      clock.current = local('09:10');
      const appointment = await insertAppointment(p2, doctorA, local('09:15'));
      const v2 = (await attend(appointment.id).expect(201)).body;
      clock.current = local('09:20');
      const v3 = (
        await walkIn({ patientId: p3.id, doctorId: doctorB.doctorId }).expect(
          201,
        )
      ).body;
      return { v1, v2, v3, appointment };
    }

    it("queue: the day's ACTIVE visits in attend order; doctors get their own", async () => {
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
      expect(res.body[1]).toEqual({
        visitId: v2.id,
        isWalkIn: false,
        appointmentId: appointment.id,
        appointmentStartAt: iso('09:15'),
        patient: { id: p2.id, name: 'Patient Two', phone: '+201000000002' },
        doctor: { id: doctorA.doctorId, name: expect.any(String) },
        service: { id: serviceId, name: 'Physio', durationMinutes: 30 },
        attendedAt: iso('09:10'),
        hasNote: false,
        noteStatus: null,
      });

      const own = await request(server)
        .get(`/api/v1/visits/queue?doctorId=${doctorB.doctorId}`)
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(own.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v1.id,
        v2.id,
      ]);

      // Voided visits leave the queue.
      await undoVisit(v1.id).expect(200);
      const after = await request(server)
        .get('/api/v1/visits/queue')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(after.body.map((q: { visitId: string }) => q.visitId)).toEqual([
        v2.id,
        v3.id,
      ]);
    });

    it('lists with filters; doctors see only their own; history; patient visits across doctors', async () => {
      const { v1, v2, v3 } = await busyMorning();
      await undoVisit(v3.id).expect(200);

      const walkIns = await request(server)
        .get('/api/v1/visits?walkIn=true')
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(
        walkIns.body.items.map((v: { id: string }) => v.id).sort(),
      ).toEqual([v1.id, v3.id].sort());
      const voided = await request(server)
        .get('/api/v1/visits?status=VOIDED')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(voided.body.items.map((v: { id: string }) => v.id)).toEqual([
        v3.id,
      ]);

      const mine = await request(server)
        .get('/api/v1/visits')
        .set('Authorization', bearer(doctorA))
        .expect(200);
      expect(mine.body.items.map((v: { id: string }) => v.id)).toEqual([
        v2.id,
        v1.id,
      ]);
      await request(server)
        .get(`/api/v1/visits/${v3.id}`)
        .set('Authorization', bearer(doctorA))
        .expect(404);
      await request(server)
        .get(`/api/v1/visits/${v3.id}/history`)
        .set('Authorization', bearer(doctorA))
        .expect(404);
      const history = await request(server)
        .get(`/api/v1/visits/${v3.id}/history`)
        .set('Authorization', bearer(doctorB))
        .expect(200);
      expect(history.body.map((h: { toStatus: string }) => h.toStatus)).toEqual(
        ['ACTIVE', 'VOIDED'],
      );

      // Patient visits: every doctor's, including for doctors.
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
