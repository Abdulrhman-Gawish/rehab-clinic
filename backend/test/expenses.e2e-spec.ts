import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { FileStorage } from '../src/common/storage/file-storage.service.js';
import { findOrphans } from '../src/common/storage/orphan-sweep.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { ExpenseCategory } from '../src/modules/expenses/entities/expense-category.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import { withFailingInserts } from './utils/db-failure.js';
import { insertPatient } from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Uploaded files go to a throw-away folder (git-ignored).
vi.hoisted(() => {
  process.env.STORAGE_LOCAL_PATH = '.tmp/e2e-storage';
});

const TODAY = '2026-11-03';
const local = (time: string, date = TODAY) =>
  new Date(`${date}T${time}:00+02:00`);
const clock = { current: local('09:00') };

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body'),
]);
const PDF = Buffer.from('%PDF-1.4\nfake pdf body', 'ascii');

const EXPENSE_KEYS = [
  'amount',
  'category',
  'createdAt',
  'createdBy',
  'description',
  'expenseDate',
  'expenseNumber',
  'hasReceipt',
  'id',
  'paymentMethod',
  'reference',
  'referralPayout',
  'status',
  'vendorName',
  'voidReason',
  'voidedAt',
  'voidedBy',
];

describe('Expenses (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let otherReceptionist: TestUser;
  let hospitality: ExpenseCategory;
  let retired: ExpenseCategory;

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
    const categories = ctx.dataSource.getRepository(ExpenseCategory);
    hospitality = await categories.save(
      categories.create({ name: 'ضيافة', isActive: true }),
    );
    retired = await categories.save(
      categories.create({ name: 'قديم', isActive: false }),
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const as = (user: TestUser) => ({ Authorization: bearer(user) });

  const create = (
    overrides: Record<string, unknown> = {},
    by: TestUser = receptionist,
  ) =>
    request(server)
      .post('/api/v1/expenses')
      .set(as(by))
      .send({
        categoryId: hospitality.id,
        description: 'Tea and sugar',
        amount: '85.5',
        expenseDate: TODAY,
        paymentMethod: 'CASH',
        ...overrides,
      });

  describe('recording', () => {
    it('creates an expense with a gapless number and the exact shape', async () => {
      const res = await create({ vendorName: 'Corner shop' }).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(EXPENSE_KEYS);
      expect(res.body).toMatchObject({
        expenseNumber: 'EXP-2026-000001',
        category: { id: hospitality.id, name: 'ضيافة', isActive: true },
        description: 'Tea and sugar',
        amount: '85.50',
        expenseDate: TODAY,
        vendorName: 'Corner shop',
        paymentMethod: 'CASH',
        reference: null,
        hasReceipt: false,
        status: 'VALID',
        createdBy: { id: receptionist.id, name: expect.any(String) },
        createdAt: '2026-11-03T09:00:00+02:00',
      });
      const second = await create().expect(201);
      expect(second.body.expenseNumber).toBe('EXP-2026-000002');
    });

    it('rejects future dates; receptionists can backdate at most BACKDATE_MAX_DAYS, the owner further', async () => {
      const future = await create({ expenseDate: '2026-11-04' }).expect(422);
      expect(future.body.code).toBe('EXPENSE_DATE_IN_FUTURE');

      await create({ expenseDate: '2026-10-27' }).expect(201);
      const old = await create({ expenseDate: '2026-10-26' }).expect(422);
      expect(old.body).toMatchObject({
        code: 'BACKDATE_LIMIT_EXCEEDED',
        details: { earliestDate: '2026-10-27' },
      });
      await create({ expenseDate: '2026-09-01' }, owner).expect(201);
      await create({ expenseDate: '2026-11-04' }, owner).expect(422);
    });

    it('validates category, amount and date', async () => {
      const inactive = await create({ categoryId: retired.id }).expect(422);
      expect(inactive.body.code).toBe('CATEGORY_INACTIVE');
      await create({
        categoryId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
      await create({ amount: '0' }).expect(400);
      await create({ amount: '-1' }).expect(400);
      await create({ expenseDate: '03/11/2026' }).expect(400);
      await create({ paymentMethod: 'CHEQUE' }).expect(400);
    });
  });

  describe('edit and void', () => {
    it('the creator can edit on the same day (old/new values audited)', async () => {
      const created = await create().expect(201);
      const res = await request(server)
        .patch(`/api/v1/expenses/${created.body.id}`)
        .set(as(receptionist))
        .send({ amount: '90', description: 'Tea, sugar and milk' })
        .expect(200);
      expect(res.body).toMatchObject({
        amount: '90.00',
        description: 'Tea, sugar and milk',
      });

      const log = await ctx.dataSource.getRepository(AuditLog).findOneByOrFail({
        action: 'EXPENSE_UPDATED',
        entityId: created.body.id,
      });
      expect(log).toMatchObject({
        userId: receptionist.id,
        oldValues: { amount: '85.50', description: 'Tea and sugar' },
        newValues: { amount: '90.00', description: 'Tea, sugar and milk' },
      });
    });

    it("others can't edit; the creator can't the next day; the owner always can", async () => {
      const created = await create().expect(201);
      const other = await request(server)
        .patch(`/api/v1/expenses/${created.body.id}`)
        .set(as(otherReceptionist))
        .send({ amount: '1' })
        .expect(422);
      expect(other.body.code).toBe('EXPENSE_EDIT_NOT_ALLOWED');

      clock.current = local('08:00', '2026-11-04');
      await request(server)
        .patch(`/api/v1/expenses/${created.body.id}`)
        .set(as(receptionist))
        .send({ amount: '1' })
        .expect(422);
      await request(server)
        .post(`/api/v1/expenses/${created.body.id}/void`)
        .set(as(receptionist))
        .send({ reason: 'Duplicate entry' })
        .expect(422);
      await request(server)
        .patch(`/api/v1/expenses/${created.body.id}`)
        .set(as(owner))
        .send({ amount: '80' })
        .expect(200);
    });

    it('void keeps the row; a voided expense cannot change', async () => {
      const created = await create().expect(201);
      await request(server)
        .post(`/api/v1/expenses/${created.body.id}/void`)
        .set(as(receptionist))
        .send({})
        .expect(400);
      const voided = await request(server)
        .post(`/api/v1/expenses/${created.body.id}/void`)
        .set(as(receptionist))
        .send({ reason: 'Entered twice' })
        .expect(200);
      expect(voided.body).toMatchObject({
        status: 'VOIDED',
        voidReason: 'Entered twice',
        voidedBy: { id: receptionist.id, name: expect.any(String) },
        voidedAt: '2026-11-03T09:00:00+02:00',
      });
      await request(server)
        .patch(`/api/v1/expenses/${created.body.id}`)
        .set(as(owner))
        .send({ amount: '1' })
        .expect(422);
      await request(server)
        .get(`/api/v1/expenses/${created.body.id}`)
        .set(as(owner))
        .expect(200);
    });

    it('lists with filters and the total of valid expenses', async () => {
      await create({ amount: '100' }).expect(201);
      await create({
        amount: '50',
        paymentMethod: 'CARD',
        expenseDate: '2026-11-02',
      }).expect(201);
      const voided = await create({ amount: '999' }).expect(201);
      await request(server)
        .post(`/api/v1/expenses/${voided.body.id}/void`)
        .set(as(receptionist))
        .send({ reason: 'Wrong amount' })
        .expect(200);

      const all = await request(server)
        .get('/api/v1/expenses')
        .set(as(owner))
        .expect(200);
      expect(all.body.meta.total).toBe(3);
      expect(all.body.totalAmount).toBe('150.00');

      const today = await request(server)
        .get(`/api/v1/expenses?from=${TODAY}&to=${TODAY}&status=VALID`)
        .set(as(owner))
        .expect(200);
      expect(today.body).toMatchObject({
        totalAmount: '100.00',
        meta: { total: 1 },
      });
      const card = await request(server)
        .get('/api/v1/expenses?method=CARD')
        .set(as(owner))
        .expect(200);
      expect(card.body.totalAmount).toBe('50.00');
    });

    it('pages after the filters, newest first; the total covers every page', async () => {
      const older = await create({
        amount: '30',
        expenseDate: '2026-11-01',
      }).expect(201);
      const first = await create({ amount: '100' }).expect(201);
      const second = await create({ amount: '50' }).expect(201);
      await create({ amount: '20', paymentMethod: 'CARD' }).expect(201);
      const page = async (n: number) =>
        (
          await request(server)
            .get(`/api/v1/expenses?method=CASH&limit=2&page=${n}`)
            .set(as(owner))
            .expect(200)
        ).body as {
          items: { id: string }[];
          meta: object;
          totalAmount: string;
        };

      const page1 = await page(1);
      const page2 = await page(2);
      expect(page1.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      // Same date: the higher expense number first.
      expect([...page1.items, ...page2.items].map((x) => x.id)).toEqual([
        second.body.id,
        first.body.id,
        older.body.id,
      ]);
      for (const body of [page1, page2, await page(3)]) {
        expect(body.totalAmount).toBe('180.00');
      }
      expect((await page(3)).items).toEqual([]);
    });
  });

  describe('receipt files', () => {
    const upload = (
      id: string,
      content: Buffer,
      name: string,
      by: TestUser = receptionist,
    ) =>
      request(server)
        .post(`/api/v1/expenses/${id}/receipt`)
        .set(as(by))
        .attach('file', content, name);

    it('stores the file privately and streams it back to authorized users', async () => {
      const created = await create().expect(201);
      const res = await upload(created.body.id, PNG, 'receipt.png').expect(200);
      expect(res.body.hasReceipt).toBe(true);

      const file = await request(server)
        .get(`/api/v1/expenses/${created.body.id}/receipt`)
        .set(as(owner))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['content-disposition']).toBe(
        'inline; filename="EXP-2026-000001.png"',
      );
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);

      // Replacing is allowed (same edit rule); a PDF works too.
      await upload(created.body.id, PDF, 'scan.pdf').expect(200);

      // Never served statically.
      await request(server).get('/storage/expenses').expect(404);
    });

    it('checks the real type from the content, the size and the edit rule', async () => {
      const created = await create().expect(201);
      for (const [content, name] of [
        [Buffer.from('just some text'), 'receipt.png'],
        [Buffer.from('MZ\x90\x00 executable'), 'invoice.pdf'],
        [PDF, 'looks-like.png'],
      ] as const) {
        const res = await upload(created.body.id, content, name).expect(422);
        expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
      }

      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      await upload(created.body.id, big, 'big.png').expect(413);

      await request(server)
        .post(`/api/v1/expenses/${created.body.id}/receipt`)
        .set(as(receptionist))
        .expect(400);
      const other = await upload(
        created.body.id,
        PNG,
        'receipt.png',
        otherReceptionist,
      ).expect(422);
      expect(other.body.code).toBe('EXPENSE_EDIT_NOT_ALLOWED');

      await request(server)
        .get(`/api/v1/expenses/${created.body.id}/receipt`)
        .set(as(owner))
        .expect(404);
    });

    it('a failed upload removes only its own file; replaced receipts are kept and never swept', async () => {
      const storage = ctx.app.get(FileStorage, { strict: false });
      const created = await create().expect(201);
      const id = created.body.id as string;
      const folder = `expenses/${id}/`;
      await upload(id, PNG, 'receipt.png').expect(200);
      await upload(id, PDF, 'scan.pdf').expect(200); // replaces; PNG kept
      const before = await storage.list(folder);
      expect(before).toHaveLength(2);

      // The audit entry (same transaction) fails: 500, nothing changes.
      await withFailingInserts(ctx.dataSource, 'audit_logs', () =>
        upload(id, PNG, 'again.png').expect(500),
      );
      expect(await storage.list(folder)).toEqual(before);
      const current = await request(server)
        .get(`/api/v1/expenses/${id}/receipt`)
        .set(as(owner))
        .expect(200);
      expect(current.headers['content-type']).toBe('application/pdf');

      // The sweep keeps the current and the replaced receipt; it only
      // reports an old file nothing points to.
      const orphan = `${folder}orphan.png`;
      await storage.put(orphan, PNG);
      const later = new Date(Date.now() + 61 * 60_000);
      const found = (await findOrphans(storage, ctx.dataSource, later, 60))
        .map((f) => f.key)
        .filter((key) => key.startsWith(folder));
      expect(found).toEqual([orphan]);
    });
  });

  describe('daily summary', () => {
    it('cash expenses reduce the expected cash', async () => {
      const patient = await insertPatient(
        ctx.dataSource,
        'Mona Ali',
        '+201011111111',
      );
      const invoice = await request(server)
        .post('/api/v1/invoices')
        .set(as(receptionist))
        .send({
          patientId: patient.id,
          items: [{ description: 'Session', unitPrice: '300', quantity: 1 }],
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/invoices/${invoice.body.id}/payments`)
        .set(as(receptionist))
        .send({ amount: '200', method: 'CASH' })
        .expect(201);
      await create({ amount: '50' }).expect(201);
      await create({ amount: '30', paymentMethod: 'CARD' }).expect(201);
      await create({ amount: '7', expenseDate: '2026-11-02' }).expect(201);
      const voided = await create({ amount: '1000' }).expect(201);
      await request(server)
        .post(`/api/v1/expenses/${voided.body.id}/void`)
        .set(as(receptionist))
        .send({ reason: 'Wrong amount' })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/billing/daily-summary')
        .set(as(receptionist))
        .expect(200);
      expect(res.body.expenses).toEqual({
        count: 2,
        total: '80.00',
        byMethod: {
          CASH: '50.00',
          CARD: '30.00',
          WALLET: '0.00',
          INSTAPAY: '0.00',
        },
      });
      expect(res.body.expectedCash).toBe('150.00');
    });
  });

  // ---------- payouts to referring doctors ----------

  describe('referral payouts', () => {
    // A referring doctor owed `owed` (an adjustment), paid `amount`.
    async function payout(
      amount: string,
      body: object = {},
      doctor = 'Dr. Hany Samir',
      owed = '1000.00',
    ) {
      const doc = await request(server)
        .post('/api/v1/referring-doctors')
        .set(as(owner))
        .send({
          name: doctor,
          commission: { type: 'PERCENT', value: '10' },
          discount: { type: 'NONE' },
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/referring-doctors/${doc.body.id}/commission-adjustments`)
        .set(as(owner))
        .send({ amount: owed, reason: 'Owed from before' })
        .expect(201);
      const res = await request(server)
        .post(`/api/v1/referring-doctors/${doc.body.id}/payouts`)
        .set(as(owner))
        .send({ amount, method: 'CASH', ...body })
        .expect(201);
      return {
        doctorId: doc.body.id as string,
        payoutId: res.body.id as string,
        expenseId: res.body.expense.id as string,
      };
    }

    const list = (query: string) =>
      request(server).get(`/api/v1/expenses?${query}`).set(as(receptionist));

    it('a payout is an expense in the reserved category that changes only with its payout', async () => {
      const paid = await payout('350.00', {
        payoutDate: '2026-11-02',
        reference: 'TX-1',
        notes: 'November, first part',
      });
      const res = await request(server)
        .get(`/api/v1/expenses/${paid.expenseId}`)
        .set(as(receptionist))
        .expect(200);
      expect(res.body).toMatchObject({
        expenseNumber: 'EXP-2026-000001',
        category: { systemKey: 'REFERRAL_COMMISSION', isActive: true },
        description: 'Referral commission: Dr. Hany Samir',
        amount: '350.00',
        expenseDate: '2026-11-02',
        vendorName: 'Dr. Hany Samir',
        paymentMethod: 'CASH',
        reference: 'TX-1',
        status: 'VALID',
        createdBy: { id: owner.id },
        referralPayout: {
          id: paid.payoutId,
          referringDoctor: { id: paid.doctorId, name: 'Dr. Hany Samir' },
          notes: 'November, first part',
        },
      });
      const audit = await request(server)
        .get(`/api/v1/audit-logs?entityId=${paid.expenseId}`)
        .set(as(owner))
        .expect(200);
      expect(audit.body.items[0]).toMatchObject({
        action: 'EXPENSE_CREATED',
        newValues: { amount: '350.00', referralPayoutId: paid.payoutId },
      });

      // Even the owner changes it only through the payout.
      for (const attempt of [
        () =>
          request(server)
            .patch(`/api/v1/expenses/${paid.expenseId}`)
            .set(as(owner))
            .send({ amount: '300' }),
        () =>
          request(server)
            .post(`/api/v1/expenses/${paid.expenseId}/void`)
            .set(as(owner))
            .send({ reason: 'Mistake' }),
      ]) {
        const refused = await attempt().expect(422);
        expect(refused.body.code).toBe('EXPENSE_EDIT_NOT_ALLOWED');
      }
      // The transfer slip can still be attached.
      await request(server)
        .post(`/api/v1/expenses/${paid.expenseId}/receipt`)
        .set(as(owner))
        .attach('file', PNG, 'slip.png')
        .expect(200);
    });

    it('filters by source, referring doctor, method and date', async () => {
      await create({ amount: '50' }).expect(201);
      const hany = await payout('300.00');
      await payout('120.00', { method: 'INSTAPAY' }, 'Dr. Mona Adel');

      const manual = await list('source=MANUAL').expect(200);
      expect(
        manual.body.items.map((e: { amount: string }) => e.amount),
      ).toEqual(['50.00']);
      const commissions = await list('source=REFERRAL_PAYOUT').expect(200);
      expect(commissions.body).toMatchObject({
        meta: { total: 2 },
        totalAmount: '420.00',
      });
      const ofHany = await list(`referringDoctorId=${hany.doctorId}`).expect(
        200,
      );
      expect(ofHany.body).toMatchObject({
        meta: { total: 1 },
        totalAmount: '300.00',
      });
      const byMethod = await list('source=REFERRAL_PAYOUT&method=INSTAPAY');
      expect(byMethod.body.totalAmount).toBe('120.00');
      const before = await list(
        'source=REFERRAL_PAYOUT&from=2026-11-01&to=2026-11-02',
      );
      expect(before.body.meta.total).toBe(0);
    });

    it('nobody records an expense in the reserved category by hand, and it stays active', async () => {
      await payout('100.00');
      const categories = await request(server)
        .get('/api/v1/expense-categories')
        .set(as(receptionist))
        .expect(200);
      const reserved = categories.body.find(
        (c: { systemKey: string | null }) =>
          c.systemKey === 'REFERRAL_COMMISSION',
      );
      expect(reserved).toMatchObject({ isActive: true });

      const typed = await create({ categoryId: reserved.id }, owner).expect(
        422,
      );
      expect(typed.body.code).toBe('CATEGORY_RESERVED');
      const manual = await create().expect(201);
      const moved = await request(server)
        .patch(`/api/v1/expenses/${manual.body.id}`)
        .set(as(owner))
        .send({ categoryId: reserved.id })
        .expect(422);
      expect(moved.body.code).toBe('CATEGORY_RESERVED');
      const deactivate = await request(server)
        .patch(`/api/v1/expense-categories/${reserved.id}/deactivate`)
        .set(as(owner))
        .expect(422);
      expect(deactivate.body.code).toBe('CATEGORY_RESERVED');
      await request(server)
        .patch(`/api/v1/expense-categories/${reserved.id}`)
        .set(as(owner))
        .send({ name: 'Doctor commissions' })
        .expect(200);
    });

    it('a payout whose expense cannot be written is not recorded at all', async () => {
      const doc = await request(server)
        .post('/api/v1/referring-doctors')
        .set(as(owner))
        .send({
          name: 'Dr. Hany Samir',
          commission: { type: 'PERCENT', value: '10' },
          discount: { type: 'NONE' },
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/referring-doctors/${doc.body.id}/commission-adjustments`)
        .set(as(owner))
        .send({ amount: '100.00', reason: 'Owed from before' })
        .expect(201);
      const pay = () =>
        request(server)
          .post(`/api/v1/referring-doctors/${doc.body.id}/payouts`)
          .set(as(owner))
          .send({ amount: '100.00', method: 'CASH' });

      // The expense is written, then the payout row fails.
      await withFailingInserts(ctx.dataSource, 'referral_payouts', () =>
        pay().expect(500),
      );
      const expenses = await list('').expect(200);
      expect(expenses.body.meta.total).toBe(0);
      const balance = await request(server)
        .get(`/api/v1/referring-doctors/${doc.body.id}/commission-balance`)
        .set(as(owner))
        .expect(200);
      expect(balance.body).toMatchObject({
        paid: '0.00',
        outstanding: '100.00',
      });
      // Nothing was used up: not even the expense number.
      const ok = await pay().expect(201);
      expect(ok.body.expense.expenseNumber).toBe('EXP-2026-000001');
    });
  });

  describe('categories', () => {
    it('owner manages, receptionist reads', async () => {
      const list = await request(server)
        .get('/api/v1/expense-categories')
        .set(as(receptionist))
        .expect(200);
      expect(list.body.map((c: { name: string }) => c.name)).toEqual(['ضيافة']);
      const all = await request(server)
        .get('/api/v1/expense-categories?includeInactive=true')
        .set(as(receptionist))
        .expect(200);
      expect(all.body).toHaveLength(2);

      const created = await request(server)
        .post('/api/v1/expense-categories')
        .set(as(owner))
        .send({ name: 'صيانة' })
        .expect(201);
      const duplicate = await request(server)
        .post('/api/v1/expense-categories')
        .set(as(owner))
        .send({ name: 'صيانة' })
        .expect(409);
      expect(duplicate.body.code).toBe('CATEGORY_NAME_TAKEN');

      await request(server)
        .patch(`/api/v1/expense-categories/${created.body.id}`)
        .set(as(owner))
        .send({ name: 'صيانة وإصلاح' })
        .expect(200)
        .expect(({ body }) => expect(body.name).toBe('صيانة وإصلاح'));
      await request(server)
        .patch(`/api/v1/expense-categories/${created.body.id}/deactivate`)
        .set(as(owner))
        .expect(200)
        .expect(({ body }) => expect(body.isActive).toBe(false));
      await create({ categoryId: created.body.id }).expect(422);
    });
  });
});
