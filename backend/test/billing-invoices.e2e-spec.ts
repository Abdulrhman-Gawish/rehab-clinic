import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { AuditAction } from '../src/modules/audit/audit.constants.js';
import {
  AuditService,
  type AuditEntry,
} from '../src/modules/audit/audit.service.js';
import { InvoiceItem } from '../src/modules/billing/entities/invoice-item.entity.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { ClinicService } from '../src/modules/clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../src/modules/doctors/entities/doctor-clinic-service.entity.js';
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

const TODAY = '2026-11-03';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('09:00') };

const DETAIL_KEYS = [
  'balance',
  'cancelReason',
  'cancelledAt',
  'cancelledById',
  'discount',
  'discountTotal',
  'id',
  'invoiceNumber',
  'issuedAt',
  'issuedById',
  'items',
  'notes',
  'patient',
  'payments',
  'status',
  'subtotal',
  'total',
  'amountPaid',
  'visitId',
].sort();

describe('Billing: invoices (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let receptionist: TestUser;
  let doctor: TestUser & { doctorId: string };
  let service: ClinicService;
  let patient: Patient;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = local('09:00');
    await resetDatabase(ctx.dataSource);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    service = await insertService(ctx.dataSource, {
      name: 'Physio session',
      basePrice: '300.00',
    });
    await assignService(ctx.dataSource, doctor.doctorId, service.id);
    await ctx.dataSource
      .getRepository(DoctorClinicService)
      .update(
        { doctorId: doctor.doctorId, serviceId: service.id },
        { priceOverride: '320.00' },
      );
    patient = await insertPatient(ctx.dataSource, 'Mona Ali', '+201011111111');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  async function attendToday(
    time = '09:30',
  ): Promise<{ visitId: string; invoiceId: string }> {
    const appointment = await insertAppointment(ctx.dataSource, {
      patientId: patient.id,
      doctorId: doctor.doctorId,
      serviceId: service.id,
      startAt: local(time),
    });
    const res = await request(server)
      .post(`/api/v1/appointments/${appointment.id}/attend`)
      .set(as(receptionist))
      .expect(201);
    return { visitId: res.body.id, invoiceId: res.body.invoiceId };
  }

  const getInvoice = (id: string) =>
    request(server)
      .get(`/api/v1/invoices/${id}`)
      .set(as(receptionist))
      .expect(200);

  const manualInvoice = (
    items: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) =>
    request(server)
      .post('/api/v1/invoices')
      .set(as(receptionist))
      .send({ patientId: patient.id, items, ...extra });

  // Pretend money was received (payments arrive in 6C).
  const markPaid = (invoiceId: string, amount: string, status: string) =>
    ctx.dataSource.query(
      `UPDATE invoices SET amount_paid = $2, status = $3 WHERE id = $1`,
      [invoiceId, amount, status],
    );

  describe('invoice created on attend', () => {
    it("is created with the visit, with the doctor's price override snapshotted", async () => {
      const { visitId, invoiceId } = await attendToday();

      const res = await getInvoice(invoiceId);
      expect(Object.keys(res.body).sort()).toEqual(DETAIL_KEYS);
      expect(res.body).toMatchObject({
        invoiceNumber: 'INV-2026-000001',
        status: 'ISSUED',
        visitId,
        patient: { id: patient.id, name: 'Mona Ali', phone: '+201011111111' },
        subtotal: '320.00',
        discountTotal: '0.00',
        total: '320.00',
        amountPaid: '0.00',
        balance: '320.00',
        issuedById: receptionist.id,
        issuedAt: '2026-11-03T09:00:00+02:00',
        discount: null,
        payments: [],
      });
      expect(res.body.items).toEqual([
        {
          id: expect.any(String),
          serviceId: service.id,
          description: 'Physio session',
          unitPrice: '320.00',
          quantity: 1,
          lineTotal: '320.00',
        },
      ]);

      // A later catalog change never alters the snapshot.
      await ctx.dataSource.getRepository(ClinicService).update(service.id, {
        name: 'Renamed',
        basePrice: '999.00',
      });
      expect((await getInvoice(invoiceId)).body.items[0]).toMatchObject({
        description: 'Physio session',
        unitPrice: '320.00',
      });
    });

    it('walk-ins get an invoice too (base price when there is no override)', async () => {
      const other = await insertService(ctx.dataSource, {
        name: 'Massage',
        basePrice: '150.50',
      });
      await assignService(ctx.dataSource, doctor.doctorId, other.id);
      const walkIn = await request(server)
        .post('/api/v1/visits/walk-in')
        .set(as(receptionist))
        .send({
          patientId: patient.id,
          doctorId: doctor.doctorId,
          serviceId: other.id,
        })
        .expect(201);
      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .findOneByOrFail({ id: walkIn.body.invoiceId }),
      ).toMatchObject({
        visitId: walkIn.body.id,
        total: '150.50',
        status: 'ISSUED',
      });
    });
  });

  describe('manual invoices and items', () => {
    it('service items use the catalog price (client price ignored); free-text items need a price', async () => {
      const res = await manualInvoice(
        [
          { serviceId: service.id, unitPrice: '1.00', quantity: 2 },
          { description: 'Medical report', unitPrice: '150', quantity: 1 },
          { description: 'Copies', unitPrice: '0.10', quantity: 3 },
        ],
        { notes: 'For the insurance company' },
      ).expect(201);
      expect(res.body).toMatchObject({
        visitId: null,
        issuedById: receptionist.id,
        subtotal: '750.30',
        total: '750.30',
        status: 'ISSUED',
        notes: 'For the insurance company',
      });
      expect(
        res.body.items.map(
          (i: {
            description: string;
            unitPrice: string;
            lineTotal: string;
          }) => [i.description, i.unitPrice, i.lineTotal],
        ),
      ).toEqual([
        ['Physio session', '300.00', '600.00'],
        ['Medical report', '150.00', '150.00'],
        ['Copies', '0.10', '0.30'],
      ]);

      await manualInvoice([{ description: 'No price', quantity: 1 }]).expect(
        400,
      );
      await manualInvoice([{ unitPrice: '10.00', quantity: 1 }]).expect(400);
      await manualInvoice([
        { description: 'Bad', unitPrice: '10.001', quantity: 1 },
      ]).expect(400);
      await manualInvoice([
        { description: 'Bad', unitPrice: '-5', quantity: 1 },
      ]).expect(400);
      await manualInvoice([
        { description: 'Bad', unitPrice: '5', quantity: 0 },
      ]).expect(400);
      await manualInvoice([]).expect(400);
      await manualInvoice(
        [{ description: 'X item', unitPrice: '5', quantity: 1 }],
        {
          total: '1.00',
        },
      ).expect(400);
      await request(server)
        .post('/api/v1/invoices')
        .set(as(receptionist))
        .send({
          patientId: '00000000-0000-4000-8000-000000000000',
          items: [{ description: 'X item', unitPrice: '5', quantity: 1 }],
        })
        .expect(404);
    });

    it('item changes recompute totals; at least one item must remain', async () => {
      const created = await manualInvoice([
        { description: 'Report', unitPrice: '100.00', quantity: 1 },
      ]).expect(201);
      const id = created.body.id as string;

      const added = await request(server)
        .post(`/api/v1/invoices/${id}/items`)
        .set(as(receptionist))
        .send({ serviceId: service.id, quantity: 1 })
        .expect(201);
      expect(added.body.total).toBe('400.00');

      const serviceItem = added.body.items[1].id as string;
      await request(server)
        .patch(`/api/v1/invoices/${id}/items/${serviceItem}`)
        .set(as(receptionist))
        .send({ unitPrice: '1.00' })
        .expect(400);
      const updated = await request(server)
        .patch(`/api/v1/invoices/${id}/items/${serviceItem}`)
        .set(as(receptionist))
        .send({ quantity: 3 })
        .expect(200);
      expect(updated.body).toMatchObject({
        subtotal: '1000.00',
        total: '1000.00',
      });

      const removed = await request(server)
        .delete(`/api/v1/invoices/${id}/items/${serviceItem}`)
        .set(as(receptionist))
        .expect(200);
      expect(removed.body.total).toBe('100.00');

      const last = await request(server)
        .delete(`/api/v1/invoices/${id}/items/${removed.body.items[0].id}`)
        .set(as(receptionist))
        .expect(422);
      expect(last.body.code).toBe('INVOICE_NEEDS_ITEMS');
    });

    it('items lock once something is paid; cancel needs a zero balance paid', async () => {
      const created = await manualInvoice([
        { description: 'Report', unitPrice: '100.00', quantity: 1 },
        { description: 'Copies', unitPrice: '5.00', quantity: 1 },
      ]).expect(201);
      const id = created.body.id as string;
      const itemId = created.body.items[0].id as string;
      await markPaid(id, '50.00', 'PARTIALLY_PAID');

      for (const call of [
        () =>
          request(server)
            .post(`/api/v1/invoices/${id}/items`)
            .send({ description: 'More', unitPrice: '1', quantity: 1 }),
        () =>
          request(server)
            .patch(`/api/v1/invoices/${id}/items/${itemId}`)
            .send({ quantity: 2 }),
        () => request(server).delete(`/api/v1/invoices/${id}/items/${itemId}`),
      ]) {
        const res = await call().set(as(receptionist)).expect(422);
        expect(res.body.code).toBe('INVOICE_LOCKED');
      }
      const cancel = await request(server)
        .post(`/api/v1/invoices/${id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Wrong patient' })
        .expect(422);
      expect(cancel.body.code).toBe('INVOICE_HAS_PAYMENTS');
    });

    it('cancelling an unpaid invoice; a cancelled invoice is locked', async () => {
      const created = await manualInvoice([
        { description: 'Report', unitPrice: '100.00', quantity: 1 },
      ]).expect(201);
      const res = await request(server)
        .post(`/api/v1/invoices/${created.body.id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Created by mistake' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Created by mistake',
        cancelledById: receptionist.id,
        cancelledAt: '2026-11-03T09:00:00+02:00',
      });
      await request(server)
        .post(`/api/v1/invoices/${created.body.id}/items`)
        .set(as(receptionist))
        .send({ description: 'More', unitPrice: '1', quantity: 1 })
        .expect(422);
      await request(server)
        .post(`/api/v1/invoices/${created.body.id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Again please' })
        .expect(422);
    });
  });

  describe('numbering', () => {
    it('10 parallel invoices get 10 unique, gapless numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          manualInvoice([
            { description: `Item ${i}`, unitPrice: '10.00', quantity: 1 },
          ]),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => r.body.invoiceNumber as string).sort();
      expect(numbers).toEqual(
        Array.from(
          { length: 10 },
          (_, i) => `INV-2026-${String(i + 1).padStart(6, '0')}`,
        ),
      );
    });

    it('a rolled-back invoice does not burn a number', async () => {
      await manualInvoice([
        { description: 'First', unitPrice: '10', quantity: 1 },
      ]).expect(201);
      const audit = ctx.app.get(AuditService);
      const original = audit.log.bind(audit);
      vi.spyOn(audit, 'log').mockImplementationOnce(
        (entry: AuditEntry, manager) =>
          entry.action === AuditAction.INVOICE_CREATED
            ? Promise.reject(new Error('simulated failure'))
            : original(entry, manager),
      );
      await manualInvoice([
        { description: 'Lost', unitPrice: '10', quantity: 1 },
      ]).expect(500);
      const next = await manualInvoice([
        { description: 'Third', unitPrice: '10', quantity: 1 },
      ]).expect(201);
      expect(next.body.invoiceNumber).toBe('INV-2026-000002');
    });

    it('the year comes from the clinic local date', async () => {
      clock.current = new Date('2026-12-31T23:30:00+02:00'); // 21:30Z
      const late = await manualInvoice([
        { description: 'NYE', unitPrice: '10', quantity: 1 },
      ]).expect(201);
      clock.current = new Date('2027-01-01T00:30:00+02:00'); // still 2026 in UTC
      const early = await manualInvoice([
        { description: 'NY', unitPrice: '10', quantity: 1 },
      ]).expect(201);
      expect([late.body.invoiceNumber, early.body.invoiceNumber]).toEqual([
        'INV-2026-000001',
        'INV-2027-000001',
      ]);
    });
  });

  describe('database guarantees', () => {
    it('CHECK constraints reject inconsistent invoices and items inserted directly', async () => {
      const base = {
        invoice_number: 'INV-TEST-1',
        patient_id: patient.id,
        issued_at: new Date(),
      };
      const insert = (values: Record<string, unknown>) => {
        const row = { ...base, ...values };
        const columns = Object.keys(row);
        return ctx.dataSource.query(
          `INSERT INTO invoices (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
          Object.values(row),
        );
      };
      const rejected = (promise: Promise<unknown>) =>
        expect(promise).rejects.toMatchObject({
          driverError: { code: '23514' },
        });

      // total != subtotal - discount
      await rejected(
        insert({
          status: 'ISSUED',
          subtotal: '100',
          discount_total: '10',
          total: '100',
        }),
      );
      // amount_paid > total
      await rejected(
        insert({
          status: 'PAID',
          subtotal: '100',
          total: '100',
          amount_paid: '150',
        }),
      );
      // negative amount
      await rejected(insert({ status: 'ISSUED', subtotal: '-1', total: '-1' }));
      // status does not match the amounts
      await rejected(
        insert({
          status: 'PAID',
          subtotal: '100',
          total: '100',
          amount_paid: '0',
        }),
      );
      // cancelled without a reason
      await rejected(
        insert({
          status: 'CANCELLED',
          subtotal: '100',
          total: '100',
          cancelled_at: new Date(),
        }),
      );

      const ok = await manualInvoice([
        { description: 'Ok', unitPrice: '10', quantity: 1 },
      ]).expect(201);
      await expect(
        ctx.dataSource.getRepository(InvoiceItem).insert({
          invoiceId: ok.body.id,
          serviceId: null,
          description: 'Wrong line',
          unitPrice: '10.00',
          quantity: 2,
          lineTotal: '25.00',
          position: 9,
        }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    });
  });

  describe('queries', () => {
    it('lists with filters, patient invoices and balance', async () => {
      const a = await manualInvoice([
        { description: 'Item A', unitPrice: '100.00', quantity: 1 },
      ]).expect(201);
      const b = await manualInvoice([
        { description: 'Item B', unitPrice: '250.50', quantity: 1 },
      ]).expect(201);
      const c = await manualInvoice([
        { description: 'Item C', unitPrice: '40.00', quantity: 1 },
      ]).expect(201);
      await markPaid(a.body.id, '100.00', 'PAID');
      await markPaid(b.body.id, '50.00', 'PARTIALLY_PAID');
      await request(server)
        .post(`/api/v1/invoices/${c.body.id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Duplicate' })
        .expect(200);

      const withBalance = await request(server)
        .get('/api/v1/invoices?hasBalance=true')
        .set(as(receptionist))
        .expect(200);
      expect(withBalance.body.items.map((i: { id: string }) => i.id)).toEqual([
        b.body.id,
      ]);
      expect(withBalance.body.items[0].balance).toBe('200.50');

      const paid = await request(server)
        .get('/api/v1/invoices?status=PAID')
        .set(as(receptionist))
        .expect(200);
      expect(paid.body.meta.total).toBe(1);

      const ofPatient = await request(server)
        .get(`/api/v1/patients/${patient.id}/invoices`)
        .set(as(receptionist))
        .expect(200);
      expect(ofPatient.body.meta.total).toBe(3);

      const balance = await request(server)
        .get(`/api/v1/patients/${patient.id}/balance`)
        .set(as(receptionist))
        .expect(200);
      expect(balance.body).toEqual({
        patientId: patient.id,
        totalInvoiced: '350.50',
        totalPaid: '150.00',
        balance: '200.50',
      });
    });
  });
});
