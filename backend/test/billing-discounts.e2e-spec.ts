import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { InvoiceDiscount } from '../src/modules/billing/entities/invoice-discount.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { insertPatient } from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Runs before the app (and its config) is imported.
vi.hoisted(() => {
  process.env.RECEPTIONIST_MAX_DISCOUNT_PERCENT = '30';
});

const NOW = new Date('2026-11-03T09:00:00+02:00');

describe('Billing: discounts (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let patient: Patient;
  let otherPatient: Patient;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => NOW }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    patient = await insertPatient(ctx.dataSource, 'Mona Ali', '+201011111111');
    otherPatient = await insertPatient(
      ctx.dataSource,
      'Other One',
      '+201022222222',
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  async function invoiceFor(
    p: Patient,
    unitPrices: string[],
    by: TestUser = receptionist,
  ): Promise<{ id: string; items: { id: string }[] }> {
    const res = await request(server)
      .post('/api/v1/invoices')
      .set(as(by))
      .send({
        patientId: p.id,
        items: unitPrices.map((unitPrice, i) => ({
          description: `Line ${i + 1}`,
          unitPrice,
          quantity: 1,
        })),
      })
      .expect(201);
    return res.body;
  }

  const discount = (
    invoiceId: string,
    body: Record<string, unknown>,
    by: TestUser = receptionist,
  ) =>
    request(server)
      .post(`/api/v1/invoices/${invoiceId}/discount`)
      .set(as(by))
      .send(body);

  const markPaid = (invoiceId: string, amount: string) =>
    ctx.dataSource.query(
      `UPDATE invoices SET amount_paid = $2, status = 'PARTIALLY_PAID' WHERE id = $1`,
      [invoiceId, amount],
    );

  describe('applying', () => {
    it.each([
      ['99.99', '12.5', '12.50', '87.49'],
      ['99.99', '33.33', '33.33', '66.66'],
      ['100.00', '25', '25.00', '75.00'],
    ])(
      'PERCENT on %s: %s%% -> %s off, total %s (owner)',
      async (price, value, amount, total) => {
        const invoice = await invoiceFor(patient, [price]);
        const res = await discount(
          invoice.id,
          { type: 'PERCENT', value, reason: 'Loyal patient' },
          owner,
        ).expect(200);
        expect(res.body).toMatchObject({
          discountTotal: amount,
          total,
          status: 'ISSUED',
        });
        expect(res.body.discount).toMatchObject({
          type: 'PERCENT',
          value: Number(value).toFixed(2),
          amount,
          reason: 'Loyal patient',
          repeatedFromId: null,
          appliedBy: { id: owner.id, name: expect.any(String) },
          appliedAt: '2026-11-03T09:00:00+02:00',
        });
      },
    );

    it('FIXED: up to the subtotal; more is DISCOUNT_EXCEEDS_SUBTOTAL', async () => {
      const invoice = await invoiceFor(patient, ['50.00']);
      const res = await discount(
        invoice.id,
        { type: 'FIXED', value: '50.01', reason: 'Too much' },
        owner,
      ).expect(422);
      expect(res.body.code).toBe('DISCOUNT_EXCEEDS_SUBTOTAL');
      const ok = await discount(
        invoice.id,
        { type: 'FIXED', value: '50', reason: 'Free visit' },
        owner,
      ).expect(200);
      expect(ok.body).toMatchObject({ total: '0.00', status: 'PAID' });
    });

    it('percent discounts follow item changes; fixed ones block a subtotal below them', async () => {
      const invoice = await invoiceFor(patient, ['200.00']);
      await discount(invoice.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'Neighbour',
      }).expect(200);

      const added = await request(server)
        .post(`/api/v1/invoices/${invoice.id}/items`)
        .set(as(receptionist))
        .send({ description: 'Report', unitPrice: '99.99', quantity: 1 })
        .expect(201);
      expect(added.body).toMatchObject({
        subtotal: '299.99',
        discountTotal: '30.00',
        total: '269.99',
      });
      expect(added.body.discount.amount).toBe('30.00');
      const stored = await ctx.dataSource
        .getRepository(InvoiceDiscount)
        .findOneByOrFail({ invoiceId: invoice.id });
      expect(stored.amount).toBe('30.00');

      // Fixed 150 (owner: above the receptionist cap) on 200 + 99.99:
      // dropping the first line to 10.00 would leave a 109.99 subtotal.
      await discount(
        invoice.id,
        { type: 'FIXED', value: '150', reason: 'Fixed deal' },
        owner,
      ).expect(200);
      const firstItem = added.body.items[0].id as string;
      await request(server)
        .patch(`/api/v1/invoices/${invoice.id}/items/${firstItem}`)
        .set(as(receptionist))
        .send({ unitPrice: '10.00' })
        .expect(422)
        .expect(({ body }) =>
          expect(body.code).toBe('DISCOUNT_EXCEEDS_SUBTOTAL'),
        );
    });

    it('validates the body', async () => {
      const invoice = await invoiceFor(patient, ['100.00']);
      for (const body of [
        { type: 'PERCENT', value: '0', reason: 'Zero' },
        { type: 'PERCENT', value: '101', reason: 'Too much' },
        { type: 'FIXED', value: '10.001', reason: 'Precision' },
        { type: 'PERCENT', value: '10' },
        { type: 'PERCENT', value: '10', reason: 'ab' },
        { type: 'PERCENT', value: '10', reason: '   ' },
        { type: 'BOGUS', value: '10', reason: 'Bad type' },
        {},
        {
          type: 'PERCENT',
          value: '10',
          reason: 'Both forms',
          repeatFromDiscountId: '00000000-0000-4000-8000-000000000000',
        },
      ]) {
        await discount(invoice.id, body, owner).expect(400);
      }
    });

    it('replacing keeps history; removing needs a reason; all audited', async () => {
      const invoice = await invoiceFor(patient, ['100.00']);
      await discount(invoice.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'First',
      }).expect(200);
      const replaced = await discount(invoice.id, {
        type: 'FIXED',
        value: '15',
        reason: 'Second',
      }).expect(200);
      expect(replaced.body).toMatchObject({
        discountTotal: '15.00',
        total: '85.00',
      });

      const rows = await ctx.dataSource.getRepository(InvoiceDiscount).find({
        where: { invoiceId: invoice.id },
        order: { appliedAt: 'ASC', createdAt: 'ASC' },
      });
      expect(
        rows.map((r) => [r.reason, r.removedAt !== null, r.removalReason]),
      ).toEqual([
        ['First', true, 'Replaced'],
        ['Second', false, null],
      ]);

      await request(server)
        .post(`/api/v1/invoices/${invoice.id}/discount/remove`)
        .set(as(receptionist))
        .send({})
        .expect(400);
      const removed = await request(server)
        .post(`/api/v1/invoices/${invoice.id}/discount/remove`)
        .set(as(receptionist))
        .send({ reason: 'Applied by mistake' })
        .expect(200);
      expect(removed.body).toMatchObject({
        discount: null,
        discountTotal: '0.00',
        total: '100.00',
      });
      await request(server)
        .post(`/api/v1/invoices/${invoice.id}/discount/remove`)
        .set(as(receptionist))
        .send({ reason: 'Nothing left' })
        .expect(404);

      const actions = (
        await ctx.dataSource.getRepository(AuditLog).find({
          where: { entityId: invoice.id },
          order: { createdAt: 'ASC' },
        })
      ).map((l) => l.action);
      expect(actions.filter((a) => a.startsWith('DISCOUNT'))).toEqual([
        'DISCOUNT_APPLIED',
        'DISCOUNT_APPLIED',
        'DISCOUNT_REMOVED',
      ]);
    });

    it('locked once something is paid', async () => {
      const invoice = await invoiceFor(patient, ['100.00']);
      await discount(invoice.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'Before',
      }).expect(200);
      await markPaid(invoice.id, '10.00');
      const res = await discount(invoice.id, {
        type: 'PERCENT',
        value: '20',
        reason: 'After',
      }).expect(422);
      expect(res.body.code).toBe('INVOICE_LOCKED');
      await request(server)
        .post(`/api/v1/invoices/${invoice.id}/discount/remove`)
        .set(as(receptionist))
        .send({ reason: 'Too late now' })
        .expect(422);
    });
  });

  describe('receptionist limit (RECEPTIONIST_MAX_DISCOUNT_PERCENT = 30)', () => {
    it('applies to the effective percentage, for PERCENT and FIXED; the owner has no limit', async () => {
      const invoice = await invoiceFor(patient, ['100.00']);
      const tooMuch = await discount(invoice.id, {
        type: 'PERCENT',
        value: '30.01',
        reason: 'Generous',
      }).expect(422);
      expect(tooMuch.body).toMatchObject({
        code: 'DISCOUNT_LIMIT_EXCEEDED',
        details: { maxPercent: '30.00', effectivePercent: '30.01' },
      });
      await discount(invoice.id, {
        type: 'FIXED',
        value: '40',
        reason: 'Generous',
      }).expect(422);
      await discount(invoice.id, {
        type: 'FIXED',
        value: '30',
        reason: 'Exactly the cap',
      }).expect(200);
      await discount(invoice.id, {
        type: 'PERCENT',
        value: '30',
        reason: 'Exactly the cap',
      }).expect(200);
      await discount(
        invoice.id,
        { type: 'PERCENT', value: '80', reason: 'Owner decision' },
        owner,
      ).expect(200);
    });
  });

  describe('repeat', () => {
    it("copies type, value and reason with a new amount; the old invoice doesn't change", async () => {
      const first = await invoiceFor(patient, ['200.00']);
      await discount(first.id, {
        type: 'PERCENT',
        value: '20',
        reason: 'Regular patient',
      }).expect(200);

      const last = await request(server)
        .get(`/api/v1/patients/${patient.id}/last-discount`)
        .set(as(receptionist))
        .expect(200);
      expect(last.body).toMatchObject({
        invoiceId: first.id,
        type: 'PERCENT',
        value: '20.00',
        amount: '40.00',
        reason: 'Regular patient',
      });

      const second = await invoiceFor(patient, ['150.00']);
      const repeated = await discount(second.id, {
        repeatFromDiscountId: last.body.id,
      }).expect(200);
      expect(repeated.body).toMatchObject({
        discountTotal: '30.00',
        total: '120.00',
      });
      expect(repeated.body.discount).toMatchObject({
        type: 'PERCENT',
        value: '20.00',
        amount: '30.00',
        reason: 'Regular patient',
        repeatedFromId: last.body.id,
        appliedBy: { id: receptionist.id, name: expect.any(String) },
      });

      const old = await request(server)
        .get(`/api/v1/invoices/${first.id}`)
        .set(as(receptionist))
        .expect(200);
      expect(old.body).toMatchObject({
        discountTotal: '40.00',
        total: '160.00',
      });
      expect(old.body.discount.id).toBe(last.body.id);

      // The repeat is now the latest.
      const latest = await request(server)
        .get(`/api/v1/patients/${patient.id}/last-discount`)
        .set(as(receptionist))
        .expect(200);
      expect(latest.body.invoiceId).toBe(second.id);
      // While editing `second`, "repeat last" means the one before it.
      const previous = await request(server)
        .get(
          `/api/v1/patients/${patient.id}/last-discount?excludeInvoiceId=${second.id}`,
        )
        .set(as(receptionist))
        .expect(200);
      expect(previous.body.invoiceId).toBe(first.id);
    });

    it("rejects another patient's discount, still enforces the limit, 404 for unknown", async () => {
      const mine = await invoiceFor(patient, ['100.00']);
      const theirs = await invoiceFor(otherPatient, ['100.00']);
      const applied = await discount(theirs.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'Their discount',
      }).expect(200);

      const mismatch = await discount(mine.id, {
        repeatFromDiscountId: applied.body.discount.id,
      }).expect(422);
      expect(mismatch.body.code).toBe('DISCOUNT_PATIENT_MISMATCH');

      const ownerDiscount = await invoiceFor(patient, ['100.00']);
      const big = await discount(
        ownerDiscount.id,
        { type: 'PERCENT', value: '50', reason: 'Owner approved' },
        owner,
      ).expect(200);
      const limited = await discount(mine.id, {
        repeatFromDiscountId: big.body.discount.id,
      }).expect(422);
      expect(limited.body.code).toBe('DISCOUNT_LIMIT_EXCEEDED');
      await discount(
        mine.id,
        { repeatFromDiscountId: big.body.discount.id },
        owner,
      ).expect(200);

      await discount(mine.id, {
        repeatFromDiscountId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
    });

    it('200 null when there is none, or only removed ones / on cancelled invoices', async () => {
      const none = await request(server)
        .get(`/api/v1/patients/${patient.id}/last-discount`)
        .set(as(receptionist))
        .expect(200);
      expect(none.body).toBeNull();

      const removedOne = await invoiceFor(patient, ['100.00']);
      await discount(removedOne.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'Removed later',
      }).expect(200);
      await request(server)
        .post(`/api/v1/invoices/${removedOne.id}/discount/remove`)
        .set(as(receptionist))
        .send({ reason: 'Not deserved' })
        .expect(200);

      const cancelledOne = await invoiceFor(patient, ['100.00']);
      await discount(cancelledOne.id, {
        type: 'PERCENT',
        value: '10',
        reason: 'On cancelled',
      }).expect(200);
      await request(server)
        .post(`/api/v1/invoices/${cancelledOne.id}/cancel`)
        .set(as(receptionist))
        .send({ reason: 'Duplicate invoice' })
        .expect(200);

      const stillNone = await request(server)
        .get(`/api/v1/patients/${patient.id}/last-discount`)
        .set(as(receptionist))
        .expect(200);
      expect(stillNone.body).toBeNull();
      // Unknown patient: still 404.
      await request(server)
        .get(
          '/api/v1/patients/00000000-0000-4000-8000-000000000000/last-discount',
        )
        .set(as(receptionist))
        .expect(404);
    });
  });

  it('database CHECKs reject invalid discount rows', async () => {
    const invoice = await invoiceFor(patient, ['100.00']);
    const row = (values: Record<string, unknown>) =>
      ctx.dataSource.getRepository(InvoiceDiscount).insert({
        invoiceId: invoice.id,
        patientId: patient.id,
        type: 'PERCENT' as never,
        value: '10.00',
        amount: '10.00',
        reason: 'Valid reason',
        repeatedFromId: null,
        appliedById: owner.id,
        appliedAt: NOW,
        removedAt: null,
        removedById: null,
        removalReason: null,
        ...values,
      });
    for (const bad of [
      { value: '150.00' },
      { value: '0.00' },
      { reason: '  a  ' },
      { amount: '-1.00' },
    ]) {
      await expect(row(bad)).rejects.toMatchObject({
        driverError: { code: '23514' },
      });
    }
  });
});
