// Seeds demo data through the API, as the OWNER from backend/.env. Run on a freshly migrated database.
//   npm run seed:demo            (API_URL defaults to http://localhost:3000/api/v1)
// The API stamps everything with "now", so past days are built through the API too and then moved back
// with SQL (timestamps only, see pastDay). That needs DB_* (backend/.env, or the environment in Docker).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DEMO_PASSWORD, DEMO_STAFF } from '../src/demo.ts';
import { addDays, cairoIso, dayOfWeek, nowCairoHHmm, todayCairo, TZ } from '../src/time.ts';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';

// SEED_OWNER_* from the environment (Docker), else from backend/.env (local run).
function backendEnvFile(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const env: Record<string, string | undefined> = { ...backendEnvFile(), ...process.env };

class HttpError extends Error {
  constructor(public status: number, public body: any, label: string) {
    super(`${label} -> ${status} ${body?.code ?? ''} ${body?.message ?? ''} ${body?.details ? JSON.stringify(body.details) : ''}`);
  }
}

async function call<T = any>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      if (path.startsWith('/public/') || path === '/auth/login') {
        throw new Error('Throttled on a public endpoint (bookings: 5 / 15 min per IP; login: 5 / min per email). Restart the backend with THROTTLE_ENABLED=false while seeding.');
      }
      const wait = Number(res.headers.get('retry-after') ?? 60);
      console.log(`  throttled on ${method} ${path}, waiting ${wait}s (tip: run the backend with THROTTLE_ENABLED=false while seeding)`);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new HttpError(res.status, data, `${method} ${path}`);
    return data as T;
  }
}

const login = async (email: string, password: string) => (await call(null, 'POST', '/auth/login', { email, password })).accessToken as string;

// ---------- dates (clinic local)
const TODAY = todayCairo();
const TOMORROW = addDays(TODAY, 1);
const isWorkday = (d: string) => dayOfWeek(d) <= 4; // Sun..Thu
let NEXT_WORKDAY = TOMORROW;
while (!isWorkday(NEXT_WORKDAY)) NEXT_WORKDAY = addDays(NEXT_WORKDAY, 1);

function shift(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  if (total < 0 || total >= 24 * 60) return '99:99';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function main() {
  console.log(`API ${API}; today ${TODAY}, tomorrow ${TOMORROW}, next working day ${NEXT_WORKDAY}`);
  if (!env.SEED_OWNER_EMAIL || !env.SEED_OWNER_PASSWORD) throw new Error('SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD are not set');
  const owner = await login(env.SEED_OWNER_EMAIL, env.SEED_OWNER_PASSWORD);

  // Idempotent: on a database that already has doctors (seeded before, or real data) do nothing.
  const existing = await call(owner, 'GET', '/doctors?limit=1');
  if (existing.meta.total > 0) {
    console.log('Doctors already exist: demo seed skipped (it only runs on a fresh database). See playground/README.md ("Reset").');
    return;
  }

  // ---------- staff
  const [rec, ...docSpecs] = DEMO_STAFF;
  await call(owner, 'POST', '/users', { name: rec.name, email: rec.email, password: DEMO_PASSWORD, role: 'RECEPTIONIST' });

  const svc = {
    assessment: await call(owner, 'POST', '/clinic-services', { name: 'Initial assessment', durationMinutes: 30, basePrice: '200.00', description: 'First visit evaluation' }),
    physio: await call(owner, 'POST', '/clinic-services', { name: 'Physiotherapy session', durationMinutes: 45, basePrice: '300.00' }),
    massage: await call(owner, 'POST', '/clinic-services', { name: 'Sports massage', durationMinutes: 60, basePrice: '400.00' }),
  };

  const docs: any[] = [];
  for (const d of docSpecs) {
    docs.push(await call(owner, 'POST', '/doctors', {
      name: d.name, email: d.email, password: DEMO_PASSWORD, specialty: 'specialty' in d ? d.specialty : 'General', isPublic: true,
      bio: `${d.name.replace('Dr. ', '')} — demo doctor`,
    }));
  }
  const [D1, D2, D3] = docs;
  const assign = (doc: any, s: any, priceOverride: string | null = null) => call(owner, 'PUT', `/doctors/${doc.id}/services/${s.id}`, { priceOverride });
  await assign(D1, svc.assessment);
  await assign(D1, svc.physio);
  await assign(D2, svc.physio, '350.00'); // price override
  await assign(D2, svc.massage);
  await assign(D3, svc.assessment);
  await assign(D3, svc.physio);
  await assign(D3, svc.massage);

  for (const doc of docs) {
    for (let day = 0; day <= 4; day++) {
      await call(owner, 'POST', `/doctors/${doc.id}/schedules`, { dayOfWeek: day, startTime: '10:00', endTime: '14:00' });
      await call(owner, 'POST', `/doctors/${doc.id}/schedules`, { dayOfWeek: day, startTime: '17:00', endTime: '21:00' });
    }
  }
  console.log('staff, services, schedules: done');

  const desk = await login(rec.email, DEMO_PASSWORD);
  const d1 = await login(docSpecs[0].email, DEMO_PASSWORD);
  const d2 = await login(docSpecs[1].email, DEMO_PASSWORD);

  // ---------- patients (created by the bookings themselves)
  const phone = (n: number) => `0101000${String(n).padStart(4, '0')}`;
  const P = {
    omar: { name: 'Omar Farouk', phone: phone(1) },
    laila: { name: 'Laila Ibrahim', phone: phone(2) },
    youssef: { name: 'Youssef Nabil', phone: phone(3) },
    nour: { name: 'Nour El-Din Sami', phone: phone(4) },
    hana: { name: 'Hana Mostafa', phone: phone(5) },
    mostafa: { name: 'Mostafa Gamal', phone: phone(6) },
    salma: { name: 'Salma Adel', phone: phone(7) },
    tarek: { name: 'Tarek Fathy', phone: phone(8) },
    ali: { name: 'Ali Hassan', phone: phone(9) },
    mariam: { name: 'Mariam Khalil', phone: phone(10) },
    khaled: { name: 'Khaled Samir', phone: phone(11) },
    rania: { name: 'Rania Fouad', phone: phone(12) },
    sherif: { name: 'Sherif Lotfy', phone: phone(13) },
    dina: { name: 'Dina Wagdy', phone: phone(14) },
    hossam: { name: 'Hossam Zaki', phone: phone(15) },
    ola: { name: 'Ola Samy', phone: phone(16) },
  };

  /** Reception booking, outside schedule; on SLOT_UNAVAILABLE try the next time (step minutes). */
  async function book(p: { name: string; phone: string }, doc: any, s: any, date: string, time: string, step = 15, notes?: string) {
    for (let i = 0; i < 40; i++) {
      const t = shift(time, i * step);
      if (t > '23:00') break;
      try {
        return await call(desk, 'POST', '/appointments', {
          ...p, doctorId: doc.id, serviceId: s.id, startAt: cairoIso(date, t), allowOutsideSchedule: true, notes,
        });
      } catch (e) {
        if (e instanceof HttpError && e.body?.code === 'SLOT_UNAVAILABLE') continue;
        throw e;
      }
    }
    throw new Error(`no free time for ${p.name}`);
  }
  // Attend creates the visit and its invoice in one call (the response has invoiceId).
  const attend = (a: any) => call(desk, 'POST', `/appointments/${a.id}/attend`);

  // ---------- history: six past days over the last ~6 weeks (so the reports span two months)
  await seedHistory({ owner, desk, d1, d2, d3: await login(docSpecs[2].email, DEMO_PASSWORD) }, { D1, D2, D3 }, svc, P, book, attend);

  // ---------- public bookings first (they need real schedule slots on the next working day)
  const publicSlots = async (doc: any, s: any) =>
    call<any[]>(owner, 'GET', `/appointments/availability?doctorId=${doc.id}&serviceId=${s.id}&date=${NEXT_WORKDAY}`);
  const publicBook = async (p: { name: string; phone: string }, doc: any, s: any, pick: number) => {
    const slots = await publicSlots(doc, s);
    if (!slots.length) throw new Error(`no public slots for ${doc.name} on ${NEXT_WORKDAY}`);
    const slot = slots[Math.min(pick, slots.length - 1)];
    return call(null, 'POST', '/public/appointments', { ...p, doctorId: doc.id, serviceId: s.id, startAt: slot.startAt });
  };
  const pub = [
    await publicBook(P.ali, D1, svc.physio, 2),
    await publicBook(P.mariam, D2, svc.massage, 4),
    await publicBook(P.khaled, D3, svc.assessment, 1),
  ];
  console.log('public bookings (PENDING):', pub.map((b) => b.referenceCode).join(', '));

  // ---------- today
  // a) Omar: full flow — attended, 10% discount, paid in full, D1 writes and signs the note in one call.
  const aOmar = await book(P.omar, D1, svc.assessment, TODAY, '10:00');
  const vOmar = await attend(aOmar);
  await call(desk, 'POST', `/invoices/${vOmar.invoiceId}/discount`, { type: 'PERCENT', value: '10', reason: 'Student discount' });
  const iOmar = await call(desk, 'GET', `/invoices/${vOmar.invoiceId}`);
  await call(desk, 'POST', `/invoices/${vOmar.invoiceId}/payments`, { amount: iOmar.balance, method: 'CASH' });
  await call(d1, 'PUT', `/patients/${aOmar.patient.id}/medical-info`, {
    allergies: 'Penicillin', chronicConditions: 'Mild asthma', currentMedications: 'Salbutamol inhaler as needed',
  });
  await call(d1, 'POST', `/visits/${vOmar.id}/note/sign`, {
    chiefComplaint: 'Lower back pain for 3 weeks after lifting', assessment: 'Mechanical low back pain, no red flags',
    treatmentDone: 'Assessment, core activation, heat therapy', plan: 'Physio 2x/week for 3 weeks; home: cat-camel, bird-dog', painScore: 6,
  });

  // b) Laila: attended, fixed discount, partial payment, no note yet.
  const aLaila = await book(P.laila, D1, svc.physio, TODAY, '11:00');
  const vLaila = await attend(aLaila);
  await call(desk, 'POST', `/invoices/${vLaila.invoiceId}/discount`, { type: 'FIXED', value: '50.00', reason: 'Returning patient' });
  await call(desk, 'POST', `/invoices/${vLaila.invoiceId}/payments`, { amount: '100.00', method: 'CARD', reference: 'POS 4471' });

  // c) Youssef: attended with D2, draft note.
  const aYoussef = await book(P.youssef, D2, svc.physio, TODAY, '10:00');
  const vYoussef = await attend(aYoussef);
  await call(d2, 'PUT', `/visits/${vYoussef.id}/note`, { chiefComplaint: 'Knee pain after running' });

  // d) Nour: confirmed, not arrived yet.
  await book(P.nour, D2, svc.massage, TODAY, '12:00');

  // e) Hana: cancelled.
  const aHana = await book(P.hana, D3, svc.assessment, TODAY, '10:00');
  await call(desk, 'POST', `/appointments/${aHana.id}/cancel`, { reason: 'Patient called to cancel' });

  // f) Salma: attended with D3, unpaid invoice.
  const aSalma = await book(P.salma, D3, svc.massage, TODAY, '17:00');
  await attend(aSalma);

  // g) Mostafa: no-show (needs a start in the past), stepping back from now - 2h.
  const now = nowCairoHHmm();
  const noShowStart = shift(`${now.slice(0, 2)}:${String(Math.floor(Number(now.slice(3)) / 15) * 15).padStart(2, '0')}`, -120);
  if (now >= '02:30') {
    const aMostafa = await book(P.mostafa, D3, svc.physio, TODAY, noShowStart, -15);
    await call(desk, 'POST', `/appointments/${aMostafa.id}/no-show`);
  } else {
    await book(P.mostafa, D3, svc.physio, TODAY, '19:00');
    console.log('  (too early in the day for a NO_SHOW example; Mostafa stays CONFIRMED)');
  }

  // h) Tarek: walk-in with D1 (invoice created with it).
  await call(desk, 'POST', '/visits/walk-in', { ...P.tarek, doctorId: D1.id, serviceId: svc.assessment.id });

  // i) Ola: attended by mistake, then undone (voided visit, cancelled invoice, back to CONFIRMED).
  const aOla = await book(P.ola, D2, svc.physio, TODAY, '18:00');
  await attend(aOla);
  await call(desk, 'POST', `/appointments/${aOla.id}/undo-attend`, { reason: 'Sent in the wrong patient' });

  // j) Same phone as Laila, different name, via public booking -> nameMismatch.
  const mismatch = await publicBook({ name: 'Laila Mahmoud', phone: P.laila.phone }, D3, svc.physio, 3);
  console.log('same phone / different name booking:', mismatch.referenceCode, 'on', NEXT_WORKDAY);

  // ---------- tomorrow
  // Omar sees D2 tomorrow: D2 can read D1's signed note (shared clinical history).
  await book(P.omar, D2, svc.physio, TOMORROW, '11:00');
  await book(P.rania, D1, svc.assessment, TOMORROW, '10:00');
  await book(P.sherif, D3, svc.massage, TOMORROW, '18:00');
  await book(P.hossam, D3, svc.assessment, TOMORROW, '17:00');
  const aDina = await book(P.dina, D1, svc.physio, TOMORROW, '12:00');
  await call(desk, 'POST', `/appointments/${aDina.id}/reschedule`, { startAt: cairoIso(TOMORROW, '13:00'), allowOutsideSchedule: true, reason: 'Patient asked for later' });

  // ---------- one expense today
  const cats = await call<any[]>(desk, 'GET', '/expense-categories');
  await call(desk, 'POST', '/expenses', {
    categoryId: cats[0].id, description: 'Tea, sugar and water', amount: '85.00', expenseDate: TODAY, paymentMethod: 'CASH', vendorName: 'Corner shop',
  });

  console.log('\nDone. Accounts:');
  console.log(`  OWNER         ${env.SEED_OWNER_EMAIL} / (SEED_OWNER_PASSWORD from backend/.env)`);
  for (const s of DEMO_STAFF) console.log(`  ${s.role.padEnd(13)} ${s.email} / ${DEMO_PASSWORD}   (${s.name})`);
  console.log(`\nToday (${TODAY}): Omar attended+paid+signed note, Laila attended+partial, Youssef attended (draft note),`);
  console.log(`  Nour confirmed, Hana cancelled, Salma attended unpaid, Mostafa no-show, Tarek walk-in, Ola attend undone.`);
  console.log(`Tomorrow (${TOMORROW}): Omar with ${D2.name} (shared history), Rania, Sherif, Hossam, Dina (rescheduled).`);
  console.log(`Next working day (${NEXT_WORKDAY}): 4 PENDING public bookings incl. "Laila Mahmoud" (name mismatch).`);
}

// ---------- past days

// Rows a past day writes, and their time columns. Rows are picked by `by >= marker`: nothing else
// writes while the seed runs, and earlier days were already moved back.
const SHIFTED: [table: string, columns: string[], by: string][] = [
  ['patients', ['created_at', 'updated_at'], 'created_at'],
  ['appointments', ['start_at', 'end_at', 'created_at', 'updated_at'], 'created_at'],
  ['appointment_status_history', ['changed_at'], 'changed_at'],
  ['visits', ['attended_at', 'voided_at', 'created_at', 'updated_at'], 'created_at'],
  ['visit_status_history', ['changed_at'], 'changed_at'],
  ['invoices', ['issued_at', 'cancelled_at', 'created_at', 'updated_at'], 'created_at'],
  ['invoice_items', ['created_at', 'updated_at'], 'created_at'],
  ['invoice_discounts', ['applied_at', 'removed_at', 'created_at', 'updated_at'], 'created_at'],
  ['payments', ['received_at', 'voided_at', 'created_at', 'updated_at'], 'created_at'],
  ['clinical_notes', ['signed_at', 'created_at', 'updated_at'], 'created_at'],
  ['clinical_note_addenda', ['created_at'], 'created_at'],
  ['patient_medical_info', ['updated_at'], 'updated_at'],
  ['expenses', ['expense_date', 'voided_at', 'created_at', 'updated_at'], 'created_at'],
  ['audit_logs', ['created_at'], 'created_at'],
];

/**
 * Builds one past day through the API (so every rule and total is the real one), then moves everything
 * it wrote back by `daysAgo` days in one transaction. The session runs in the clinic zone, so wall-clock
 * times stay the same across DST.
 */
async function pastDay(db: pg.Client, daysAgo: number, label: string, build: () => Promise<void>) {
  const { rows: [{ marker }] } = await db.query('SELECT now() AS marker');
  await build();
  await db.query('BEGIN');
  for (const [table, columns, by] of SHIFTED) {
    const set = columns
      .map((c) => `${c} = ${c} - ${c.endsWith('_date') ? '$2::int' : 'make_interval(days => $2::int)'}`)
      .join(', ');
    await db.query(`UPDATE ${table} SET ${set} WHERE ${by} >= $1`, [marker, daysAgo]);
  }
  await db.query('COMMIT');
  console.log(`  ${addDays(TODAY, -daysAgo)}: ${label}`);
}

type Tokens = { owner: string; desk: string; d1: string; d2: string; d3: string };
type Person = { name: string; phone: string };

/**
 * Omar, Laila and Youssef get a rich history: several visits with different doctors, signed notes and
 * addenda, discounts (one repeated), a voided payment, a refund, a reschedule, no-shows, a cancellation,
 * unpaid balances, plus a few expenses. Everything happens "now" and is then moved back (pastDay).
 */
async function seedHistory(
  t: Tokens,
  doc: Record<'D1' | 'D2' | 'D3', any>,
  svc: Record<'assessment' | 'physio' | 'massage', any>,
  P: Record<'omar' | 'laila' | 'youssef' | 'hana', Person>,
  book: (p: Person, doc: any, s: any, date: string, time: string, step?: number) => Promise<any>,
  attend: (a: any) => Promise<any>,
) {
  const now = nowCairoHHmm();
  if (now < '03:00') {
    console.log('  (history skipped: it needs appointment times earlier today; run the seed after 03:00 Cairo time)');
    return;
  }
  // Just before now, stepping back on conflicts: attend works the same day, no-show needs a passed start.
  const recent = shift(`${now.slice(0, 2)}:${String(Math.floor(Number(now.slice(3)) / 15) * 15).padStart(2, '0')}`, -15);
  const bookRecent = (p: Person, d: any, s: any) => book(p, d, s, TODAY, recent, -15);
  const visit = async (p: Person, d: any, s: any) => attend(await bookRecent(p, d, s));
  const walkIn = (p: Person, d: any, s: any) => call(t.desk, 'POST', '/visits/walk-in', { ...p, doctorId: d.id, serviceId: s.id });
  const noShow = async (p: Person, d: any, s: any) => call(t.desk, 'POST', `/appointments/${(await bookRecent(p, d, s)).id}/no-show`);
  const discount = (v: any, body: object) => call(t.desk, 'POST', `/invoices/${v.invoiceId}/discount`, body);
  const pay = (v: any, amount: string, method: string) => call(t.desk, 'POST', `/invoices/${v.invoiceId}/payments`, { amount, method });
  const payAll = async (v: any, method: string) => pay(v, (await call(t.desk, 'GET', `/invoices/${v.invoiceId}`)).balance, method);
  const sign = (token: string, v: any, note: object) => call(token, 'POST', `/visits/${v.id}/note/sign`, note);
  const addendum = (token: string, note: any, content: string) => call(token, 'POST', `/clinical-notes/${note.id}/addenda`, { content });
  const cats = await call<any[]>(t.desk, 'GET', '/expense-categories');
  const expense = (i: number, description: string, amount: string, paymentMethod: string) =>
    call(t.desk, 'POST', '/expenses', { categoryId: cats[i % cats.length].id, description, amount, expenseDate: TODAY, paymentMethod });

  const db = new pg.Client({
    host: env.DB_HOST, port: Number(env.DB_PORT ?? 5432), user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE,
  });
  await db.connect();
  await db.query(`SET TIME ZONE '${TZ}'`);
  console.log('history (built now, moved back):');
  try {
    await pastDay(db, 41, 'Omar first assessment (Dr. Ahmed), Laila walk-in with discount', async () => {
      const v = await visit(P.omar, doc.D1, svc.assessment);
      await payAll(v, 'CASH');
      await call(t.d1, 'PUT', `/patients/${v.patient.id}/medical-info`, { allergies: 'Penicillin', chronicConditions: 'Mild asthma' });
      await sign(t.d1, v, {
        chiefComplaint: 'Lower back pain after lifting', assessment: 'Mechanical low back pain, no red flags',
        treatmentDone: 'Assessment, core activation', plan: 'Physio twice a week', painScore: 7,
      });
      const w = await walkIn(P.laila, doc.D3, svc.assessment);
      await discount(w, { type: 'FIXED', value: '30.00', reason: 'Returning patient' });
      await payAll(w, 'CARD');
      await expense(1, 'Cleaning supplies', '120.00', 'CASH');
    });
    await pastDay(db, 34, 'Omar with Dr. Mona (student discount), Youssef massage, Laila no-show', async () => {
      const v = await visit(P.omar, doc.D2, svc.physio);
      await discount(v, { type: 'PERCENT', value: '10', reason: 'Student discount' });
      await payAll(v, 'CASH');
      await sign(t.d2, v, { assessment: 'Improving, pain 5/10', treatmentDone: 'Manual therapy, McKenzie extensions', painScore: 5 });
      const y = await visit(P.youssef, doc.D2, svc.massage);
      await payAll(y, 'INSTAPAY');
      await sign(t.d2, y, { assessment: 'Tight hamstrings after running', treatmentDone: 'Sports massage' });
      await noShow(P.laila, doc.D1, svc.physio);
    });
    await pastDay(db, 27, 'Omar no-show, Laila payment voided and re-entered, Hana cancelled', async () => {
      await noShow(P.omar, doc.D1, svc.physio);
      const v = await visit(P.laila, doc.D1, svc.physio);
      const wrong = await pay(v, '300.00', 'CASH');
      await call(t.desk, 'POST', `/payments/${wrong.id}/void`, { reason: 'Recorded on the wrong invoice' });
      await payAll(v, 'CARD');
      const note = await sign(t.d1, v, { assessment: 'Neck strain from desk work', treatmentDone: 'Mobilisation, posture advice' });
      await addendum(t.d1, note, 'Patient called: pain much better the next day.');
      const h = await bookRecent(P.hana, doc.D3, svc.assessment);
      await call(t.desk, 'POST', `/appointments/${h.id}/cancel`, { reason: 'Patient travelling' });
    });
    await pastDay(db, 20, 'Omar rescheduled to Dr. Karim, refund; Youssef unpaid', async () => {
      const a = await bookRecent(P.omar, doc.D3, svc.massage);
      const moved = await call(t.desk, 'POST', `/appointments/${a.id}/reschedule`, {
        startAt: cairoIso(TODAY, shift(recent, -90)), allowOutsideSchedule: true, reason: 'Patient asked for earlier',
      });
      const v = await attend(moved);
      const paid = await payAll(v, 'CARD');
      await call(t.owner, 'POST', `/payments/${paid.id}/refund`, { amount: '100.00', reason: 'Session cut short' });
      const note = await sign(t.d3, v, { assessment: 'Paraspinal spasm', treatmentDone: 'Massage, stopped early (dizziness)' });
      await addendum(t.d3, note, 'Dizziness resolved, cleared to continue.');
      const y = await visit(P.youssef, doc.D1, svc.assessment);
      await sign(t.d1, y, { assessment: 'Patellofemoral pain', treatmentDone: 'Assessment, taping' });
      await expense(2, 'Printer ink', '250.00', 'CARD');
    });
    await pastDay(db, 13, 'Omar repeat discount, Laila partial payment, Youssef no-show', async () => {
      const v = await visit(P.omar, doc.D2, svc.physio);
      const last = await call(t.desk, 'GET', `/patients/${v.patient.id}/last-discount?excludeInvoiceId=${v.invoiceId}`);
      await discount(v, { repeatFromDiscountId: last.id });
      await payAll(v, 'WALLET');
      await sign(t.d2, v, { assessment: 'Pain 3/10, back to light gym', treatmentDone: 'Progressive loading' });
      await call(t.d2, 'PUT', `/patients/${v.patient.id}/medical-info`, {
        allergies: 'Penicillin', chronicConditions: 'Mild asthma', currentMedications: 'Salbutamol inhaler as needed',
      });
      const w = await walkIn(P.laila, doc.D2, svc.massage);
      await discount(w, { type: 'PERCENT', value: '15', reason: 'Loyal patient' });
      await pay(w, '200.00', 'CASH');
      await noShow(P.youssef, doc.D2, svc.physio);
    });
    await pastDay(db, 6, 'Laila with Dr. Karim, Youssef partial payment', async () => {
      const v = await visit(P.laila, doc.D3, svc.physio);
      await payAll(v, 'INSTAPAY');
      const y = await visit(P.youssef, doc.D1, svc.physio);
      await discount(y, { type: 'FIXED', value: '50.00', reason: 'Returning patient' });
      await pay(y, '100.00', 'CASH');
      await expense(0, 'Tea and water', '90.00', 'CASH');
    });
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e.message);
  if (String(e.message).includes('fetch failed')) console.error(`Is the backend running at ${API}?`);
  process.exit(1);
});
