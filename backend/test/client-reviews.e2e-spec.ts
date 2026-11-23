import { readdir } from 'node:fs/promises';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { FileStorage } from '../src/common/storage/file-storage.service.js';
import { findOrphans } from '../src/common/storage/orphan-sweep.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { ClientReviewAttachment } from '../src/modules/client-reviews/entities/client-review-attachment.entity.js';
import { ClientReview } from '../src/modules/client-reviews/entities/client-review.entity.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import {
  accessCookie,
  accessTokenFor,
  bearer,
  createLoggedInUser,
  login,
  type TestUser,
} from './utils/auth-helpers.js';
import { withFailingInserts } from './utils/db-failure.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './utils/test-app.js';

// Uploaded files go to a throw-away folder (git-ignored).
vi.hoisted(() => {
  process.env.STORAGE_LOCAL_PATH = '.tmp/e2e-storage';
});
const STORED_DIR = '.tmp/e2e-storage/client-reviews';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake png review'),
]);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fake jpg review'),
]);
const PDF = Buffer.from('%PDF-1.4\na thank-you letter', 'ascii');
const GIF = Buffer.from('GIF89a not accepted', 'ascii');

const REVIEW = {
  reviewType: 'IMAGE',
  clientName: 'أحمد حسن',
  content: 'شكرا لفريق المركز، رجعت أمشي بعد ثلاث أسابيع من العلاج.',
  keywords: ['تأهيل', 'خشونة الركبة'],
};

type Fields = Record<string, string | string[] | boolean>;
type Upload = [Buffer, string];

const ISO = expect.stringMatching(/T.*\+0[23]:00$/);

describe('Client reviews (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;
  let receptionist: TestUser;
  let doctor: TestUser;

  const as = (user: TestUser) => ({ Authorization: bearer(user) });
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    const make = (role: UserRole) =>
      createLoggedInUser(ctx.app, ctx.dataSource, role);
    owner = await make(UserRole.OWNER);
    receptionist = await make(UserRole.RECEPTIONIST);
    doctor = await make(UserRole.DOCTOR);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // ---------- helpers ----------

  // Multipart like the staff UI: one field per keyword / file.
  const multipart = (
    req: request.Test,
    fields: Fields,
    files: Upload[],
  ): request.Test => {
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        req.field(key, String(item));
      }
    }
    for (const [buffer, name] of files) req.attach('attachments', buffer, name);
    return req;
  };

  const create = (fields: Fields = {}, files: Upload[] = [], user = owner) =>
    multipart(
      request(server).post(api('/client-reviews')).set(as(user)),
      { ...REVIEW, ...fields },
      files,
    );

  const update = (
    id: string,
    fields: Fields,
    files: Upload[] = [],
    user = owner,
  ) =>
    multipart(
      request(server)
        .patch(api(`/client-reviews/${id}`))
        .set(as(user)),
      fields,
      files,
    );

  const created = async (fields: Fields = {}, files: Upload[] = []) =>
    (await create(fields, files).expect(201)).body as {
      id: string;
      attachments: { id: string; fileName: string }[];
    };

  const list = (query = '', user = owner) =>
    request(server)
      .get(api(`/client-reviews${query}`))
      .set(as(user));

  const download = (id: string, attachmentId: string, user = owner) =>
    request(server)
      .get(api(`/client-reviews/${id}/attachments/${attachmentId}`))
      .set(as(user))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  const storedFiles = async () =>
    (await readdir(STORED_DIR).catch(() => [] as string[])).length;

  const auditOf = (entityId: string) =>
    ctx.dataSource.getRepository(AuditLog).find({
      where: { entityType: 'CLIENT_REVIEW', entityId },
      order: { createdAt: 'ASC' },
    });

  // ---------- create ----------

  it('create: the OWNER adds a review with attachments (Arabic file names kept), unpublished by default', async () => {
    const res = await create({}, [
      [PNG, 'رسالة المريض.png'],
      [PDF, 'letter.pdf'],
    ]).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      reviewType: 'IMAGE',
      clientName: REVIEW.clientName,
      content: REVIEW.content,
      keywords: REVIEW.keywords,
      isPublished: false,
      attachmentCount: 2,
      createdBy: { id: owner.id, name: expect.any(String) },
      createdAt: ISO,
      updatedAt: ISO,
      attachments: [
        {
          id: expect.any(String),
          fileName: 'رسالة المريض.png',
          mimeType: 'image/png',
          sizeBytes: PNG.length,
          createdAt: ISO,
        },
        {
          id: expect.any(String),
          fileName: 'letter.pdf',
          mimeType: 'application/pdf',
          sizeBytes: PDF.length,
          createdAt: ISO,
        },
      ],
    });

    // Stored under a generated key, never the client's name.
    const rows = await ctx.dataSource
      .getRepository(ClientReviewAttachment)
      .findBy({ reviewId: res.body.id });
    for (const row of rows) {
      expect(row.fileKey).toMatch(/^client-reviews\/[0-9a-f-]{36}\.(png|pdf)$/);
      expect(row.uploadedById).toBe(owner.id);
    }
  });

  it('create: the files keep their upload order (on the review and after an edit)', async () => {
    const names = ['b.png', 'a.pdf', 'e.jpg', 'c.png', 'd.pdf'];
    const files = names.map(
      (name) =>
        [
          name.endsWith('.pdf') ? PDF : name.endsWith('.jpg') ? JPG : PNG,
          name,
        ] as Upload,
    );
    const review = await created({}, files);
    expect(review.attachments.map((a) => a.fileName)).toEqual(names);

    const res = await update(review.id, {}, [
      [PNG, 'z.png'],
      [PDF, 'y.pdf'],
    ]).expect(200);
    expect(
      res.body.attachments.map((a: { fileName: string }) => a.fileName),
    ).toEqual([...names, 'z.png', 'y.pdf']);
  });

  it('create: trims and collapses the name, published on request, no keywords and no files are fine', async () => {
    const res = await create({
      clientName: '  منى   عادل ',
      content: '  ممتاز  ',
      keywords: '',
      isPublished: true,
      reviewType: 'TEXT',
    }).expect(201);
    expect(res.body).toMatchObject({
      clientName: 'منى عادل',
      content: 'ممتاز',
      keywords: [],
      isPublished: true,
      reviewType: 'TEXT',
      attachments: [],
      attachmentCount: 0,
    });
  });

  it('create: required fields and limits are validated (400 per field)', async () => {
    const res = await multipart(
      request(server).post(api('/client-reviews')).set(as(owner)),
      {},
      [],
    ).expect(400);
    const fields = (res.body.details as { field: string }[]).map(
      (d) => d.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['reviewType', 'clientName', 'content']),
    );

    const bad = async (fields: Fields, field: string) => {
      const r = await create(fields).expect(400);
      expect(r.body.details.map((d: { field: string }) => d.field)).toContain(
        field,
      );
    };
    await bad({ reviewType: 'VIDEO' }, 'reviewType');
    await bad({ clientName: 'x' }, 'clientName');
    await bad({ content: '   ' }, 'content');
    await bad({ content: 'a'.repeat(5001) }, 'content');
    await bad({ keywords: ['أ', 'ب', 'أ'] }, 'keywords');
    await bad({ keywords: ['Knee', 'knee'] }, 'keywords');
    await bad({ keywords: ['x'.repeat(51)] }, 'keywords');
    await bad(
      { keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) },
      'keywords',
    );
    await bad({ isPublished: 'maybe' }, 'isPublished');
    await bad({ createdById: owner.id }, 'createdById');
    expect(await ctx.dataSource.getRepository(ClientReview).count()).toBe(0);
  });

  // ---------- attachments ----------

  it('attachments: JPG, PNG, WEBP or PDF checked by content; a refused file stores nothing', async () => {
    const before = await storedFiles();
    for (const file of [
      [GIF, 'anim.gif'],
      [PNG, 'renamed.pdf'],
      [Buffer.from('plain text'), 'notes.txt'],
    ] as Upload[]) {
      const res = await create({}, [[JPG, 'ok.jpg'], file]).expect(422);
      expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    }
    expect(await ctx.dataSource.getRepository(ClientReview).count()).toBe(0);
    expect(await storedFiles()).toBe(before);
  });

  it('attachments: 5 MB each (413), at most 10 per request (400), only the `attachments` field', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await create({}, [[big, 'big.png']]).expect(413);

    const eleven = Array.from(
      { length: 11 },
      (_, i) => [PNG, `p${i}.png`] as Upload,
    );
    await create({}, eleven).expect(400);

    await multipart(
      request(server).post(api('/client-reviews')).set(as(owner)),
      REVIEW,
      [],
    )
      .attach('image', PNG, 'p.png')
      .expect(400);
    expect(await ctx.dataSource.getRepository(ClientReview).count()).toBe(0);
  });

  it('attachments: a failed transaction removes the files it wrote (no orphans)', async () => {
    const before = await storedFiles();
    await withFailingInserts(
      ctx.dataSource,
      'client_review_attachments',
      async () => {
        await create({}, [
          [PNG, 'a.png'],
          [PDF, 'b.pdf'],
        ]).expect(500);
      },
    );
    expect(await ctx.dataSource.getRepository(ClientReview).count()).toBe(0);
    expect(await storedFiles()).toBe(before);
  });

  it('attachments: the orphan sweep keeps recorded files (removed ones too) and finds unrecorded ones', async () => {
    const review = await created({}, [
      [PNG, 'kept.png'],
      [PDF, 'removed.pdf'],
    ]);
    await update(review.id, {
      removeAttachmentIds: review.attachments[1].id,
    }).expect(200);
    const storage = ctx.app.get(FileStorage);
    const stray = 'client-reviews/00000000-0000-4000-8000-000000000000.png';
    await storage.put(stray, PNG);
    try {
      const rows = await ctx.dataSource
        .getRepository(ClientReviewAttachment)
        .findBy({ reviewId: review.id });
      const orphans = (
        await findOrphans(
          storage,
          ctx.dataSource,
          new Date(Date.now() + 3_600_000),
          10,
        )
      ).map((o) => o.key);
      expect(orphans).toContain(stray);
      for (const row of rows) expect(orphans).not.toContain(row.fileKey);
    } finally {
      await storage.delete(stray);
    }
  });

  it('download: streams the file with its type and an encoded name; 404 for another review or unknown ids', async () => {
    const review = await created({}, [[PNG, 'صورة (1).png']]);
    const other = await created({}, [[PDF, 'x.pdf']]);
    const [attachment] = review.attachments;

    const res = await download(review.id, attachment.id).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    expect(res.headers['content-disposition']).toBe(
      `inline; filename="${attachment.id}.png"; filename*=UTF-8''${encodeURIComponent('صورة')}%20%281%29.png`,
    );

    await download(other.id, attachment.id).expect(404);
    await download(review.id, other.attachments[0].id).expect(404);
    await download(review.id, 'not-a-uuid').expect(400);

    // The browser's cookie (with the CSRF header) works too.
    await request(server)
      .get(api(`/client-reviews/${review.id}/attachments/${attachment.id}`))
      .set(accessCookie(owner.accessToken))
      .expect(200);
  });

  // ---------- list ----------

  it('list: server-side pages, newest first, without repeats', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push((await created({ clientName: `Client ${i}` })).id);
    }
    const newestFirst = [...ids].reverse();

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await list(`?page=${page}&limit=10`).expect(200);
      expect(res.body.meta).toEqual({
        page,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
      expect(res.body.items).toHaveLength(page === 3 ? 5 : 10);
      seen.push(...res.body.items.map((r: { id: string }) => r.id));
    }
    expect(seen).toEqual(newestFirst);

    const beyond = await list('?page=4&limit=10').expect(200);
    expect(beyond.body.items).toEqual([]);
    await list('?limit=101').expect(400);
    await list('?page=0').expect(400);
  });

  it('list: search (name, text, keywords; Arabic spelling variants), type and published filters, active attachment counts', async () => {
    const ahmed = await created({}, [
      [PNG, 'a.png'],
      [PDF, 'b.pdf'],
    ]);
    const mona = await created({
      clientName: 'Mona Adel',
      content: 'Great physiotherapy for my shoulder',
      keywords: ['Shoulder'],
      reviewType: 'TEXT',
      isPublished: true,
    });
    const third = await created({
      clientName: 'Sara Ali',
      content: 'تأهيل ممتاز بعد الجلطة',
      keywords: ['جلطات'],
      reviewType: 'GALLERY',
    });

    const ids = async (query: string) =>
      (await list(query).expect(200)).body.items.map(
        (r: { id: string }) => r.id,
      );

    // احمد finds أحمد; ممتاز appears in two texts.
    expect(await ids(`?search=${encodeURIComponent('احمد')}`)).toEqual([
      ahmed.id,
    ]);
    expect(await ids('?search=MONA')).toEqual([mona.id]);
    expect(await ids('?search=shoulder')).toEqual([mona.id]);
    expect(await ids(`?search=${encodeURIComponent('جلطات')}`)).toEqual([
      third.id,
    ]);
    expect(await ids(`?search=${encodeURIComponent('الركبه')}`)).toEqual([
      ahmed.id,
    ]);
    expect(await ids('?search=100%25')).toEqual([]);
    expect(await ids('?reviewType=TEXT')).toEqual([mona.id]);
    expect(await ids('?isPublished=true')).toEqual([mona.id]);
    expect(await ids('?isPublished=false')).toEqual([third.id, ahmed.id]);
    expect(
      await ids(`?reviewType=GALLERY&search=${encodeURIComponent('تاهيل')}`),
    ).toEqual([third.id]);
    await list('?reviewType=VIDEO').expect(400);

    await update(ahmed.id, { removeAttachmentIds: ahmed.attachments[0].id });
    const rows = (await list(`?search=${encodeURIComponent('أحمد')}`)).body
      .items;
    expect(rows[0]).toMatchObject({
      id: ahmed.id,
      attachmentCount: 1,
      keywords: REVIEW.keywords,
      content: REVIEW.content,
      createdBy: { id: owner.id },
    });
  });

  // ---------- view / update ----------

  it('get: the full review; unknown is 404, a bad id 400', async () => {
    const review = await created({}, [[JPG, 'p.jpg']]);
    const res = await request(server)
      .get(api(`/client-reviews/${review.id}`))
      .set(as(owner))
      .expect(200);
    expect(res.body).toMatchObject({
      id: review.id,
      attachments: [{ fileName: 'p.jpg', mimeType: 'image/jpeg' }],
    });
    await request(server)
      .get(api('/client-reviews/6f1c1a52-58a3-4b3e-9a59-0cc1d24b8a8e'))
      .set(as(owner))
      .expect(404);
    await request(server)
      .get(api('/client-reviews/abc'))
      .set(as(owner))
      .expect(400);
  });

  it('update: only the fields sent change; files added and removed in one request (audited)', async () => {
    const review = await created({}, [
      [PNG, 'one.png'],
      [PDF, 'two.pdf'],
    ]);
    const [one, two] = review.attachments;

    const res = await update(
      review.id,
      {
        clientName: 'أحمد حسن علي',
        keywords: '',
        isPublished: true,
        removeAttachmentIds: one.id,
      },
      [[JPG, 'three.jpg']],
    ).expect(200);
    expect(res.body).toMatchObject({
      clientName: 'أحمد حسن علي',
      content: REVIEW.content,
      reviewType: 'IMAGE',
      keywords: [],
      isPublished: true,
      attachmentCount: 2,
    });
    expect(res.body.attachments.map((a: { id: string }) => a.id)).toEqual([
      two.id,
      expect.any(String),
    ]);
    expect(res.body.attachments[1].fileName).toBe('three.jpg');
    await download(review.id, one.id).expect(404);
    // The removed attachment's row and file stay (soft delete).
    const removed = await ctx.dataSource
      .getRepository(ClientReviewAttachment)
      .findOneByOrFail({ id: one.id });
    expect(removed.deletedAt).not.toBeNull();

    // JSON works too (no files): publish toggles from the list.
    await request(server)
      .patch(api(`/client-reviews/${review.id}`))
      .set(as(owner))
      .send({ isPublished: false })
      .expect(200)
      .expect(({ body }) => expect(body.isPublished).toBe(false));

    // Nothing changed: no audit entry.
    await update(review.id, { reviewType: 'IMAGE' }).expect(200);

    const audit = await auditOf(review.id);
    expect(audit.map((a) => a.action)).toEqual([
      'CLIENT_REVIEW_CREATED',
      'CLIENT_REVIEW_UPDATED',
      'CLIENT_REVIEW_UPDATED',
    ]);
    expect(audit[0].newValues).toEqual({
      reviewType: 'IMAGE',
      clientName: REVIEW.clientName,
      content: REVIEW.content,
      keywords: REVIEW.keywords,
      isPublished: false,
      attachmentsAdded: ['one.png', 'two.pdf'],
    });
    expect(audit[1].oldValues).toEqual({
      clientName: REVIEW.clientName,
      keywords: REVIEW.keywords,
      isPublished: false,
    });
    expect(audit[1].newValues).toEqual({
      clientName: 'أحمد حسن علي',
      keywords: [],
      isPublished: true,
      attachmentsAdded: ['three.jpg'],
      attachmentsRemoved: ['one.png'],
    });
    expect(audit[1].userId).toBe(owner.id);
    expect(audit[2].oldValues).toEqual({ isPublished: true });
    expect(audit[2].newValues).toEqual({ isPublished: false });
  });

  it('update: at most 10 attachments in total; an unknown attachment id is a 404 (new files discarded)', async () => {
    const review = await created(
      {},
      Array.from({ length: 9 }, (_, i) => [PNG, `p${i}.png`] as Upload),
    );
    const before = await storedFiles();

    const tooMany = await update(review.id, {}, [
      [PNG, 'a.png'],
      [PNG, 'b.png'],
    ]).expect(400);
    expect(tooMany.body.details[0]).toMatchObject({
      field: 'attachments',
      constraints: ['arrayMaxSize'],
    });
    await update(
      review.id,
      { removeAttachmentIds: '6f1c1a52-58a3-4b3e-9a59-0cc1d24b8a8e' },
      [[PNG, 'c.png']],
    ).expect(404);
    await update(review.id, { removeAttachmentIds: 'nope' }).expect(400);
    expect(await storedFiles()).toBe(before);

    // Removing one makes room for two.
    await update(review.id, { removeAttachmentIds: review.attachments[0].id }, [
      [PNG, 'a.png'],
      [PNG, 'b.png'],
    ])
      .expect(200)
      .expect(({ body }) => expect(body.attachmentCount).toBe(10));
  });

  // ---------- delete ----------

  it('delete: gone from the list and 404 everywhere afterwards (row and files kept, audited)', async () => {
    const review = await created({}, [[PNG, 'p.png']]);
    const keep = await created({ clientName: 'Keep Me' });

    await request(server)
      .delete(api(`/client-reviews/${review.id}`))
      .set(as(owner))
      .expect(204);

    const items = (await list().expect(200)).body.items;
    expect(items.map((r: { id: string }) => r.id)).toEqual([keep.id]);
    await request(server)
      .get(api(`/client-reviews/${review.id}`))
      .set(as(owner))
      .expect(404);
    await update(review.id, { clientName: 'Again' }).expect(404);
    await download(review.id, review.attachments[0].id).expect(404);
    await request(server)
      .delete(api(`/client-reviews/${review.id}`))
      .set(as(owner))
      .expect(404);

    const row = await ctx.dataSource
      .getRepository(ClientReview)
      .findOneByOrFail({ id: review.id });
    expect(row.deletedAt).not.toBeNull();
    const audit = await auditOf(review.id);
    expect(audit.at(-1)).toMatchObject({
      action: 'CLIENT_REVIEW_DELETED',
      oldValues: { clientName: REVIEW.clientName },
      newValues: { deleted: true },
    });
  });

  // ---------- access ----------

  it('access: RECEPTIONIST and DOCTOR get 403 on every endpoint, even for an existing review; no login is 401', async () => {
    const review = await created({}, [[PNG, 'p.png']]);
    const path = `/client-reviews/${review.id}`;
    const file = `${path}/attachments/${review.attachments[0].id}`;
    const before = await storedFiles();

    for (const user of [receptionist, doctor]) {
      await list('', user).expect(403);
      await request(server).get(api(path)).set(as(user)).expect(403);
      await download(review.id, review.attachments[0].id, user).expect(403);
      await create({}, [[PNG, 'x.png']], user).expect(403);
      await update(review.id, { clientName: 'Hacked' }, [], user).expect(403);
      await update(review.id, { isPublished: true }, [], user).expect(403);
      await request(server).delete(api(path)).set(as(user)).expect(403);
    }
    expect(await storedFiles()).toBe(before);
    // Patients never log in (they are not users): without a staff session
    // every route is 401.
    for (const anonymous of [
      () => request(server).get(api('/client-reviews')),
      () => request(server).get(api(path)),
      () => request(server).get(api(file)),
      () => request(server).post(api('/client-reviews')),
      () => request(server).patch(api(path)),
      () => request(server).delete(api(path)),
    ]) {
      await anonymous().expect(401);
    }

    const after = await request(server)
      .get(api(path))
      .set(as(owner))
      .expect(200);
    expect(after.body).toMatchObject({
      clientName: REVIEW.clientName,
      isPublished: false,
    });
  });

  it('access: the OWNER works through the browser cookie; a role claim in the token grants nothing', async () => {
    const { accessToken } = await login(ctx.app, owner.email);
    await request(server)
      .get(api('/client-reviews'))
      .set(accessCookie(accessToken))
      .expect(200);

    // The guard reads the role from the database, not from the token.
    const forged = accessTokenFor(ctx.app, {
      id: receptionist.id,
      role: UserRole.OWNER,
    });
    await request(server)
      .get(api('/client-reviews'))
      .set({ Authorization: `Bearer ${forged}` })
      .expect(403);

    // A deactivated OWNER is out at once.
    await ctx.dataSource
      .getRepository(User)
      .update(owner.id, { isActive: false });
    await list().expect(401);
  });
});
