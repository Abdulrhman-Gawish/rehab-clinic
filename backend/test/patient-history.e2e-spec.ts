import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import {
  BILLING_EVENTS,
  CLINICAL_EVENTS,
  TimelineEventType as T,
} from '../src/modules/patient-history/patient-history.enums.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertService,
  insertWeeklySchedule,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Uploaded files go to a throw-away folder (git-ignored).
vi.hoisted(() => {
  process.env.STORAGE_LOCAL_PATH = '.tmp/e2e-storage';
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake x-ray'),
]);

// "Today" is Tuesday 2026-11-03 in Cairo (+02:00). Every action moves the
// clock one minute so clock-stamped events have a strict order.
const TODAY = '2026-11-03';
const iso = (time: string, date = TODAY) => `${date}T${time}:00+02:00`;
const clock = { current: new Date(iso('08:00')) };
const tick = () => {
  clock.current = new Date(clock.current.getTime() + 60_000);
};

type DoctorUser = TestUser & { doctorId: string };

interface Event {
  id: string;
  type: T;
  at: string;
  actor: { id: string; name: string } | null;
  doctor: { id: string; name: string } | null;
  refs: Record<string, string>;
  data: Record<string, unknown>;
}

// What the scenario in beforeAll produces for the main patient.
const EXPECTED: Record<T, number> = {
  [T.PATIENT_CREATED]: 1,
  [T.PATIENT_UPDATED]: 1,
  [T.APPOINTMENT_BOOKED]: 4,
  [T.APPOINTMENT_CONFIRMED]: 1,
  [T.APPOINTMENT_RESCHEDULED]: 1,
  [T.APPOINTMENT_CANCELLED]: 1,
  [T.APPOINTMENT_NO_SHOW]: 2,
  [T.NO_SHOW_UNDONE]: 1,
  [T.VISIT_ATTENDED]: 3,
  [T.ATTEND_UNDONE]: 1,
  [T.INVOICE_ISSUED]: 3,
  [T.INVOICE_CANCELLED]: 1,
  [T.DISCOUNT_APPLIED]: 2,
  [T.DISCOUNT_REMOVED]: 1,
  [T.PAYMENT_RECORDED]: 2,
  [T.PAYMENT_VOIDED]: 1,
  [T.PAYMENT_REFUNDED]: 1,
  [T.NOTE_SIGNED]: 1,
  [T.ADDENDUM_ADDED]: 1,
  [T.MEDICAL_INFO_UPDATED]: 1,
  [T.ATTACHMENT_UPLOADED]: 1,
};
const ALL_TYPES = Object.values(T);
const TOTAL = Object.values(EXPECTED).reduce((sum, n) => sum + n, 0);

function countByType(events: Event[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return counts;
}

function expectedFor(hidden: readonly T[]): Partial<Record<T, number>> {
  return Object.fromEntries(
    ALL_TYPES.filter((t) => !hidden.includes(t)).map((t) => [t, EXPECTED[t]]),
  );
}

describe('Patient history (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: DoctorUser;
  let doctorB: DoctorUser;
  let doctorC: DoctorUser;
  let serviceId: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  const api = (path: string) => `/api/v1${path}`;
  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  async function post(
    path: string,
    by: TestUser,
    body: object = {},
  ): Promise<Record<string, any>> {
    tick();
    const res = await request(server).post(api(path)).set(as(by)).send(body);
    if (res.status >= 300) {
      throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function send(
    method: 'put' | 'patch',
    path: string,
    by: TestUser,
    body: object,
  ): Promise<Record<string, any>> {
    tick();
    const res = await request(server)[method](api(path)).set(as(by)).send(body);
    expect(res.status).toBe(200);
    return res.body;
  }

  const timeline = (by: TestUser, query = '', id = patientId) =>
    request(server)
      .get(api(`/patients/${id}/timeline${query}`))
      .set(as(by));

  async function allEvents(by: TestUser, query = ''): Promise<Event[]> {
    const res = await timeline(by, `?limit=200${query}`).expect(200);
    expect(res.body.nextCursor).toBeNull();
    return res.body.items;
  }

  const overview = (by: TestUser, id = patientId) =>
    request(server)
      .get(api(`/patients/${id}/overview`))
      .set(as(by));

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
    await resetDatabase(ctx.dataSource);

    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorC = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (await insertService(ctx.dataSource)).id;
    for (const doctor of [doctorA, doctorB, doctorC]) {
      await assignService(ctx.dataSource, doctor.doctorId, serviceId);
      await insertWeeklySchedule(ctx.dataSource, doctor.doctorId);
    }

    // ---- patient ----
    patientId = (
      await post('/patients', receptionist, {
        name: 'Mona Ali',
        phone: '01011111111',
      })
    ).id;
    await send('patch', `/patients/${patientId}`, receptionist, {
      name: 'Mona Ali Hassan',
    });
    // Not a name/phone change: no event.
    await send('patch', `/patients/${patientId}`, receptionist, {
      notes: 'Prefers mornings',
    });

    // ---- appointments ----
    const book = (startAt: string, doctorId = doctorA.doctorId) =>
      post('/appointments', receptionist, {
        patientId,
        doctorId,
        serviceId,
        startAt,
        allowOutsideSchedule: true,
      });
    // 07:00 no-show that stays.
    const missed = await book(iso('07:00'));
    // 08:00: no-show, undone, then attended (visit + invoice).
    ids.attended = (await book(iso('08:00'))).id;
    clock.current = new Date(iso('08:40'));
    await post(`/appointments/${missed.id}/no-show`, receptionist);
    await post(`/appointments/${ids.attended}/no-show`, receptionist);
    await post(`/appointments/${ids.attended}/undo-no-show`, receptionist);
    const attend = await post(
      `/appointments/${ids.attended}/attend`,
      receptionist,
    );
    ids.visitA = attend.id;
    ids.invoiceA = attend.invoiceId;

    // Online booking (PENDING), confirmed, then rescheduled.
    tick();
    const online = await request(server)
      .post(api('/public/appointments'))
      .send({
        name: 'Mona',
        phone: '01011111111',
        doctorId: doctorA.doctorId,
        serviceId,
        startAt: iso('10:00', '2026-11-04'),
      })
      .expect(201);
    ids.online = (
      await request(server)
        .get(api(`/appointments/by-reference/${online.body.referenceCode}`))
        .set(as(receptionist))
        .expect(200)
    ).body.id;
    await post(`/appointments/${ids.online}/confirm`, receptionist);
    ids.rescheduled = (
      await post(`/appointments/${ids.online}/reschedule`, receptionist, {
        startAt: iso('11:00', '2026-11-05'),
      })
    ).id;
    // Cancelled (doctor B).
    const cancelled = await book(iso('12:00', '2026-11-06'), doctorB.doctorId);
    await post(`/appointments/${cancelled.id}/cancel`, receptionist, {
      reason: 'Patient travelling',
    });

    // ---- walk-ins with doctor B: one undone, one with a DRAFT note ----
    const walkIn = () =>
      post('/visits/walk-in', receptionist, {
        patientId,
        doctorId: doctorB.doctorId,
        serviceId,
      });
    const undone = await walkIn();
    await post(`/visits/${undone.id}/undo-attend`, receptionist, {
      reason: 'Sent in by mistake',
    });
    ids.visitB = (await walkIn()).id;
    await send('put', `/visits/${ids.visitB}/note`, doctorB, {
      assessment: 'Draft only',
    });

    // ---- billing on the attended visit's invoice (300.00) ----
    const discount = (body: object) =>
      post(`/invoices/${ids.invoiceA}/discount`, receptionist, body);
    await discount({ type: 'PERCENT', value: '10', reason: 'Loyal patient' });
    await post(`/invoices/${ids.invoiceA}/discount/remove`, receptionist, {
      reason: 'Owner did not approve',
    });
    await discount({ type: 'FIXED', value: '50', reason: 'Student' });
    const pay = (amount: string, method: string) =>
      post(`/invoices/${ids.invoiceA}/payments`, receptionist, {
        amount,
        method,
      });
    ids.cash = (await pay('100.00', 'CASH')).id;
    ids.card = (await pay('50.00', 'CARD')).id;
    await post(`/payments/${ids.card}/void`, receptionist, {
      reason: 'Typed twice',
    });

    // ---- clinical (doctor A) ----
    await send('put', `/visits/${ids.visitA}/note`, doctorA, {
      assessment: 'x'.repeat(250),
    });
    ids.note = (await post(`/visits/${ids.visitA}/note/sign`, doctorA)).id;
    await post(`/clinical-notes/${ids.note}/addenda`, doctorA, {
      content: 'Pain improved',
    });
    await send('put', `/patients/${patientId}/medical-info`, doctorA, {
      allergies: 'Penicillin',
    });
    tick();
    await request(server)
      .post(api(`/patients/${patientId}/attachments`))
      .set(as(doctorA))
      .field('title', 'Knee X-ray')
      .attach('file', PNG, 'xray.png')
      .expect(201);

    // ---- the refund happens the next day ----
    clock.current = new Date(iso('10:00', '2026-11-04'));
    await post(`/payments/${ids.cash}/refund`, owner, {
      amount: '30.00',
      reason: 'Overcharged',
    });

    // ---- another patient: none of this may leak ----
    const other = await post('/patients', receptionist, {
      name: 'Other Patient',
      phone: '01022222222',
    });
    const otherVisit = await post('/visits/walk-in', receptionist, {
      patientId: other.id,
      doctorId: doctorA.doctorId,
      serviceId,
    });
    await post(`/invoices/${otherVisit.invoiceId}/payments`, receptionist, {
      amount: '300.00',
      method: 'CASH',
    });
    clock.current = new Date(iso('12:00', '2026-11-04'));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('GET /patients/:id/timeline', () => {
    it('returns every event type for the OWNER, newest first', async () => {
      const events = await allEvents(owner);

      expect(events).toHaveLength(TOTAL);
      expect(countByType(events)).toEqual(EXPECTED);
      for (const event of events) {
        expect(Object.keys(event).sort()).toEqual(
          ['actor', 'at', 'data', 'doctor', 'id', 'refs', 'type'].sort(),
        );
      }
      // Sorted by (at, id) descending.
      for (let i = 1; i < events.length; i++) {
        const [newer, older] = [events[i - 1], events[i]];
        const diff = Date.parse(newer.at) - Date.parse(older.at);
        expect(diff > 0 || (diff === 0 && newer.id > older.id)).toBe(true);
      }
      // Clock-stamped billing events come out in reverse order of entry.
      const billing = events
        .filter((e) => e.refs.invoiceId === ids.invoiceA)
        .filter((e) => e.type !== T.INVOICE_ISSUED)
        .map((e) => e.type);
      expect(billing).toEqual([
        T.PAYMENT_REFUNDED,
        T.PAYMENT_VOIDED,
        T.PAYMENT_RECORDED,
        T.PAYMENT_RECORDED,
        T.DISCOUNT_APPLIED,
        T.DISCOUNT_REMOVED,
        T.DISCOUNT_APPLIED,
      ]);
    });

    it('describes each event with its actor, doctor, refs and data', async () => {
      const events = await allEvents(owner);
      const one = (type: T) => events.filter((e) => e.type === type);

      expect(one(T.PATIENT_UPDATED)[0]).toMatchObject({
        actor: { id: receptionist.id },
        doctor: null,
        refs: {},
        data: {
          oldValues: { name: 'Mona Ali' },
          newValues: { name: 'Mona Ali Hassan' },
        },
      });
      const online = one(T.APPOINTMENT_BOOKED).find(
        (e) => e.refs.appointmentId === ids.online,
      );
      expect(online).toMatchObject({
        actor: null,
        doctor: { id: doctorA.doctorId },
        data: {
          source: 'ONLINE',
          bookedName: 'Mona',
          startAt: '2026-11-04T10:00:00+02:00',
          service: { id: serviceId, name: 'Session' },
        },
      });
      expect(one(T.APPOINTMENT_RESCHEDULED)[0]).toMatchObject({
        refs: { appointmentId: ids.rescheduled },
        data: {
          previousAppointmentId: ids.online,
          oldStartAt: '2026-11-04T10:00:00+02:00',
          newStartAt: '2026-11-05T11:00:00+02:00',
        },
      });
      expect(one(T.APPOINTMENT_CANCELLED)[0]).toMatchObject({
        doctor: { id: doctorB.doctorId },
        data: { reason: 'Patient travelling' },
      });
      const walkIns = one(T.VISIT_ATTENDED).filter((e) => e.data.isWalkIn);
      expect(walkIns).toHaveLength(2);
      expect(one(T.ATTEND_UNDONE)[0].data).toMatchObject({
        isWalkIn: true,
        reason: 'Sent in by mistake',
      });
      // The visit's invoice is issued by whoever attended it.
      expect(
        one(T.INVOICE_ISSUED).find((e) => e.refs.invoiceId === ids.invoiceA),
      ).toMatchObject({
        actor: { id: receptionist.id },
        doctor: { id: doctorA.doctorId },
        refs: { visitId: ids.visitA, invoiceId: ids.invoiceA },
        data: { total: '250.00' },
      });
      expect(one(T.DISCOUNT_APPLIED).map((e) => e.data)).toEqual([
        expect.objectContaining({
          type: 'FIXED',
          value: '50.00',
          amount: '50.00',
          reason: 'Student',
          isRepeat: false,
        }),
        expect.objectContaining({
          type: 'PERCENT',
          value: '10.00',
          amount: '30.00',
          reason: 'Loyal patient',
        }),
      ]);
      expect(one(T.PAYMENT_VOIDED)[0]).toMatchObject({
        refs: { paymentId: ids.card },
        data: { amount: '50.00', method: 'CARD', reason: 'Typed twice' },
      });
      expect(one(T.PAYMENT_REFUNDED)[0]).toMatchObject({
        actor: { id: owner.id },
        at: '2026-11-04T10:01:00+02:00',
        data: {
          amount: '30.00',
          method: 'CASH',
          reason: 'Overcharged',
          refundOfPaymentId: ids.cash,
        },
      });
      const signed = one(T.NOTE_SIGNED)[0];
      expect(signed).toMatchObject({
        actor: { id: doctorA.id },
        doctor: { id: doctorA.doctorId },
        refs: { visitId: ids.visitA, noteId: ids.note },
      });
      expect(signed.data.assessment).toBe('x'.repeat(200));
      expect(one(T.ADDENDUM_ADDED)[0].data).toEqual({
        content: 'Pain improved',
      });
      expect(one(T.MEDICAL_INFO_UPDATED)[0]).toMatchObject({
        doctor: { id: doctorA.doctorId },
        data: { fields: ['allergies'] },
      });
      expect(one(T.ATTACHMENT_UPLOADED)[0].data).toMatchObject({
        title: 'Knee X-ray',
        mimeType: 'image/png',
      });
    });

    it('pages with the cursor and returns every event exactly once', async () => {
      const all = await allEvents(owner);
      const paged: Event[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?limit=7&cursor=${cursor}` : '?limit=7';
        const res = await timeline(owner, query).expect(200);
        expect(res.body.items.length).toBeLessThanOrEqual(7);
        paged.push(...res.body.items);
        cursor = res.body.nextCursor;
      } while (cursor);

      expect(paged.map((e) => e.id)).toEqual(all.map((e) => e.id));
      expect(new Set(paged.map((e) => e.id)).size).toBe(TOTAL);
    });

    it('rejects a malformed cursor and a limit above 200', async () => {
      await timeline(owner, '?cursor=not-a-cursor').expect(400);
      await timeline(owner, '?limit=201').expect(400);
    });

    it('filters by event types', async () => {
      const events = await allEvents(
        owner,
        `&types=${T.PAYMENT_RECORDED},${T.PAYMENT_VOIDED}`,
      );
      expect(countByType(events)).toEqual({
        [T.PAYMENT_RECORDED]: 2,
        [T.PAYMENT_VOIDED]: 1,
      });
      await timeline(owner, '?types=NOPE').expect(400);
    });

    it('filters by local dates (inclusive)', async () => {
      const nextDay = await allEvents(owner, '&from=2026-11-04&to=2026-11-04');
      expect(nextDay.map((e) => e.type)).toContain(T.PAYMENT_REFUNDED);
      for (const e of nextDay) expect(e.at.startsWith('2026-11-04')).toBe(true);

      const today = await allEvents(owner, '&from=2026-11-03&to=2026-11-03');
      expect(today.map((e) => e.type)).not.toContain(T.PAYMENT_REFUNDED);
      expect(countByType(today)[T.PAYMENT_RECORDED]).toBe(2);
      for (const e of today) expect(e.at.startsWith('2026-11-03')).toBe(true);
    });

    it('hides clinical events from the RECEPTIONIST', async () => {
      expect(countByType(await allEvents(receptionist))).toEqual(
        expectedFor(CLINICAL_EVENTS),
      );
      // Asking for them explicitly doesn't help.
      expect(await allEvents(receptionist, `&types=${T.NOTE_SIGNED}`)).toEqual(
        [],
      );
    });

    it('hides billing events from a DOCTOR with access', async () => {
      for (const doctor of [doctorA, doctorB]) {
        expect(countByType(await allEvents(doctor))).toEqual(
          expectedFor(BILLING_EVENTS),
        );
      }
    });

    it('never shows draft notes, not even to their author', async () => {
      for (const user of [doctorB, owner]) {
        const notes = (await allEvents(user)).filter(
          (e) => e.refs.visitId === ids.visitB && e.refs.noteId,
        );
        expect(notes).toEqual([]);
      }
    });

    it('answers 404 to a doctor without access and for an unknown patient', async () => {
      await timeline(doctorC).expect(404);
      await timeline(owner, '', randomUUID()).expect(404);
    });
  });

  describe('GET /patients/:id/overview', () => {
    const patientFields = {
      id: expect.any(String),
      name: 'Mona Ali Hassan',
      phone: '+201011111111',
      createdSource: 'RECEPTION',
      createdAt: expect.any(String),
    };

    it('gives the OWNER everything', async () => {
      const { body } = await overview(owner).expect(200);
      expect(body).toEqual({
        patient: { ...patientFields, id: patientId },
        nextAppointment: {
          id: ids.rescheduled,
          startAt: '2026-11-05T11:00:00+02:00',
          status: 'CONFIRMED',
          doctor: { id: doctorA.doctorId, name: expect.any(String) },
          service: { id: serviceId, name: 'Session' },
        },
        lastVisit: {
          id: ids.visitB,
          attendedAt: expect.stringMatching(/^2026-11-03T/),
          isWalkIn: true,
          doctor: { id: doctorB.doctorId, name: expect.any(String) },
          service: { id: serviceId, name: 'Session' },
        },
        counts: { attended: 2, noShow: 1, cancelled: 1 },
        doctors: [
          {
            id: doctorB.doctorId,
            name: expect.any(String),
            lastVisitAt: body.lastVisit.attendedAt,
          },
          {
            id: doctorA.doctorId,
            name: expect.any(String),
            lastVisitAt: expect.stringMatching(/^2026-11-03T08:4/),
          },
        ],
        // Invoice A 250.00 (70.00 paid after the refund) + walk-in 300.00;
        // the undone walk-in's invoice is cancelled.
        balance: {
          patientId,
          totalInvoiced: '550.00',
          totalPaid: '70.00',
          balance: '480.00',
        },
        notesNeedingAttention: [
          {
            visitId: ids.visitB,
            attendedAt: body.lastVisit.attendedAt,
            doctor: { id: doctorB.doctorId, name: expect.any(String) },
            service: { id: serviceId, name: 'Session' },
            noteStatus: 'DRAFT',
          },
        ],
      });
    });

    it('gives the RECEPTIONIST no clinical data', async () => {
      const { body } = await overview(receptionist).expect(200);
      expect(body.notesNeedingAttention).toBeNull();
      expect(body.balance).toMatchObject({ balance: '480.00' });
      expect(body.counts).toEqual({ attended: 2, noShow: 1, cancelled: 1 });
    });

    it('gives a DOCTOR no billing, and only their own notes to write', async () => {
      const a = (await overview(doctorA).expect(200)).body;
      expect(a.balance).toBeNull();
      expect(a.notesNeedingAttention).toEqual([]);
      expect(a.doctors).toHaveLength(2);

      const b = (await overview(doctorB).expect(200)).body;
      expect(b.balance).toBeNull();
      expect(b.notesNeedingAttention).toEqual([
        expect.objectContaining({ visitId: ids.visitB, noteStatus: 'DRAFT' }),
      ]);
    });

    it('answers 404 to a doctor without access and for an unknown patient', async () => {
      await overview(doctorC).expect(404);
      await overview(owner, randomUUID()).expect(404);
    });
  });
});
