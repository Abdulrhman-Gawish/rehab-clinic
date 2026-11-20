import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { backfillInvoiceTotalChanges } from '../src/database/invoice-total-changes-backfill.js';
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

/**
 * invoice_total_changes: an invoice's total in effect at any instant, so a
 * past day's balances never move when an unpaid invoice is edited or
 * discounted later. Clinic local dates in November (+02:00).
 *
 *  A  Nov 10 09:00  issued 150 (one item)
 *     Nov 11 10:00  + item 30          -> 180
 *     Nov 11 11:00  discount 20        -> 160
 *     Nov 12 09:00  discount removed   -> 180
 */
const nov = (date: string, time: string) =>
  new Date(`2026-11-${date}T${time}:00+02:00`);
const clock = { current: nov('10', '09:00') };

type HistoryRow = { invoice_id: string; changed_at: Date; total: string };

describe('Invoice total history (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let patientId: string;
  const ids: Record<string, string> = {};

  const as = (user: TestUser) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Authorization', bearer(user)),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });
  const ok = async (res: request.Test, status = 201) =>
    (await res.expect(status)).body;
  const manual = async (unitPrice: string) =>
    (
      await ok(
        as(receptionist).post('/invoices', {
          patientId,
          items: [{ description: 'Medical report', unitPrice, quantity: 1 }],
        }),
      )
    ).id as string;
  const discount = (invoiceId: string, value: string) =>
    ok(
      as(receptionist).post(`/invoices/${invoiceId}/discount`, {
        type: 'FIXED',
        value,
        reason: 'Goodwill',
      }),
      200,
    );
  const history = async (): Promise<HistoryRow[]> =>
    ctx.dataSource.query(
      `SELECT invoice_id, changed_at, total FROM invoice_total_changes
        ORDER BY invoice_id, changed_at`,
    );
  const daily = async (date: string) =>
    (
      await as(owner)
        .get(`/billing/daily-summary?date=2026-11-${date}`)
        .expect(200)
    ).body.outstanding.patientsOwe;

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
    patientId = (
      await insertPatient(ctx.dataSource, 'Patient One', '+201011111111')
    ).id;

    ids.a = await manual('150.00');
    clock.current = nov('11', '10:00');
    await ok(
      as(receptionist).post(`/invoices/${ids.a}/items`, {
        description: 'Copy of the report',
        unitPrice: '30.00',
        quantity: 1,
      }),
    );
    clock.current = nov('11', '11:00');
    await discount(ids.a, '20');
    clock.current = nov('12', '09:00');
    await ok(
      as(receptionist).post(`/invoices/${ids.a}/discount/remove`, {
        reason: 'Not eligible',
      }),
      200,
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('records each change of the total at the instant it happened', async () => {
    expect(
      (await history()).map((r) => [r.changed_at.toISOString(), r.total]),
    ).toEqual([
      ['2026-11-10T07:00:00.000Z', '150.00'],
      ['2026-11-11T08:00:00.000Z', '180.00'],
      ['2026-11-11T09:00:00.000Z', '160.00'],
      ['2026-11-12T07:00:00.000Z', '180.00'],
    ]);
  });

  it('a later item edit or discount never changes an earlier day', async () => {
    expect(await daily('10')).toEqual({
      opening: '0.00',
      invoiced: '150.00',
      adjustments: '0.00',
      cancelled: '0.00',
      payments: '0.00',
      refunds: '0.00',
      closing: '150.00', // not 160 or 180: those came later
      unpaidInvoices: 1,
    });
    expect(await daily('11')).toMatchObject({
      opening: '150.00',
      invoiced: '0.00',
      adjustments: '10.00', // + 30 item, - 20 discount
      closing: '160.00',
    });
    expect(await daily('12')).toMatchObject({
      opening: '160.00',
      adjustments: '20.00', // the discount removed
      closing: '180.00',
    });
    const asOf = async (date: string) =>
      (
        await as(owner)
          .get(`/reports/patients-owe?asOf=2026-11-${date}`)
          .expect(200)
      ).body;
    expect(await asOf('10')).toMatchObject({
      totalBalance: '150.00',
      items: [{ invoices: [{ total: '150.00', balance: '150.00' }] }],
    });
    expect(await asOf('11')).toMatchObject({
      totalBalance: '160.00',
      items: [{ invoices: [{ total: '160.00', balance: '160.00' }] }],
    });
  });

  it('the migration rebuilds the same history from the audit log', async () => {
    // B: discounted later, but the audit row of that discount is missing.
    clock.current = nov('13', '09:00');
    ids.b = await manual('200.00');
    clock.current = nov('13', '10:00');
    await discount(ids.b, '20');
    await ctx.dataSource.query(
      `DELETE FROM audit_logs WHERE entity_id = $1 AND action = 'DISCOUNT_APPLIED'`,
      [ids.b],
    );
    // C: discounted in the transaction that created it (one instant).
    clock.current = nov('13', '11:00');
    ids.c = await manual('100.00');
    await discount(ids.c, '10');

    // Audit times are the database clock at the start of each transaction:
    // set them to when each change happened (the creating transaction
    // starts a few ms before the issue).
    const auditAt: [string, string, Date][] = [
      [ids.a, 'INVOICE_CREATED', new Date(nov('10', '09:00').getTime() - 5)],
      [ids.a, 'INVOICE_ITEM_ADDED', nov('11', '10:00')],
      [ids.a, 'DISCOUNT_APPLIED', nov('11', '11:00')],
      [ids.a, 'DISCOUNT_REMOVED', nov('12', '09:00')],
      [ids.b, 'INVOICE_CREATED', new Date(nov('13', '09:00').getTime() - 5)],
      [ids.c, 'INVOICE_CREATED', new Date(nov('13', '11:00').getTime() - 5)],
      [ids.c, 'DISCOUNT_APPLIED', new Date(nov('13', '11:00').getTime() - 5)],
    ];
    for (const [entityId, action, when] of auditAt) {
      await ctx.dataSource.query(
        `UPDATE audit_logs SET created_at = $3 WHERE entity_id = $1 AND action = $2`,
        [entityId, action, when],
      );
    }

    const recorded = await history();
    await ctx.dataSource.query('DELETE FROM invoice_total_changes');
    await backfillInvoiceTotalChanges(ctx.dataSource);
    const rebuilt = await history();

    const of = (rows: HistoryRow[], id: string) =>
      rows
        .filter((r) => r.invoice_id === id)
        .map((r) => [r.changed_at.toISOString(), r.total]);
    // A and C: exactly what the app recorded.
    expect(of(rebuilt, ids.a)).toEqual(of(recorded, ids.a));
    expect(of(rebuilt, ids.c)).toEqual([['2026-11-13T09:00:00.000Z', '90.00']]);
    expect(of(rebuilt, ids.c)).toEqual(of(recorded, ids.c));
    // B: its audit doesn't end at its total: its current total from its
    // issue (how every balance was computed before the history existed).
    expect(of(recorded, ids.b)).toEqual([
      ['2026-11-13T07:00:00.000Z', '200.00'],
      ['2026-11-13T08:00:00.000Z', '180.00'],
    ]);
    expect(of(rebuilt, ids.b)).toEqual([
      ['2026-11-13T07:00:00.000Z', '180.00'],
    ]);

    // Invoices that already have a history are left alone.
    await backfillInvoiceTotalChanges(ctx.dataSource);
    expect(await history()).toEqual(rebuilt);
  });
});
