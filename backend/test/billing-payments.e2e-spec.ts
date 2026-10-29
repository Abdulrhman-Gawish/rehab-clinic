import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { Payment } from '../src/modules/billing/entities/payment.entity.js';
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

const RECEIPT_KEYS = [
  'amount',
  'clinicName',
  'clinicPhone',
  'discount',
  'invoiceNumber',
  'items',
  'method',
  'patient',
  'receiptNumber',
  'receivedAt',
  'receivedBy',
  'reference',
  'remainingBalance',
  'status',
  'subtotal',
  'total',
  'totalPaid',
  'type',
];

describe('Billing: payments (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let otherReceptionist: TestUser;
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
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    otherReceptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    patient = await insertPatient(ctx.dataSource, 'Mona Ali', '+201011111111');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  async function newInvoice(
    prices: string[] = ['300.00'],
    by: TestUser = receptionist,
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/invoices')
      .set(as(by))
      .send({
        patientId: patient.id,
        items: prices.map((unitPrice, i) => ({
          description: `Line ${i + 1}`,
          unitPrice,
          quantity: 1,
        })),
      })
      .expect(201);
    return res.body.id as string;
  }

  const pay = (
    invoiceId: string,
    body: Record<string, unknown>,
    by: TestUser = receptionist,
    key?: string,
  ) => {
    const req = request(server)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set(as(by));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const refund = (
    paymentId: string,
    body: Record<string, unknown>,
    by: TestUser = owner,
  ) =>
    request(server)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set(as(by))
      .send(body);

  const voidPayment = (
    paymentId: string,
    by: TestUser,
    reason = 'Typed the wrong amount',
  ) =>
    request(server)
      .post(`/api/v1/payments/${paymentId}/void`)
      .set(as(by))
      .send({ reason });

  const invoiceRow = (id: string) =>
    ctx.dataSource.getRepository(Invoice).findOneByOrFail({ id });

  describe('recording payments', () => {
    it('partial then full payment; status and balance follow; overpayment refused', async () => {
      const invoiceId = await newInvoice(['300.00']);

      const first = await pay(invoiceId, {
        amount: '100',
        method: 'CASH',
      }).expect(201);
      expect(first.body).toMatchObject({
        receiptNumber: 'RCP-2026-000001',
        type: 'PAYMENT',
        status: 'VALID',
        amount: '100.00',
        method: 'CASH',
        reference: null,
        receivedById: receptionist.id,
        receivedAt: '2026-11-03T09:00:00+02:00',
        invoice: {
          status: 'PARTIALLY_PAID',
          total: '300.00',
          amountPaid: '100.00',
          balance: '200.00',
        },
      });

      const over = await pay(invoiceId, {
        amount: '200.01',
        method: 'CASH',
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'OVERPAYMENT',
        details: { balance: '200.00' },
      });

      const second = await pay(invoiceId, {
        amount: '200.00',
        method: 'CARD',
        reference: 'POS-123',
      }).expect(201);
      expect(second.body.invoice).toMatchObject({
        status: 'PAID',
        amountPaid: '300.00',
        balance: '0.00',
      });

      const detail = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set(as(receptionist))
        .expect(200);
      expect(
        detail.body.payments.map(
          (p: { receiptNumber: string }) => p.receiptNumber,
        ),
      ).toEqual(['RCP-2026-000001', 'RCP-2026-000002']);
      await pay(invoiceId, { amount: '0.01', method: 'CASH' }).expect(422);
    });

    it('validates amount, method and reference', async () => {
      const invoiceId = await newInvoice();
      await pay(invoiceId, { amount: '0', method: 'CASH' }).expect(400);
      await pay(invoiceId, { amount: '-5', method: 'CASH' }).expect(400);
      await pay(invoiceId, { amount: '10.001', method: 'CASH' }).expect(400);
      await pay(invoiceId, { amount: '10', method: 'BITCOIN' }).expect(400);
      for (const method of ['CARD', 'WALLET', 'INSTAPAY']) {
        await pay(invoiceId, { amount: '10', method }).expect(400);
      }
      await pay(invoiceId, {
        amount: '10',
        method: 'INSTAPAY',
        reference: 'IP-778',
      }).expect(201);
      await pay(invoiceId, { amount: '10', method: 'CASH', total: '5' }).expect(
        400,
      );
    });

    it('a cancelled invoice cannot be paid', async () => {
      const invoiceId = await newInvoice();
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Duplicate invoice' })
        .expect(200);
      const res = await pay(invoiceId, { amount: '10', method: 'CASH' }).expect(
        422,
      );
      expect(res.body.code).toBe('INVOICE_CANCELLED');
    });

    it('5 parallel payments exceeding the balance: amount_paid never exceeds the total', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          pay(invoiceId, { amount: '100.00', method: 'CASH' }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      const refused = results.filter((r) => r.status === 422);
      expect(refused).toHaveLength(2);
      for (const r of refused) expect(r.body.code).toBe('OVERPAYMENT');
      expect(await invoiceRow(invoiceId)).toMatchObject({
        amountPaid: '300.00',
        status: 'PAID',
      });
    });

    it('items and discount are locked once paid, even after a full refund', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const paid = await pay(invoiceId, {
        amount: '300',
        method: 'CASH',
      }).expect(201);
      await refund(paid.body.id, {
        amount: '300',
        reason: 'Service not delivered',
      }).expect(201);
      expect(await invoiceRow(invoiceId)).toMatchObject({
        amountPaid: '0.00',
        status: 'ISSUED',
      });

      const res = await request(server)
        .post(`/api/v1/invoices/${invoiceId}/items`)
        .set(as(receptionist))
        .send({ description: 'Extra line', unitPrice: '1', quantity: 1 })
        .expect(422);
      expect(res.body.code).toBe('INVOICE_LOCKED');
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/discount`)
        .set(as(owner))
        .send({ type: 'PERCENT', value: '10', reason: 'Too late now' })
        .expect(422);

      // ...but it can now be cancelled.
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Fully refunded' })
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('CANCELLED'));
    });
  });

  describe('Idempotency-Key', () => {
    it('same key + same body returns the original; other body is 409', async () => {
      const invoiceId = await newInvoice();
      const first = await pay(
        invoiceId,
        { amount: '50', method: 'CASH' },
        receptionist,
        'key-1',
      ).expect(201);
      const again = await pay(
        invoiceId,
        { amount: '50.00', method: 'CASH' },
        receptionist,
        'key-1',
      ).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
      expect(await ctx.dataSource.getRepository(Payment).count()).toBe(1);

      const reused = await pay(
        invoiceId,
        { amount: '60', method: 'CASH' },
        receptionist,
        'key-1',
      ).expect(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherInvoice = await newInvoice();
      await pay(
        otherInvoice,
        { amount: '50', method: 'CASH' },
        receptionist,
        'key-1',
      ).expect(409);
    });

    it('parallel requests with the same key create exactly one payment', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          pay(
            invoiceId,
            { amount: '300.00', method: 'CASH' },
            receptionist,
            'same-key',
          ),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await ctx.dataSource.getRepository(Payment).count()).toBe(1);
      expect((await invoiceRow(invoiceId)).amountPaid).toBe('300.00');
    });
  });

  describe('void vs refund', () => {
    it('void: same day; receptionists only their own; owner any; not the next day', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const mine = await pay(invoiceId, {
        amount: '100',
        method: 'CASH',
      }).expect(201);
      const theirs = await pay(
        invoiceId,
        { amount: '50', method: 'CASH' },
        otherReceptionist,
      ).expect(201);

      const notMine = await voidPayment(theirs.body.id, receptionist).expect(
        422,
      );
      expect(notMine.body.code).toBe('VOID_NOT_ALLOWED');

      const voided = await voidPayment(mine.body.id, receptionist).expect(200);
      expect(voided.body).toMatchObject({
        status: 'VOIDED',
        voidedById: receptionist.id,
        voidReason: 'Typed the wrong amount',
        invoice: { amountPaid: '50.00', status: 'PARTIALLY_PAID' },
      });
      await voidPayment(mine.body.id, owner).expect(422);
      await request(server)
        .post(`/api/v1/payments/${mine.body.id}/void`)
        .set(as(owner))
        .send({})
        .expect(400);

      clock.current = local('08:00', '2026-11-04');
      const late = await voidPayment(theirs.body.id, owner).expect(422);
      expect(late.body.code).toBe('VOID_NOT_ALLOWED');
      clock.current = local('09:30');
      await voidPayment(theirs.body.id, owner).expect(200);
      expect((await invoiceRow(invoiceId)).amountPaid).toBe('0.00');
    });

    it('refund: owner only, limited to the payment, method defaults to the original', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const paid = await pay(invoiceId, {
        amount: '200',
        method: 'WALLET',
        reference: 'VF-1',
      }).expect(201);

      await refund(
        paid.body.id,
        { amount: '50', reason: 'Partial refund' },
        receptionist,
      ).expect(403);
      await refund(paid.body.id, { amount: '50' }).expect(400);

      const r1 = await refund(paid.body.id, {
        amount: '150',
        reason: 'Session cancelled',
      }).expect(201);
      expect(r1.body).toMatchObject({
        type: 'REFUND',
        amount: '150.00',
        method: 'WALLET',
        reason: 'Session cancelled',
        refundOfId: paid.body.id,
        invoice: { amountPaid: '50.00' },
      });
      const tooMuch = await refund(paid.body.id, {
        amount: '50.01',
        reason: 'More please',
      }).expect(422);
      expect(tooMuch.body).toMatchObject({
        code: 'REFUND_EXCEEDS_PAYMENT',
        details: { refundable: '50.00' },
      });
      await refund(paid.body.id, {
        amount: '50',
        reason: 'The rest',
        method: 'CASH',
      })
        .expect(201)
        .expect(({ body }) => expect(body.method).toBe('CASH'));

      // A payment with refunds cannot be voided; a refund cannot be refunded.
      await voidPayment(paid.body.id, owner).expect(422);
      await refund(r1.body.id, {
        amount: '1',
        reason: 'Refund a refund',
      }).expect(422);
    });

    it('voided payments cannot be refunded; voiding a refund restores the amount', async () => {
      const invoiceId = await newInvoice(['300.00']);
      const a = await pay(invoiceId, { amount: '100', method: 'CASH' }).expect(
        201,
      );
      const b = await pay(invoiceId, { amount: '100', method: 'CASH' }).expect(
        201,
      );
      await voidPayment(a.body.id, receptionist).expect(200);
      const res = await refund(a.body.id, {
        amount: '10',
        reason: 'Not possible',
      }).expect(422);
      expect(res.body.code).toBe('REFUND_NOT_ALLOWED');

      const r = await refund(b.body.id, {
        amount: '40',
        reason: 'Partial return',
      }).expect(201);
      expect((await invoiceRow(invoiceId)).amountPaid).toBe('60.00');
      await voidPayment(r.body.id, owner, 'Refund recorded by mistake').expect(
        200,
      );
      expect((await invoiceRow(invoiceId)).amountPaid).toBe('100.00');
    });
  });

  describe('receipts and lists', () => {
    it('receipt has exactly the printable data', async () => {
      const invoiceId = await newInvoice(['200.00', '120.00']);
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/discount`)
        .set(as(owner))
        .send({ type: 'PERCENT', value: '20', reason: 'Regular patient' })
        .expect(200);
      const paid = await pay(invoiceId, {
        amount: '100',
        method: 'CARD',
        reference: 'POS-9',
      }).expect(201);

      const res = await request(server)
        .get(`/api/v1/payments/${paid.body.id}/receipt`)
        .set(as(receptionist))
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(RECEIPT_KEYS);
      expect(res.body).toEqual({
        clinicName: 'Rehab Clinic',
        clinicPhone: null,
        receiptNumber: paid.body.receiptNumber,
        type: 'PAYMENT',
        status: 'VALID',
        receivedAt: '2026-11-03T09:00:00+02:00',
        receivedBy: expect.any(String),
        patient: { id: patient.id, name: 'Mona Ali', phone: '+201011111111' },
        invoiceNumber: 'INV-2026-000001',
        items: [
          {
            description: 'Line 1',
            unitPrice: '200.00',
            quantity: 1,
            lineTotal: '200.00',
          },
          {
            description: 'Line 2',
            unitPrice: '120.00',
            quantity: 1,
            lineTotal: '120.00',
          },
        ],
        subtotal: '320.00',
        discount: {
          type: 'PERCENT',
          value: '20.00',
          amount: '64.00',
          reason: 'Regular patient',
        },
        total: '256.00',
        method: 'CARD',
        reference: 'POS-9',
        amount: '100.00',
        totalPaid: '100.00',
        remainingBalance: '156.00',
      });
    });

    it('lists payments with filters', async () => {
      const invoiceId = await newInvoice(['500.00']);
      await pay(invoiceId, { amount: '100', method: 'CASH' }).expect(201);
      await pay(
        invoiceId,
        { amount: '50', method: 'CARD', reference: 'P1' },
        otherReceptionist,
      ).expect(201);
      const cash = await request(server)
        .get('/api/v1/payments?method=CASH')
        .set(as(owner))
        .expect(200);
      expect(cash.body.meta.total).toBe(1);
      const byUser = await request(server)
        .get(`/api/v1/payments?receivedBy=${otherReceptionist.id}`)
        .set(as(owner))
        .expect(200);
      expect(byUser.body.items[0].amount).toBe('50.00');
    });
  });

  describe('day list, attention, daily summary', () => {
    it('the reception day list shows invoice and payment status per row', async () => {
      const doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
      const service = await insertService(ctx.dataSource, {
        basePrice: '300.00',
      });
      await assignService(ctx.dataSource, doctor.doctorId, service.id);
      const checkedIn = await insertAppointment(ctx.dataSource, {
        patientId: patient.id,
        doctorId: doctor.doctorId,
        serviceId: service.id,
        startAt: local('10:00'),
      });
      const other = await insertPatient(
        ctx.dataSource,
        'Later Patient',
        '+201033333333',
      );
      await insertAppointment(ctx.dataSource, {
        patientId: other.id,
        doctorId: doctor.doctorId,
        serviceId: service.id,
        startAt: local('15:00'),
      });
      const visit = await request(server)
        .post(`/api/v1/appointments/${checkedIn.id}/check-in`)
        .set(as(receptionist))
        .expect(201);
      let invoiceId = '';
      await vi.waitFor(async () => {
        const invoice = await ctx.dataSource
          .getRepository(Invoice)
          .findOneBy({ visitId: visit.body.id });
        expect(invoice).not.toBeNull();
        invoiceId = (invoice as Invoice).id;
      });
      await pay(invoiceId, { amount: '120', method: 'CASH' }).expect(201);

      const day = await request(server)
        .get(`/api/v1/appointments/day?date=${TODAY}`)
        .set(as(receptionist))
        .expect(200);
      expect(day.body[0]).toMatchObject({
        id: checkedIn.id,
        invoiceId,
        invoiceTotal: '300.00',
        amountPaid: '120.00',
        balance: '180.00',
        paymentStatus: 'PARTIAL',
      });
      expect(day.body[1]).toMatchObject({
        invoiceId: null,
        invoiceTotal: null,
        paymentStatus: 'NOT_INVOICED',
      });
    });

    it('attention: money held for cancelled visits, and overdue balances', async () => {
      const doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
      const service = await insertService(ctx.dataSource, {
        basePrice: '300.00',
      });
      await assignService(ctx.dataSource, doctor.doctorId, service.id);
      const walkIn = await request(server)
        .post('/api/v1/visits/walk-in')
        .set(as(receptionist))
        .send({
          patientId: patient.id,
          doctorId: doctor.doctorId,
          serviceId: service.id,
        })
        .expect(201);
      let visitInvoice = '';
      await vi.waitFor(async () => {
        const invoice = await ctx.dataSource
          .getRepository(Invoice)
          .findOneBy({ visitId: walkIn.body.id });
        expect(invoice).not.toBeNull();
        visitInvoice = (invoice as Invoice).id;
      });
      await pay(visitInvoice, { amount: '50', method: 'CASH' }).expect(201);
      await request(server)
        .post(`/api/v1/visits/${walkIn.body.id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Patient left' })
        .expect(200);

      clock.current = local('09:00', '2026-10-26'); // 8 days ago
      const old = await newInvoice(['80.00']);
      clock.current = local('09:00', '2026-10-28'); // 6 days ago
      await newInvoice(['70.00']);
      clock.current = local('09:00');

      const res = await request(server)
        .get('/api/v1/billing/attention')
        .set(as(receptionist))
        .expect(200);
      expect(res.body.overdueDays).toBe(7);
      expect(
        res.body.cancelledVisitsWithPayments.map((i: { id: string }) => i.id),
      ).toEqual([visitInvoice]);
      expect(res.body.overdue.map((i: { id: string }) => i.id)).toEqual([old]);
    });

    it('daily summary on a seeded day, and receptionists only see today', async () => {
      const a = await newInvoice(['500.00']);
      const b = await newInvoice(['400.00']);
      await request(server)
        .post(`/api/v1/invoices/${b}/discount`)
        .set(as(receptionist))
        .send({ type: 'FIXED', value: '40', reason: 'Neighbour' })
        .expect(200);

      const cash1 = await pay(a, { amount: '200', method: 'CASH' }).expect(201);
      await pay(a, {
        amount: '100',
        method: 'CARD',
        reference: 'POS-1',
      }).expect(201);
      await pay(b, { amount: '150', method: 'CASH' }, otherReceptionist).expect(
        201,
      );
      const mistake = await pay(b, {
        amount: '20',
        method: 'INSTAPAY',
        reference: 'IP-1',
      }).expect(201);
      await voidPayment(mistake.body.id, receptionist).expect(200);
      await refund(cash1.body.id, {
        amount: '30',
        reason: 'Overcharged',
      }).expect(201);

      const res = await request(server)
        .get('/api/v1/billing/daily-summary')
        .set(as(receptionist))
        .expect(200);
      expect(res.body).toEqual({
        date: TODAY,
        from: '2026-11-03T00:00:00+02:00',
        to: '2026-11-04T00:00:00+02:00',
        payments: {
          count: 3,
          total: '450.00',
          byMethod: {
            CASH: '350.00',
            CARD: '100.00',
            WALLET: '0.00',
            INSTAPAY: '0.00',
          },
        },
        refunds: {
          count: 1,
          total: '30.00',
          byMethod: {
            CASH: '30.00',
            CARD: '0.00',
            WALLET: '0.00',
            INSTAPAY: '0.00',
          },
        },
        voided: { count: 1, amount: '20.00' },
        discounts: {
          count: 1,
          amount: '40.00',
          byUser: [
            {
              userId: receptionist.id,
              name: expect.any(String),
              count: 1,
              amount: '40.00',
            },
          ],
        },
        expenses: {
          count: 0,
          total: '0.00',
          byMethod: {
            CASH: '0.00',
            CARD: '0.00',
            WALLET: '0.00',
            INSTAPAY: '0.00',
          },
        },
        expectedCash: '320.00',
      });

      await request(server)
        .get('/api/v1/billing/daily-summary?date=2026-11-02')
        .set(as(receptionist))
        .expect(403);
      await request(server)
        .get('/api/v1/billing/daily-summary?date=2026-11-02')
        .set(as(owner))
        .expect(200)
        .expect(({ body }) => expect(body.payments.count).toBe(0));
    });

    it('uses the clinic local day across the DST change (2026-10-29 is 25 hours long)', async () => {
      clock.current = new Date('2026-10-28T20:00:00Z');
      const invoiceId = await newInvoice(['900.00']);

      // 00:10 local (+03:00) on the 29th: belongs to the 29th.
      clock.current = new Date('2026-10-29T00:10:00+03:00');
      await pay(invoiceId, { amount: '10', method: 'CASH' }).expect(201);
      // 23:30 local, second occurrence (+02:00) after clocks went back: still the 29th.
      clock.current = new Date('2026-10-29T23:30:00+02:00');
      await pay(invoiceId, { amount: '20', method: 'CASH' }).expect(201);
      // 00:10 local on the 30th.
      clock.current = new Date('2026-10-30T00:10:00+02:00');
      await pay(invoiceId, { amount: '40', method: 'CASH' }).expect(201);

      const day29 = await request(server)
        .get('/api/v1/billing/daily-summary?date=2026-10-29')
        .set(as(owner))
        .expect(200);
      expect(day29.body).toMatchObject({
        from: '2026-10-29T00:00:00+03:00',
        to: '2026-10-30T00:00:00+02:00',
        payments: { count: 2, total: '30.00' },
        expectedCash: '30.00',
      });
      const day30 = await request(server)
        .get('/api/v1/billing/daily-summary?date=2026-10-30')
        .set(as(owner))
        .expect(200);
      expect(day30.body.payments).toMatchObject({ count: 1, total: '40.00' });
    });
  });

  it('database CHECKs reject inconsistent payments', async () => {
    const invoiceId = await newInvoice();
    const base = {
      receiptNumber: 'RCP-X-1',
      invoiceId,
      patientId: patient.id,
      type: 'PAYMENT' as never,
      status: 'VALID' as never,
      amount: '10.00',
      method: 'CASH' as never,
      reference: null,
      reason: null,
      idempotencyKey: null,
      idempotencyHash: null,
      receivedById: owner.id,
      receivedAt: new Date(),
      voidedAt: null,
      voidedById: null,
      voidReason: null,
      refundOfId: null,
    };
    for (const bad of [
      { amount: '0.00' },
      { type: 'REFUND' as never },
      { method: 'CARD' as never },
      { status: 'VOIDED' as never },
    ]) {
      await expect(
        ctx.dataSource.getRepository(Payment).insert({ ...base, ...bad }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }
  });
});
