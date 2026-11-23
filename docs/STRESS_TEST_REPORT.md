# Stress test report (2026-11-22)

Load, spike, soak and concurrency tests of the backend API on branch `feature/salaries-identity-appointment-types`
(the built `dist/` of the current working tree). No application code was changed. Each finding has an ID; reply
with the IDs you want fixed.

## Verdict

The system is **stable and correct under load**: about 290,000 requests, a 500-user spike and a 10-minute soak
produced **zero 5xx responses, zero logged errors, no crash and no memory leak**, and all **10 concurrency tests
passed** (no double-booking, no double payment, no over-refund, no duplicate patient or check-in, gapless document
numbers). Capacity is far above what one clinic needs (about 20x headroom, see "What the numbers mean").

The real problems are not throughput:

| ID | Severity | Finding |
|---|---|---|
| **P1** | High | The daily summary and 3 reports recompute "what patients owe" from **all invoices ever issued** on every call: 0.8 s for one user today, 1.2–5 s under load, ~80% of database CPU, and it grows with every invoice. |
| **P2** | Medium | Double-clicking **Create walk-in**, **Record payment** (partial amount) or **Add expense** creates duplicates: buttons show a spinner but are never disabled. |
| **P3** | Medium | All passport (non-Egyptian) patients share code digits `0000`: the clinic can register **at most 9,999 passport patients, ever**; the next one is refused. |
| P4 | Low | Write bursts queue on the gapless number counters with a 10-connection pool, so plain reads wait too (p50 5 ms → 246 ms during a payment burst). |
| P5 | Low | One Node process is the throughput ceiling (~190 req/s desk traffic); 32% of its CPU is TypeORM hydration, 10% Luxon time-zone formatting. |
| P6 | Low | Logins use argon2 defaults (64 MiB per hash): backend memory reached ~840 MB during a login burst. |
| P7 | Low | No load shedding or server timeout: at 500 users latency reached 7–9 s instead of fast failures. |
| P8 | Info | ~0.7 KB of log per request and no Docker log rotation configured. |

## Test setup

| | |
|---|---|
| Machine | Intel i7-12700H (14 cores / 20 threads), 15.7 GB RAM, Windows 11. Load generator on the same machine. |
| Backend | `node dist/main.js`, one process (as in Docker), `NODE_ENV=production`, `LOG_LEVEL=info`, Node 24.13.1. Throttling **off** except in the rate-limit test. |
| Database | PostgreSQL 17.11 in the `clinic-postgres` container (production image is 16), default settings (`max_connections` 100, `shared_buffers` 128 MB). TypeORM default pool: **10 connections**. Throwaway database `clinic_db_stress`; the live stack and other databases were not touched. |
| Data | Created through the API (which was itself the write test), then spread over 2 years by shifting timestamps only: **16,000 patients, 40,064 visits and invoices, 38,055 payments, 1,985 expenses, 4,897 upcoming appointments, 157,000 audit rows (305 MB)**: about 55 visits/day for 10 doctors over 2 years. 6 services, 10 doctors (09:00–21:00 every day), 5 receptionists. |
| Tool | Custom Node script (keep-alive HTTP, closed-loop virtual users, per-endpoint percentiles), sampling backend CPU/RAM, Postgres CPU and `pg_stat_activity` (connections, lock waits) every second. |

A production server with fewer cores will show lower numbers for P1, P6 and the database-heavy endpoints (they used
5–13 cores here); the single-process Node ceiling (P5) depends on the speed of one core.

## Results

### Writes (20 concurrent receptionists)

| Operation | Requests | Throughput | p50 | p95 | p99 | Errors | Bottleneck |
|---|---|---|---|---|---|---|---|
| Register patient (National ID) | 6,000 | **339/s** | 58 ms | 69 ms | 83 ms | 0 | Node CPU (100%) |
| Register patient (passport) | 11,800 | 258/s | 61 ms | 175 ms | 268 ms | 2,001 refused, see P3 | 9 of 10 connections waiting on `patient_code_counters` |
| Walk-in (visit + invoice) | 40,000 | **101/s** | 175 ms | 350 ms | 477 ms | 0 | `document_counters` row lock (8 of 9 busy connections waiting) |
| Record payment | 38,042 | **106/s** | 126 ms | 409 ms | 615 ms | 0 | same counter lock |
| Book appointment | 4,897 | 196/s | 99 ms | 132 ms | 144 ms | 0 | Node CPU |
| Add expense | 3,000 | 251/s | 18 ms | 146 ms | 250 ms | 0 (1,015 correct refusals: system-reserved category) | — |

Walk-in throughput stayed flat (~100/s) while the tables grew from 0 to 40,000 rows.

### Single-user response time (2 years of data)

Most screens answer in **2–45 ms**. Patient search (trigram index) 11–20 ms; patient page 5 ms; overview 15 ms;
today's calendar 25 ms; visit queue 14 ms; availability 8 ms; deep pagination (page 700) 14 ms; public website
1–7 ms. Page size is capped at 100.

The outliers (all P1 except the last):

| Endpoint | p50 | Used by |
|---|---|---|
| `GET /billing/daily-summary` | **802 ms** | Reception (end of day cash) |
| `GET /reports/money-flow` (1 year) | 774 ms | Owner |
| `GET /reports/patients-owe` | 724 ms | Owner |
| `GET /reports/summary` (1 month or 1 year) | 411–473 ms | Owner dashboard |
| `GET /doctor-salaries` | 210 ms | Owner (with no salary terms set; see "Not covered") |

### Concurrency ladder: reception desk mix

Mix of today's calendar, visit queue, patient search, patient pages, invoices, availability and 3% daily summary.
20 seconds per level.

| Users | Throughput | p50 | p95 | p99 | Errors | Node CPU | Postgres CPU |
|---|---|---|---|---|---|---|---|
| 1 | 25/s | 14 ms | 32 ms | 798 ms | 0 | 18% | 75% |
| 10 | **132/s** | 37 ms | 87 ms | 1.3 s | 0 | 97% | 553% |
| 25 | 124/s | 111 ms | 363 ms | 1.7 s | 0 | 86% | 675% |
| 50 | 134/s | 237 ms | 732 ms | 2.0 s | 0 | 100% | 559% |
| 100 | 126/s | 516 ms | 1.8 s | 3.1 s | 0 | 99% | 584% |
| 200 | 126/s | 1.0 s | 3.5 s | 5.2 s | 0 | 102% | 578% |

The same mix **without the daily summary**: **190/s**, p95 95 ms at 10 users, Postgres CPU only ~110%. That one
endpoint (3% of requests) used ~80% of the database CPU. Throughput saturates at about 10 users; more users only
wait longer (queueing), they never get errors.

### Other scenarios

| Scenario | Result |
|---|---|
| Owner reports during desk work (30 desk users + 3 owners on reports) | Desk throughput −12% (135 → 119/s), p95 +20% (418 → 499 ms). Reports took 1–2 s each (money-flow 1.9 s, patients-owe 1.4 s, summary 1.0 s). |
| Public website (services, doctors, free slots, packages, blog) | **~610/s** flat from 10 to 200 visitors; p95 34 ms (10), 186 ms (50), 765 ms (200). |
| Spike: 500 users at once for 30 s | 177/s, p50 1.9 s, p95 6.9 s, p99 8.8 s, **0 errors, 0 timeouts**, memory 581 MB. Recovered at once. |
| Login (argon2id) | ~48 logins/s max, using ~12 of 20 threads; p50 59 ms alone, 1 s at 50 at once. Memory up to ~840 MB. |
| 50 simultaneous logins while 10 desks work | Simple reads: 658/s → 186/s, p50 15 → 53 ms. |
| Soak: 10 minutes, 30 users, mixed desk/public/report traffic | ~93,000 requests, **0 errors**. 140–155/s every minute, p50 87–98 ms, p95 277–383 ms, no drift. Memory flat at ~482 MB from minute 4; heap swung 95–303 MB and fell to **57 MB after a forced GC** (RSS 141 MB): **no leak**. |

### Concurrency correctness (20 identical requests sent at the same instant)

| Test | Result |
|---|---|
| One doctor, one slot, 20 bookings | ✅ 1 booked, 19 × 409 `SLOT_UNAVAILABLE`, 1 row |
| One patient, 10 doctors, same time | ✅ 1 booked, 9 × 409 `PATIENT_OVERLAP` |
| Full payment posted 20× | ✅ 1 recorded, 19 × 422 `OVERPAYMENT`; paid exactly once |
| 10 partial payments adding up to the total, at once | ✅ all 10 recorded, `amount_paid` = total (no lost update) |
| Full refund posted 10× | ✅ 1 refund, 9 × 422 `REFUND_EXCEEDS_PAYMENT` |
| Same new patient registered 20× | ✅ 1 created, 19 × 409, 1 row |
| Same appointment checked in 20× | ✅ 1 visit, 1 invoice, 19 × 409 `ALREADY_ATTENDED` |
| Public website: 20 visitors book the same free slot | ✅ 1 booked, 19 × 409 |
| Numbers after all tests | ✅ 40,064 invoices, 38,055 receipts, 1,985 expenses: unique and gapless; 16,026 patient codes unique |
| New-patient walk-in sent 10× | ✅ 1 patient row, no 500, but **10 visits + 10 invoices** (by design a walk-in never blocks): see P2 |

### Rate limiting (throttling on)

| Rule | Observed |
|---|---|
| Login: 5 per minute per email + IP | 5 × 401, then 429; another account from the same IP still logs in ✅ |
| 120 requests per minute per user | 120 × 200, then 429; another user unaffected ✅ |
| Public routes: 30 per minute per IP | 30 × 200, then 429 ✅ |
| Flood of 3,000 requests from 100 connections | Refused at ~1,270/s, p95 123 ms, health check 2 ms afterwards ✅ |

The frontend does not poll (only a 60 s clock tick), so normal use stays well under 120 requests per minute.

### Where the Node CPU goes (20 s profile, desk mix)

TypeORM 32% (entity hydration, query building), Luxon 10% (`partsOffset`: every timestamp of every row is converted
to the clinic zone), pg + date parsing 14%, Node I/O 20%, application code 3%, Express 2%, logging (pino) 1%.

## What the numbers mean for the clinic

A receptionist or doctor actively using the app makes roughly 10–30 API calls per minute. 15 staff at their busiest
is about 5–8 requests per second, and a walk-in or payment happens a few times per minute. Measured capacity:
~125–190 requests/s of desk traffic and ~100 walk-ins or payments per second, i.e. **about 20x headroom**.
Response times only become noticeable for the P1 endpoints, and those get slower every month.

## Findings and recommendations

### P1 (High): "Patients owe" is recomputed from all history on every call

`OutstandingService.patientsOweAt` (`backend/src/modules/outstanding/outstanding.service.ts`, using
`INVOICES_AT`/`TOTAL_AT`/`PAID_BEFORE` from `as-of.sql.ts`) runs two correlated subqueries for **every invoice ever
issued**, and PostgreSQL evaluates each of them **twice**, because the outer query uses `total` and `paid` twice
(`EXPLAIN ANALYZE`: 4 subplans × 40,050 loops, 636,000 buffer reads, ~500 ms). `flow()` calls it twice (opening and
closing), so the reception daily summary costs ~0.8 s, as do `/reports/summary`, `/reports/money-flow` and
`/reports/patients-owe`.

- **Today:** 0.4–0.8 s for one user; 1.2–5.4 s with 10–200 users; ~80% of database CPU from 3% of requests.
- **Growth:** linear in the number of invoices. Estimate at this volume: ~2 s per daily summary after 5 years
  (~100,000 invoices), more on a server with fewer cores.
- **Fix, measured on the same data (same result: 1,478,825.00 owed on 6,024 unpaid invoices):**

  | Query form | Time |
  |---|---|
  | Current | 420–495 ms |
  | Same, subquery materialized (`OFFSET 0`): no double evaluation | 229 ms |
  | Set-based: payments summed per invoice once, latest total per invoice with `DISTINCT ON`, hash-joined | **63 ms** |

  Recommended: the set-based form (only the SQL in `as-of.sql.ts`/`INVOICES_AT` changes; the existing e2e tests for
  outstanding balances cover it). Longer term, a stored closing balance per day would make it constant time.

### P2 (Medium): Double submit creates duplicate walk-ins, partial payments and expenses

`Button` (`frontend/src/ui/controls.tsx`) shows a spinner (`loading`/`busy`) but never sets `disabled`, and `busy`
only tracks `onClick`, not form submits. The walk-in form (`Booking.tsx`) passes no `loading` at all, and
`recordPayment` (`Invoice.tsx`) does not check `paying`. The server accepts each request on its own merits:

- **Walk-in:** 2 visits + 2 invoices (test above: 10 identical requests → 10 visits).
- **Partial payment** (e.g. 100 of 300): recorded twice. A full payment is safe (`OVERPAYMENT`).
- **Expense:** recorded twice.
- Bookings and patient registration are safe (overlap and uniqueness checks).

Under load a walk-in takes 175–350 ms, so a quick double-click lands inside the window. Fix: disable the button while
busy (one change in `Button`: `disabled={isBusy || rest.disabled}`), pass `loading` on the walk-in, booking and
expense forms, and return early from submit handlers while a request is in flight. Optional server-side guard: an
`Idempotency-Key` header on these POSTs.

### P3 (Medium): At most 9,999 passport patients, ever

Patient codes are `RH` + 4 code digits + a 4-digit sequence; the digits are the National ID's first 4, or `0000` for a
passport (`codeDigits` in `patients/patient-identity.ts`). Every passport patient therefore shares one counter, capped
at 9,999 (`chk_patient_code_counters_last_value`). The test hit it: patient 10,000 with a passport got
`422 PATIENT_CODE_EXHAUSTED` and **cannot be registered**. Egyptian patients are spread over birth year and month
(9,999 per bucket), which a single clinic will not reach. All passport registrations also queue on that one row
(p95 175 ms vs 69 ms with National IDs). **Decision for you:** accept the limit, or give passports a wider sequence
or their own prefix scheme.

### P4 (Low): Write bursts starve reads (counter locks + 10-connection pool)

Invoice, receipt and expense numbers are gapless: the `document_counters` row stays locked until the transaction
commits, so concurrent walk-ins/payments run one at a time through that row (8–9 of 10 connections waiting). Reads
then wait for a free connection: `GET /invoices/:id` went from ~5 ms to **246 ms p50** during the payment burst.
Irrelevant at a few writes per minute; it matters for imports or bulk operations. Options: take the number as the
last statement before commit (shorter lock), and raise the pool to ~20 (`extra: { max: 20 }` in
`typeorm.options.ts`; Postgres allows 100).

### P5 (Low): One Node process is the ceiling

Node pins one core at ~190 req/s (desk) or ~610 req/s (public). No action needed at clinic scale. Cheap win if ever
needed: cache the zone offset in `toIso`/`localDate` (`common/time/clinic-time.util.ts`) to remove most of Luxon's
10%. Running two instances would require a shared store for the in-memory rate limiter.

### P6 (Low): Login memory

`hashPassword` uses argon2 defaults (argon2id, 64 MiB, parallelism 4). A burst of logins raised backend memory to
~840 MB (idle ~250 MB). On a 1–2 GB server this could get the container killed. Options: OWASP's lighter argon2id
profile (19 MiB, t=2, p=1) for new hashes (existing hashes keep verifying, their parameters are stored in them), or
a container memory limit with headroom.

### P7 (Low): No load shedding

With 500 users latency grew to 7–9 s; nothing failed fast. Fine for a clinic; a server-side request timeout
(e.g. 30 s) would stop a stuck client from holding a connection.

### P8 (Info): Log volume

At `info` every request is logged with its headers: ~0.7 KB per request (143 MB for 195,000 requests, about 7 MB a
day at 10,000 requests). The compose files set no log rotation; add
`logging: { driver: json-file, options: { max-size: 20m, max-file: '5' } }` to the backend service.

## Not covered

- File uploads/downloads (expense receipts, attachments, blog covers).
- Salary statements with salary terms configured (`/doctor-salaries` took 210 ms with none; it reads visits, so it
  will grow with commission-based terms), packages and referral commissions under load.
- Past appointments: history was built from walk-ins, so attendance/no-show reports ran on little appointment data.
- The browser UI and the nginx frontend container; network latency between server and clinic.
- A smaller production-like server (the numbers above are from a 20-thread laptop).

## Reproducing

The scripts live outside the repository (session scratchpad: `setup.mjs`, `writes.mjs`, `reads.mjs`, `races.mjs`,
`auth.mjs`, `inspect.mjs`, `shift-history.sql`). They need a throwaway database (`clinic_db_stress`) and a backend on
port 3200; ask to move them into the repository if you want to rerun them later.
