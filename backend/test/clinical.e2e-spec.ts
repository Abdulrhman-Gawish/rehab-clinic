import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { AppointmentStatus } from '../src/modules/appointments/appointment.enums.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { ClinicalNote } from '../src/modules/clinical/entities/clinical-note.entity.js';
import type { Patient } from '../src/modules/patients/entities/patient.entity.js';
import type { Visit } from '../src/modules/visits/entities/visit.entity.js';
import { VisitStatus } from '../src/modules/visits/visit.enums.js';
import {
  bearer,
  createLoggedInUser,
  type TestUser,
} from './utils/auth-helpers.js';
import {
  createLoggedInDoctor,
  insertAppointment,
  insertPatient,
  insertService,
  insertVisit,
} from './utils/factories.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Uploaded files go to a throw-away folder (git-ignored).
vi.hoisted(() => {
  process.env.STORAGE_LOCAL_PATH = '.tmp/e2e-storage';
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake x-ray'),
]);
const PDF = Buffer.from('%PDF-1.4\nlab report', 'ascii');

type DoctorUser = TestUser & { doctorId: string };

describe('Clinical records (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  // doctorA treats the patient (ACTIVE visit); doctorB only had a
  // cancelled appointment with them; doctorC has never met them.
  let doctorA: DoctorUser;
  let doctorB: DoctorUser;
  let doctorC: DoctorUser;
  let serviceId: string;
  let patient: Patient;
  let visit: Visit;

  const as = (user: TestUser) => ({ Authorization: bearer(user) });
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
    doctorA = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorB = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    doctorC = await createLoggedInDoctor(ctx.app, ctx.dataSource);
    serviceId = (await insertService(ctx.dataSource, { name: 'Physio' })).id;
    patient = await insertPatient(ctx.dataSource, 'Mona Adel', '+201000000001');
    visit = await newVisit(doctorA, VisitStatus.ACTIVE);
    await insertAppointment(ctx.dataSource, {
      patientId: patient.id,
      doctorId: doctorB.doctorId,
      serviceId,
      startAt: new Date('2026-10-01T10:00:00Z'),
      status: AppointmentStatus.CANCELLED,
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // ---------- helpers ----------

  function newVisit(
    doctor: DoctorUser,
    status: VisitStatus,
    attendedAt?: Date,
    patientId = patient.id,
  ): Promise<Visit> {
    return insertVisit(ctx.dataSource, {
      patientId,
      doctorId: doctor.doctorId,
      serviceId,
      attendedById: owner.id,
      status,
      attendedAt,
    });
  }

  // PUT saves the draft: created on the first save, replaced after.
  const writeNote = (visitId: string, by: TestUser, body: object = {}) =>
    request(server)
      .put(api(`/visits/${visitId}/note`))
      .set(as(by))
      .send(body);

  const sign = (visitId: string, by: TestUser, body?: object) => {
    const req = request(server)
      .post(api(`/visits/${visitId}/note/sign`))
      .set(as(by));
    return body ? req.send(body) : req;
  };

  const readNote = (visitId: string, by: TestUser) =>
    request(server)
      .get(api(`/visits/${visitId}/note`))
      .set(as(by));

  const addAddendum = (noteId: string, by: TestUser, content: string) =>
    request(server)
      .post(api(`/clinical-notes/${noteId}/addenda`))
      .set(as(by))
      .send({ content });

  async function signedNote(visitId: string, by: DoctorUser, text: string) {
    await writeNote(visitId, by, { assessment: text }).expect(200);
    return (await sign(visitId, by).expect(200)).body as {
      id: string;
      status: string;
    };
  }

  const upload = (
    by: TestUser,
    content: Buffer,
    name: string,
    fields: Record<string, string> = { title: 'Knee X-ray' },
    patientId = patient.id,
  ) => {
    const req = request(server)
      .post(api(`/patients/${patientId}/attachments`))
      .set(as(by));
    for (const [key, value] of Object.entries(fields)) req.field(key, value);
    return req.attach('file', content, name);
  };

  const download = (attachmentId: string, by: TestUser) =>
    request(server)
      .get(api(`/attachments/${attachmentId}/file`))
      .set(as(by))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  // ---------- notes ----------

  describe('notes', () => {
    it("the visit's doctor writes a draft, edits it and signs it (audited)", async () => {
      const created = await writeNote(visit.id, doctorA, {
        chiefComplaint: 'Knee pain',
        painScore: 7,
      }).expect(200);
      expect(created.body).toMatchObject({
        patientId: patient.id,
        visit: { id: visit.id, service: { id: serviceId, name: 'Physio' } },
        doctor: { id: doctorA.doctorId },
        chiefComplaint: 'Knee pain',
        painScore: 7,
        assessment: null,
        status: 'DRAFT',
        signedAt: null,
        addenda: [],
      });

      // The whole draft is sent each time; painScore left out -> null.
      const edited = await writeNote(visit.id, doctorA, {
        chiefComplaint: 'Knee pain',
        assessment: 'Patellar tendinopathy',
        treatmentDone: 'Ultrasound, 10 min',
        plan: 'Eccentric squats daily',
      }).expect(200);
      expect(edited.body.id).toBe(created.body.id);
      const signed = await sign(visit.id, doctorA).expect(200);
      expect(signed.body).toMatchObject({
        chiefComplaint: 'Knee pain',
        assessment: 'Patellar tendinopathy',
        painScore: null,
        status: 'SIGNED',
        signedAt: expect.any(String),
      });

      const actions = (
        await ctx.dataSource.getRepository(AuditLog).find({
          where: { entityId: created.body.id },
          order: { createdAt: 'ASC' },
        })
      ).map((log) => log.action);
      expect(actions).toEqual([
        'CLINICAL_NOTE_CREATED',
        'CLINICAL_NOTE_UPDATED',
        'CLINICAL_NOTE_SIGNED',
      ]);
    });

    it('only on ACTIVE visits, any day after the visit', async () => {
      const other = await insertPatient(ctx.dataSource, 'Ali', '+201000000002');
      const voided = await newVisit(
        doctorC,
        VisitStatus.VOIDED,
        undefined,
        other.id,
      );
      const res = await writeNote(voided.id, doctorC).expect(422);
      expect(res.body.code).toBe('NOTE_NOT_ALLOWED');

      const lastWeek = await newVisit(
        doctorC,
        VisitStatus.ACTIVE,
        new Date(Date.now() - 7 * 24 * 3600_000),
        other.id,
      );
      await writeNote(lastWeek.id, doctorC).expect(200);
    });

    it("only the visit's doctor writes its note (others get 404)", async () => {
      await writeNote(visit.id, doctorB).expect(404);
      await writeNote(visit.id, doctorA, { assessment: 'x' }).expect(200);
      await writeNote(visit.id, doctorB, { assessment: 'hacked' }).expect(404);
      await sign(visit.id, doctorB).expect(404);
    });

    it('one note per visit: parallel first saves create exactly one', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          writeNote(visit.id, doctorA, { assessment: `Version ${i}` }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(
        await ctx.dataSource
          .getRepository(ClinicalNote)
          .countBy({ visitId: visit.id }),
      ).toBe(1);
    });

    it('blank text clears a field (cleared textarea -> null)', async () => {
      await writeNote(visit.id, doctorA, {
        assessment: 'Sprain',
        plan: 'Rest',
      }).expect(200);
      const cleared = await writeNote(visit.id, doctorA, {
        assessment: '  Sprain  ',
        plan: '   ',
        progress: '',
      }).expect(200);
      expect(cleared.body).toMatchObject({
        assessment: 'Sprain',
        plan: null,
        progress: null,
      });
    });

    it('sign can save the final fields in the same call', async () => {
      const noNote = await sign(visit.id, doctorA).expect(422);
      expect(noNote.body.code).toBe('NOTE_INCOMPLETE');

      const signed = await sign(visit.id, doctorA, {
        assessment: 'Final assessment',
        painScore: 3,
      }).expect(200);
      expect(signed.body).toMatchObject({
        assessment: 'Final assessment',
        painScore: 3,
        status: 'SIGNED',
      });
      const actions = (
        await ctx.dataSource.getRepository(AuditLog).find({
          where: { entityId: signed.body.id },
          order: { createdAt: 'ASC' },
        })
      ).map((log) => log.action);
      expect(actions).toEqual([
        'CLINICAL_NOTE_CREATED',
        'CLINICAL_NOTE_SIGNED',
      ]);
      // Nothing is saved when the fields can't be signed.
      const other = await newVisit(doctorA, VisitStatus.ACTIVE);
      await sign(other.id, doctorA, { plan: 'Only a plan' }).expect(422);
      await readNote(other.id, doctorA)
        .expect(200)
        .expect(({ body }) => expect(body).toBeNull());
    });

    it('signing needs an assessment or the treatment done', async () => {
      await writeNote(visit.id, doctorA, {
        chiefComplaint: 'Back pain',
      }).expect(200);
      const res = await sign(visit.id, doctorA).expect(422);
      expect(res.body.code).toBe('NOTE_INCOMPLETE');
      await writeNote(visit.id, doctorA, { treatmentDone: 'Massage' }).expect(
        200,
      );
      await sign(visit.id, doctorA).expect(200);
    });

    it('a signed note is locked; addenda are added by any doctor with access', async () => {
      const note = await signedNote(visit.id, doctorA, 'Sprain');

      const edit = await writeNote(visit.id, doctorA, { plan: 'Rest' }).expect(
        422,
      );
      expect(edit.body.code).toBe('NOTE_SIGNED');
      expect((await sign(visit.id, doctorA).expect(422)).body.code).toBe(
        'NOTE_SIGNED',
      );

      await addAddendum(note.id, doctorA, 'Swelling down on day 3').expect(201);
      const res = await addAddendum(
        note.id,
        doctorB,
        'Seen for follow-up',
      ).expect(201);
      expect(res.body.assessment).toBe('Sprain');
      expect(res.body.addenda).toMatchObject([
        { doctor: { id: doctorA.doctorId }, content: 'Swelling down on day 3' },
        { doctor: { id: doctorB.doctorId }, content: 'Seen for follow-up' },
      ]);
    });

    it('no note yet is 200 null; drafts are visible only to their author (NOTE_NOT_VISIBLE)', async () => {
      const none = await readNote(visit.id, doctorA).expect(200);
      expect(none.body).toBeNull();
      const draft = (
        await writeNote(visit.id, doctorA, { assessment: 'Unsure yet' }).expect(
          200,
        )
      ).body;
      await readNote(visit.id, doctorA).expect(200);
      const hidden = await readNote(visit.id, doctorB).expect(404);
      expect(hidden.body.code).toBe('NOTE_NOT_VISIBLE');
      expect((await readNote(visit.id, owner).expect(404)).body.code).toBe(
        'NOTE_NOT_VISIBLE',
      );
      await addAddendum(draft.id, doctorB, 'Nope').expect(404);
      const own = await addAddendum(draft.id, doctorA, 'Too early').expect(422);
      expect(own.body.code).toBe('NOTE_NOT_SIGNED');
      const history = await request(server)
        .get(api(`/patients/${patient.id}/clinical-history`))
        .set(as(doctorA))
        .expect(200);
      expect(history.body.notes.items).toEqual([]);

      await sign(visit.id, doctorA).expect(200);
      await readNote(visit.id, doctorB).expect(200);
      await readNote(visit.id, owner).expect(200);
    });

    it('the queue shows whether each visit has a note, and its status', async () => {
      const queue = async () =>
        (
          await request(server)
            .get(api('/visits/queue'))
            .set(as(doctorA))
            .expect(200)
        ).body as { visitId: string; hasNote: boolean; noteStatus: string }[];

      expect(await queue()).toMatchObject([
        { visitId: visit.id, hasNote: false, noteStatus: null },
      ]);
      await writeNote(visit.id, doctorA, { assessment: 'x' }).expect(200);
      expect(await queue()).toMatchObject([
        { hasNote: true, noteStatus: 'DRAFT' },
      ]);
      await sign(visit.id, doctorA).expect(200);
      expect(await queue()).toMatchObject([{ noteStatus: 'SIGNED' }]);
    });

    it('database CHECKs reject invalid notes', async () => {
      const base = {
        visitId: visit.id,
        patientId: patient.id,
        doctorId: doctorA.doctorId,
        status: 'DRAFT' as never,
        signedAt: null,
      };
      for (const bad of [
        { painScore: 11 },
        { painScore: -1 },
        { status: 'SIGNED' as never },
      ]) {
        await expect(
          ctx.dataSource
            .getRepository(ClinicalNote)
            .insert({ ...base, ...bad }),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
      }
    });
  });

  // ---------- needs attention ----------

  describe('needs-attention', () => {
    const needsAttention = (by: TestUser, query = '') =>
      request(server)
        .get(api(`/clinical-notes/needs-attention${query}`))
        .set(as(by))
        .expect(200);

    it('ACTIVE visits without a signed note, oldest first: doctor own, owner all', async () => {
      const other = await insertPatient(ctx.dataSource, 'Ali', '+201000000002');
      const old = await newVisit(
        doctorA,
        VisitStatus.ACTIVE,
        new Date('2026-10-01T08:00:00Z'),
        other.id,
      );
      const signed = await newVisit(doctorA, VisitStatus.ACTIVE, undefined);
      await signedNote(signed.id, doctorA, 'Done');
      await newVisit(doctorA, VisitStatus.VOIDED);
      const ofB = await newVisit(
        doctorB,
        VisitStatus.ACTIVE,
        new Date('2026-10-02T08:00:00Z'),
      );
      await writeNote(visit.id, doctorA, { assessment: 'Draft' }).expect(200);

      const own = await needsAttention(doctorA);
      expect(own.body.meta.total).toBe(2);
      expect(own.body.items).toMatchObject([
        {
          visitId: old.id,
          visitDate: expect.stringMatching(/^2026-10-01T11:00:00\+03:00$/),
          patient: { id: other.id, name: 'Ali' },
          service: { id: serviceId, name: 'Physio' },
          doctor: { id: doctorA.doctorId },
          noteStatus: null,
        },
        { visitId: visit.id, noteStatus: 'DRAFT' },
      ]);

      const all = await needsAttention(owner);
      expect(all.body.items.map((e: { visitId: string }) => e.visitId)).toEqual(
        [old.id, ofB.id, visit.id],
      );
      const onlyB = await needsAttention(
        owner,
        `?doctorId=${doctorB.doctorId}`,
      );
      expect(onlyB.body.items).toMatchObject([{ visitId: ofB.id }]);
      // A doctor's filter is always their own.
      const ignored = await needsAttention(
        doctorB,
        `?doctorId=${doctorA.doctorId}`,
      );
      expect(ignored.body.items).toMatchObject([{ visitId: ofB.id }]);
    });
  });

  // ---------- access ----------

  it('a doctor with no appointment or visit with the patient gets 404 everywhere', async () => {
    const note = await signedNote(visit.id, doctorA, 'Sprain');
    const attachment = (await upload(doctorA, PNG, 'xray.png').expect(201))
      .body;

    const p = `/patients/${patient.id}`;
    await request(server)
      .get(api(`${p}/medical-info`))
      .set(as(doctorC))
      .expect(404);
    await request(server)
      .put(api(`${p}/medical-info`))
      .set(as(doctorC))
      .send({ allergies: 'None' })
      .expect(404);
    await request(server)
      .get(api(`${p}/clinical-history`))
      .set(as(doctorC))
      .expect(404);
    await request(server)
      .get(api(`${p}/attachments`))
      .set(as(doctorC))
      .expect(404);
    await upload(doctorC, PNG, 'xray.png').expect(404);
    await download(attachment.id, doctorC).expect(404);
    await readNote(visit.id, doctorC).expect(404);
    await addAddendum(note.id, doctorC, 'Hi').expect(404);

    // Any relationship counts, even a cancelled appointment (doctorB).
    await request(server)
      .get(api(`${p}/clinical-history`))
      .set(as(doctorB))
      .expect(200);
  });

  // ---------- medical info ----------

  it('medical info: empty until the first save, replaced by any doctor with access, audited', async () => {
    const path = api(`/patients/${patient.id}/medical-info`);
    const empty = await request(server).get(path).set(as(owner)).expect(200);
    expect(empty.body).toMatchObject({
      patientId: patient.id,
      allergies: null,
      updatedBy: null,
      updatedAt: null,
    });

    await request(server)
      .put(path)
      .set(as(doctorA))
      .send({ allergies: 'Penicillin', currentMedications: 'Ibuprofen' })
      .expect(200);
    const replaced = await request(server)
      .put(path)
      .set(as(doctorB))
      .send({
        allergies: 'Penicillin',
        chronicConditions: 'Diabetes',
        notes: '   ',
      })
      .expect(200);
    expect(replaced.body).toMatchObject({
      allergies: 'Penicillin',
      chronicConditions: 'Diabetes',
      currentMedications: null, // left out -> cleared
      notes: null, // blank -> cleared
      updatedBy: { id: doctorB.id, name: expect.any(String) },
      updatedAt: expect.any(String),
    });

    const logs = await ctx.dataSource.getRepository(AuditLog).find({
      where: { action: 'PATIENT_MEDICAL_INFO_UPDATED', entityId: patient.id },
      order: { createdAt: 'ASC' },
    });
    expect(logs.map((l) => l.userId)).toEqual([doctorA.id, doctorB.id]);
    expect(logs[1]).toMatchObject({
      oldValues: { chronicConditions: null, currentMedications: 'Ibuprofen' },
      newValues: { chronicConditions: 'Diabetes', currentMedications: null },
    });
  });

  // ---------- history ----------

  it("clinical history: medical info, every doctor's signed notes (newest first) with addenda, and attachments", async () => {
    const older = await newVisit(
      doctorB,
      VisitStatus.ACTIVE,
      new Date('2026-10-20T08:00:00Z'),
    );
    const first = await signedNote(older.id, doctorB, 'Initial assessment');
    await addAddendum(first.id, doctorA, 'Reviewed').expect(201);
    await signedNote(visit.id, doctorA, 'Second session');
    await request(server)
      .put(api(`/patients/${patient.id}/medical-info`))
      .set(as(doctorA))
      .send({ allergies: 'Latex' })
      .expect(200);
    await upload(doctorA, PNG, 'xray.png', {
      title: 'X-ray',
      visitId: visit.id,
    }).expect(201);

    const res = await request(server)
      .get(api(`/patients/${patient.id}/clinical-history?limit=1`))
      .set(as(owner))
      .expect(200);
    expect(res.body.medicalInfo.allergies).toBe('Latex');
    expect(res.body.attachments).toMatchObject([
      { title: 'X-ray', visitId: visit.id, mimeType: 'image/png' },
    ]);
    expect(res.body.notes.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(res.body.notes.items).toMatchObject([
      { assessment: 'Second session', doctor: { id: doctorA.doctorId } },
    ]);

    const page2 = await request(server)
      .get(api(`/patients/${patient.id}/clinical-history?limit=1&page=2`))
      .set(as(doctorA))
      .expect(200);
    expect(page2.body.notes.items).toMatchObject([
      {
        assessment: 'Initial assessment',
        doctor: { id: doctorB.doctorId },
        visit: {
          id: older.id,
          date: expect.stringMatching(/^2026-10-20T/),
          service: { name: 'Physio' },
        },
        addenda: [{ doctor: { id: doctorA.doctorId }, content: 'Reviewed' }],
      },
    ]);
  });

  // ---------- attachments ----------

  it('attachments: uploaded by doctors with access and the owner, private, type-checked', async () => {
    const xray = await upload(doctorA, PNG, 'xray.png', {
      title: 'Knee X-ray',
      visitId: visit.id,
    }).expect(201);
    expect(xray.body).toMatchObject({
      patientId: patient.id,
      visitId: visit.id,
      title: 'Knee X-ray',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      uploadedBy: { id: doctorA.id, name: expect.any(String) },
    });
    await upload(owner, PDF, 'labs.pdf', { title: 'Blood test' }).expect(201);

    const list = await request(server)
      .get(api(`/patients/${patient.id}/attachments`))
      .set(as(doctorB))
      .expect(200);
    expect(list.body.map((a: { title: string }) => a.title).sort()).toEqual([
      'Blood test',
      'Knee X-ray',
    ]);

    const file = await download(xray.body.id, doctorB).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    await download(xray.body.id, owner).expect(200);

    const fake = await upload(
      doctorA,
      Buffer.from('not an image'),
      'x.png',
    ).expect(422);
    expect(fake.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    await upload(doctorA, PNG, 'x.png', {}).expect(400); // title required

    const stranger = await insertPatient(
      ctx.dataSource,
      'Other',
      '+201000000009',
    );
    const foreignVisit = await newVisit(
      doctorA,
      VisitStatus.ACTIVE,
      undefined,
      stranger.id,
    );
    const mismatch = await upload(doctorA, PNG, 'x.png', {
      title: 'Wrong visit',
      visitId: foreignVisit.id,
    }).expect(422);
    expect(mismatch.body.code).toBe('ATTACHMENT_VISIT_MISMATCH');
  });
});
