import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import {
  Patient,
  PatientSource,
} from '../src/modules/patients/entities/patient.entity.js';
import { PatientsService } from '../src/modules/patients/patients.service.js';
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

describe('Patients (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let receptionist: TestUser;
  let doctor: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.DOCTOR);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const createPatient = (body: Record<string, unknown>, as = receptionist) =>
    request(server)
      .post('/api/v1/patients')
      .set('Authorization', bearer(as))
      .send(body);

  const countPatients = () => ctx.dataSource.getRepository(Patient).count();

  describe('POST /patients', () => {
    it('normalizes the phone (Arabic digits, spaces) and records the creator', async () => {
      const res = await createPatient({
        name: '  Ahmed   Hassan ',
        phone: '٠١٠ ١٢٣٤ ٥٦٧٨',
        dateOfBirth: '1990-05-17',
        gender: 'MALE',
      }).expect(201);

      expect(res.body).toMatchObject({
        name: 'Ahmed Hassan',
        phone: '+201012345678',
        dateOfBirth: '1990-05-17',
        gender: 'MALE',
        createdSource: 'RECEPTION',
        createdById: receptionist.id,
      });

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'PATIENT_CREATED', entityId: res.body.id });
      expect(log.userId).toBe(receptionist.id);
    });

    it.each([
      ['local', '01012345678'],
      ['E.164', '+201012345678'],
      ['00 prefix', '00201012345678'],
      ['no plus', '201012345678'],
      ['dashes', '010-1234-5678'],
    ])(
      'treats the %s format as the same number (409 with existing id)',
      async (_label, phone) => {
        const first = await createPatient({
          name: 'Ahmed Hassan',
          phone: '010 1234 5678',
        }).expect(201);

        const res = await createPatient({ name: 'Someone Else', phone }).expect(
          409,
        );
        expect(res.body).toMatchObject({
          statusCode: 409,
          error: 'Conflict',
          message: 'A patient with this phone number already exists',
          details: { patientId: first.body.id },
        });
        expect(await countPatients()).toBe(1);
      },
    );

    it.each(['01312345678', '0223456789', '12345', '+966512345678'])(
      'rejects invalid phone %s with 400',
      async (phone) => {
        const res = await createPatient({ name: 'Ahmed Hassan', phone }).expect(
          400,
        );
        expect(res.body.details).toEqual([
          {
            field: 'phone',
            errors: [expect.stringContaining('Egyptian mobile')],
          },
        ]);
      },
    );

    it('creates exactly one patient when two requests race with the same phone', async () => {
      const [a, b] = await Promise.all([
        createPatient({ name: 'First Racer', phone: '01112345678' }),
        createPatient({ name: 'Second Racer', phone: '+20 111 234 5678' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      const loser = a.status === 201 ? b : a;
      expect(loser.body.details).toEqual({ patientId: winner.body.id });
      expect(await countPatients()).toBe(1);
    });

    it('is forbidden for doctors', async () => {
      await createPatient(
        { name: 'Ahmed Hassan', phone: '01012345678' },
        doctor,
      ).expect(403);
    });
  });

  describe('findOrCreateByPhone (service, used by future public booking)', () => {
    it('creates once under concurrency and never renames an existing patient', async () => {
      const patients = ctx.app.get(PatientsService);
      const results = await Promise.all(
        ['Mona Ali', 'mona  ali', 'Totally Different', 'Mona Ali'].map((name) =>
          patients.findOrCreateByPhone({
            name,
            phone: '015 1234 5678',
            source: PatientSource.ONLINE,
          }),
        ),
      );

      expect(await countPatients()).toBe(1);
      expect(new Set(results.map((r) => r.patient.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);

      const stored = await ctx.dataSource
        .getRepository(Patient)
        .findOneByOrFail({ phone: '+201512345678' });
      expect(stored.createdSource).toBe('ONLINE');
      expect(stored.createdById).toBeNull();

      // Whoever won, the losers got the winner's row back unchanged.
      for (const result of results) {
        expect(result.patient.name).toBe(stored.name);
      }

      const again = await patients.findOrCreateByPhone({
        name: 'Another Name',
        phone: '+201512345678',
        source: PatientSource.ONLINE,
      });
      expect(again).toMatchObject({ created: false, nameMismatch: true });
      expect(again.patient.name).toBe(stored.name);

      // Name comparison ignores case and extra spaces.
      const same = await patients.findOrCreateByPhone({
        name: ` ${stored.name.toUpperCase()} `,
        phone: '01512345678',
        source: PatientSource.ONLINE,
      });
      expect(same).toMatchObject({ created: false, nameMismatch: false });

      const created = await ctx.dataSource
        .getRepository(AuditLog)
        .countBy({ action: 'PATIENT_CREATED', entityId: stored.id });
      expect(created).toBe(1);
    });

    it('rejects an invalid phone (service-level normalization)', async () => {
      await expect(
        ctx.app.get(PatientsService).findOrCreateByPhone({
          name: 'X Y',
          phone: '12345',
          source: PatientSource.ONLINE,
        }),
      ).rejects.toThrow('Egyptian mobile');
    });
  });

  describe('reading', () => {
    beforeEach(async () => {
      await createPatient({ name: 'Ahmed Hassan', phone: '01012345678' });
      await createPatient({ name: 'Mona Adel', phone: '01198765432' });
      await createPatient({ name: 'Ahmad Samir', phone: '01255555555' });
    });

    it('doctors can search by partial name (case-insensitive)', async () => {
      const res = await request(server)
        .get('/api/v1/patients?search=AHM')
        .set('Authorization', bearer(doctor))
        .expect(200);
      expect(res.body.items.map((p: { name: string }) => p.name)).toEqual([
        'Ahmad Samir',
        'Ahmed Hassan',
      ]);
    });

    it('searches by full phone in any format and by partial digits', async () => {
      const full = await request(server)
        .get(
          `/api/v1/patients?search=${encodeURIComponent('+20 119 876 5432')}`,
        )
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(full.body.items.map((p: { name: string }) => p.name)).toEqual([
        'Mona Adel',
      ]);

      const partial = await request(server)
        .get('/api/v1/patients?search=0119876')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(partial.body.meta.total).toBe(1);
    });

    it('treats LIKE wildcards literally', async () => {
      const res = await request(server)
        .get('/api/v1/patients?search=%25')
        .set('Authorization', bearer(receptionist))
        .expect(200);
      expect(res.body.meta.total).toBe(0);
    });

    it('GET /patients/lookup finds by exact phone in any format', async () => {
      const res = await request(server)
        .get(
          `/api/v1/patients/lookup?phone=${encodeURIComponent('00201012345678')}`,
        )
        .set('Authorization', bearer(doctor))
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Ahmed Hassan',
        phone: '+201012345678',
      });

      await request(server)
        .get('/api/v1/patients/lookup?phone=01500000000')
        .set('Authorization', bearer(doctor))
        .expect(404);
      await request(server)
        .get('/api/v1/patients/lookup?phone=123')
        .set('Authorization', bearer(doctor))
        .expect(400);
    });
  });

  describe('PATCH /patients/:id', () => {
    it('changes the phone and audits old and new values', async () => {
      const created = await createPatient({
        name: 'Ahmed Hassan',
        phone: '01012345678',
      }).expect(201);

      const res = await request(server)
        .patch(`/api/v1/patients/${created.body.id}`)
        .set('Authorization', bearer(receptionist))
        .send({ phone: '0111 111 1111', notes: 'Prefers mornings' })
        .expect(200);
      expect(res.body.phone).toBe('+201111111111');

      const log = await ctx.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({
          action: 'PATIENT_UPDATED',
          entityId: created.body.id,
        });
      expect(log).toMatchObject({
        userId: receptionist.id,
        oldValues: { phone: '+201012345678', notes: null },
        newValues: { phone: '+201111111111', notes: 'Prefers mornings' },
      });
    });

    it("returns 409 with the other patient's id when the new phone is taken", async () => {
      const a = await createPatient({
        name: 'Patient A',
        phone: '01012345678',
      });
      const b = await createPatient({
        name: 'Patient B',
        phone: '01112345678',
      });

      const res = await request(server)
        .patch(`/api/v1/patients/${b.body.id}`)
        .set('Authorization', bearer(receptionist))
        .send({ phone: '+201012345678' })
        .expect(409);
      expect(res.body.details).toEqual({ patientId: a.body.id });

      const unchanged = await ctx.dataSource
        .getRepository(Patient)
        .findOneByOrFail({ id: b.body.id });
      expect(unchanged.phone).toBe('+201112345678');
    });

    it('rejects null for name/phone but allows clearing optional fields', async () => {
      const created = await createPatient({
        name: 'Ahmed Hassan',
        phone: '01012345678',
        gender: 'MALE',
      });

      await request(server)
        .patch(`/api/v1/patients/${created.body.id}`)
        .set('Authorization', bearer(receptionist))
        .send({ phone: null })
        .expect(400);

      const res = await request(server)
        .patch(`/api/v1/patients/${created.body.id}`)
        .set('Authorization', bearer(receptionist))
        .send({ gender: null })
        .expect(200);
      expect(res.body.gender).toBeNull();
    });
  });

  it('exposes no public patient endpoint', async () => {
    await request(server).get('/api/v1/public/patients').expect(404);
    await request(server).get('/api/v1/patients').expect(401);
  });
});
