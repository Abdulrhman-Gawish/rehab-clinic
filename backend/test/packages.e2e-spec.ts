import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { AuditAction } from '../src/modules/audit/audit.constants.js';
import {
  AuditService,
  type AuditEntry,
} from '../src/modules/audit/audit.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { InvoiceItem } from '../src/modules/billing/entities/invoice-item.entity.js';
import { Doctor } from '../src/modules/doctors/entities/doctor.entity.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { PatientPackage } from '../src/modules/packages/entities/patient-package.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertAppointment,
  insertPatient,
  insertService,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Frozen clock: "today" is Tuesday 2026-11-03 in Cairo (+02:00), 09:00.
const TODAY = '2026-11-03';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('09:00') };

type DoctorUser = TestUser & { doctorId: string };
interface DayRow {
  id: string;
  allowedActions: string[];
  package: { usageId: string; patientPackageId: string } | null;
}

const PUBLIC_KEYS = [
  'allDoctors',
  'doctors',
  'id',
  'name',
  'offerEndsOn',
  'price',
  'sellingPrice',
  'service',
  'sessionsCount',
];
const PRICE_KEYS = [
  'listPrice',
  'offerAmount',
  'price',
  'invoiceId',
  'invoiceTotal',
  'amountPaid',
  'balance',
];

describe('Packages (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorA: DoctorUser;
  let doctorB: DoctorUser;
  let physioId: string;
  let massageId: string;
  let patient: Patient;
  let slot: number;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = local('09:00');
    slot = 0;
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    physioId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        basePrice: '300.00',
      })
    ).id;
    massageId = (
      await insertService(ctx.dataSource, {
        name: 'Massage',
        basePrice: '200.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctorA.doctorId, physioId);
    await assignService(ctx.dataSource, doctorB.doctorId, physioId);
    await assignService(ctx.dataSource, doctorA.doctorId, massageId);
    patient = await insertPatient(ctx.dataSource, 'Sara Ali', '+201000000001');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // ---------- helpers ----------

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Authorization', bearer(user)),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    patch: (path: string, body: object = {}) =>
      request(server)
        .patch(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
    delete: (path: string) =>
      request(server)
        .delete(`/api/v1${path}`)
        .set('Authorization', bearer(user)),
  });

  async function createPackage(overrides: Record<string, unknown> = {}) {
    const res = await as(owner)
      .post('/packages', {
        name: '3 physio sessions',
        serviceId: physioId,
        sessionsCount: 3,
        price: '900.00',
        allDoctors: true,
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string };
  }

  async function sell(packageId: string) {
    const res = await as(receptionist)
      .post(`/patients/${patient.id}/packages`, { packageId })
      .expect(201);
    return res.body as { id: string; invoiceId: string };
  }

  // Appointments of the patient today, 30 min apart from 06:00 (all have
  // started at 09:00, so they can attend or be marked no-show).
  function appointment(doctor: DoctorUser, serviceId = physioId) {
    const minutes = 6 * 60 + 30 * slot++;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return insertAppointment(ctx.dataSource, {
      patientId: patient.id,
      doctorId: doctor.doctorId,
      serviceId,
      startAt: local(time),
    });
  }

  const attend = (appointmentId: string, body: object = {}) =>
    as(receptionist).post(`/appointments/${appointmentId}/attend`, body);

  const lines = (invoiceId: string) =>
    ctx.dataSource.getRepository(InvoiceItem).findBy({ invoiceId });

  const stored = (id: string) =>
    ctx.dataSource.getRepository(PatientPackage).findOneByOrFail({ id });

  const dayRow = async (user: TestUser, appointmentId: string) => {
    const res = await as(user)
      .get(`/appointments/day?date=${TODAY}`)
      .expect(200);
    return (res.body as DayRow[]).find((r) => r.id === appointmentId);
  };

  // ---------- catalog ----------

  describe('catalog', () => {
    it("creates a package with its doctors and an offer; the list shows today's selling price", async () => {
      const pkg = await createPackage({
        allDoctors: undefined,
        doctorIds: [doctorA.doctorId],
        offer: {
          type: 'PERCENT',
          value: '20',
          startsOn: '2026-11-01',
          endsOn: '2026-11-30',
        },
      });
      expect(pkg).toMatchObject({
        name: '3 physio sessions',
        service: { id: physioId, name: 'Physio' },
        sessionsCount: 3,
        price: '900.00',
        allDoctors: false,
        doctors: [{ id: doctorA.doctorId, name: expect.any(String) }],
        offer: {
          type: 'PERCENT',
          value: '20.00',
          startsOn: '2026-11-01',
          endsOn: '2026-11-30',
        },
        offerActive: true,
        sellingPrice: '720.00',
        isPublic: true,
        isActive: true,
      });

      const list = await as(receptionist).get('/packages').expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].sellingPrice).toBe('720.00');
      await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'PACKAGE_CREATED', entityId: pkg.id });
    });

    it('the offer price applies only inside the offer dates (sale too)', async () => {
      const pkg = await createPackage({
        offer: {
          type: 'FIXED',
          value: '100',
          startsOn: '2026-11-05',
          endsOn: '2026-11-06',
        },
      });
      const priceOn = async (date: string) => {
        clock.current = local('09:00', date);
        const { body } = await as(owner).get(`/packages/${pkg.id}`).expect(200);
        return [body.offerActive, body.sellingPrice];
      };
      expect(await priceOn('2026-11-04')).toEqual([false, '900.00']);
      expect(await priceOn('2026-11-05')).toEqual([true, '800.00']);
      expect(await priceOn('2026-11-06')).toEqual([true, '800.00']);

      clock.current = local('09:00', '2026-11-06');
      const sold = await sell(pkg.id);
      expect(sold).toMatchObject({
        listPrice: '900.00',
        offerAmount: '100.00',
        price: '800.00',
        invoiceTotal: '800.00',
      });

      expect(await priceOn('2026-11-07')).toEqual([false, '900.00']);
    });

    it('rejects an offer that would make the price negative or a percent above 100', async () => {
      const res = await as(owner)
        .post('/packages', {
          name: 'Too generous',
          serviceId: physioId,
          sessionsCount: 3,
          price: '900.00',
          allDoctors: true,
          offer: { type: 'FIXED', value: '900.01' },
        })
        .expect(422);
      expect(res.body.code).toBe('OFFER_EXCEEDS_PRICE');

      await as(owner)
        .post('/packages', {
          name: 'Too generous',
          serviceId: physioId,
          sessionsCount: 3,
          price: '900.00',
          allDoctors: true,
          offer: { type: 'PERCENT', value: '101' },
        })
        .expect(400);

      // Lowering the price under an existing FIXED offer.
      const pkg = await createPackage({
        offer: { type: 'FIXED', value: '500' },
      });
      const patched = await as(owner)
        .patch(`/packages/${pkg.id}`, { price: '400.00' })
        .expect(422);
      expect(patched.body.code).toBe('OFFER_EXCEEDS_PRICE');
    });

    it('every listed doctor must offer the service; doctorIds or allDoctors, not both', async () => {
      const res = await as(owner)
        .post('/packages', {
          name: 'Massage pack',
          serviceId: massageId,
          sessionsCount: 5,
          price: '800.00',
          doctorIds: [doctorA.doctorId, doctorB.doctorId],
        })
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'SERVICE_NOT_OFFERED',
        details: { doctorIds: [doctorB.doctorId] },
      });

      const body = {
        name: 'Pack',
        serviceId: physioId,
        sessionsCount: 3,
        price: '900.00',
      };
      await as(owner).post('/packages', body).expect(400);
      await as(owner)
        .post('/packages', {
          ...body,
          allDoctors: true,
          doctorIds: [doctorA.doctorId],
        })
        .expect(400);
    });

    it('PATCH replaces the doctors and removes the offer; a deactivated package is not sold', async () => {
      const pkg = await createPackage({
        offer: { type: 'PERCENT', value: '10' },
      });
      const res = await as(owner)
        .patch(`/packages/${pkg.id}`, {
          doctorIds: [doctorB.doctorId],
          offer: null,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        allDoctors: false,
        doctors: [{ id: doctorB.doctorId }],
        offer: null,
        offerActive: false,
        sellingPrice: '900.00',
      });
      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'PACKAGE_UPDATED', entityId: pkg.id });
      expect(log.newValues).toMatchObject({
        allDoctors: false,
        doctorIds: doctorB.doctorId,
        offerType: null,
      });

      await as(owner).patch(`/packages/${pkg.id}/deactivate`).expect(200);
      const sale = await as(receptionist)
        .post(`/patients/${patient.id}/packages`, { packageId: pkg.id })
        .expect(422);
      expect(sale.body.code).toBe('PACKAGE_INACTIVE');
    });

    it('deactivate stops sales for a while; DELETE removes the package for good, sold ones keep working', async () => {
      const pkg = await createPackage();
      const sold = await sell(pkg.id);

      // Deactivating works even when the service itself is off.
      await as(owner)
        .patch(`/clinic-services/${physioId}/deactivate`)
        .expect(200);
      await as(owner).patch(`/packages/${pkg.id}/deactivate`).expect(200);
      await as(owner)
        .patch(`/clinic-services/${physioId}/activate`)
        .expect(200);
      await as(owner).patch(`/packages/${pkg.id}/activate`).expect(200);

      await as(owner).delete(`/packages/${pkg.id}`).expect(204);
      await as(owner).get(`/packages/${pkg.id}`).expect(404);
      await as(owner).patch(`/packages/${pkg.id}/activate`).expect(404);
      await as(owner)
        .patch(`/packages/${pkg.id}`, { name: 'Back' })
        .expect(404);
      expect(
        (await as(receptionist).get('/packages').expect(200)).body.items,
      ).toEqual([]);
      expect(
        (await request(server).get('/api/v1/public/packages').expect(200)).body,
      ).toEqual([]);
      await as(receptionist)
        .post(`/patients/${patient.id}/packages`, { packageId: pkg.id })
        .expect(404);

      const res = await attend((await appointment(doctorA)).id).expect(201);
      expect(res.body.package?.patientPackageId).toBe(sold.id);
    });

    it('GET /public/packages: active and public only, with safe fields', async () => {
      const visible = await createPackage({
        offer: { type: 'PERCENT', value: '10', endsOn: '2026-11-30' },
      });
      await createPackage({ name: 'Staff only', isPublic: false });
      const retired = await createPackage({ name: 'Old pack' });
      await as(owner).patch(`/packages/${retired.id}/deactivate`).expect(200);

      const res = await request(server)
        .get('/api/v1/public/packages')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual(PUBLIC_KEYS);
      expect(res.body[0]).toEqual({
        id: visible.id,
        name: '3 physio sessions',
        service: { id: physioId, name: 'Physio' },
        sessionsCount: 3,
        price: '900.00',
        sellingPrice: '810.00',
        offerEndsOn: '2026-11-30',
        allDoctors: true,
        doctors: [],
      });
    });

    it('GET /public/packages lists the doctors of a package, public ones only', async () => {
      await createPackage({
        allDoctors: undefined,
        doctorIds: [doctorA.doctorId, doctorB.doctorId],
      });
      await ctx.dataSource
        .getRepository(Doctor)
        .update({ id: doctorB.doctorId }, { isPublic: false });

      const res = await request(server)
        .get('/api/v1/public/packages')
        .expect(200);
      expect(res.body[0]).toMatchObject({
        allDoctors: false,
        doctors: [{ id: doctorA.doctorId, name: expect.any(String) }],
      });
      expect(res.body[0].doctors).toHaveLength(1);
    });
  });

  // ---------- selling ----------

  describe('selling', () => {
    it('creates the patient package and its invoice (no visit) in one go', async () => {
      const pkg = await createPackage({
        offer: { type: 'PERCENT', value: '20' },
      });
      const sold = await sell(pkg.id);
      expect(sold).toMatchObject({
        packageId: pkg.id,
        name: '3 physio sessions',
        status: 'ACTIVE',
        totalSessions: 3,
        usedSessions: 0,
        sessionsLeft: 3,
        listPrice: '900.00',
        offerAmount: '180.00',
        price: '720.00',
        invoiceTotal: '720.00',
        amountPaid: '0.00',
        balance: '720.00',
        usages: [],
      });

      const invoice = await ctx.dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: sold.invoiceId });
      expect(invoice).toMatchObject({
        visitId: null,
        patientId: patient.id,
        total: '720.00',
        status: 'ISSUED',
      });
      const items = await lines(invoice.id);
      expect(items).toEqual([
        expect.objectContaining({
          serviceId: null,
          description: 'Package: 3 physio sessions (3 sessions)',
          unitPrice: '720.00',
        }),
      ]);
      await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'PACKAGE_SOLD', entityId: sold.id });
    });

    it('rolls the invoice back when the sale fails', async () => {
      const pkg = await createPackage();
      const audit = ctx.app.get(AuditService);
      const original = audit.log.bind(audit);
      vi.spyOn(audit, 'log').mockImplementation(
        (entry: AuditEntry, manager) => {
          if (entry.action === AuditAction.PACKAGE_SOLD) {
            return Promise.reject(new Error('simulated failure'));
          }
          return original(entry, manager);
        },
      );

      await as(receptionist)
        .post(`/patients/${patient.id}/packages`, { packageId: pkg.id })
        .expect(500);
      expect(await ctx.dataSource.getRepository(Invoice).count()).toBe(0);
      expect(await ctx.dataSource.getRepository(PatientPackage).count()).toBe(
        0,
      );
    });

    it('a partial payment leaves a balance, and the sessions are usable before full payment', async () => {
      const sold = await sell((await createPackage()).id);
      await as(receptionist)
        .post(`/invoices/${sold.invoiceId}/payments`, {
          amount: '300.00',
          method: 'CASH',
        })
        .expect(201);

      const list = await as(receptionist)
        .get(`/patients/${patient.id}/packages`)
        .expect(200);
      expect(list.body[0]).toMatchObject({
        amountPaid: '300.00',
        balance: '600.00',
      });

      const apt = await appointment(doctorA);
      const res = await attend(apt.id).expect(201);
      expect(res.body.package).toMatchObject({ used: 1, total: 3 });
    });

    it('the sale invoice takes a discount, but its items are fixed and it is cancelled only after the package', async () => {
      const sold = await sell((await createPackage()).id);
      const discount = await as(receptionist).post(
        `/invoices/${sold.invoiceId}/discount`,
        { type: 'FIXED', value: '100', reason: 'Loyal patient' },
      );
      expect(discount.status).toBeLessThan(300);
      const list = await as(receptionist)
        .get(`/patients/${patient.id}/packages`)
        .expect(200);
      expect(list.body[0]).toMatchObject({
        price: '900.00',
        invoiceTotal: '800.00',
        balance: '800.00',
      });

      const item = await as(receptionist)
        .post(`/invoices/${sold.invoiceId}/items`, {
          description: 'Extra',
          unitPrice: '10.00',
          quantity: 1,
        })
        .expect(422);
      expect(item.body.code).toBe('PACKAGE_INVOICE');
      const cancel = await as(receptionist)
        .post(`/invoices/${sold.invoiceId}/cancel`, { reason: 'Mistake' })
        .expect(422);
      expect(cancel.body.code).toBe('PACKAGE_INVOICE');

      await as(owner)
        .post(`/patient-packages/${sold.id}/cancel`, { reason: 'Changed mind' })
        .expect(200);
      await as(receptionist)
        .post(`/invoices/${sold.invoiceId}/cancel`, { reason: 'Changed mind' })
        .expect(200);
    });
  });

  // ---------- sessions ----------

  describe('sessions', () => {
    it('attend uses a session: a 0.00 invoice line, shown in the day list', async () => {
      const sold = await sell((await createPackage()).id);
      const apt = await appointment(doctorA);

      const res = await attend(apt.id).expect(201);
      expect(res.body.package).toEqual({
        usageId: expect.any(String),
        patientPackageId: sold.id,
        name: '3 physio sessions',
        used: 1,
        total: 3,
      });
      expect(await lines(res.body.invoiceId)).toEqual([
        expect.objectContaining({
          serviceId: physioId,
          description: 'Physio — package 3 physio sessions (session 1/3)',
          unitPrice: '0.00',
          lineTotal: '0.00',
        }),
      ]);
      const invoice = await ctx.dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: res.body.invoiceId });
      expect(invoice).toMatchObject({ total: '0.00', status: 'PAID' });

      expect((await dayRow(receptionist, apt.id))?.package).toEqual(
        res.body.package,
      );
      // The doctor's own day list shows it too (no prices in it).
      expect((await dayRow(doctorA, apt.id))?.package).toEqual(
        res.body.package,
      );
    });

    it('another doctor or another service is billed normally', async () => {
      const sold = await sell(
        (
          await createPackage({
            allDoctors: undefined,
            doctorIds: [doctorA.doctorId],
          })
        ).id,
      );
      const otherDoctor = await attend((await appointment(doctorB)).id).expect(
        201,
      );
      expect(otherDoctor.body.package).toBeNull();
      expect((await lines(otherDoctor.body.invoiceId))[0].unitPrice).toBe(
        '300.00',
      );

      const otherService = await attend(
        (await appointment(doctorA, massageId)).id,
      ).expect(201);
      expect(otherService.body.package).toBeNull();
      expect((await stored(sold.id)).usedSessions).toBe(0);
    });

    it('the oldest usable package goes first; patientPackageId and usePackage: false choose', async () => {
      const pkg = await createPackage();
      const massagePkg = await createPackage({
        name: 'Massage pack',
        serviceId: massageId,
      });
      clock.current = local('08:00');
      const older = await sell(pkg.id);
      clock.current = local('08:30');
      const newer = await sell(pkg.id);
      const massage = await sell(massagePkg.id);
      clock.current = local('09:00');

      const first = await attend((await appointment(doctorA)).id).expect(201);
      expect(first.body.package.patientPackageId).toBe(older.id);

      const chosen = await attend((await appointment(doctorA)).id, {
        patientPackageId: newer.id,
      }).expect(201);
      expect(chosen.body.package.patientPackageId).toBe(newer.id);

      const skipped = await attend((await appointment(doctorA)).id, {
        usePackage: false,
      }).expect(201);
      expect(skipped.body.package).toBeNull();
      expect((await lines(skipped.body.invoiceId))[0].unitPrice).toBe('300.00');

      const apt = await appointment(doctorA);
      await attend(apt.id, {
        patientPackageId: newer.id,
        usePackage: false,
      }).expect(400);
      const wrong = await attend(apt.id, {
        patientPackageId: massage.id,
      }).expect(422);
      expect(wrong.body.code).toBe('PACKAGE_NOT_USABLE');
    });

    it('a walk-in uses a session too', async () => {
      const sold = await sell((await createPackage()).id);
      const res = await as(receptionist)
        .post('/visits/walk-in', {
          patientId: patient.id,
          doctorId: doctorB.doctorId,
          serviceId: physioId,
        })
        .expect(201);
      expect(res.body.package).toMatchObject({
        patientPackageId: sold.id,
        used: 1,
      });
    });

    it('a no-show uses a session; restore gives it back, so does undo no-show; cancel uses none', async () => {
      const sold = await sell((await createPackage()).id);

      const missed = await appointment(doctorA);
      await as(receptionist)
        .post(`/appointments/${missed.id}/no-show`)
        .expect(200);
      expect((await stored(sold.id)).usedSessions).toBe(1);
      const row = await dayRow(receptionist, missed.id);
      expect(row?.allowedActions).toContain('restoreSession');
      const usageId = row?.package?.usageId as string;

      const restored = await as(receptionist)
        .post(`/package-usages/${usageId}/restore`, {
          reason: 'Called in sick',
        })
        .expect(200);
      expect(restored.body).toMatchObject({
        usedSessions: 0,
        usages: [
          {
            id: usageId,
            reason: 'NO_SHOW',
            doctor: { id: doctorA.doctorId },
            restored: true,
            restoreReason: 'Called in sick',
          },
        ],
      });
      const again = await as(receptionist)
        .post(`/package-usages/${usageId}/restore`, { reason: 'Twice' })
        .expect(422);
      expect(again.body.code).toBe('RESTORE_NOT_ALLOWED');
      expect(
        (await dayRow(receptionist, missed.id))?.allowedActions,
      ).not.toContain('restoreSession');

      const mistake = await appointment(doctorA);
      await as(receptionist)
        .post(`/appointments/${mistake.id}/no-show`)
        .expect(200);
      expect((await stored(sold.id)).usedSessions).toBe(1);
      await as(receptionist)
        .post(`/appointments/${mistake.id}/undo-no-show`)
        .expect(200);
      expect((await stored(sold.id)).usedSessions).toBe(0);

      const cancelled = await appointment(doctorA);
      await as(receptionist)
        .post(`/appointments/${cancelled.id}/cancel`, { reason: 'Travelling' })
        .expect(200);
      expect((await stored(sold.id)).usedSessions).toBe(0);
    });

    it('undo attend gives the session back; an attended session is not restored directly', async () => {
      const sold = await sell((await createPackage()).id);
      const apt = await appointment(doctorA);
      const res = await attend(apt.id).expect(201);

      const direct = await as(receptionist)
        .post(`/package-usages/${res.body.package.usageId}/restore`, {
          reason: 'Mistake',
        })
        .expect(422);
      expect(direct.body.code).toBe('RESTORE_NOT_ALLOWED');

      await as(receptionist)
        .post(`/appointments/${apt.id}/undo-attend`, {
          reason: 'Wrong patient',
        })
        .expect(200);
      const detail = await as(receptionist)
        .get(`/patient-packages/${sold.id}`)
        .expect(200);
      expect(detail.body).toMatchObject({
        usedSessions: 0,
        usages: [
          {
            reason: 'ATTENDED',
            restored: true,
            restoreReason: 'Wrong patient',
          },
        ],
      });
    });

    it('the last session finishes the package; restoring one makes it ACTIVE again', async () => {
      const sold = await sell((await createPackage({ sessionsCount: 1 })).id);
      const missed = await appointment(doctorA);
      await as(receptionist)
        .post(`/appointments/${missed.id}/no-show`)
        .expect(200);
      expect(await stored(sold.id)).toMatchObject({
        usedSessions: 1,
        status: 'FINISHED',
      });

      const billed = await attend((await appointment(doctorA)).id).expect(201);
      expect(billed.body.package).toBeNull();

      const usageId = (await dayRow(receptionist, missed.id))?.package?.usageId;
      await as(receptionist)
        .post(`/package-usages/${usageId}/restore`, {
          reason: 'Called in sick',
        })
        .expect(200);
      expect(await stored(sold.id)).toMatchObject({
        usedSessions: 0,
        status: 'ACTIVE',
      });
    });

    it('a cancelled package is never used', async () => {
      const sold = await sell((await createPackage()).id);
      const res = await as(owner)
        .post(`/patient-packages/${sold.id}/cancel`, { reason: 'Moved away' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Moved away',
        cancelledBy: { id: owner.id },
      });

      const auto = await attend((await appointment(doctorA)).id).expect(201);
      expect(auto.body.package).toBeNull();
      const chosen = await attend((await appointment(doctorA)).id, {
        patientPackageId: sold.id,
      }).expect(422);
      expect(chosen.body.code).toBe('PACKAGE_NOT_USABLE');

      const again = await as(owner)
        .post(`/patient-packages/${sold.id}/cancel`, { reason: 'Twice' })
        .expect(422);
      expect(again.body.code).toBe('PACKAGE_CANCELLED');
    });

    it('two parallel attends with one session left: only one uses it', async () => {
      const sold = await sell((await createPackage({ sessionsCount: 1 })).id);
      const first = await appointment(doctorA);
      const second = await appointment(doctorB);

      const results = await Promise.all([attend(first.id), attend(second.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const covered = results.filter((r) => r.body.package !== null);
      expect(covered).toHaveLength(1);
      expect(await stored(sold.id)).toMatchObject({
        usedSessions: 1,
        status: 'FINISHED',
      });
    });

    it('adding a doctor to the package lets existing patient packages be used with that doctor', async () => {
      const pkg = await createPackage({
        allDoctors: undefined,
        doctorIds: [doctorA.doctorId],
      });
      const sold = await sell(pkg.id);
      await as(owner)
        .patch(`/packages/${pkg.id}`, {
          doctorIds: [doctorA.doctorId, doctorB.doctorId],
        })
        .expect(200);

      const res = await attend((await appointment(doctorB)).id).expect(201);
      expect(res.body.package?.patientPackageId).toBe(sold.id);
    });
  });

  // ---------- views ----------

  describe('views', () => {
    it("a patient's packages: the desk sees prices, a treating doctor only sessions, other doctors 404", async () => {
      const sold = await sell((await createPackage()).id);
      await attend((await appointment(doctorA)).id).expect(201);

      const desk = await as(receptionist)
        .get(`/patients/${patient.id}/packages`)
        .expect(200);
      expect(desk.body[0]).toMatchObject({
        id: sold.id,
        sessionsLeft: 2,
        balance: '900.00',
      });

      const doctor = await as(doctorA)
        .get(`/patients/${patient.id}/packages`)
        .expect(200);
      expect(doctor.body[0]).toMatchObject({ id: sold.id, sessionsLeft: 2 });
      for (const key of PRICE_KEYS)
        expect(doctor.body[0]).not.toHaveProperty(key);
      const detail = await as(doctorA)
        .get(`/patient-packages/${sold.id}`)
        .expect(200);
      expect(detail.body.usages).toHaveLength(1);
      for (const key of PRICE_KEYS) expect(detail.body).not.toHaveProperty(key);

      await as(doctorB).get(`/patients/${patient.id}/packages`).expect(404);
      await as(doctorB).get(`/patient-packages/${sold.id}`).expect(404);
    });

    it('timeline: package events for the desk; doctors get the session events without prices', async () => {
      const sold = await sell((await createPackage()).id);
      await attend((await appointment(doctorA)).id).expect(201);
      const missed = await appointment(doctorA);
      await as(receptionist)
        .post(`/appointments/${missed.id}/no-show`)
        .expect(200);
      const usageId = (await dayRow(receptionist, missed.id))?.package?.usageId;
      await as(receptionist)
        .post(`/package-usages/${usageId}/restore`, {
          reason: 'Called in sick',
        })
        .expect(200);
      await as(owner)
        .post(`/patient-packages/${sold.id}/cancel`, { reason: 'Moved away' })
        .expect(200);

      const packageEvents = async (user: TestUser) => {
        const res = await as(user)
          .get(`/patients/${patient.id}/timeline?limit=100`)
          .expect(200);
        return (res.body.items as { type: string; data: object }[]).filter(
          (e) => e.type.startsWith('PACKAGE_'),
        );
      };
      const types = (events: { type: string }[]) =>
        events.map((e) => e.type).sort();

      const all = [
        'PACKAGE_CANCELLED',
        'PACKAGE_SESSION_RESTORED',
        'PACKAGE_SESSION_USED',
        'PACKAGE_SESSION_USED',
        'PACKAGE_SOLD',
      ];
      const ownerEvents = await packageEvents(owner);
      expect(types(ownerEvents)).toEqual(all);
      expect(
        ownerEvents.find((e) => e.type === 'PACKAGE_SOLD')?.data,
      ).toMatchObject({ patientPackageId: sold.id, price: '900.00' });
      expect(types(await packageEvents(receptionist))).toEqual(all);

      const doctorEvents = await packageEvents(doctorA);
      expect(types(doctorEvents)).toEqual(
        all.filter((type) => type !== 'PACKAGE_SOLD'),
      );
      expect(JSON.stringify(doctorEvents)).not.toMatch(/price/i);
    });
  });
});
