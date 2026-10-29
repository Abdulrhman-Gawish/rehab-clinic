import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Who = UserRole | 'ANONYMOUS';

const { OWNER, RECEPTIONIST, DOCTOR } = UserRole;
const STAFF = [OWNER, RECEPTIONIST, DOCTOR];
const EVERYONE: Who[] = [...STAFF, 'ANONYMOUS'];

const id = randomUUID();
const otherId = randomUUID();

// Mirrors the permissions matrix from the specification.
const MATRIX: { method: Method; path: string; allowed: Who[] }[] = [
  // users: OWNER RW
  { method: 'get', path: '/users', allowed: [OWNER] },
  { method: 'post', path: '/users', allowed: [OWNER] },
  { method: 'get', path: `/users/${id}`, allowed: [OWNER] },
  { method: 'patch', path: `/users/${id}`, allowed: [OWNER] },
  { method: 'patch', path: `/users/${id}/activate`, allowed: [OWNER] },
  { method: 'patch', path: `/users/${id}/deactivate`, allowed: [OWNER] },
  { method: 'post', path: `/users/${id}/reset-password`, allowed: [OWNER] },
  // audit-logs: OWNER R
  { method: 'get', path: '/audit-logs', allowed: [OWNER] },
  // patients: OWNER/RECEPTIONIST RW, DOCTOR R
  { method: 'get', path: '/patients', allowed: STAFF },
  { method: 'get', path: '/patients/lookup?phone=01012345678', allowed: STAFF },
  { method: 'get', path: `/patients/${id}`, allowed: STAFF },
  { method: 'post', path: '/patients', allowed: [OWNER, RECEPTIONIST] },
  { method: 'patch', path: `/patients/${id}`, allowed: [OWNER, RECEPTIONIST] },
  // doctors (staff): OWNER RW, others R
  { method: 'get', path: '/doctors', allowed: STAFF },
  { method: 'get', path: `/doctors/${id}`, allowed: STAFF },
  { method: 'post', path: '/doctors', allowed: [OWNER] },
  { method: 'patch', path: `/doctors/${id}`, allowed: [OWNER] },
  { method: 'patch', path: `/doctors/${id}/activate`, allowed: [OWNER] },
  { method: 'patch', path: `/doctors/${id}/deactivate`, allowed: [OWNER] },
  {
    method: 'put',
    path: `/doctors/${id}/services/${otherId}`,
    allowed: [OWNER],
  },
  {
    method: 'delete',
    path: `/doctors/${id}/services/${otherId}`,
    allowed: [OWNER],
  },
  // clinic services (staff): OWNER RW, others R
  { method: 'get', path: '/clinic-services', allowed: STAFF },
  { method: 'get', path: `/clinic-services/${id}`, allowed: STAFF },
  { method: 'post', path: '/clinic-services', allowed: [OWNER] },
  { method: 'patch', path: `/clinic-services/${id}`, allowed: [OWNER] },
  {
    method: 'patch',
    path: `/clinic-services/${id}/activate`,
    allowed: [OWNER],
  },
  {
    method: 'patch',
    path: `/clinic-services/${id}/deactivate`,
    allowed: [OWNER],
  },
  // schedules / time off: OWNER, RECEPTIONIST RW; DOCTOR R (own, else 404)
  { method: 'get', path: `/doctors/${id}/schedules`, allowed: STAFF },
  {
    method: 'post',
    path: `/doctors/${id}/schedules`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/doctors/${id}/schedules/${otherId}`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/doctors/${id}/schedules/${otherId}/activate`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/doctors/${id}/schedules/${otherId}/deactivate`,
    allowed: [OWNER, RECEPTIONIST],
  },
  { method: 'get', path: `/doctors/${id}/time-off`, allowed: STAFF },
  {
    method: 'post',
    path: `/doctors/${id}/time-off`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/doctors/${id}/time-off/${otherId}`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'delete',
    path: `/doctors/${id}/time-off/${otherId}`,
    allowed: [OWNER, RECEPTIONIST],
  },
  // availability (staff): all staff, DOCTOR own only
  {
    method: 'get',
    path: `/appointments/availability?doctorId=${id}&serviceId=${otherId}&date=2026-11-05`,
    allowed: STAFF,
  },
  // appointments: OWNER, RECEPTIONIST W; DOCTOR R own only (else 404)
  { method: 'post', path: '/appointments', allowed: [OWNER, RECEPTIONIST] },
  { method: 'get', path: '/appointments', allowed: STAFF },
  {
    method: 'get',
    path: '/appointments/day?date=2026-11-05',
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'get',
    path: '/appointments/by-reference/APT-AAAAAA',
    allowed: STAFF,
  },
  { method: 'get', path: `/appointments/${id}`, allowed: STAFF },
  { method: 'get', path: `/appointments/${id}/history`, allowed: STAFF },
  {
    method: 'patch',
    path: `/appointments/${id}/confirm`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/appointments/${id}/cancel`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/appointments/${id}/no-show`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'post',
    path: `/appointments/${id}/reschedule`,
    allowed: [OWNER, RECEPTIONIST],
  },
  { method: 'get', path: `/patients/${id}/appointments`, allowed: STAFF },
  // visits: desk W (check-in/walk-in/undo/cancel); OWNER + own DOCTOR start/complete
  {
    method: 'post',
    path: `/appointments/${id}/check-in`,
    allowed: [OWNER, RECEPTIONIST],
  },
  { method: 'post', path: '/visits/walk-in', allowed: [OWNER, RECEPTIONIST] },
  {
    method: 'post',
    path: `/visits/${id}/undo-check-in`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'post',
    path: `/visits/${id}/cancel`,
    allowed: [OWNER, RECEPTIONIST],
  },
  { method: 'post', path: `/visits/${id}/start`, allowed: [OWNER, DOCTOR] },
  { method: 'post', path: `/visits/${id}/complete`, allowed: [OWNER, DOCTOR] },
  { method: 'get', path: '/visits/queue', allowed: STAFF },
  { method: 'get', path: '/visits/open', allowed: [OWNER, RECEPTIONIST] },
  { method: 'get', path: '/visits', allowed: STAFF },
  { method: 'get', path: `/visits/${id}`, allowed: STAFF },
  { method: 'get', path: `/visits/${id}/history`, allowed: STAFF },
  { method: 'get', path: `/patients/${id}/visits`, allowed: STAFF },
  // billing (doctors have no access): OWNER, RECEPTIONIST
  { method: 'post', path: '/invoices', allowed: [OWNER, RECEPTIONIST] },
  { method: 'get', path: '/invoices', allowed: [OWNER, RECEPTIONIST] },
  { method: 'get', path: `/invoices/${id}`, allowed: [OWNER, RECEPTIONIST] },
  {
    method: 'post',
    path: `/invoices/${id}/items`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'patch',
    path: `/invoices/${id}/items/${otherId}`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'delete',
    path: `/invoices/${id}/items/${otherId}`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'post',
    path: `/invoices/${id}/cancel`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'get',
    path: `/patients/${id}/invoices`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'get',
    path: `/patients/${id}/balance`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'post',
    path: `/visits/${id}/invoice`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'get',
    path: `/patients/${id}/last-discount`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'post',
    path: `/invoices/${id}/discount`,
    allowed: [OWNER, RECEPTIONIST],
  },
  {
    method: 'delete',
    path: `/invoices/${id}/discount`,
    allowed: [OWNER, RECEPTIONIST],
  },
  // public: anyone
  { method: 'get', path: '/public/doctors', allowed: EVERYONE },
  { method: 'get', path: `/public/doctors/${id}`, allowed: EVERYONE },
  { method: 'get', path: '/public/services', allowed: EVERYONE },
  {
    method: 'get',
    path: `/public/doctors/${id}/slots?serviceId=${otherId}&date=2026-11-05`,
    allowed: EVERYONE,
  },
  { method: 'post', path: '/public/appointments', allowed: EVERYONE },
];

const CASES = MATRIX.flatMap((route) =>
  EVERYONE.map((who) => ({
    ...route,
    who,
    expectAllowed: route.allowed.includes(who),
  })),
);

describe('Permissions matrix (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  const users = new Map<UserRole, TestUser>();

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
    await resetDatabase(ctx.dataSource);
    for (const role of STAFF) {
      users.set(role, await createLoggedInUser(ctx.app, ctx.dataSource, role));
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it.each(CASES)(
    '$who $method $path -> allowed: $expectAllowed',
    async ({ method, path, who, expectAllowed }) => {
      let req = request(server)[method](`/api/v1${path}`).send({});
      if (who !== 'ANONYMOUS') {
        req = req.set('Authorization', bearer(users.get(who)!));
      }
      const { status } = await req;

      if (expectAllowed) {
        // Past the guards: may still be 200/201/204/400/404/409.
        expect([401, 403]).not.toContain(status);
      } else {
        expect(status).toBe(who === 'ANONYMOUS' ? 401 : 403);
      }
    },
  );
});
