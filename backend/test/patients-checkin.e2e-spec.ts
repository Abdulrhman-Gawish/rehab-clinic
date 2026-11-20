import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { CLOCK } from '../src/common/time/clinic-time.service.js';
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

// Frozen clock: today is Friday 2026-11-20 in Cairo (+02:00).
const TODAY = '2026-11-20';
const local = (time: string) => new Date(`${TODAY}T${time}:00+02:00`);
const clock = { current: local('10:00') };

/**
 * An Egyptian National ID: century (2 = 1900s), YYMMDD, governorate 01, a
 * 4-digit sequence (its last digit odd = male, even = female), check digit.
 */
const nid = (yymmdd: string, sequence: string, century = '2') =>
  `${century}${yymmdd}01${sequence}1`;

type DoctorUser = TestUser & { doctorId: string };

describe('Patient identity and check-in details (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctor: DoctorUser;
  let serviceId: string;
  let phone = 0;

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(CLOCK).useValue({ now: () => clock.current }),
    );
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    clock.current = local('10:00');
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    receptionist = await createLoggedInUser(
      ctx.app,
      ctx.dataSource,
      UserRole.RECEPTIONIST,
    );
    doctor = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (
      await insertService(ctx.dataSource, { name: 'Physio', basePrice: '300' })
    ).id;
    await assignService(ctx.dataSource, doctor.doctorId, serviceId);
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
    patch: (path: string, body: object) =>
      request(server)
        .patch(`/api/v1${path}`)
        .set('Authorization', bearer(user))
        .send(body),
  });
  const nextPhone = () => {
    phone += 1;
    return `0101${String(phone).padStart(7, '0')}`;
  };
  const register = (body: object, by: TestUser = receptionist) =>
    as(by).post('/patients', {
      name: `Patient ${phone + 1}`,
      phone: nextPhone(),
      ...body,
    });
  const sources = async (patientId: string) =>
    (
      await as(receptionist)
        .get(`/patients/${patientId}/acquisition`)
        .expect(200)
    ).body.sources as { channel: string; isPrimary: boolean }[];

  // ---------- patient code ----------

  describe('patient code', () => {
    it('RH + the first 4 digits of the National ID + a sequence per those digits; birth date and gender from the ID', async () => {
      const first = await register({
        nationalId: nid('900101', '0123'),
      }).expect(201);
      expect(first.body).toMatchObject({
        patientCode: 'RH29000001',
        nationalId: '29001010101231',
        passportNumber: null,
        dateOfBirth: '1990-01-01',
        gender: 'MALE', // ...3: odd
      });
      const second = await register({
        nationalId: nid('900215', '0124'),
      }).expect(201);
      expect(second.body).toMatchObject({
        patientCode: 'RH29000002',
        dateOfBirth: '1990-02-15',
        gender: 'FEMALE',
      });
      // Another prefix starts at 0001.
      const other = await register({
        nationalId: nid('051231', '0335', '3'),
      }).expect(201);
      expect(other.body.patientCode).toBe('RH30510001');
      // A passport (non-Egyptian): 0000 digits.
      const visitor = await register({
        passportNumber: ' a12-345 678 ',
        gender: 'FEMALE',
        dateOfBirth: '1980-03-03',
      }).expect(201);
      expect(visitor.body).toMatchObject({
        patientCode: 'RH00000001',
        passportNumber: 'A12345678',
        nationalId: null,
      });
      // No identity document yet: no code.
      const plain = await register({ gender: 'MALE' }).expect(201);
      expect(plain.body.patientCode).toBeNull();
    });

    it('Arabic digits, spaces and dashes in a National ID are accepted', async () => {
      const res = await register({
        nationalId: '٢٩٠ ٠١٠١-٠١٠١٢٣١',
      }).expect(201);
      expect(res.body).toMatchObject({
        nationalId: '29001010101231',
        patientCode: 'RH29000001',
      });
    });

    it('concurrent registrations get distinct, consecutive codes', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          register({
            nationalId: nid('900101', String(1000 + i).padStart(4, '0')),
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
      const codes = results.map((r) => r.body.patientCode as string).sort();
      expect(codes).toEqual(
        Array.from(
          { length: 12 },
          (_, i) => `RH2900${String(i + 1).padStart(4, '0')}`,
        ),
      );
      const [counter] = await ctx.dataSource.query(
        `SELECT last_value FROM patient_code_counters WHERE prefix = '2900'`,
      );
      expect(counter.last_value).toBe(12);
    });

    it('a registration refused after its code was drawn gives the number back (no gap)', async () => {
      const first = await register({
        nationalId: nid('900101', '0123'),
      }).expect(201);
      // Same phone: the code RH29000002 is drawn, then the insert fails on
      // the phone and the whole transaction (counter included) rolls back.
      await as(receptionist)
        .post('/patients', {
          name: 'Same Phone',
          phone: first.body.phone,
          nationalId: nid('900102', '0125'),
        })
        .expect(409);
      const next = await register({ nationalId: nid('900102', '0125') }).expect(
        201,
      );
      expect(next.body.patientCode).toBe('RH29000002');
    });

    it('9999 codes per prefix, then 422 PATIENT_CODE_EXHAUSTED (nothing saved)', async () => {
      await ctx.dataSource.query(
        `INSERT INTO patient_code_counters (prefix, last_value) VALUES ('2900', 9998)`,
      );
      const last = await register({ nationalId: nid('900101', '0123') }).expect(
        201,
      );
      expect(last.body.patientCode).toBe('RH29009999');
      const number = nextPhone();
      const res = await as(receptionist)
        .post('/patients', {
          name: 'Too Many',
          phone: number,
          nationalId: nid('900102', '0125'),
        })
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'PATIENT_CODE_EXHAUSTED',
        details: { digits: '2900' },
      });
      const found = await as(receptionist)
        .get(`/patients/lookup?phone=${number}`)
        .expect(200);
      expect(found.body.patient).toBeNull();
      // Other prefixes are not affected.
      await register({ nationalId: nid('910101', '0123') }).expect(201);
    });

    it('the code never changes; only the owner can change the identity document once there is one', async () => {
      const created = await register({}).expect(201);
      const id = created.body.id as string;
      // Reception records the first document: the code is assigned.
      const set = await as(receptionist)
        .patch(`/patients/${id}`, { nationalId: nid('900101', '0123') })
        .expect(200);
      expect(set.body.patientCode).toBe('RH29000001');

      const locked = await as(receptionist)
        .patch(`/patients/${id}`, { nationalId: nid('850505', '0123') })
        .expect(403);
      expect(locked.body).toMatchObject({
        code: 'PATIENT_IDENTITY_LOCKED',
        details: { patientCode: 'RH29000001' },
      });
      await as(receptionist)
        .patch(`/patients/${id}`, { passportNumber: 'B7654321' })
        .expect(403);
      // The same value again is not a change.
      await as(receptionist)
        .patch(`/patients/${id}`, {
          nationalId: nid('900101', '0123'),
          notes: 'Prefers mornings',
        })
        .expect(200);

      // The owner corrects it (birth date with it): the code stays.
      const corrected = await as(owner)
        .patch(`/patients/${id}`, {
          nationalId: nid('850505', '0123'),
          dateOfBirth: '1985-05-05',
        })
        .expect(200);
      expect(corrected.body).toMatchObject({
        nationalId: nid('850505', '0123'),
        dateOfBirth: '1985-05-05',
        patientCode: 'RH29000001',
      });
    });
  });

  // ---------- validation ----------

  describe('validation', () => {
    it('rejects malformed documents (400), impossible National IDs (422) and two documents at once', async () => {
      for (const nationalId of ['2900101010123', '290010101012311', 'abc']) {
        await register({ nationalId }).expect(400);
      }
      for (const passportNumber of [
        'AB1',
        'A1234567890123456789X',
        'A#12345',
      ]) {
        await register({ passportNumber }).expect(400);
      }
      for (const nationalId of [
        '19001010101231', // century 1
        '29013010101231', // month 13
        '29002300101231', // 30 February
        '32701010101231', // born in 2027
      ]) {
        const res = await register({ nationalId }).expect(422);
        expect(res.body.code).toBe('NATIONAL_ID_INVALID');
      }
      await register({
        nationalId: nid('900101', '0123'),
        passportNumber: 'A1234567',
      }).expect(400);
    });

    it('the birth date and gender must match the National ID', async () => {
      const dob = await register({
        nationalId: nid('900101', '0123'),
        dateOfBirth: '1990-01-02',
      }).expect(422);
      expect(dob.body).toMatchObject({
        code: 'NATIONAL_ID_MISMATCH',
        details: { field: 'dateOfBirth', expected: '1990-01-01' },
      });
      const gender = await register({
        nationalId: nid('900101', '0123'),
        gender: 'FEMALE',
      }).expect(422);
      expect(gender.body).toMatchObject({
        code: 'NATIONAL_ID_MISMATCH',
        details: { field: 'gender', expected: 'MALE' },
      });
      // A later edit of the birth date alone is checked too.
      const ok = await register({ nationalId: nid('900101', '0123') }).expect(
        201,
      );
      await as(receptionist)
        .patch(`/patients/${ok.body.id}`, { dateOfBirth: '1991-01-01' })
        .expect(422);
    });

    it('a birth date or gender typed before the National ID is replaced by what the ID states', async () => {
      const typed = await register({
        dateOfBirth: '1995-06-06',
        gender: 'FEMALE',
      }).expect(201);
      const withId = await as(receptionist)
        .patch(`/patients/${typed.body.id}`, {
          nationalId: nid('900101', '0123'),
        })
        .expect(200);
      expect(withId.body).toMatchObject({
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
        patientCode: 'RH29000001',
      });
    });

    it('one National ID or passport per patient (409 ID_DOCUMENT_TAKEN)', async () => {
      const first = await register({
        nationalId: nid('900101', '0123'),
      }).expect(201);
      const twice = await register({
        nationalId: nid('900101', '0123'),
      }).expect(409);
      expect(twice.body).toMatchObject({
        code: 'ID_DOCUMENT_TAKEN',
        details: { patientId: first.body.id, field: 'nationalId' },
      });
      const visitor = await register({ passportNumber: 'A1234567' }).expect(
        201,
      );
      const other = await register({}).expect(201);
      const taken = await as(receptionist)
        .patch(`/patients/${other.body.id}`, { passportNumber: 'a1234567' })
        .expect(409);
      expect(taken.body.details).toEqual({
        patientId: visitor.body.id,
        field: 'passportNumber',
      });

      // Two at once: one wins, the other is refused.
      const race = await Promise.all(
        [1, 2].map(() => register({ nationalId: nid('920202', '0456') })),
      );
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  // ---------- reading ----------

  describe('reading and search', () => {
    it('a doctor sees the code but not the identity document, and cannot search by it', async () => {
      const created = await register({
        nationalId: nid('900101', '0123'),
      }).expect(201);
      const asDoctor = await as(doctor)
        .get(`/patients/${created.body.id}`)
        .expect(200);
      expect(asDoctor.body).toMatchObject({
        patientCode: 'RH29000001',
        nationalId: null,
        passportNumber: null,
      });
      const byId = await as(doctor)
        .get(`/patients?search=${nid('900101', '0123')}`)
        .expect(200);
      expect(byId.body.items).toEqual([]);
      const byCode = await as(doctor)
        .get('/patients?search=rh29000001')
        .expect(200);
      expect(byCode.body.items.map((p: { id: string }) => p.id)).toEqual([
        created.body.id,
      ]);

      for (const search of ['RH29000001', nid('900101', '0123')]) {
        const res = await as(receptionist)
          .get(`/patients?search=${search}`)
          .expect(200);
        expect(res.body.items[0]).toMatchObject({
          id: created.body.id,
          nationalId: nid('900101', '0123'),
        });
      }
    });

    it('doctors cannot write patients', async () => {
      const created = await register({}).expect(201);
      await as(doctor)
        .patch(`/patients/${created.body.id}`, {
          nationalId: nid('900101', '0123'),
        })
        .expect(403);
    });
  });

  // ---------- check-in ----------

  describe('check-in requires the details', () => {
    const DETAILS = {
      nationalId: nid('900101', '0123'),
      notes: 'Comes with his son',
      referralSource: { channel: 'FACEBOOK', details: 'Clinic page' },
    };

    const appointmentFor = async (patientId: string) =>
      insertAppointment(ctx.dataSource, {
        patientId,
        doctorId: doctor.doctorId,
        serviceId,
        startAt: local('11:00'),
      });

    it('attend: 422 PATIENT_DETAILS_REQUIRED listing what is missing; nothing changes', async () => {
      const patient = await insertPatient(
        ctx.dataSource,
        'Ali',
        '+201011111111',
      );
      const appointment = await appointmentFor(patient.id);
      const res = await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`)
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'PATIENT_DETAILS_REQUIRED',
        details: {
          patientId: patient.id,
          missing: [
            'identityDocument',
            'gender',
            'dateOfBirth',
            'referralSource',
          ],
        },
      });
      // Partly given: still refused, and the partial details are not saved.
      const partial = await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`, {
          patientDetails: { passportNumber: 'A1234567' },
        })
        .expect(422);
      expect(partial.body.details.missing).toEqual([
        'gender',
        'dateOfBirth',
        'referralSource',
      ]);
      const unchanged = await as(receptionist)
        .get(`/patients/${patient.id}`)
        .expect(200);
      expect(unchanged.body).toMatchObject({
        passportNumber: null,
        patientCode: null,
      });
      const day = await as(receptionist)
        .get(`/appointments/day?date=${TODAY}`)
        .expect(200);
      expect(day.body[0]).toMatchObject({ status: 'CONFIRMED', visitId: null });
    });

    it('attend with the details: saved on the patient (code, notes, primary source), then the visit', async () => {
      const patient = await insertPatient(
        ctx.dataSource,
        'Ali',
        '+201011111111',
      );
      const appointment = await appointmentFor(patient.id);
      await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`, {
          patientDetails: DETAILS,
        })
        .expect(201);
      const saved = await as(receptionist)
        .get(`/patients/${patient.id}`)
        .expect(200);
      expect(saved.body).toMatchObject({
        patientCode: 'RH29000001',
        nationalId: DETAILS.nationalId,
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
        notes: 'Comes with his son',
      });
      expect(await sources(patient.id)).toMatchObject([
        { channel: 'FACEBOOK', isPrimary: true },
      ]);

      // A complete patient checks in with nothing more.
      clock.current = local('16:00');
      const later = await insertAppointment(ctx.dataSource, {
        patientId: patient.id,
        doctorId: doctor.doctorId,
        serviceId,
        startAt: local('16:00'),
      });
      await as(receptionist)
        .post(`/appointments/${later.id}/attend`)
        .expect(201);
    });

    it('a referral source given for a patient who has one is added, not made primary', async () => {
      const patient = await insertPatient(
        ctx.dataSource,
        'Ali',
        '+201011111111',
      );
      await as(receptionist)
        .post(`/patients/${patient.id}/acquisition-sources`, {
          channel: 'GOOGLE',
        })
        .expect(201);
      const appointment = await appointmentFor(patient.id);
      await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`, {
          patientDetails: DETAILS,
        })
        .expect(201);
      expect(
        (await sources(patient.id)).map((s) => [s.channel, s.isPrimary]),
      ).toEqual([
        ['GOOGLE', true],
        ['FACEBOOK', false],
      ]);
    });

    it('walk-in of a new patient: refused without details (the patient is not created), accepted with them', async () => {
      const body = {
        name: 'New Person',
        phone: '01555555555',
        doctorId: doctor.doctorId,
        serviceId,
        type: 'EXAMINATION',
      };
      const refused = await as(receptionist)
        .post('/visits/walk-in', body)
        .expect(422);
      expect(refused.body).toMatchObject({
        code: 'PATIENT_DETAILS_REQUIRED',
        details: { patientId: null },
      });
      const none = await as(receptionist)
        .get('/patients/lookup?phone=01555555555')
        .expect(200);
      expect(none.body.patient).toBeNull();

      // A doctor referral is not a desk channel (it has a referring doctor).
      await as(receptionist)
        .post('/visits/walk-in', {
          ...body,
          patientDetails: {
            ...DETAILS,
            referralSource: { channel: 'DOCTOR_REFERRAL' },
          },
        })
        .expect(400);
      // Invalid details: refused too, nothing created.
      await as(receptionist)
        .post('/visits/walk-in', {
          ...body,
          patientDetails: { ...DETAILS, gender: 'FEMALE' },
        })
        .expect(422);

      const visit = await as(receptionist)
        .post('/visits/walk-in', {
          ...body,
          patientDetails: {
            passportNumber: 'X9876543',
            gender: 'FEMALE',
            dateOfBirth: '1979-09-09',
            referralSource: { channel: 'FRIENDS_FAMILY' },
          },
        })
        .expect(201);
      const created = await as(receptionist)
        .get(`/patients/${visit.body.patient.id}`)
        .expect(200);
      expect(created.body).toMatchObject({
        patientCode: 'RH00000001',
        passportNumber: 'X9876543',
        gender: 'FEMALE',
        dateOfBirth: '1979-09-09',
      });
    });

    describe('referred by a doctor', () => {
      const PCT = (value: string) => ({ type: 'PERCENT', value });
      const referringDoctor = async () =>
        (
          await as(owner)
            .post('/referring-doctors', {
              name: 'Dr. Hany Samir',
              commission: PCT('10'),
              discount: PCT('10'),
            })
            .expect(201)
        ).body.id as string;
      const referralBody = (referringDoctorId: string, over: object = {}) => ({
        referringDoctorId,
        commission: PCT('10'),
        discount: PCT('10'),
        applicability: { type: 'ALL_SESSIONS' },
        ...over,
      });
      const activeReferrals = async (patientId: string) =>
        Number(
          (
            await ctx.dataSource.query(
              `SELECT count(*) AS n FROM patient_referrals WHERE patient_id = $1 AND status = 'ACTIVE'`,
              [patientId],
            )
          )[0].n,
        );

      it('the referral is recorded with its terms at check-in: it is the source, and this session is covered', async () => {
        const doctorId = await referringDoctor();
        const patient = await insertPatient(
          ctx.dataSource,
          'Ali',
          '+201011111111',
        );
        const appointment = await appointmentFor(patient.id);
        const res = await as(receptionist)
          .post(`/appointments/${appointment.id}/attend`, {
            patientDetails: {
              nationalId: nid('900101', '0123'),
              referral: referralBody(doctorId),
            },
          })
          .expect(201);
        // 300 - the referral's 10%, on this very first session.
        const invoice = await as(receptionist)
          .get(`/invoices/${res.body.invoiceId}`)
          .expect(200);
        expect(invoice.body).toMatchObject({
          total: '270.00',
          referral: { termsVersion: 1 },
        });
        expect(await sources(patient.id)).toMatchObject([
          { channel: 'DOCTOR_REFERRAL', isPrimary: true },
        ]);
        expect(await activeReferrals(patient.id)).toBe(1);
      });

      it('a walk-in of a new patient referred by a doctor', async () => {
        const doctorId = await referringDoctor();
        const visit = await as(receptionist)
          .post('/visits/walk-in', {
            name: 'New Person',
            phone: '01555555555',
            doctorId: doctor.doctorId,
            serviceId,
            type: 'EXAMINATION',
            patientDetails: {
              passportNumber: 'X9876543',
              gender: 'MALE',
              dateOfBirth: '1979-09-09',
              referral: referralBody(doctorId),
            },
          })
          .expect(201);
        expect(await activeReferrals(visit.body.patient.id)).toBe(1);
        const invoice = await as(receptionist)
          .get(`/invoices/${visit.body.invoiceId}`)
          .expect(200);
        expect(invoice.body.total).toBe('270.00');
      });

      it('a refused referral saves nothing (other terms than the doctor’s need a reason)', async () => {
        const doctorId = await referringDoctor();
        const patient = await insertPatient(
          ctx.dataSource,
          'Ali',
          '+201011111111',
        );
        const appointment = await appointmentFor(patient.id);
        const res = await as(receptionist)
          .post(`/appointments/${appointment.id}/attend`, {
            patientDetails: {
              nationalId: nid('900101', '0123'),
              referral: referralBody(doctorId, { discount: PCT('5') }),
            },
          })
          .expect(422);
        expect(res.body.code).toBe('OVERRIDE_REASON_REQUIRED');
        expect(await activeReferrals(patient.id)).toBe(0);
        expect(await sources(patient.id)).toEqual([]);
        const unchanged = await as(receptionist)
          .get(`/patients/${patient.id}`)
          .expect(200);
        expect(unchanged.body).toMatchObject({
          nationalId: null,
          patientCode: null,
        });
        // With the reason: accepted.
        await as(receptionist)
          .post(`/appointments/${appointment.id}/attend`, {
            patientDetails: {
              nationalId: nid('900101', '0123'),
              referral: referralBody(doctorId, {
                discount: PCT('5'),
                overrideReason: 'Agreed with the doctor',
              }),
            },
          })
          .expect(201);
      });

      it('a patient who already has an active referral: 409 REFERRAL_ALREADY_ACTIVE', async () => {
        const doctorId = await referringDoctor();
        const patient = await insertPatient(
          ctx.dataSource,
          'Ali',
          '+201011111111',
        );
        await as(receptionist)
          .post(`/patients/${patient.id}/referrals`, referralBody(doctorId))
          .expect(201);
        const appointment = await appointmentFor(patient.id);
        const res = await as(receptionist)
          .post(`/appointments/${appointment.id}/attend`, {
            patientDetails: {
              nationalId: nid('900101', '0123'),
              referral: referralBody(doctorId),
            },
          })
          .expect(409);
        expect(res.body.code).toBe('REFERRAL_ALREADY_ACTIVE');
      });
    });

    it('a receptionist cannot replace the identity document at check-in once there is a code', async () => {
      const created = await register({
        nationalId: nid('900101', '0123'),
      }).expect(201);
      const appointment = await appointmentFor(created.body.id);
      const res = await as(receptionist)
        .post(`/appointments/${appointment.id}/attend`, {
          patientDetails: {
            nationalId: nid('850505', '0123'),
            referralSource: { channel: 'OTHER' },
          },
        })
        .expect(403);
      expect(res.body.code).toBe('PATIENT_IDENTITY_LOCKED');
    });
  });
});
