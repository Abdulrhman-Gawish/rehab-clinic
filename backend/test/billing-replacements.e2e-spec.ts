import request from 'supertest';
import type { App } from 'supertest/types.js';
import { In } from 'typeorm';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { Appointment } from '../src/modules/appointments/entities/appointment.entity.js';
import { InvoiceStatus } from '../src/modules/billing/billing.enums.js';
import { InvoiceDiscount } from '../src/modules/billing/entities/invoice-discount.entity.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { Payment } from '../src/modules/billing/entities/payment.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import { ReferralCommission } from '../src/modules/referrals/entities/referral-commission.entity.js';
import { Visit } from '../src/modules/visits/entities/visit.entity.js';
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
import { completeCheckInDetails } from './utils/check-in.js';

// Frozen clock: "today" is Tuesday 2026-11-03 in Cairo (+02:00), 09:00.
const TODAY = '2026-11-03';
const TOMORROW = '2026-11-04';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('09:00') };

interface Rate {
  type: 'NONE' | 'PERCENT' | 'FIXED';
  value?: string;
}
const pct = (value: string): Rate => ({ type: 'PERCENT', value });
const ALL = { type: 'ALL_SESSIONS' };
const WRONG_REFERRAL = 'Wrong referral selected by receptionist';

describe('Billing: replacement invoices (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorId: string;
  let serviceId: string;
  let ali: Patient;

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
    doctorId = (await createLoggedInDoctor(ctx.app, ctx.dataSource)).doctorId;
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'PT session',
        basePrice: '300.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctorId, serviceId);
    ali = await insertPatient(ctx.dataSource, 'ALI ALI', '+201096018442');
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
  });

  // A referring doctor and the patient referred to them on their defaults.
  async function referTo(
    name: string,
    commission: Rate,
    discount: Rate,
    applicability: object = ALL,
  ): Promise<{ doctorId: string; referralId: string; termsId: string }> {
    const doctor = await as(owner)
      .post('/referring-doctors', { name, commission, discount })
      .expect(201);
    const referral = await as(receptionist)
      .post(`/patients/${ali.id}/referrals`, {
        referringDoctorId: doctor.body.id,
        commission,
        discount,
        applicability,
      })
      .expect(201);
    return {
      doctorId: doctor.body.id,
      referralId: referral.body.id,
      termsId: referral.body.terms.id,
    };
  }
  const samaka = () => referTo('Samaka', pct('10'), pct('2'));
  const mohamedAhmed = (applicability: object = ALL) =>
    referTo('Mohamed Ahmed', pct('6'), pct('5'), applicability);

  const endReferral = (referralId: string) =>
    as(receptionist)
      .post(`/patient-referrals/${referralId}/end`, {
        reason: 'Assigned by mistake',
      })
      .expect(201);

  const todayAppointment = async (time = '10:00') =>
    (
      await insertAppointment(ctx.dataSource, {
        patientId: ali.id,
        doctorId,
        serviceId,
        startAt: local(time),
      })
    ).id;

  async function attend(
    appointmentId: string,
  ): Promise<{ visitId: string; invoiceId: string }> {
    await completeCheckInDetails(ctx.dataSource);
    const res = await as(receptionist)
      .post(`/appointments/${appointmentId}/attend`, {})
      .expect(201);
    return { visitId: res.body.id, invoiceId: res.body.invoiceId };
  }

  async function walkIn(): Promise<{ visitId: string; invoiceId: string }> {
    await completeCheckInDetails(ctx.dataSource);
    const res = await as(receptionist)
      .post('/visits/walk-in', {
        patientId: ali.id,
        doctorId,
        serviceId,
        type: 'SESSION',
      })
      .expect(201);
    return { visitId: res.body.id, invoiceId: res.body.invoiceId };
  }

  async function pay(invoiceId: string, amount: string): Promise<string> {
    const res = await as(receptionist)
      .post(`/invoices/${invoiceId}/payments`, { amount, method: 'CASH' })
      .expect(201);
    return res.body.id;
  }

  const voidReceipt = (paymentId: string) =>
    as(receptionist)
      .post(`/payments/${paymentId}/void`, { reason: 'Wrong referral' })
      .expect(200);

  const cancelInvoice = (invoiceId: string) =>
    as(receptionist)
      .post(`/invoices/${invoiceId}/cancel`, {
        reason: 'Created with the wrong referral',
      })
      .expect(200);

  const invoice = async (id: string) =>
    (await as(receptionist).get(`/invoices/${id}`).expect(200)).body;
  const preview = async (id: string) =>
    (await as(receptionist).get(`/invoices/${id}/replacement`).expect(200))
      .body;
  const correct = (id: string, reason = WRONG_REFERRAL) =>
    as(receptionist).post(`/invoices/${id}/correct`, { reason });
  const reissue = (id: string) =>
    as(receptionist).post(`/invoices/${id}/reissue`);

  const dayList = async () =>
    (await as(receptionist).get(`/appointments/day?date=${TODAY}`).expect(200))
      .body as {
      id: string | null;
      visitId: string | null;
      allowedActions: string[];
    }[];
  const dayRowOf = async (appointmentId: string) =>
    (await dayList()).find((row) => row.id === appointmentId);

  const ledger = async () =>
    (
      await ctx.dataSource.getRepository(ReferralCommission).find({
        relations: { referringDoctor: true },
        order: { recordedAt: 'ASC', createdAt: 'ASC' },
      })
    ).map((row) => ({
      kind: row.kind,
      amount: row.amount,
      doctor: row.referringDoctor?.name,
      invoiceId: row.invoiceId,
    }));

  const balance = async () =>
    (await as(receptionist).get(`/patients/${ali.id}/balance`).expect(200))
      .body;

  /**
   * ALI ALI: referred to Samaka (2% discount, 10% commission) by mistake,
   * attended a 300.00 session, paid 294.00, the receipt was voided, the
   * referral ended and Mohamed Ahmed (5%, 6%) recorded instead.
   */
  async function wrongReferralVoided() {
    const wrong = await samaka();
    const appointmentId = await todayAppointment();
    const { visitId, invoiceId } = await attend(appointmentId);
    const paymentId = await pay(invoiceId, '294.00');
    await voidReceipt(paymentId);
    await endReferral(wrong.referralId);
    const right = await mohamedAhmed();
    return { appointmentId, visitId, invoiceId, paymentId, wrong, right };
  }

  // ---------- correct (a live invoice) ----------

  describe('correcting an invoice billed with the wrong referral', () => {
    it('ALI ALI: preview, then a replacement for the same visit with Mohamed Ahmed 5% (285.00)', async () => {
      const s = await wrongReferralVoided();
      expect(await invoice(s.invoiceId)).toMatchObject({
        status: 'ISSUED',
        total: '294.00',
        amountPaid: '0.00',
        canCorrect: true,
        canReissue: false,
      });

      expect(await preview(s.invoiceId)).toEqual({
        invoiceId: s.invoiceId,
        invoiceNumber: 'INV-2026-000001',
        action: 'CORRECT',
        blockedBy: null,
        current: {
          referral: expect.objectContaining({
            termsId: s.wrong.termsId,
            referringDoctor: { id: s.wrong.doctorId, name: 'Samaka' },
          }),
          discount: {
            type: 'PERCENT',
            value: '2.00',
            amount: '6.00',
            reason: 'Doctor referral: Samaka',
          },
          subtotal: '300.00',
          discountTotal: '6.00',
          total: '294.00',
        },
        replacement: {
          referral: expect.objectContaining({
            termsId: s.right.termsId,
            referringDoctor: { id: s.right.doctorId, name: 'Mohamed Ahmed' },
          }),
          discount: {
            type: 'PERCENT',
            value: '5.00',
            amount: '15.00',
            reason: 'Doctor referral: Mohamed Ahmed',
          },
          subtotal: '300.00',
          discountTotal: '15.00',
          total: '285.00',
        },
        replacementNotCovered: null,
      });

      const res = await correct(s.invoiceId).expect(201);
      expect(res.body).toMatchObject({
        invoiceNumber: 'INV-2026-000002',
        status: 'ISSUED',
        visitId: s.visitId,
        subtotal: '300.00',
        discountTotal: '15.00',
        total: '285.00',
        amountPaid: '0.00',
        balance: '285.00',
        items: [
          { description: 'PT session', unitPrice: '300.00', quantity: 1 },
        ],
        discount: {
          type: 'PERCENT',
          value: '5.00',
          amount: '15.00',
          reason: 'Doctor referral: Mohamed Ahmed',
          referralTermsId: s.right.termsId,
          repeatedFromId: null,
        },
        referral: {
          termsId: s.right.termsId,
          referringDoctor: { name: 'Mohamed Ahmed' },
        },
        payments: [],
        replacesInvoice: {
          id: s.invoiceId,
          invoiceNumber: 'INV-2026-000001',
        },
        replacedBy: null,
        canCorrect: false,
        canReissue: false,
      });
      expect(res.body.id).not.toBe(s.invoiceId);
    });

    it('the original stays as it was: cancelled, its referral, discount and voided receipt, linked to the replacement', async () => {
      const s = await wrongReferralVoided();
      const discounts = await ctx.dataSource
        .getRepository(InvoiceDiscount)
        .findBy({ invoiceId: s.invoiceId });
      const receipts = await ctx.dataSource
        .getRepository(Payment)
        .findBy({ invoiceId: s.invoiceId });
      const replacement = (await correct(s.invoiceId).expect(201)).body;

      expect(await invoice(s.invoiceId)).toMatchObject({
        invoiceNumber: 'INV-2026-000001',
        status: 'CANCELLED',
        cancelReason: WRONG_REFERRAL,
        cancelledBy: { id: receptionist.id },
        subtotal: '300.00',
        discountTotal: '6.00',
        total: '294.00',
        amountPaid: '0.00',
        discount: { amount: '6.00', reason: 'Doctor referral: Samaka' },
        referral: { termsId: s.wrong.termsId },
        payments: [{ id: s.paymentId, status: 'VOIDED', amount: '294.00' }],
        replacedBy: {
          id: replacement.id,
          invoiceNumber: replacement.invoiceNumber,
        },
        replacesInvoice: null,
        canCorrect: false,
        canReissue: false,
      });
      // Nothing about its discount or its receipt was touched.
      expect(
        await ctx.dataSource
          .getRepository(InvoiceDiscount)
          .findBy({ invoiceId: s.invoiceId }),
      ).toEqual(discounts);
      expect(
        await ctx.dataSource
          .getRepository(Payment)
          .findBy({ invoiceId: s.invoiceId }),
      ).toEqual(receipts);
      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .findOneByOrFail({ id: replacement.id }),
      ).toMatchObject({ replacesInvoiceId: s.invoiceId, visitId: s.visitId });
    });

    it("balance: a voided receipt never counted, and the original stops counting once it's replaced", async () => {
      const s = await wrongReferralVoided();
      expect(await balance()).toMatchObject({
        totalInvoiced: '294.00',
        totalPaid: '0.00',
        balance: '294.00',
      });
      const replacement = (await correct(s.invoiceId).expect(201)).body;
      expect(await balance()).toMatchObject({
        totalInvoiced: '285.00',
        totalPaid: '0.00',
        balance: '285.00',
      });
      const open = await as(receptionist)
        .get(`/invoices?patientId=${ali.id}&hasBalance=true`)
        .expect(200);
      expect(open.body.items.map((i: { id: string }) => i.id)).toEqual([
        replacement.id,
      ]);
    });

    it("commissions: Samaka's +29.40 / -29.40 stay; paying the replacement earns 17.10 for Mohamed Ahmed", async () => {
      const s = await wrongReferralVoided();
      const replacement = (await correct(s.invoiceId).expect(201)).body;

      await pay(replacement.id, '285.00');
      expect(await invoice(replacement.id)).toMatchObject({
        status: 'PAID',
        amountPaid: '285.00',
        balance: '0.00',
      });
      expect(await ledger()).toEqual([
        {
          kind: 'EARNED',
          amount: '29.40',
          doctor: 'Samaka',
          invoiceId: s.invoiceId,
        },
        {
          kind: 'VOID_REVERSAL',
          amount: '-29.40',
          doctor: 'Samaka',
          invoiceId: s.invoiceId,
        },
        {
          kind: 'EARNED',
          amount: '17.10',
          doctor: 'Mohamed Ahmed',
          invoiceId: replacement.id,
        },
      ]);
      const owed = async (id: string) =>
        (
          await as(owner)
            .get(`/referring-doctors/${id}/commission-balance`)
            .expect(200)
        ).body;
      expect(await owed(s.wrong.doctorId)).toMatchObject({
        earned: '29.40',
        reversed: '29.40',
        outstanding: '0.00',
      });
      expect(await owed(s.right.doctorId)).toMatchObject({
        earned: '17.10',
        outstanding: '17.10',
      });
      expect(await balance()).toMatchObject({ balance: '0.00' });
    });

    it('the attendance does not change; the day list shows the replacement', async () => {
      const s = await wrongReferralVoided();
      const replacement = (await correct(s.invoiceId).expect(201)).body;

      expect(
        await ctx.dataSource.getRepository(Visit).findBy({ patientId: ali.id }),
      ).toEqual([expect.objectContaining({ id: s.visitId, status: 'ACTIVE' })]);
      expect(
        await ctx.dataSource
          .getRepository(Appointment)
          .findOneByOrFail({ id: s.appointmentId }),
      ).toMatchObject({ status: 'ATTENDED' });
      const row = await dayRowOf(s.appointmentId);
      expect(row).toMatchObject({
        visitId: s.visitId,
        status: 'ATTENDED',
        invoiceId: replacement.id,
        invoiceTotal: '285.00',
        paymentStatus: 'UNPAID',
        invoiceStatus: 'ISSUED',
        cancelledInvoiceId: null,
      });
      expect(row?.allowedActions).not.toContain('createInvoice');

      // Undoing the attendance now cancels the replacement (the live one).
      await as(receptionist)
        .post(`/appointments/${s.appointmentId}/undo-attend`, {
          reason: 'Did not attend',
        })
        .expect(200);
      expect(await invoice(replacement.id)).toMatchObject({
        status: 'CANCELLED',
      });
    });

    it('is done once: a second correction or reissue is 409, and the replacement keeps its referral', async () => {
      const s = await wrongReferralVoided();
      const replacement = (await correct(s.invoiceId).expect(201)).body;

      const again = await correct(s.invoiceId).expect(409);
      expect(again.body).toMatchObject({
        code: 'INVOICE_ALREADY_REPLACED',
        details: {
          replacementInvoiceId: replacement.id,
          replacementInvoiceNumber: replacement.invoiceNumber,
        },
      });
      const reissued = await reissue(s.invoiceId).expect(409);
      expect(reissued.body.code).toBe('INVOICE_ALREADY_REPLACED');
      expect(await preview(s.invoiceId)).toMatchObject({
        action: null,
        blockedBy: 'ALREADY_REPLACED',
        replacement: null,
      });
      // Mohamed Ahmed's referral is active: nothing to correct.
      const res = await correct(replacement.id).expect(422);
      expect(res.body).toMatchObject({
        code: 'INVOICE_NOT_REPLACEABLE',
        details: { reason: 'REFERRAL_ACTIVE' },
      });
    });

    it('parallel corrections: exactly one replacement', async () => {
      const s = await wrongReferralVoided();
      const statuses = await Promise.all(
        [1, 2, 3].map(() => correct(s.invoiceId).then((res) => res.status)),
      );
      expect(statuses.sort()).toEqual([201, 409, 409]);
      const invoices = await ctx.dataSource
        .getRepository(Invoice)
        .findBy({ visitId: s.visitId });
      expect(invoices.map((i) => i.status).sort()).toEqual([
        'CANCELLED',
        'ISSUED',
      ]);
    });

    it('ending a referral or recording another never changes an existing invoice', async () => {
      const wrong = await samaka();
      const { invoiceId } = await attend(await todayAppointment());
      const before = await ctx.dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: invoiceId });
      const discounts = await ctx.dataSource
        .getRepository(InvoiceDiscount)
        .findBy({ invoiceId });

      await endReferral(wrong.referralId);
      await mohamedAhmed();

      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .findOneByOrFail({ id: invoiceId }),
      ).toEqual(before);
      expect(
        await ctx.dataSource
          .getRepository(InvoiceDiscount)
          .findBy({ invoiceId }),
      ).toEqual(discounts);
      expect(await invoice(invoiceId)).toMatchObject({
        status: 'ISSUED',
        total: '294.00',
        referral: { referringDoctor: { name: 'Samaka' } },
        canCorrect: true,
      });
      expect(
        await ctx.dataSource.getRepository(Invoice).count({
          where: { patientId: ali.id },
        }),
      ).toBe(1);
    });

    it('money on the invoice: a valid payment, or a refunded one, is left for review', async () => {
      const wrong = await samaka();
      const { invoiceId } = await attend(await todayAppointment());
      const paymentId = await pay(invoiceId, '100.00');
      await endReferral(wrong.referralId);
      await mohamedAhmed();

      const partial = await correct(invoiceId).expect(422);
      expect(partial.body).toMatchObject({
        code: 'INVOICE_NOT_REPLACEABLE',
        details: { reason: 'HAS_PAYMENTS' },
      });
      expect(await preview(invoiceId)).toMatchObject({
        action: null,
        blockedBy: 'HAS_PAYMENTS',
        replacement: null,
      });

      await as(owner)
        .post(`/payments/${paymentId}/refund`, {
          amount: '100.00',
          reason: 'Returned to the patient',
        })
        .expect(201);
      expect(await invoice(invoiceId)).toMatchObject({
        amountPaid: '0.00',
        canCorrect: false,
      });
      const refunded = await correct(invoiceId).expect(422);
      expect(refunded.body.details).toEqual({ reason: 'HAS_PAYMENTS' });
      expect(await invoice(invoiceId)).toMatchObject({
        status: 'ISSUED',
        replacedBy: null,
      });
    });

    it('nothing to correct: referral still active, no referral, not a session invoice, already cancelled', async () => {
      const wrong = await samaka();
      const reason = async (id: string) =>
        (await correct(id).expect(422)).body.details.reason;

      expect(await reason((await walkIn()).invoiceId)).toBe('REFERRAL_ACTIVE');
      const manual = await as(receptionist)
        .post('/invoices', {
          patientId: ali.id,
          items: [
            { description: 'Medical report', unitPrice: '50.00', quantity: 1 },
          ],
        })
        .expect(201);
      expect(await reason(manual.body.id)).toBe('NOT_A_SESSION_INVOICE');

      await endReferral(wrong.referralId);
      const unreferred = await walkIn();
      expect(await reason(unreferred.invoiceId)).toBe('NO_REFERRAL');
      await cancelInvoice(unreferred.invoiceId);
      expect(await reason(unreferred.invoiceId)).toBe('CANCELLED');
    });

    it('without a current referral the replacement gets no referral discount (walk-in)', async () => {
      const wrong = await samaka();
      const { visitId, invoiceId } = await walkIn();
      await endReferral(wrong.referralId);

      expect(await preview(invoiceId)).toMatchObject({
        action: 'CORRECT',
        replacement: {
          referral: null,
          discount: null,
          discountTotal: '0.00',
          total: '300.00',
        },
        replacementNotCovered: 'NO_ACTIVE_REFERRAL',
      });
      const res = await correct(invoiceId).expect(201);
      expect(res.body).toMatchObject({
        visitId,
        total: '300.00',
        discount: null,
        referral: null,
        replacesInvoice: { id: invoiceId },
      });
    });

    it('a session from an earlier day is covered as of the session date', async () => {
      const wrong = await samaka();
      const { invoiceId } = await attend(await todayAppointment());
      await endReferral(wrong.referralId);
      await mohamedAhmed({
        type: 'DATE_RANGE',
        validFrom: TODAY,
        validTo: TODAY,
      });

      clock.current = local('09:00', TOMORROW);
      const res = await correct(invoiceId).expect(201);
      expect(res.body).toMatchObject({
        issuedAt: '2026-11-04T09:00:00+02:00',
        discountTotal: '15.00',
        total: '285.00',
        referral: { referringDoctor: { name: 'Mohamed Ahmed' } },
      });
    });

    it('is audited on the original with both sides, the reason and the voided receipt', async () => {
      const s = await wrongReferralVoided();
      const replacement = (await correct(s.invoiceId).expect(201)).body;

      const logs = await as(owner)
        .get(`/audit-logs?entityId=${s.invoiceId}&action=INVOICE_CORRECTED`)
        .expect(200);
      expect(logs.body.items).toHaveLength(1);
      expect(logs.body.items[0]).toMatchObject({
        user: { id: receptionist.id },
        entityType: 'INVOICE',
        oldValues: {
          invoiceNumber: 'INV-2026-000001',
          status: 'ISSUED',
          referral: { referringDoctor: { name: 'Samaka' } },
          discount: { value: '2.00', amount: '6.00' },
          subtotal: '300.00',
          discountTotal: '6.00',
          total: '294.00',
        },
        newValues: {
          reason: WRONG_REFERRAL,
          visitId: s.visitId,
          replacementInvoiceId: replacement.id,
          replacementInvoiceNumber: replacement.invoiceNumber,
          referral: { referringDoctor: { name: 'Mohamed Ahmed' } },
          discount: { value: '5.00', amount: '15.00' },
          discountTotal: '15.00',
          total: '285.00',
          voidedReceipts: [
            {
              paymentId: s.paymentId,
              amount: '294.00',
              voidReason: 'Wrong referral',
            },
          ],
        },
      });
    });
  });

  // ---------- reissue (a cancelled invoice), from Today's List ----------

  describe("creating the invoice again from Today's List", () => {
    it('an attended row whose invoice was cancelled offers createInvoice; it bills the current referral', async () => {
      const wrong = await samaka();
      const appointmentId = await todayAppointment();
      const { visitId, invoiceId } = await attend(appointmentId);
      await cancelInvoice(invoiceId);
      await endReferral(wrong.referralId);
      const right = await mohamedAhmed();

      const row = await dayRowOf(appointmentId);
      expect(row).toMatchObject({
        status: 'ATTENDED',
        visitId,
        invoiceId: null,
        paymentStatus: 'NOT_INVOICED',
        invoiceStatus: 'CANCELLED',
        cancelledInvoiceId: invoiceId,
      });
      expect(row?.allowedActions).toContain('createInvoice');
      expect(await preview(invoiceId)).toMatchObject({
        action: 'REISSUE',
        current: { total: '294.00' },
        replacement: {
          referral: { termsId: right.termsId },
          discount: { amount: '15.00' },
          total: '285.00',
        },
      });

      const res = await reissue(invoiceId).expect(201);
      expect(res.body).toMatchObject({
        status: 'ISSUED',
        visitId,
        total: '285.00',
        discount: { reason: 'Doctor referral: Mohamed Ahmed' },
        replacesInvoice: { id: invoiceId },
      });
      expect(await invoice(invoiceId)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Created with the wrong referral',
        discountTotal: '6.00',
        replacedBy: { id: res.body.id },
      });
      const after = await dayRowOf(appointmentId);
      expect(after).toMatchObject({
        status: 'ATTENDED',
        visitId,
        invoiceId: res.body.id,
        invoiceStatus: 'ISSUED',
        cancelledInvoiceId: null,
        paymentStatus: 'UNPAID',
      });
      expect(after?.allowedActions).not.toContain('createInvoice');
      expect(
        await ctx.dataSource
          .getRepository(Visit)
          .countBy({ patientId: ali.id }),
      ).toBe(1);

      const logs = await as(owner)
        .get(`/audit-logs?entityId=${invoiceId}&action=INVOICE_REISSUED`)
        .expect(200);
      expect(logs.body.items[0]).toMatchObject({
        oldValues: { status: 'CANCELLED', total: '294.00' },
        newValues: { replacementInvoiceId: res.body.id, total: '285.00' },
      });
      expect(logs.body.items[0].newValues).not.toHaveProperty('reason');
    });

    it('no createInvoice for an active invoice, a voided receipt only, a row not attended, or an undone attendance', async () => {
      await samaka();
      const active = await todayAppointment('10:00');
      const live = await attend(active);
      const voided = await todayAppointment('11:00');
      const withVoidedReceipt = await attend(voided);
      await voidReceipt(await pay(withVoidedReceipt.invoiceId, '294.00'));
      const notAttended = await todayAppointment('12:00');
      const undone = await todayAppointment('13:00');
      const undoneVisit = await attend(undone);
      await as(receptionist)
        .post(`/appointments/${undone}/undo-attend`, { reason: 'Mistake' })
        .expect(200);

      const rows = await dayList();
      const rowOf = (id: string) => rows.find((r) => r.id === id);
      for (const id of [active, voided, notAttended, undone]) {
        expect(rowOf(id)?.allowedActions).not.toContain('createInvoice');
      }
      expect(rowOf(active)).toMatchObject({
        invoiceStatus: 'ISSUED',
        cancelledInvoiceId: null,
      });
      expect(rowOf(voided)).toMatchObject({
        invoiceId: withVoidedReceipt.invoiceId,
        invoiceStatus: 'ISSUED',
        cancelledInvoiceId: null,
      });
      for (const id of [notAttended, undone]) {
        expect(rowOf(id)).toMatchObject({
          status: 'CONFIRMED',
          invoiceId: null,
          paymentStatus: 'NOT_INVOICED',
          invoiceStatus: null,
          cancelledInvoiceId: null,
        });
      }

      // The backend refuses the same cases.
      const reason = async (id: string) =>
        (await reissue(id).expect(422)).body.details.reason;
      expect(await reason(live.invoiceId)).toBe('NOT_CANCELLED');
      expect(await reason(withVoidedReceipt.invoiceId)).toBe('NOT_CANCELLED');
      expect(await reason(undoneVisit.invoiceId)).toBe('VISIT_VOIDED');
    });

    it('duplicate requests create one invoice; a cancelled replacement can be created again (walk-in)', async () => {
      const { visitId, invoiceId } = await walkIn();
      await cancelInvoice(invoiceId);
      const walkInRow = (await dayList()).find((r) => r.visitId === visitId);
      expect(walkInRow).toMatchObject({
        id: null,
        cancelledInvoiceId: invoiceId,
      });
      expect(walkInRow?.allowedActions).toContain('createInvoice');

      const statuses = await Promise.all(
        [1, 2, 3].map(() => reissue(invoiceId).then((res) => res.status)),
      );
      expect(statuses.sort()).toEqual([201, 409, 409]);
      const first = await ctx.dataSource
        .getRepository(Invoice)
        .findOneByOrFail({
          replacesInvoiceId: invoiceId,
        });

      // The replacement is cancelled too: the row offers it again, and the
      // next invoice replaces the replacement (one link each).
      await cancelInvoice(first.id);
      expect(
        (await dayList()).find((r) => r.visitId === visitId),
      ).toMatchObject({ cancelledInvoiceId: first.id });
      const second = (await reissue(first.id).expect(201)).body;
      expect(second.replacesInvoice).toEqual({
        id: first.id,
        invoiceNumber: first.invoiceNumber,
      });
      await reissue(invoiceId).expect(409);
      expect(
        await ctx.dataSource.getRepository(Invoice).count({
          where: { visitId, id: In([invoiceId, first.id, second.id]) },
        }),
      ).toBe(3);
      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .countBy({ visitId, status: InvoiceStatus.ISSUED }),
      ).toBe(1);
    });
  });
});
