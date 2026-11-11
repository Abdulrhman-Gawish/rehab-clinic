import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
import { Appointment } from '../src/modules/appointments/entities/appointment.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  assignService,
  createLoggedInDoctor,
  insertPatient,
  insertService,
  insertWeeklySchedule,
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
const RANGE = '?from=2026-11-01&to=2026-11-30';
const TOMORROW_10 = '2026-11-04T10:00:00+02:00';

const UTM = {
  source: 'facebook',
  medium: 'cpc',
  campaign: 'back-pain-nov',
  content: 'video',
  term: 'physio cairo',
};

interface Source {
  id: string;
  channel: string;
  isPrimary: boolean;
  details: string | null;
}

describe('Patient acquisition (e2e)', () => {
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
        basePrice: '300.00',
      })
    ).id;
    await assignService(ctx.dataSource, doctorId, serviceId);
    await insertWeeklySchedule(ctx.dataSource, doctorId);
    patient = await insertPatient(ctx.dataSource, 'Sara Ali', '+201000000001');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

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

  const addSource = (body: object, who: Patient = patient) =>
    as(receptionist).post(`/patients/${who.id}/acquisition-sources`, body);

  const sources = async (who: Patient = patient) =>
    (await as(receptionist).get(`/patients/${who.id}/acquisition`).expect(200))
      .body as {
      sources: Source[];
      removed: (Source & {
        removalReason: string;
        removedBy: { id: string };
      })[];
      campaignBookings: { referenceCode: string; utm: typeof UTM }[];
    };

  const book = (body: object = {}) =>
    request(server)
      .post('/api/v1/public/appointments')
      .send({
        name: 'Online Patient',
        phone: '01099999999',
        doctorId,
        serviceId,
        startAt: TOMORROW_10,
        ...body,
      });

  // Patients' created_at comes from the database clock; pin it.
  const createdOn = (who: Patient, instant: string) =>
    ctx.dataSource.query(`UPDATE patients SET created_at = $1 WHERE id = $2`, [
      instant,
      who.id,
    ]);

  // ---------- sources ----------

  describe('sources recorded by reception', () => {
    it('a patient can have several sources; the first is primary until another is made primary', async () => {
      await addSource({ channel: 'FACEBOOK', details: 'Back pain ad' }).expect(
        201,
      );
      await addSource({ channel: 'INSTAGRAM' }).expect(201);
      const res = await addSource({
        channel: 'FRIENDS_FAMILY',
        details: 'Her sister',
        isPrimary: true,
      }).expect(201);
      expect(
        (res.body.sources as Source[]).map((s) => [s.channel, s.isPrimary]),
      ).toEqual([
        ['FRIENDS_FAMILY', true],
        ['FACEBOOK', false],
        ['INSTAGRAM', false],
      ]);
      expect(res.body.sources[0]).toMatchObject({
        category: 'WORD_OF_MOUTH',
        recordedBy: { id: receptionist.id },
      });
    });

    it('a channel is recorded once at a time (409); after removing it, it can be added again', async () => {
      const first = await addSource({ channel: 'GOOGLE' }).expect(201);
      const dup = await addSource({ channel: 'GOOGLE' }).expect(409);
      expect(dup.body.code).toBe('SOURCE_ALREADY_RECORDED');
      await as(receptionist)
        .post(`/acquisition-sources/${first.body.sources[0].id}/remove`, {
          reason: 'Recorded by mistake',
        })
        .expect(201);
      await addSource({ channel: 'GOOGLE' }).expect(201);
    });

    it('edits are audited with the old and new values', async () => {
      const added = await addSource({ channel: 'WEBSITE' }).expect(201);
      const id = added.body.sources[0].id as string;
      await as(receptionist)
        .patch(`/acquisition-sources/${id}`, { details: 'Found us on Maps' })
        .expect(200);
      const audit = await as(owner)
        .get(`/audit-logs?entityId=${id}&action=ACQUISITION_SOURCE_UPDATED`)
        .expect(200);
      expect(audit.body.items[0]).toMatchObject({
        oldValues: { details: null },
        newValues: { details: 'Found us on Maps' },
        user: { id: receptionist.id },
      });
    });

    it('removing keeps the source as history; a removed primary hands over to the oldest remaining one', async () => {
      const facebook = await addSource({ channel: 'FACEBOOK' }).expect(201);
      await addSource({ channel: 'INSTAGRAM' }).expect(201);
      await addSource({ channel: 'GOOGLE' }).expect(201);
      await as(receptionist)
        .post(`/acquisition-sources/${facebook.body.sources[0].id}/remove`, {
          reason: 'Patient corrected it',
        })
        .expect(201);
      const now = await sources();
      expect(now.sources.map((s) => [s.channel, s.isPrimary])).toEqual([
        ['INSTAGRAM', true],
        ['GOOGLE', false],
      ]);
      expect(now.removed).toEqual([
        expect.objectContaining({
          channel: 'FACEBOOK',
          isPrimary: false,
          removalReason: 'Patient corrected it',
          removedBy: expect.objectContaining({ id: receptionist.id }),
        }),
      ]);
    });

    it('the DOCTOR_REFERRAL source stays while the patient has an active referral', async () => {
      const doc = await as(owner)
        .post('/referring-doctors', {
          name: 'Dr. Hany',
          commission: { type: 'NONE' },
          discount: { type: 'NONE' },
        })
        .expect(201);
      await as(receptionist)
        .post(`/patients/${patient.id}/referrals`, {
          referringDoctorId: doc.body.id,
          commission: { type: 'NONE' },
          discount: { type: 'NONE' },
          applicability: { type: 'ALL_SESSIONS' },
        })
        .expect(201);
      const source = (await sources()).sources[0];
      const res = await as(receptionist)
        .post(`/acquisition-sources/${source.id}/remove`, { reason: 'Mistake' })
        .expect(422);
      expect(res.body.code).toBe('SOURCE_IN_USE');
    });

    it('a doctor referral picked from the list can be the primary source (new or already recorded)', async () => {
      const doc = await as(owner)
        .post('/referring-doctors', {
          name: 'Dr. Hany',
          commission: { type: 'NONE' },
          discount: { type: 'NONE' },
        })
        .expect(201);
      const refer = (who: Patient) =>
        as(receptionist)
          .post(`/patients/${who.id}/referrals`, {
            referringDoctorId: doc.body.id,
            commission: { type: 'NONE' },
            discount: { type: 'NONE' },
            applicability: { type: 'ALL_SESSIONS' },
            primarySource: true,
          })
          .expect(201);

      // New source.
      await addSource({ channel: 'FACEBOOK' }).expect(201);
      await refer(patient);
      expect(
        (await sources()).sources.map((s) => [
          s.channel,
          s.isPrimary,
          s.details,
        ]),
      ).toEqual([
        ['DOCTOR_REFERRAL', true, 'Dr. Hany'],
        ['FACEBOOK', false, null],
      ]);

      // Already recorded (not primary): it becomes primary, no second row.
      const other = await insertPatient(
        ctx.dataSource,
        'Mona',
        '+201000000002',
      );
      await addSource({ channel: 'INSTAGRAM' }, other).expect(201);
      await addSource({ channel: 'DOCTOR_REFERRAL' }, other).expect(201);
      await refer(other);
      expect(
        (await sources(other)).sources.map((s) => [s.channel, s.isPrimary]),
      ).toEqual([
        ['DOCTOR_REFERRAL', true],
        ['INSTAGRAM', false],
      ]);
    });

    it('unknown patient or source: 404', async () => {
      await as(receptionist)
        .get('/patients/00000000-0000-4000-8000-000000000000/acquisition')
        .expect(404);
      await as(receptionist)
        .patch('/acquisition-sources/00000000-0000-4000-8000-000000000000', {
          details: 'x',
        })
        .expect(404);
    });
  });

  // ---------- utm ----------

  describe('campaign tags of online bookings', () => {
    it('are stored on the booking and shown apart; they never create sources', async () => {
      const res = await book({ utm: UTM }).expect(201);
      const stored = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: res.body.referenceCode });
      expect(stored).toMatchObject({
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'back-pain-nov',
        utmContent: 'video',
        utmTerm: 'physio cairo',
      });
      const online = { id: stored.patientId } as Patient;
      const view = await sources(online);
      expect(view.sources).toEqual([]);
      expect(view.campaignBookings).toEqual([
        expect.objectContaining({
          referenceCode: res.body.referenceCode,
          utm: UTM,
        }),
      ]);
    });

    it('blank tags are dropped, long ones refused; no tags means none stored', async () => {
      await book({ utm: { source: 'x'.repeat(101) } }).expect(400);
      const res = await book({ utm: { source: '  ', campaign: 'nov' } }).expect(
        201,
      );
      const stored = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: res.body.referenceCode });
      expect(stored).toMatchObject({ utmSource: null, utmCampaign: 'nov' });

      const plain = await book({
        phone: '01088888888',
        startAt: '2026-11-04T11:00:00+02:00',
      }).expect(201);
      expect(
        await ctx.dataSource
          .getRepository(Appointment)
          .findOneByOrFail({ referenceCode: plain.body.referenceCode }),
      ).toMatchObject({ utmSource: null, utmCampaign: null });
    });

    it('a reschedule keeps the tags', async () => {
      const res = await book({ utm: UTM }).expect(201);
      const old = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: res.body.referenceCode });
      const moved = await as(receptionist)
        .post(`/appointments/${old.id}/reschedule`, {
          startAt: '2026-11-04T12:00:00+02:00',
        })
        .expect(201);
      expect(
        await ctx.dataSource
          .getRepository(Appointment)
          .findOneByOrFail({ id: moved.body.id }),
      ).toMatchObject({ utmSource: 'facebook', utmCampaign: 'back-pain-nov' });
    });
  });

  // ---------- reports ----------

  describe('reports (OWNER)', () => {
    it('new patients by primary source, with who attended and paid', async () => {
      const ahmed = await insertPatient(
        ctx.dataSource,
        'Ahmed',
        '+201000000002',
      );
      const mona = await insertPatient(ctx.dataSource, 'Mona', '+201000000003');
      const old = await insertPatient(ctx.dataSource, 'Old', '+201000000004');
      for (const who of [patient, ahmed, mona]) {
        await createdOn(who, '2026-11-03T08:00:00+02:00');
      }
      await createdOn(old, '2026-10-15T08:00:00+02:00');

      await addSource({ channel: 'FACEBOOK' }).expect(201);
      await addSource({ channel: 'INSTAGRAM' }).expect(201);
      await addSource({ channel: 'GOOGLE_ADS' }, ahmed).expect(201);
      await addSource({ channel: 'FACEBOOK' }, old).expect(201);
      // mona: no source.

      const visit = await as(receptionist)
        .post('/visits/walk-in', { patientId: patient.id, doctorId, serviceId })
        .expect(201);
      await as(receptionist)
        .post(`/invoices/${visit.body.invoiceId}/payments`, {
          amount: '300.00',
          method: 'CASH',
        })
        .expect(201);

      const res = await as(owner)
        .get(`/reports/acquisition${RANGE}`)
        .expect(200);
      expect(res.body).toMatchObject({
        from: '2026-11-01',
        to: '2026-11-30',
        newPatients: 3,
        withoutSource: 1,
      });
      expect(res.body.channels).toEqual([
        {
          channel: 'FACEBOOK',
          category: 'SOCIAL_MEDIA',
          patients: 1,
          mentions: 1,
          attendedPatients: 1,
          payingPatients: 1,
          collected: '300.00',
        },
        {
          channel: 'GOOGLE_ADS',
          category: 'ADVERTISING',
          patients: 1,
          mentions: 1,
          attendedPatients: 0,
          payingPatients: 0,
          collected: '0.00',
        },
        {
          channel: 'INSTAGRAM',
          category: 'SOCIAL_MEDIA',
          patients: 0,
          mentions: 1,
          attendedPatients: 0,
          payingPatients: 0,
          collected: '0.00',
        },
      ]);
      expect(res.body.byMonth).toEqual(
        expect.arrayContaining([
          { month: '2026-11', channel: 'FACEBOOK', patients: 1 },
          { month: '2026-11', channel: 'GOOGLE_ADS', patients: 1 },
          { month: '2026-11', channel: null, patients: 1 },
        ]),
      );

      const facebook = await as(owner)
        .get(`/reports/acquisition${RANGE}&channel=FACEBOOK`)
        .expect(200);
      expect(facebook.body.channels.map((c: Source) => c.channel)).toEqual([
        'FACEBOOK',
      ]);
    });

    it('campaigns: bookings, attended, new and paying patients, money', async () => {
      const first = await book({ utm: UTM }).expect(201);
      await book({
        utm: UTM,
        phone: '01088888888',
        startAt: '2026-11-04T11:00:00+02:00',
      }).expect(201);
      await book({
        utm: { source: 'google', campaign: 'brand' },
        phone: '01077777777',
        startAt: '2026-11-04T12:00:00+02:00',
      }).expect(201);

      // The first booking attends and pays the next day.
      clock.current = local('10:30', '2026-11-04');
      const appointment = await ctx.dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ referenceCode: first.body.referenceCode });
      const attended = await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`)
        .expect(201);
      await as(receptionist)
        .post(`/invoices/${attended.body.invoiceId}/payments`, {
          amount: '300.00',
          method: 'CASH',
        })
        .expect(201);

      const res = await as(owner).get(`/reports/campaigns${RANGE}`).expect(200);
      expect(res.body.rows).toEqual([
        {
          source: 'facebook',
          medium: 'cpc',
          campaign: 'back-pain-nov',
          bookings: 2,
          attended: 1,
          patients: 2,
          newPatients: 2,
          payingPatients: 1,
          collected: '300.00',
        },
        {
          source: 'google',
          medium: null,
          campaign: 'brand',
          bookings: 1,
          attended: 0,
          patients: 1,
          newPatients: 1,
          payingPatients: 0,
          collected: '0.00',
        },
      ]);
    });

    it('a booking by a patient the clinic already knew is not a new patient', async () => {
      await book({ utm: UTM, phone: '01000000001' }).expect(201);
      const res = await as(owner).get(`/reports/campaigns${RANGE}`).expect(200);
      expect(res.body.rows[0]).toMatchObject({ patients: 1, newPatients: 0 });
    });

    it('`from` after `to` is 400', async () => {
      await as(owner)
        .get('/reports/acquisition?from=2026-11-30&to=2026-11-01')
        .expect(400);
    });
  });
});
