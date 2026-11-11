import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IsNull } from 'typeorm';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { getPgError } from '../src/common/utils/pg-errors.js';
import { InvoiceDiscount } from '../src/modules/billing/entities/invoice-discount.entity.js';
import { Invoice } from '../src/modules/billing/entities/invoice.entity.js';
import { Payment } from '../src/modules/billing/entities/payment.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import { ReferralCommission } from '../src/modules/referrals/entities/referral-commission.entity.js';
import { ReferralCommissionsService } from '../src/modules/referrals/referral-commissions.service.js';
import { CommissionKind } from '../src/modules/referrals/referrals.enums.js';
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

// The desk discount cap applies to a receptionist's own discount override.
// Runs before the app (and its config) is imported.
vi.hoisted(() => {
  process.env.RECEPTIONIST_MAX_DISCOUNT_PERCENT = '30';
});

// Frozen clock: "today" is Tuesday 2026-11-03 in Cairo (+02:00), 09:00.
const TODAY = '2026-11-03';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('09:00') };
const RANGE = '?from=2026-11-01&to=2026-11-30';

interface Rate {
  type: 'NONE' | 'PERCENT' | 'FIXED';
  value?: string;
}
const pct = (value: string): Rate => ({ type: 'PERCENT', value });
const fixed = (value: string): Rate => ({ type: 'FIXED', value });
const NONE: Rate = { type: 'NONE' };
const ALL = { type: 'ALL_SESSIONS' };

describe('Doctor referrals (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctorId: string;
  let serviceId: string;
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
    doctorId = (await createLoggedInDoctor(ctx.app, ctx.dataSource)).doctorId;
    serviceId = (
      await insertService(ctx.dataSource, {
        name: 'Physio',
        basePrice: '1000.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctorId, serviceId);
    patient = await insertPatient(ctx.dataSource, 'Sara Ali', '+201000000001');
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
  });

  async function referringDoctor(
    commission: Rate = pct('10'),
    discount: Rate = pct('10'),
    extra: object = {},
  ): Promise<{ id: string; currentAgreement: { id: string } }> {
    const res = await as(owner)
      .post('/referring-doctors', {
        name: 'Dr. Hany Samir',
        commission,
        discount,
        ...extra,
      })
      .expect(201);
    return res.body as { id: string; currentAgreement: { id: string } };
  }

  // Defaults match referringDoctor()'s defaults (not an override).
  const refer = (
    referringDoctorId: string,
    overrides: object = {},
    user: TestUser = receptionist,
    who: Patient = patient,
  ) =>
    as(user).post(`/patients/${who.id}/referrals`, {
      referringDoctorId,
      commission: pct('10'),
      discount: pct('10'),
      applicability: ALL,
      ...overrides,
    });

  async function walkIn(body: object = {}, who: Patient = patient) {
    const res = await as(receptionist)
      .post('/visits/walk-in', {
        patientId: who.id,
        doctorId,
        serviceId,
        ...body,
      })
      .expect(201);
    return res.body as { id: string; invoiceId: string };
  }

  const invoice = async (id: string) =>
    (await as(receptionist).get(`/invoices/${id}`).expect(200)).body as {
      subtotal: string;
      discountTotal: string;
      total: string;
      discount: {
        amount: string;
        reason: string;
        referralTermsId: string | null;
      } | null;
      referral: {
        termsVersion: number;
        referringDoctor: { name: string };
      } | null;
    };

  async function pay(invoiceId: string, amount: string): Promise<string> {
    const res = await as(receptionist)
      .post(`/invoices/${invoiceId}/payments`, { amount, method: 'CASH' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function refund(paymentId: string, amount: string): Promise<string> {
    const res = await as(owner)
      .post(`/payments/${paymentId}/refund`, {
        amount,
        reason: 'Returned to the patient',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const voidPayment = (paymentId: string, user = owner) =>
    as(user)
      .post(`/payments/${paymentId}/void`, { reason: 'Recorded twice' })
      .expect(200);

  const ledger = () =>
    ctx.dataSource
      .getRepository(ReferralCommission)
      .find({ order: { createdAt: 'ASC', id: 'ASC' } });

  const amounts = async () => (await ledger()).map((row) => row.amount);

  const balance = async (referringDoctorId: string) =>
    (
      await as(owner)
        .get(`/referring-doctors/${referringDoctorId}/commission-balance`)
        .expect(200)
    ).body as Record<string, string>;

  const referrals = async (who: Patient = patient) =>
    (await as(receptionist).get(`/patients/${who.id}/referrals`).expect(200))
      .body as {
      id: string;
      status: string;
      coveredSessions: number;
      history: unknown[];
    }[];

  // ---------- referring doctors ----------

  describe('referring doctors (OWNER)', () => {
    it('creates a doctor with agreement version 1, effective today, audited', async () => {
      const res = await as(owner)
        .post('/referring-doctors', {
          name: '  Dr.   Hany Samir ',
          phone: '01012345678',
          specialty: 'Orthopedics',
          commission: pct('10'),
          discount: fixed('50'),
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Dr. Hany Samir',
        phone: '+201012345678',
        isActive: true,
        currentAgreement: {
          version: 1,
          effectiveFrom: TODAY,
          commission: { type: 'PERCENT', value: '10.00' },
          discount: { type: 'FIXED', value: '50.00' },
        },
        upcomingAgreement: null,
      });
      const audit = await as(owner)
        .get(`/audit-logs?entityId=${res.body.id}`)
        .expect(200);
      const actions = (audit.body.items as { action: string }[]).map(
        (row) => row.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'REFERRING_DOCTOR_CREATED',
          'REFERRAL_AGREEMENT_CREATED',
        ]),
      );
    });

    it('rejects a phone already used by another referring doctor (409)', async () => {
      const first = await referringDoctor(pct('10'), NONE, {
        phone: '01012345678',
      });
      const res = await as(owner)
        .post('/referring-doctors', {
          name: 'Dr. Other',
          phone: '+201012345678',
          commission: NONE,
          discount: NONE,
        })
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'REFERRING_DOCTOR_PHONE_TAKEN',
        details: { referringDoctorId: first.id },
      });
    });

    it('validates rates: NONE takes no value, PERCENT at most 100, others need a value', async () => {
      const post = (commission: Rate) =>
        as(owner)
          .post('/referring-doctors', {
            name: 'Dr. X',
            commission,
            discount: NONE,
          })
          .expect(400);
      expect(
        (await post({ type: 'NONE', value: '5' })).body.details[0],
      ).toMatchObject({
        field: 'commission.value',
      });
      await post(pct('100.01'));
      await post({ type: 'FIXED' });
      await post(pct('0'));
    });

    it('edits the doctor with old and new values audited', async () => {
      const doc = await referringDoctor();
      await as(owner)
        .patch(`/referring-doctors/${doc.id}`, { workplace: 'Kasr Al Ainy' })
        .expect(200);
      const audit = await as(owner)
        .get(`/audit-logs?entityId=${doc.id}&action=REFERRING_DOCTOR_UPDATED`)
        .expect(200);
      expect(audit.body.items[0]).toMatchObject({
        oldValues: { workplace: null },
        newValues: { workplace: 'Kasr Al Ainy' },
      });
    });

    it('a new agreement version: future dates are upcoming, past dates refused, history kept', async () => {
      const doc = await referringDoctor();
      await as(owner)
        .post(`/referring-doctors/${doc.id}/agreements`, {
          commission: pct('12'),
          discount: NONE,
          effectiveFrom: '2026-12-01',
        })
        .expect(201);
      const res = await as(owner)
        .get(`/referring-doctors/${doc.id}`)
        .expect(200);
      expect(res.body.currentAgreement.version).toBe(1);
      expect(res.body.upcomingAgreement).toMatchObject({
        version: 2,
        effectiveFrom: '2026-12-01',
      });

      const past = await as(owner)
        .post(`/referring-doctors/${doc.id}/agreements`, {
          commission: pct('12'),
          discount: NONE,
          effectiveFrom: '2026-11-02',
        })
        .expect(422);
      expect(past.body.code).toBe('AGREEMENT_DATE_INVALID');
      // Not before the latest version either.
      const early = await as(owner)
        .post(`/referring-doctors/${doc.id}/agreements`, {
          commission: pct('12'),
          discount: NONE,
          effectiveFrom: '2026-11-20',
        })
        .expect(422);
      expect(early.body.details).toEqual({ minDate: '2026-12-01' });

      const history = await as(owner)
        .get(`/referring-doctors/${doc.id}/agreements`)
        .expect(200);
      expect(history.body.map((a: { version: number }) => a.version)).toEqual([
        2, 1,
      ]);
    });
  });

  // ---------- patient referral ----------

  describe('assigning a referral', () => {
    it('loads the doctor default (not an override) and records the DOCTOR_REFERRAL source', async () => {
      const doc = await referringDoctor();
      const res = await refer(doc.id).expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        referringDoctor: { id: doc.id, name: 'Dr. Hany Samir' },
        coveredSessions: 0,
        terms: {
          version: 1,
          defaults: {
            agreementId: doc.currentAgreement.id,
            agreementVersion: 1,
            commission: { type: 'PERCENT', value: '10.00' },
            discount: { type: 'PERCENT', value: '10.00' },
          },
          commission: { type: 'PERCENT', value: '10.00' },
          discount: { type: 'PERCENT', value: '10.00' },
          applicability: { type: 'ALL_SESSIONS' },
          isOverride: false,
          overrideReason: null,
        },
      });
      const acquisition = await as(receptionist)
        .get(`/patients/${patient.id}/acquisition`)
        .expect(200);
      expect(acquisition.body.sources).toEqual([
        expect.objectContaining({
          channel: 'DOCTOR_REFERRAL',
          category: 'REFERRAL',
          isPrimary: true,
          details: 'Dr. Hany Samir',
        }),
      ]);
    });

    it('an override needs a reason; the defaults and the doctor agreement stay as they were', async () => {
      const doc = await referringDoctor();
      const missing = await refer(doc.id, { commission: pct('15') }).expect(
        422,
      );
      expect(missing.body.code).toBe('OVERRIDE_REASON_REQUIRED');

      const res = await refer(doc.id, {
        commission: pct('15'),
        overrideReason: 'Agreed by phone with the doctor',
      }).expect(201);
      expect(res.body.terms).toMatchObject({
        isOverride: true,
        overrideReason: 'Agreed by phone with the doctor',
        commission: { value: '15.00' },
        defaults: { commission: { value: '10.00' } },
      });
      const doctorNow = await as(owner)
        .get(`/referring-doctors/${doc.id}`)
        .expect(200);
      expect(doctorNow.body.currentAgreement.commission.value).toBe('10.00');
    });

    it("a receptionist's own percent discount stays within the desk cap; the OWNER's default does not count", async () => {
      const doc = await referringDoctor(pct('10'), pct('50'));
      const own = await refer(doc.id, {
        discount: pct('40'),
        overrideReason: 'Family of staff',
      }).expect(422);
      expect(own.body.code).toBe('DISCOUNT_LIMIT_EXCEEDED');
      // The doctor's default (50%) is the OWNER's decision.
      await refer(doc.id, { discount: pct('50') }).expect(201);
    });

    it('one active referral per patient (409)', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const res = await refer(doc.id).expect(409);
      expect(res.body.code).toBe('REFERRAL_ALREADY_ACTIVE');
    });

    it('an inactive doctor gets no new referral; current ones keep working', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      await as(owner)
        .patch(`/referring-doctors/${doc.id}/deactivate`)
        .expect(200);

      const other = await insertPatient(
        ctx.dataSource,
        'Mona',
        '+201000000002',
      );
      const res = await refer(doc.id, {}, receptionist, other).expect(422);
      expect(res.body.code).toBe('REFERRING_DOCTOR_INACTIVE');

      const visit = await walkIn();
      expect((await invoice(visit.invoiceId)).referral).not.toBeNull();
    });

    it("a changed doctor agreement never changes an existing patient's terms or billing", async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      await as(owner)
        .post(`/referring-doctors/${doc.id}/agreements`, {
          commission: pct('20'),
          discount: NONE,
        })
        .expect(201);

      // Existing patient: still 10% discount, 10% commission.
      const visit = await walkIn();
      expect((await invoice(visit.invoiceId)).discountTotal).toBe('100.00');
      await pay(visit.invoiceId, '900.00');
      expect(await amounts()).toEqual(['90.00']);

      // A new patient gets version 2 as defaults.
      const other = await insertPatient(
        ctx.dataSource,
        'Mona',
        '+201000000002',
      );
      const res = await refer(
        doc.id,
        { commission: pct('20'), discount: NONE },
        receptionist,
        other,
      ).expect(201);
      expect(res.body.terms).toMatchObject({
        isOverride: false,
        defaults: { agreementVersion: 2 },
      });
    });

    it('changing the terms adds a version; billed sessions keep theirs', async () => {
      const doc = await referringDoctor();
      const referral = (await refer(doc.id).expect(201)).body as { id: string };
      const first = await walkIn();

      const changed = await as(receptionist)
        .post(`/patient-referrals/${referral.id}/terms`, {
          commission: pct('20'),
          discount: pct('10'),
          applicability: ALL,
          overrideReason: 'Doctor asked for more',
        })
        .expect(201);
      expect(changed.body.terms.version).toBe(2);
      expect(changed.body.history).toHaveLength(2);
      // The same values again: no new version.
      const same = await as(receptionist)
        .post(`/patient-referrals/${referral.id}/terms`, {
          commission: pct('20'),
          discount: pct('10'),
          applicability: ALL,
          overrideReason: 'Doctor asked for more',
        })
        .expect(201);
      expect(same.body.history).toHaveLength(2);

      const second = await walkIn();
      expect((await invoice(first.invoiceId)).referral?.termsVersion).toBe(1);
      expect((await invoice(second.invoiceId)).referral?.termsVersion).toBe(2);
      await pay(first.invoiceId, '900.00');
      await pay(second.invoiceId, '900.00');
      expect(await amounts()).toEqual(['90.00', '180.00']);
    });

    it('ending: no new session is covered; ended referrals are read-only; a new one can start', async () => {
      const doc = await referringDoctor();
      const referral = (await refer(doc.id).expect(201)).body as { id: string };
      const ended = await as(receptionist)
        .post(`/patient-referrals/${referral.id}/end`, {
          reason: 'Recorded for the wrong doctor',
        })
        .expect(201);
      expect(ended.body).toMatchObject({
        status: 'ENDED',
        endReason: 'Recorded for the wrong doctor',
      });
      expect((await invoice((await walkIn()).invoiceId)).referral).toBeNull();

      const again = await as(receptionist)
        .post(`/patient-referrals/${referral.id}/end`, { reason: 'Twice' })
        .expect(422);
      expect(again.body.code).toBe('REFERRAL_ENDED');
      await as(receptionist)
        .post(`/patient-referrals/${referral.id}/terms`, {
          commission: NONE,
          discount: NONE,
          applicability: ALL,
          overrideReason: 'Nothing',
        })
        .expect(422);
      await refer(doc.id).expect(201);
      expect(await referrals()).toHaveLength(2);
    });
  });

  // ---------- coverage and discount ----------

  describe('sessions covered by the referral', () => {
    it("a referred patient's session invoice carries the referral and its discount", async () => {
      const doc = await referringDoctor();
      const terms = (await refer(doc.id).expect(201)).body.terms as {
        id: string;
      };
      const visit = await walkIn();
      expect(await invoice(visit.invoiceId)).toMatchObject({
        subtotal: '1000.00',
        discountTotal: '100.00',
        total: '900.00',
        discount: {
          amount: '100.00',
          reason: 'Doctor referral: Dr. Hany Samir',
          referralTermsId: terms.id,
        },
        referral: {
          termsVersion: 1,
          referringDoctor: { name: 'Dr. Hany Samir' },
        },
      });
    });

    it('a FIXED discount is capped at the subtotal', async () => {
      const doc = await referringDoctor(NONE, fixed('1500'));
      await refer(doc.id, { commission: NONE, discount: fixed('1500') }).expect(
        201,
      );
      const visit = await walkIn();
      expect(await invoice(visit.invoiceId)).toMatchObject({
        discountTotal: '1000.00',
        total: '0.00',
      });
    });

    it('a patient without a referral: no referral, no discount, no commission', async () => {
      const visit = await walkIn();
      expect(await invoice(visit.invoiceId)).toMatchObject({
        referral: null,
        discount: null,
        total: '1000.00',
      });
      await pay(visit.invoiceId, '1000.00');
      expect(await ledger()).toHaveLength(0);
    });

    it('FIRST_SESSION covers only the first session', async () => {
      const doc = await referringDoctor();
      await refer(doc.id, { applicability: { type: 'FIRST_SESSION' } }).expect(
        201,
      );
      expect(
        (await invoice((await walkIn()).invoiceId)).referral,
      ).not.toBeNull();
      const second = await invoice((await walkIn()).invoiceId);
      expect(second).toMatchObject({ referral: null, discount: null });
    });

    it('SESSION_COUNT covers N sessions; undoing a covered attendance frees its place', async () => {
      const doc = await referringDoctor();
      await refer(doc.id, {
        applicability: { type: 'SESSION_COUNT', maxSessions: 2 },
      }).expect(201);
      await walkIn();
      const second = await walkIn();
      expect((await invoice((await walkIn()).invoiceId)).referral).toBeNull();
      expect((await referrals())[0].coveredSessions).toBe(2);

      await as(receptionist)
        .post(`/visits/${second.id}/undo-attend`, { reason: 'Wrong patient' })
        .expect(200);
      expect((await referrals())[0].coveredSessions).toBe(1);
      expect(
        (await invoice((await walkIn()).invoiceId)).referral,
      ).not.toBeNull();
    });

    it('DATE_RANGE covers sessions on its local dates only', async () => {
      const doc = await referringDoctor();
      await refer(doc.id, {
        applicability: {
          type: 'DATE_RANGE',
          validFrom: '2026-11-05',
          validTo: '2026-11-10',
        },
      }).expect(201);
      expect((await invoice((await walkIn()).invoiceId)).referral).toBeNull();
      clock.current = local('09:00', '2026-11-05');
      expect(
        (await invoice((await walkIn()).invoiceId)).referral,
      ).not.toBeNull();
      clock.current = local('09:00', '2026-11-11');
      expect((await invoice((await walkIn()).invoiceId)).referral).toBeNull();
    });

    it('an invoice issued before the referral is covered on request, while unpaid', async () => {
      const doc = await referringDoctor();
      const before = await walkIn();
      const paid = await walkIn();
      await pay(paid.invoiceId, '100.00');
      await refer(doc.id).expect(201);

      const res = await as(receptionist)
        .post(`/invoices/${before.invoiceId}/referral`)
        .expect(200);
      expect(res.body).toMatchObject({
        total: '900.00',
        referral: { termsVersion: 1 },
      });
      const twice = await as(receptionist)
        .post(`/invoices/${before.invoiceId}/referral`)
        .expect(422);
      expect(twice.body).toMatchObject({
        code: 'REFERRAL_NOT_APPLICABLE',
        details: { reason: 'ALREADY_APPLIED' },
      });
      const locked = await as(receptionist)
        .post(`/invoices/${paid.invoiceId}/referral`)
        .expect(422);
      expect(locked.body.code).toBe('INVOICE_LOCKED');

      const manual = await as(receptionist)
        .post('/invoices', {
          patientId: patient.id,
          items: [
            { description: 'Medical report', unitPrice: '50.00', quantity: 1 },
          ],
        })
        .expect(201);
      const res2 = await as(receptionist)
        .post(`/invoices/${manual.body.id}/referral`)
        .expect(422);
      expect(res2.body.details).toEqual({ reason: 'MANUAL_INVOICE' });
    });
  });

  // ---------- a voided session billed again ----------

  // An attendance undone (its invoice cancelled) and attended again after
  // the patient's referring doctor changed: the new invoice takes the
  // current referral's discount, the cancelled one stays as it was, and
  // nothing copies the old doctor's discount onto the new invoice.
  describe('a voided session billed again', () => {
    // A referring doctor whose default discount is `discount` (no
    // commission), and the patient referred to them on those defaults.
    async function referTo(name: string, discount: Rate) {
      const doc = await referringDoctor(NONE, discount, { name });
      const res = await refer(doc.id, { commission: NONE, discount }).expect(
        201,
      );
      return res.body as { id: string; terms: { id: string } };
    }

    const endReferral = (referralId: string) =>
      as(receptionist)
        .post(`/patient-referrals/${referralId}/end`, {
          reason: 'Recorded for the wrong doctor',
        })
        .expect(201);

    const todayAppointment = async (service = serviceId) =>
      (
        await insertAppointment(ctx.dataSource, {
          patientId: patient.id,
          doctorId,
          serviceId: service,
          startAt: local('10:00'),
        })
      ).id;

    async function attend(appointmentId: string): Promise<string> {
      const res = await as(receptionist)
        .post(`/appointments/${appointmentId}/attend`, {})
        .expect(201);
      return (res.body as { invoiceId: string }).invoiceId;
    }

    const undoAttend = (appointmentId: string) =>
      as(receptionist)
        .post(`/appointments/${appointmentId}/undo-attend`, {
          reason: 'Attended by mistake',
        })
        .expect(200);

    // Referred to Dr. A (20%), attended (billed), attendance undone (the
    // invoice is cancelled), then the referral moves through `next`.
    async function voidedThenChanged(
      next: [string, Rate][],
      service = serviceId,
    ) {
      const a = await referTo('Dr. A', pct('20'));
      const appointmentId = await todayAppointment(service);
      const voided = await attend(appointmentId);
      await undoAttend(appointmentId);
      let current = a;
      for (const [name, discount] of next) {
        await endReferral(current.id);
        current = await referTo(name, discount);
      }
      return { appointmentId, voided, a, current };
    }

    const activeDiscountRow = (invoiceId: string) =>
      ctx.dataSource
        .getRepository(InvoiceDiscount)
        .findOneByOrFail({ invoiceId, removedAt: IsNull() });

    it("the new invoice takes the current doctor's discount (B 10%), not A's 20%", async () => {
      const { appointmentId, current } = await voidedThenChanged([
        ['Dr. B', pct('10')],
      ]);
      const rebilled = await attend(appointmentId);

      expect(await invoice(rebilled)).toMatchObject({
        status: 'ISSUED',
        subtotal: '1000.00',
        discountTotal: '100.00',
        total: '900.00',
        discount: {
          type: 'PERCENT',
          value: '10.00',
          amount: '100.00',
          reason: 'Doctor referral: Dr. B',
          referralTermsId: current.terms.id,
          repeatedFromId: null,
        },
        referral: { referringDoctor: { name: 'Dr. B' } },
      });
      // The database says the same.
      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .findOneByOrFail({ id: rebilled }),
      ).toMatchObject({
        referralTermsId: current.terms.id,
        discountTotal: '100.00',
        total: '900.00',
      });
      expect(await activeDiscountRow(rebilled)).toMatchObject({
        value: '10.00',
        amount: '100.00',
        referralTermsId: current.terms.id,
      });
    });

    it("the cancelled invoice keeps Dr. A's discount, terms and amounts untouched", async () => {
      const { appointmentId, voided, a } = await voidedThenChanged([
        ['Dr. B', pct('10')],
      ]);
      const invoiceRow = await ctx.dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: voided });
      const discountRows = await ctx.dataSource
        .getRepository(InvoiceDiscount)
        .findBy({ invoiceId: voided });
      await attend(appointmentId);

      expect(await invoice(voided)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Attended by mistake',
        subtotal: '1000.00',
        discountTotal: '200.00',
        total: '800.00',
        discount: {
          value: '20.00',
          amount: '200.00',
          reason: 'Doctor referral: Dr. A',
          referralTermsId: a.terms.id,
        },
        referral: { referringDoctor: { name: 'Dr. A' } },
      });
      // Billing again wrote nothing to the old invoice or its discount.
      expect(
        await ctx.dataSource
          .getRepository(Invoice)
          .findOneByOrFail({ id: voided }),
      ).toEqual(invoiceRow);
      expect(
        await ctx.dataSource
          .getRepository(InvoiceDiscount)
          .findBy({ invoiceId: voided }),
      ).toEqual(discountRows);
    });

    it("same doctor: billed again with the referral's terms in force at that moment", async () => {
      const a = await referTo('Dr. A', pct('20'));
      const appointmentId = await todayAppointment();
      const first = await attend(appointmentId);
      await undoAttend(appointmentId);

      // Nothing changed: the same terms again.
      const second = await attend(appointmentId);
      expect(await invoice(second)).toMatchObject({
        discountTotal: '200.00',
        discount: { value: '20.00', referralTermsId: a.terms.id },
        referral: { termsVersion: 1 },
      });

      // The terms change before the next billing: version 2 applies.
      await undoAttend(appointmentId);
      await as(receptionist)
        .post(`/patient-referrals/${a.id}/terms`, {
          commission: NONE,
          discount: pct('15'),
          applicability: ALL,
          overrideReason: 'Agreed with the doctor',
        })
        .expect(201);
      const third = await attend(appointmentId);
      expect(await invoice(third)).toMatchObject({
        discountTotal: '150.00',
        total: '850.00',
        discount: { value: '15.00', reason: 'Doctor referral: Dr. A' },
        referral: { termsVersion: 2 },
      });
      for (const old of [first, second]) {
        expect(await invoice(old)).toMatchObject({
          status: 'CANCELLED',
          discountTotal: '200.00',
          referral: { termsVersion: 1 },
        });
      }
    });

    it("a new doctor without a discount: Dr. A's discount is not carried over", async () => {
      const { appointmentId, voided } = await voidedThenChanged([
        ['Dr. B', NONE],
      ]);
      const rebilled = await attend(appointmentId);
      expect(await invoice(rebilled)).toMatchObject({
        subtotal: '1000.00',
        discountTotal: '0.00',
        total: '1000.00',
        discount: null,
        referral: { referringDoctor: { name: 'Dr. B' } },
      });

      // Nor can the cancelled invoice's discount be copied onto it.
      const res = await as(receptionist)
        .post(`/invoices/${rebilled}/discount`, {
          repeatFromDiscountId: (await activeDiscountRow(voided)).id,
        })
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'DISCOUNT_NOT_REPEATABLE',
        details: { reason: 'REFERRAL_DISCOUNT' },
      });
      expect((await invoice(rebilled)).discount).toBeNull();
    });

    it("A, then B, then C: only Dr. C's discount is used", async () => {
      const { appointmentId, current } = await voidedThenChanged([
        ['Dr. B', pct('10')],
        ['Dr. C', pct('15')],
      ]);
      const rebilled = await attend(appointmentId);
      expect(await invoice(rebilled)).toMatchObject({
        discountTotal: '150.00',
        total: '850.00',
        discount: {
          value: '15.00',
          reason: 'Doctor referral: Dr. C',
          referralTermsId: current.terms.id,
        },
        referral: { referringDoctor: { name: 'Dr. C' } },
      });
      expect((await referrals()).map((r) => r.status)).toEqual([
        'ACTIVE',
        'ENDED',
        'ENDED',
      ]);
    });

    it('amounts: percent rounded half up, total and payable consistent', async () => {
      const odd = await insertService(ctx.dataSource, {
        name: 'Assessment',
        basePrice: '999.99',
      });
      await assignService(ctx.dataSource, doctorId, odd.id);
      const { appointmentId, voided } = await voidedThenChanged(
        [['Dr. B', pct('12.5')]],
        odd.id,
      );
      const rebilled = await attend(appointmentId);

      // 12.5% of 999.99 = 124.99875 -> 125.00; 20% = 199.998 -> 200.00.
      expect(await invoice(rebilled)).toMatchObject({
        subtotal: '999.99',
        discountTotal: '125.00',
        total: '874.99',
        discount: { value: '12.50', amount: '125.00' },
      });
      expect(await invoice(voided)).toMatchObject({
        discountTotal: '200.00',
        total: '799.99',
      });
      await pay(rebilled, '874.99');
      expect(await invoice(rebilled)).toMatchObject({
        status: 'PAID',
        amountPaid: '874.99',
        balance: '0.00',
      });
    });

    it('"repeat last discount" never offers or copies an earlier doctor\'s referral discount', async () => {
      // A desk discount given long ago, then a session with Dr. A that stays.
      const manual = await as(receptionist)
        .post('/invoices', {
          patientId: patient.id,
          items: [
            { description: 'Medical report', unitPrice: '100.00', quantity: 1 },
          ],
        })
        .expect(201);
      const desk = await as(receptionist)
        .post(`/invoices/${manual.body.id}/discount`, {
          type: 'PERCENT',
          value: '5',
          reason: 'Staff relative',
        })
        .expect(200);
      const a = await referTo('Dr. A', pct('20'));
      const kept = (await walkIn()).invoiceId;

      // This session is voided and billed again with Dr. B.
      const appointmentId = await todayAppointment();
      const voided = await attend(appointmentId);
      await undoAttend(appointmentId);
      await endReferral(a.id);
      await referTo('Dr. B', pct('10'));
      const rebilled = await attend(appointmentId);

      // The newer referral discounts are skipped: the desk one is offered.
      const last = await as(receptionist)
        .get(
          `/patients/${patient.id}/last-discount?excludeInvoiceId=${rebilled}`,
        )
        .expect(200);
      expect(last.body).toMatchObject({
        id: desk.body.discount.id,
        reason: 'Staff relative',
      });

      // Dr. A's discount, from the kept or the cancelled invoice, is refused.
      for (const source of [kept, voided]) {
        const res = await as(receptionist)
          .post(`/invoices/${rebilled}/discount`, {
            repeatFromDiscountId: (await activeDiscountRow(source)).id,
          })
          .expect(422);
        expect(res.body).toMatchObject({
          code: 'DISCOUNT_NOT_REPEATABLE',
          details: { reason: 'REFERRAL_DISCOUNT' },
        });
      }
      expect(await invoice(rebilled)).toMatchObject({
        discountTotal: '100.00',
        discount: { reason: 'Doctor referral: Dr. B' },
      });
    });
  });

  // ---------- commissions ----------

  describe('commissions', () => {
    it('1000 session, 10% discount, 10% commission, paid 300 x 3: 30 per payment, 90 in all', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      const payments = [
        await pay(visit.invoiceId, '300.00'),
        await pay(visit.invoiceId, '300.00'),
        await pay(visit.invoiceId, '300.00'),
      ];
      const rows = await ledger();
      expect(
        rows.map((r) => [r.kind, r.amount, r.baseAmount, r.status]),
      ).toEqual([
        ['EARNED', '30.00', '300.00', 'ELIGIBLE'],
        ['EARNED', '30.00', '300.00', 'ELIGIBLE'],
        ['EARNED', '30.00', '300.00', 'ELIGIBLE'],
      ]);
      expect(rows.map((r) => r.paymentId)).toEqual(payments);
      expect(rows[0]).toMatchObject({
        referringDoctorId: doc.id,
        patientId: patient.id,
        visitId: visit.id,
        invoiceId: visit.invoiceId,
        commissionType: 'PERCENT',
        rate: '10.00',
      });
      expect((await balance(doc.id)).outstanding).toBe('90.00');
    });

    it('FIXED commission: per session, earned as the money comes in', async () => {
      const doc = await referringDoctor(fixed('50'), NONE);
      await refer(doc.id, { commission: fixed('50'), discount: NONE }).expect(
        201,
      );
      const visit = await walkIn();
      await pay(visit.invoiceId, '300.00');
      await pay(visit.invoiceId, '700.00');
      expect(await amounts()).toEqual(['15.00', '35.00']);
    });

    it('commission NONE: the discount applies, no commission rows', async () => {
      const doc = await referringDoctor(NONE, pct('15'));
      await refer(doc.id, { commission: NONE, discount: pct('15') }).expect(
        201,
      );
      const visit = await walkIn();
      expect((await invoice(visit.invoiceId)).total).toBe('850.00');
      await pay(visit.invoiceId, '850.00');
      expect(await ledger()).toHaveLength(0);
    });

    it('a partial refund reverses its share; a full refund brings it to zero', async () => {
      const doc = await referringDoctor(pct('10'), NONE);
      await refer(doc.id, { discount: NONE }).expect(201);
      const visit = await walkIn();
      const payment = await pay(visit.invoiceId, '1000.00');
      const partial = await refund(payment, '300.00');
      await refund(payment, '700.00');

      const rows = await ledger();
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['EARNED', '100.00'],
        ['REFUND_REVERSAL', '-30.00'],
        ['REFUND_REVERSAL', '-70.00'],
      ]);
      expect(rows[1]).toMatchObject({
        paymentId: payment,
        sourcePaymentId: partial,
        baseAmount: '300.00',
      });
      expect((await balance(doc.id)).outstanding).toBe('0.00');
    });

    it('voids: a voided payment takes its commission back, a voided refund gives it back', async () => {
      const doc = await referringDoctor(pct('10'), NONE);
      await refer(doc.id, { discount: NONE }).expect(201);
      const visit = await walkIn();
      const mistake = await pay(visit.invoiceId, '400.00');
      await voidPayment(mistake, receptionist);
      const payment = await pay(visit.invoiceId, '500.00');
      const back = await refund(payment, '200.00');
      await voidPayment(back);
      expect((await ledger()).map((r) => [r.kind, r.amount])).toEqual([
        ['EARNED', '40.00'],
        ['VOID_REVERSAL', '-40.00'],
        ['EARNED', '50.00'],
        ['REFUND_REVERSAL', '-20.00'],
        ['REFUND_VOIDED', '20.00'],
      ]);
    });

    it('a session cancelled after payment: the payment is voided first (reversed), then the attendance undone', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      const payment = await pay(visit.invoiceId, '300.00');
      const refused = await as(receptionist)
        .post(`/visits/${visit.id}/undo-attend`, { reason: 'Left early' })
        .expect(422);
      expect(refused.body.code).toBe('INVOICE_HAS_PAYMENTS');
      await voidPayment(payment, receptionist);
      await as(receptionist)
        .post(`/visits/${visit.id}/undo-attend`, { reason: 'Left early' })
        .expect(200);
      expect(await amounts()).toEqual(['30.00', '-30.00']);
      expect((await referrals())[0].coveredSessions).toBe(0);
    });

    it('parallel payments on one invoice: one row each, adding up exactly', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          as(receptionist).post(`/invoices/${visit.invoiceId}/payments`, {
            amount: '300.00',
            method: 'CASH',
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await amounts()).toEqual(['30.00', '30.00', '30.00']);
    });

    it('a replayed payment event writes nothing; the database refuses a second row for it', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      const paymentId = await pay(visit.invoiceId, '900.00');
      const commissions = ctx.app.get(ReferralCommissionsService);

      await ctx.dataSource.transaction(async (manager) => {
        const locked = await manager.findOneOrFail(Invoice, {
          where: { id: visit.invoiceId },
          lock: { mode: 'pessimistic_write' },
        });
        const source = await manager.findOneByOrFail(Payment, {
          id: paymentId,
        });
        await commissions.recordPaymentEvent(
          manager,
          locked,
          { kind: CommissionKind.EARNED, paymentId, source },
          { userId: owner.id, ip: null },
        );
      });
      const rows = await ledger();
      expect(rows.map((r) => r.amount)).toEqual(['90.00']);

      const duplicate = await ctx.dataSource
        .getRepository(ReferralCommission)
        .insert({
          ...rows[0],
          id: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        })
        .catch((error: unknown) => error);
      expect(getPgError(duplicate)).toMatchObject({
        code: '23505',
        constraint: 'uq_referral_commissions_event',
      });
    });

    it('a package sale is one covered session: PENDING until a package session is attended', async () => {
      const doc = await referringDoctor();
      await refer(doc.id, { applicability: { type: 'FIRST_SESSION' } }).expect(
        201,
      );
      const pkg = await as(owner)
        .post('/packages', {
          name: '3 physio sessions',
          serviceId,
          sessionsCount: 3,
          price: '900.00',
          allDoctors: true,
        })
        .expect(201);
      const sold = await as(receptionist)
        .post(`/patients/${patient.id}/packages`, { packageId: pkg.body.id })
        .expect(201);
      const saleInvoice = sold.body.invoiceId as string;
      expect(await invoice(saleInvoice)).toMatchObject({
        total: '810.00',
        referral: { termsVersion: 1 },
      });

      // Paid before any session: owed only once a session is attended.
      await pay(saleInvoice, '300.00');
      expect((await ledger()).map((r) => [r.amount, r.status])).toEqual([
        ['30.00', 'PENDING'],
      ]);
      expect((await balance(doc.id)).pending).toBe('30.00');

      // A visit paid by the package: 0.00 invoice, not covered.
      const visit = await walkIn();
      expect((await invoice(visit.invoiceId)).referral).toBeNull();
      expect((await ledger())[0].status).toBe('ELIGIBLE');

      // Undoing that attendance makes it pending again.
      await as(receptionist)
        .post(`/visits/${visit.id}/undo-attend`, { reason: 'Wrong day' })
        .expect(200);
      expect((await ledger())[0]).toMatchObject({
        status: 'PENDING',
        eligibleAt: null,
      });

      // FIRST_SESSION was the sale: a normally billed session is not covered.
      const billed = await walkIn({ usePackage: false });
      expect((await invoice(billed.invoiceId)).referral).toBeNull();
    });
  });

  // ---------- payouts and adjustments ----------

  describe('payouts (OWNER)', () => {
    const day = (date: string) => ({
      summary: async () =>
        (await as(owner).get(`/billing/daily-summary?date=${date}`).expect(200))
          .body as {
          expenses: { total: string; byMethod: Record<string, string> };
          commissionPayouts: {
            total: string;
            byMethod: Record<string, string>;
          };
          expectedCash: string;
        },
    });
    const ownerSummary = async () =>
      (await as(owner).get(`/reports/summary${RANGE}`).expect(200)).body as {
        expenses: string;
        commissionPayouts: string;
        netAfterExpenses: string;
      };
    const payout = (referringDoctorId: string, body: object) =>
      as(owner).post(`/referring-doctors/${referringDoctorId}/payouts`, {
        method: 'CASH',
        ...body,
      });
    // Owed at once, without patients (for the rules that don't need them).
    const owe = (referringDoctorId: string, amount: string) =>
      as(owner)
        .post(
          `/referring-doctors/${referringDoctorId}/commission-adjustments`,
          {
            amount,
            reason: 'Owed from before',
          },
        )
        .expect(201);

    it('earned 900, paid 350 in cash then 200 by InstaPay: each payout is an expense counted once in every report', async () => {
      const doc = await referringDoctor(pct('50'), NONE);
      await refer(doc.id, { commission: pct('50'), discount: NONE }).expect(
        201,
      );
      // Commission earned on days 1, 2, 3 and 9: 300 + 200 + 250 + 150.
      for (const [date, paid] of [
        ['2026-11-03', '600.00'],
        ['2026-11-04', '400.00'],
        ['2026-11-05', '500.00'],
        ['2026-11-11', '300.00'],
      ]) {
        clock.current = local('10:00', date);
        await pay((await walkIn()).invoiceId, paid);
      }
      expect(await balance(doc.id)).toMatchObject({
        earned: '900.00',
        paid: '0.00',
        outstanding: '900.00',
      });

      clock.current = local('12:00', '2026-11-12');
      const cashBefore = await day('2026-11-12').summary();
      const ownerBefore = await ownerSummary();
      const first = await payout(doc.id, {
        amount: '350.00',
        notes: 'First part',
      }).expect(201);
      expect(first.body).toMatchObject({
        amount: '350.00',
        payoutDate: '2026-11-12',
        method: 'CASH',
        notes: 'First part',
        status: 'VALID',
        expense: { expenseNumber: 'EXP-2026-000001' },
        commissionCount: 2, // 300 in full, 50 of the 200
      });
      expect(await balance(doc.id)).toMatchObject({
        earned: '900.00',
        paid: '350.00',
        outstanding: '550.00',
      });
      const expense = await as(owner)
        .get(`/expenses/${first.body.expense.id}`)
        .expect(200);
      expect(expense.body).toMatchObject({
        amount: '350.00',
        paymentMethod: 'CASH',
        expenseDate: '2026-11-12',
        category: { systemKey: 'REFERRAL_COMMISSION' },
        referralPayout: { id: first.body.id, notes: 'First part' },
      });
      // The cash drawer and the owner's figures move by 350, once.
      const cashAfter = await day('2026-11-12').summary();
      expect(cashAfter.expectedCash).toBe(
        (Number(cashBefore.expectedCash) - 350).toFixed(2),
      );
      expect(cashAfter.expenses.byMethod.CASH).toBe('350.00');
      expect(cashAfter.commissionPayouts.byMethod.CASH).toBe('350.00');
      const ownerAfter = await ownerSummary();
      expect(Number(ownerAfter.expenses) - Number(ownerBefore.expenses)).toBe(
        350,
      );
      expect(ownerAfter.commissionPayouts).toBe('350.00');
      expect(
        Number(ownerBefore.netAfterExpenses) -
          Number(ownerAfter.netAfterExpenses),
      ).toBe(350);

      // Not cash: an expense, but the drawer doesn't move.
      clock.current = local('12:00', '2026-11-13');
      const drawer = (await day('2026-11-13').summary()).expectedCash;
      await payout(doc.id, { amount: '200.00', method: 'INSTAPAY' }).expect(
        201,
      );
      const nextDay = await day('2026-11-13').summary();
      expect(nextDay.expectedCash).toBe(drawer);
      expect(nextDay.expenses.byMethod.INSTAPAY).toBe('200.00');
      expect(nextDay.commissionPayouts.total).toBe('200.00');
      expect(await balance(doc.id)).toMatchObject({
        earned: '900.00',
        paid: '550.00',
        outstanding: '350.00',
      });

      // The ledger keeps every amount; the oldest rows were paid first.
      const rows = await as(owner)
        .get(`/referring-doctors/${doc.id}/commissions`)
        .expect(200);
      expect(
        rows.body.items.map((r: Record<string, string>) => [
          r.amount,
          r.paidAmount,
          r.status,
        ]),
      ).toEqual([
        ['150.00', '0.00', 'ELIGIBLE'],
        ['250.00', '50.00', 'ELIGIBLE'],
        ['200.00', '200.00', 'PAID'],
        ['300.00', '300.00', 'PAID'],
      ]);
      const payouts = await as(owner)
        .get(`/referring-doctors/${doc.id}/payouts`)
        .expect(200);
      expect(
        payouts.body.map((p: Record<string, string>) => [
          p.payoutDate,
          p.amount,
          p.method,
        ]),
      ).toEqual([
        ['2026-11-13', '200.00', 'INSTAPAY'],
        ['2026-11-12', '350.00', 'CASH'],
      ]);

      // Expense and referral reports agree: 550 paid in November.
      const expenses = await as(owner)
        .get(`/reports/expenses${RANGE}`)
        .expect(200);
      expect(expenses.body).toMatchObject({
        total: '550.00',
        commissionPayouts: '550.00',
        byCategory: [expect.objectContaining({ count: 2, total: '550.00' })],
      });
      const referral = await as(owner)
        .get(`/reports/referrals${RANGE}`)
        .expect(200);
      expect(referral.body.rows[0]).toMatchObject({
        commissionEarned: '900.00',
        commissionPaid: '550.00',
        outstanding: '350.00',
      });
    });

    it('refuses more than is owed, nothing owed, and a future date', async () => {
      const doc = await referringDoctor();
      await owe(doc.id, '100.00');
      const tooMuch = await payout(doc.id, { amount: '100.01' }).expect(422);
      expect(tooMuch.body).toMatchObject({
        code: 'PAYOUT_EXCEEDS_OUTSTANDING',
        details: { outstanding: '100.00' },
      });
      const future = await payout(doc.id, {
        amount: '10.00',
        payoutDate: '2026-11-04',
      }).expect(422);
      expect(future.body.code).toBe('EXPENSE_DATE_IN_FUTURE');
      await payout(doc.id, { amount: '100.00' }).expect(201);
      const nothing = await payout(doc.id, { amount: '1.00' }).expect(422);
      expect(nothing.body).toMatchObject({
        code: 'NOTHING_TO_PAY',
        details: { outstanding: '0.00' },
      });
      await payout(doc.id, { amount: '0.00' }).expect(400);
    });

    it('two payouts at once never pay more than is owed', async () => {
      const doc = await referringDoctor();
      await owe(doc.id, '900.00');
      const results = await Promise.all([
        payout(doc.id, { amount: '600.00' }),
        payout(doc.id, { amount: '600.00' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      expect(
        results.find((r) => r.status === 422)?.body.details.outstanding,
      ).toBe('300.00');
      expect(await balance(doc.id)).toMatchObject({
        paid: '600.00',
        outstanding: '300.00',
      });
      const expenses = await as(owner)
        .get('/expenses?source=REFERRAL_PAYOUT')
        .expect(200);
      expect(expenses.body.totalAmount).toBe('600.00');
    });

    it('money owed back is deducted first; voiding a payout makes it owed again and voids its expense', async () => {
      const doc = await referringDoctor(pct('10'), NONE);
      await refer(doc.id, { discount: NONE }).expect(201);
      const visit = await walkIn();
      const payment = await pay(visit.invoiceId, '1000.00');
      const first = await payout(doc.id, {
        amount: '100.00',
        method: 'INSTAPAY',
        reference: 'TX-991',
      }).expect(201);
      expect((await ledger())[0]).toMatchObject({
        status: 'PAID',
        payoutId: first.body.id,
      });

      // A refund after the payout: 30 owed back, deducted from the next one.
      await refund(payment, '300.00');
      expect((await balance(doc.id)).outstanding).toBe('-30.00');
      const second = await walkIn();
      await pay(second.invoiceId, '500.00');
      expect((await balance(doc.id)).outstanding).toBe('20.00');
      const net = await payout(doc.id, { amount: '20.00' }).expect(201);
      expect(net.body.commissionCount).toBe(2);
      expect((await ledger()).map((r) => [r.amount, r.status])).toEqual([
        ['100.00', 'PAID'],
        ['-30.00', 'PAID'],
        ['50.00', 'PAID'],
      ]);

      await as(owner)
        .post(`/referral-payouts/${first.body.id}/void`, {
          reason: 'Transfer bounced',
        })
        .expect(201);
      expect(await balance(doc.id)).toMatchObject({
        paid: '20.00',
        outstanding: '100.00',
      });
      expect((await ledger())[0]).toMatchObject({
        status: 'ELIGIBLE',
        payoutId: null,
      });
      const expense = await as(owner)
        .get(`/expenses/${first.body.expense.id}`)
        .expect(200);
      expect(expense.body).toMatchObject({
        status: 'VOIDED',
        voidReason: 'Transfer bounced',
      });
      expect((await day(TODAY).summary()).commissionPayouts.total).toBe(
        '20.00',
      );
      const audit = await as(owner)
        .get(`/audit-logs?entityId=${first.body.id}`)
        .expect(200);
      expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(
        ['REFERRAL_PAYOUT_VOIDED', 'REFERRAL_PAYOUT_RECORDED'],
      );
      const twice = await as(owner)
        .post(`/referral-payouts/${first.body.id}/void`, { reason: 'Again' })
        .expect(422);
      expect(twice.body.code).toBe('PAYOUT_VOIDED');
    });

    it('the balance on a past date counts what was owed then and payouts dated up to then', async () => {
      const doc = await referringDoctor();
      await owe(doc.id, '300.00'); // Nov 3
      clock.current = local('10:00', '2026-11-05');
      await owe(doc.id, '200.00');
      clock.current = local('10:00', '2026-11-06');
      await payout(doc.id, {
        amount: '250.00',
        payoutDate: '2026-11-04',
      }).expect(201);

      const at = async (date: string) =>
        (
          await as(owner)
            .get(`/referring-doctors/${doc.id}/commission-balance?asOf=${date}`)
            .expect(200)
        ).body as Record<string, string>;
      expect(await at('2026-11-03')).toMatchObject({
        asOf: '2026-11-03',
        adjustments: '300.00',
        paid: '0.00',
        outstanding: '300.00',
      });
      expect(await at('2026-11-04')).toMatchObject({
        paid: '250.00',
        outstanding: '50.00',
      });
      expect(await at('2026-11-05')).toMatchObject({
        adjustments: '500.00',
        outstanding: '250.00',
      });
      expect(await balance(doc.id)).toMatchObject({
        asOf: '2026-11-06',
        outstanding: '250.00',
      });

      // Paid counts on the payout date, not when it was recorded.
      const paidIn = async (from: string, to: string) =>
        (
          await as(owner)
            .get(`/reports/referrals?from=${from}&to=${to}`)
            .expect(200)
        ).body.rows[0].commissionPaid as string;
      expect(await paidIn('2026-11-04', '2026-11-04')).toBe('250.00');
      expect(await paidIn('2026-11-06', '2026-11-06')).toBe('0.00');
    });

    it('a package commission paid in part stays owed when its session is undone', async () => {
      const doc = await referringDoctor(pct('10'), NONE);
      await refer(doc.id, { discount: NONE }).expect(201);
      const pkg = await as(owner)
        .post('/packages', {
          name: '3 physio sessions',
          serviceId,
          sessionsCount: 3,
          price: '900.00',
          allDoctors: true,
        })
        .expect(201);
      const sold = await as(receptionist)
        .post(`/patients/${patient.id}/packages`, { packageId: pkg.body.id })
        .expect(201);
      await pay(sold.body.invoiceId as string, '900.00');
      const visit = await walkIn();
      await payout(doc.id, { amount: '40.00' }).expect(201);
      await as(receptionist)
        .post(`/visits/${visit.id}/undo-attend`, { reason: 'Wrong day' })
        .expect(200);
      expect((await ledger())[0]).toMatchObject({
        amount: '90.00',
        status: 'ELIGIBLE',
      });
      expect(await balance(doc.id)).toMatchObject({
        pending: '0.00',
        paid: '40.00',
        outstanding: '50.00',
      });
    });

    it('adjustments: signed, with a reason, owed at once; zero is refused', async () => {
      const doc = await referringDoctor();
      const res = await as(owner)
        .post(`/referring-doctors/${doc.id}/commission-adjustments`, {
          amount: '-25.00',
          reason: 'Overpaid last month',
          patientId: patient.id,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        kind: 'ADJUSTMENT',
        status: 'ELIGIBLE',
        amount: '-25.00',
        reason: 'Overpaid last month',
        patient: { id: patient.id },
      });
      await as(owner)
        .post(`/referring-doctors/${doc.id}/commission-adjustments`, {
          amount: '0.00',
          reason: 'Nothing',
        })
        .expect(400);
    });
  });

  // ---------- reporting and audit ----------

  describe('reports, statement and audit', () => {
    it('per doctor: patients, bookings, sessions, money and commission; the patient statement explains it', async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      await insertAppointment(ctx.dataSource, {
        patientId: patient.id,
        doctorId,
        serviceId,
        startAt: local('06:00'),
      });
      const a = await walkIn();
      const b = await walkIn();
      await pay(a.invoiceId, '900.00');
      const bPayment = await pay(b.invoiceId, '300.00');
      await refund(bPayment, '100.00');
      await as(owner)
        .post(`/referring-doctors/${doc.id}/payouts`, {
          amount: '110.00',
          method: 'CASH',
        })
        .expect(201);
      await as(owner)
        .post(`/referring-doctors/${doc.id}/commission-adjustments`, {
          amount: '5.00',
          reason: 'Rounding agreed',
          patientId: patient.id,
        })
        .expect(201);

      const report = await as(owner)
        .get(`/reports/referrals${RANGE}`)
        .expect(200);
      expect(report.body.rows).toEqual([
        {
          referringDoctor: {
            id: doc.id,
            name: 'Dr. Hany Samir',
            isActive: true,
          },
          referredPatients: 1,
          bookings: 1,
          attendedSessions: 2,
          coveredSessions: 2,
          collected: '1100.00',
          discounts: '200.00',
          commissionEarned: '120.00',
          commissionReversed: '10.00',
          adjustments: '5.00',
          commissionPaid: '110.00',
          outstanding: '5.00',
          pending: '0.00',
        },
      ]);

      const patients = await as(owner)
        .get(`/referring-doctors/${doc.id}/patients`)
        .expect(200);
      expect(patients.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(patients.body.items).toEqual([
        expect.objectContaining({
          patient: expect.objectContaining({ id: patient.id }),
          coveredSessions: 2,
          collected: '1100.00',
          discounts: '200.00',
          commission: '115.00',
          outstanding: '5.00',
        }),
      ]);

      const statement = await as(owner)
        .get(`/patients/${patient.id}/referral-statement`)
        .expect(200);
      expect(statement.body.referrals).toHaveLength(1);
      expect(statement.body.invoices).toHaveLength(2);
      expect(statement.body.invoices[0]).toMatchObject({
        termsVersion: 1,
        isPackageSale: false,
        discount: { fromReferral: true, amount: '100.00' },
      });
      expect(statement.body.commissions).toHaveLength(4);
      expect(statement.body.payouts).toEqual([
        expect.objectContaining({ amount: '110.00', commissionCount: 3 }),
      ]);
    });

    it("a doctor's patients come one page at a time, newest referral first, each once", async () => {
      const doc = await referringDoctor();
      // Sara is referred first (09:00) and has the money; then one patient an
      // hour, so the newest is Mona.
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      await pay(visit.invoiceId, '900.00');
      const omar = await insertPatient(
        ctx.dataSource,
        'Omar Adel',
        '+201000000002',
      );
      const mona = await insertPatient(
        ctx.dataSource,
        'Mona Samy',
        '+201000000003',
      );
      clock.current = local('10:00');
      await refer(doc.id, {}, receptionist, omar).expect(201);
      clock.current = local('11:00');
      await refer(doc.id, {}, receptionist, mona).expect(201);

      const page = async (n: number) =>
        (
          await as(owner)
            .get(`/referring-doctors/${doc.id}/patients?limit=2&page=${n}`)
            .expect(200)
        ).body as {
          items: { patient: { id: string } }[];
          meta: Record<string, number>;
        };
      const first = await page(1);
      expect(first.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(first.items.map((r) => r.patient.id)).toEqual([mona.id, omar.id]);
      expect(first.items[0]).toMatchObject({
        coveredSessions: 0,
        collected: '0.00',
        commission: '0.00',
      });

      // The last page: the oldest referral, its money summed as before.
      const second = await page(2);
      expect(second.items).toEqual([
        expect.objectContaining({
          patient: expect.objectContaining({ id: patient.id }),
          coveredSessions: 1,
          collected: '900.00',
          discounts: '100.00',
          commission: '90.00',
          outstanding: '90.00',
        }),
      ]);
      expect(
        new Set([...first.items, ...second.items].map((r) => r.patient.id))
          .size,
      ).toBe(3);

      const past = await page(3);
      expect(past.items).toEqual([]);
      expect(past.meta).toMatchObject({ total: 3, totalPages: 2 });
    });

    it("the patient's audit trail has the referral, the coverage, the discount and the commissions", async () => {
      const doc = await referringDoctor();
      await refer(doc.id).expect(201);
      const visit = await walkIn();
      await pay(visit.invoiceId, '900.00');
      const res = await as(owner)
        .get(`/audit-logs?patientId=${patient.id}&limit=100`)
        .expect(200);
      const actions = (res.body.items as { action: string }[]).map(
        (r) => r.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'ACQUISITION_SOURCE_ADDED',
          'PATIENT_REFERRAL_ASSIGNED',
          'REFERRAL_APPLIED',
          'DISCOUNT_APPLIED',
          'REFERRAL_COMMISSION_RECORDED',
        ]),
      );
      const assigned = (
        res.body.items as { action: string; user: { id: string } }[]
      ).find((r) => r.action === 'PATIENT_REFERRAL_ASSIGNED');
      expect(assigned?.user.id).toBe(receptionist.id);
    });
  });
});
