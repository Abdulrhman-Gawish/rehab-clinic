import request from 'supertest';
import type { App } from 'supertest/types.js';
import { UserRole } from '../src/common/enums/user-role.enum.js';
import { FileStorage } from '../src/common/storage/file-storage.service.js';
import { findOrphans } from '../src/common/storage/orphan-sweep.js';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity.js';
import { BlogPost } from '../src/modules/blog/entities/blog-post.entity.js';
import {
  bearer,
  createLoggedInUser,
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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake png cover'),
]);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fake jpg cover'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 fake webp cover'),
]);
const PDF = Buffer.from('%PDF-1.4\nnot an image', 'ascii');

const KEYWORDS = ['تأهيل', 'جلطات', 'علاج طبيعي', 'أعصاب', 'شلل نصفي'];
const POST = {
  title: 'تأهيل حالات ما بعد الجلطات',
  description: 'كيف يساعد العلاج الطبيعي مرضى الجلطات على استعادة الحركة.',
  keywords: KEYWORDS,
  category: 'NEUROLOGICAL',
  content: '<h2>مقدمة</h2><p class="ql-align-right">نص المقال</p>',
};

type Fields = Partial<Record<keyof typeof POST, string | string[]>>;
type Image = [Buffer, string] | null;

describe('Blog (e2e)', () => {
  let ctx: TestApp;
  let server: App;
  let owner: TestUser;

  const as = (user: TestUser) => ({ Authorization: bearer(user) });
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    owner = await createLoggedInUser(ctx.app, ctx.dataSource, UserRole.OWNER);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // ---------- helpers ----------

  // Multipart like the staff UI: one `keywords` field per keyword.
  const multipart = (
    req: request.Test,
    fields: Fields,
    image: Image,
  ): request.Test => {
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        req.field(key, item);
      }
    }
    return image ? req.attach('image', image[0], image[1]) : req;
  };

  const create = (fields: Fields = {}, image: Image = [PNG, 'cover.png']) =>
    multipart(
      request(server).post(api('/blog-posts')).set(as(owner)),
      { ...POST, ...fields },
      image,
    );

  const update = (id: string, fields: Fields, image: Image = null) =>
    multipart(
      request(server)
        .patch(api(`/blog-posts/${id}`))
        .set(as(owner)),
      fields,
      image,
    );

  const created = async (fields: Fields = {}): Promise<{ id: string }> =>
    (await create(fields).expect(201)).body;

  const publicGet = (path: string) => request(server).get(api(path));

  const cover = (id: string) =>
    publicGet(`/public/blog-posts/${id}/cover`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  const auditOf = (entityId: string) =>
    ctx.dataSource.getRepository(AuditLog).find({
      where: { entityType: 'BLOG_POST', entityId },
      order: { createdAt: 'ASC' },
    });

  // ---------- OWNER ----------

  it('create: the OWNER publishes a post at once (audited)', async () => {
    const res = await create().expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      title: POST.title,
      description: POST.description,
      keywords: KEYWORDS,
      category: 'NEUROLOGICAL',
      content: POST.content,
      author: { id: owner.id, name: expect.any(String) },
      createdAt: expect.stringMatching(/T.*\+0[23]:00$/),
      updatedAt: expect.stringMatching(/T.*\+0[23]:00$/),
    });

    const [entry] = await auditOf(res.body.id);
    expect(entry).toMatchObject({
      action: 'BLOG_POST_CREATED',
      userId: owner.id,
      newValues: {
        title: POST.title,
        keywords: KEYWORDS,
        category: 'NEUROLOGICAL',
        coverImageMimeType: 'image/png',
      },
    });

    // Published: the website lists it right away.
    const list = await publicGet('/public/blog-posts').expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([
      res.body.id,
    ]);
  });

  it('list: newest first, paginated, without the content; category filter', async () => {
    const first = await created({ category: 'CARDIAC' });
    const second = await created({ title: 'جهاز شد الفقرات الإلكتروني' });
    const third = await created({ category: 'CARDIAC' });

    const all = await request(server)
      .get(api('/blog-posts?limit=2'))
      .set(as(owner))
      .expect(200);
    expect(all.body.meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(all.body.items.map((p: { id: string }) => p.id)).toEqual([
      third.id,
      second.id,
    ]);
    expect(all.body.items[0]).toEqual({
      id: third.id,
      title: POST.title,
      description: POST.description,
      keywords: KEYWORDS,
      category: 'CARDIAC',
      author: { id: owner.id, name: expect.any(String) },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const cardiac = await request(server)
      .get(api('/blog-posts?category=CARDIAC'))
      .set(as(owner))
      .expect(200);
    expect(cardiac.body.items.map((p: { id: string }) => p.id)).toEqual([
      third.id,
      first.id,
    ]);
  });

  it('get: the full post; unknown is 404', async () => {
    const post = await created();
    const res = await request(server)
      .get(api(`/blog-posts/${post.id}`))
      .set(as(owner))
      .expect(200);
    expect(res.body).toMatchObject({
      id: post.id,
      content: POST.content,
      author: { id: owner.id },
    });
    await request(server)
      .get(api('/blog-posts/00000000-0000-4000-8000-000000000000'))
      .set(as(owner))
      .expect(404);
  });

  it('update: changes only the fields sent; a new image replaces the cover (audited)', async () => {
    const post = await created();

    const res = await update(post.id, {
      title: '  تأهيل حالات الرباط الصليبي  ',
      category: 'SPORTS_INJURIES',
    }).expect(200);
    expect(res.body).toMatchObject({
      title: 'تأهيل حالات الرباط الصليبي',
      category: 'SPORTS_INJURIES',
      description: POST.description,
      keywords: KEYWORDS,
      content: POST.content,
    });
    // Without an image the cover stays.
    const kept = await cover(post.id).expect(200);
    expect(Buffer.compare(kept.body as Buffer, PNG)).toBe(0);

    await update(post.id, { keywords: [...KEYWORDS, 'رياضة'] }, [
      WEBP,
      'new.webp',
    ]).expect(200);
    const replaced = await cover(post.id).expect(200);
    expect(replaced.headers['content-type']).toBe('image/webp');
    expect(Buffer.compare(replaced.body as Buffer, WEBP)).toBe(0);

    const entries = await auditOf(post.id);
    expect(entries.map((e) => e.action)).toEqual([
      'BLOG_POST_CREATED',
      'BLOG_POST_UPDATED',
      'BLOG_POST_UPDATED',
    ]);
    expect(entries[1]).toMatchObject({
      oldValues: { title: POST.title, category: 'NEUROLOGICAL' },
      newValues: {
        title: 'تأهيل حالات الرباط الصليبي',
        category: 'SPORTS_INJURIES',
      },
    });
    expect(Object.keys(entries[1].newValues ?? {}).sort()).toEqual([
      'category',
      'title',
    ]);
    expect(entries[2].newValues).toMatchObject({
      keywords: [...KEYWORDS, 'رياضة'],
      coverImageMimeType: 'image/webp',
    });
  });

  it('delete: gone from every list, 404 everywhere afterwards (row kept, audited)', async () => {
    const post = await created();
    const other = await created();

    await request(server)
      .delete(api(`/blog-posts/${post.id}`))
      .set(as(owner))
      .expect(204);

    const owners = await request(server)
      .get(api('/blog-posts'))
      .set(as(owner))
      .expect(200);
    expect(owners.body.items.map((p: { id: string }) => p.id)).toEqual([
      other.id,
    ]);
    const site = await publicGet('/public/blog-posts').expect(200);
    expect(site.body.items.map((p: { id: string }) => p.id)).toEqual([
      other.id,
    ]);

    await publicGet(`/public/blog-posts/${post.id}`).expect(404);
    await publicGet(`/public/blog-posts/${post.id}/cover`).expect(404);
    await request(server)
      .get(api(`/blog-posts/${post.id}`))
      .set(as(owner))
      .expect(404);
    await update(post.id, { title: 'x' }).expect(404);
    await request(server)
      .delete(api(`/blog-posts/${post.id}`))
      .set(as(owner))
      .expect(404);

    const row = await ctx.dataSource
      .getRepository(BlogPost)
      .findOneByOrFail({ id: post.id });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect((await auditOf(post.id)).map((e) => e.action)).toContain(
      'BLOG_POST_DELETED',
    );
  });

  // ---------- rules ----------

  it('keywords: at least 5, trimmed, non-empty, unique ignoring case, at most 50 characters', async () => {
    const tooFew = await create({ keywords: KEYWORDS.slice(0, 4) }).expect(400);
    expect(tooFew.body.details).toEqual([
      expect.objectContaining({
        field: 'keywords',
        constraints: ['arrayMinSize'],
      }),
    ]);
    // One field is a plain string, not a list: still too few.
    await create({ keywords: 'تأهيل' }).expect(400);
    await create({ keywords: ['a', 'b', 'c', 'd', '   '] }).expect(400);
    await create({ keywords: ['Rehab', 'b', 'c', 'd', ' rehab '] }).expect(400);
    await create({ keywords: ['a', 'b', 'c', 'd', 'x'.repeat(51)] }).expect(
      400,
    );
    await update((await created()).id, { keywords: ['a', 'b'] }).expect(400);

    const ok = await create({
      keywords: [' Rehab ', 'b', 'c', 'd', 'e'],
    }).expect(201);
    expect(ok.body.keywords).toEqual(['Rehab', 'b', 'c', 'd', 'e']);
  });

  it('cover: required, JPG/PNG/WEBP only (checked by content), 5 MB at most', async () => {
    const missing = await create({}, null).expect(400);
    expect(missing.body.details).toEqual([
      expect.objectContaining({ field: 'image', constraints: ['isDefined'] }),
    ]);

    await create({}, [JPG, 'photo.jpeg']).expect(201);
    await create({}, [WEBP, 'photo.webp']).expect(201);
    for (const image of [
      [PDF, 'doc.pdf'], // a real PDF is not an image
      [Buffer.from('not an image'), 'fake.png'],
      [PNG, 'cover.jpg'], // extension does not match the content
    ] as [Buffer, string][]) {
      const res = await create({}, image).expect(422);
      expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    }
    const post = await created();
    const res = await update(post.id, {}, [PDF, 'doc.pdf']).expect(422);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');

    await create({}, [
      Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
      'big.png',
    ]).expect(413);
    expect(await ctx.dataSource.getRepository(BlogPost).count()).toBe(3);
  });

  it('content: sanitized on every write (scripts, event handlers, javascript: links); empty after that is a 400', async () => {
    const dirty =
      '<p onclick="steal()">مرحبا<script>alert(1)</script></p>' +
      '<img src="x" onerror="alert(1)">' +
      '<p><a href="javascript:alert(1)">bad</a> <a href="https://clinic.test">good</a></p>';
    const res = await create({ content: dirty }).expect(201);
    expect(res.body.content).toBe(
      '<p>مرحبا</p>' +
        '<p><a rel="noopener noreferrer" target="_blank">bad</a> ' +
        '<a href="https://clinic.test" rel="noopener noreferrer" target="_blank">good</a></p>',
    );

    const edited = await update(res.body.id, {
      content:
        '<h1 style="color:red">عنوان<iframe src="https://evil.test"></iframe></h1>',
    }).expect(200);
    expect(edited.body.content).toBe('<h1>عنوان</h1>');

    for (const content of ['<p><br></p>', '<script>alert(1)</script>']) {
      const empty = await create({ content }).expect(400);
      expect(empty.body.details).toEqual([
        expect.objectContaining({ field: 'content' }),
      ]);
    }
    await update(res.body.id, { content: '<p> </p>' }).expect(400);
  });

  // ---------- public ----------

  it('public list: newest first, paginated, category filter, no content', async () => {
    const neuro = await created();
    const ortho = await created({
      category: 'ORTHOPEDIC_SPINE',
      title: 'تأهيل حالات الرباط الصليبي قبل وبعد العملية',
    });
    const spine = await created({
      category: 'ORTHOPEDIC_SPINE',
      title: 'جهاز شد الفقرات الإلكتروني',
    });

    const page1 = await publicGet('/public/blog-posts?limit=2').expect(200);
    expect(page1.body.meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page1.body.items[0]).toEqual({
      id: spine.id,
      title: 'جهاز شد الفقرات الإلكتروني',
      description: POST.description,
      category: 'ORTHOPEDIC_SPINE',
      createdAt: expect.stringMatching(/\+0[23]:00$/),
      updatedAt: expect.any(String),
    });
    const page2 = await publicGet('/public/blog-posts?limit=2&page=2').expect(
      200,
    );
    expect(page2.body.items.map((p: { id: string }) => p.id)).toEqual([
      neuro.id,
    ]);

    const filtered = await publicGet(
      '/public/blog-posts?category=ORTHOPEDIC_SPINE',
    ).expect(200);
    expect(filtered.body.items.map((p: { id: string }) => p.id)).toEqual([
      spine.id,
      ortho.id,
    ]);
    await publicGet('/public/blog-posts?category=NOPE').expect(400);
  });

  it('public post: the content and keywords, and the cover with its type', async () => {
    const post = await created();
    const res = await publicGet(`/public/blog-posts/${post.id}`).expect(200);
    expect(res.body).toEqual({
      id: post.id,
      title: POST.title,
      description: POST.description,
      keywords: KEYWORDS,
      category: 'NEUROLOGICAL',
      content: POST.content,
      createdAt: expect.stringMatching(/\+0[23]:00$/),
      updatedAt: expect.any(String),
    });

    const file = await cover(post.id).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
  });

  // ---------- files ----------

  it('a failed database write removes the uploaded cover; recorded covers stay', async () => {
    const storage = ctx.app.get(FileStorage, { strict: false });
    const post = await created();
    const before = await storage.list('blog/');

    await withFailingInserts(ctx.dataSource, 'blog_posts', () =>
      create().expect(500),
    );
    // The update writes its audit entry in the same transaction.
    await withFailingInserts(ctx.dataSource, 'audit_logs', () =>
      update(post.id, { title: 'x' }, [JPG, 'new.jpg']).expect(500),
    );

    expect(await storage.list('blog/')).toEqual(before);
    const file = await cover(post.id).expect(200);
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
  });

  it('the orphan sweep keeps current and replaced covers', async () => {
    const storage = ctx.app.get(FileStorage, { strict: false });
    const post = await created();
    await update(post.id, {}, [JPG, 'new.jpg']).expect(200);
    const current = (
      await ctx.dataSource.getRepository(BlogPost).findOneByOrFail({
        id: post.id,
      })
    ).coverImageKey;
    const replaced = (await auditOf(post.id))[1].oldValues?.coverImageKey;
    expect(replaced).toMatch(/^blog\/.+\.png$/);
    // Left by a crash between writing the file and committing its row.
    const orphan = 'blog/orphan.png';
    await storage.put(orphan, PNG);

    // (Earlier tests' covers lost their rows to the database reset.)
    const orphans = (
      await findOrphans(
        storage,
        ctx.dataSource,
        new Date(Date.now() + 61 * 60_000),
        60,
      )
    ).map((f) => f.key);
    expect(orphans).toContain(orphan);
    expect(orphans).not.toContain(current);
    expect(orphans).not.toContain(replaced);
    await storage.delete(orphan);
  });
});
