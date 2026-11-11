# Simplification report (before Stage 7)

> **Outcome:** every item (S1–S7, D1–D6, N1–N4, T1–T4) was approved and applied on branch `chore/simplify`,
> together with "payments.reference is optional for every method". The S1 schema change is a new migration,
> `1793318095089-PaymentsManualReference`. e2e went from 103 s to 45 s (578 tests), and unit tests take 0.75 s (393 tests).
> The rest of this file is the original audit, kept for reference.

Audit of `backend/` as of branch `feature/stage-6-billing` (commit `b10c6c5` plus the uncommitted expenses work).
No code was changed. Each item has an ID; reply with the IDs you approve.

## Before Step 2: two decisions

1. **`main` does not contain most of this code.** `origin/main` stops at the Stage 5 merge (`17de4f3`).
   Stage 6A–6C is on `feature/stage-6-billing` (not merged), and the expenses module, the storage helpers
   and the `Expenses` migration are **uncommitted** in the working tree. About 70% of the candidates below
   are in that code. Options:
   - **(a) Recommended:** commit expenses, merge the Stage 6 PR, then branch `chore/simplify` from `main`.
   - (b) Branch `chore/simplify` from `feature/stage-6-billing` after committing expenses.
2. **For items that change the DB (only S1):** the `Payments` migration has not reached `main` or production.
   I can edit `1793316278307-Payments.ts` in place (simpler history, but every dev DB must re-run it),
   or add a new migration (safe, one more file). Tell me which.

## Test runtime (baseline)

| Suite | Files | Tests | Time |
|---|---|---|---|
| `npm test` (unit) | 14 | 394 | **0.96 s** (2 s wall) |
| `npm run test:e2e` | 14 | 586 | **103 s** (104 s wall: tests 78 s, imports 17 s, build + migrations ~6 s) |

10 slowest test files:

| # | File | Tests | Time |
|---|---|---|---|
| 1 | `test/visits.e2e-spec.ts` | 27 | 20.8 s |
| 2 | `test/appointments.e2e-spec.ts` | 26 | 8.3 s |
| 3 | `test/patients.e2e-spec.ts` | 22 | 8.0 s |
| 4 | `test/billing-payments.e2e-spec.ts` | 17 | 6.8 s |
| 5 | `test/billing-invoices.e2e-spec.ts` | 15 | 5.7 s |
| 6 | `test/billing-discounts.e2e-spec.ts` | 13 | 4.7 s |
| 7 | `test/expenses.e2e-spec.ts` | 11 | 4.1 s |
| 8 | `test/users.e2e-spec.ts` | 15 | 4.1 s |
| 9 | `test/doctors.e2e-spec.ts` | 12 | 3.6 s |
| 10 | `test/schedules.e2e-spec.ts` | 12 | 3.6 s |

The slowest unit file is `clinic-time.util.spec.ts` at 0.11 s, so unit tests are not a problem.

**Why e2e is slow:** almost all of it is fixed setup cost per test, not the tests themselves. Every visits test
takes 650–900 ms no matter what it checks. Each `beforeEach`:
- runs `TRUNCATE … CASCADE` on 20 tables (measured: **~135 ms**; a `DELETE` of the same tables takes ~2 ms);
- logs 2–4 users in **over HTTP**, and each login runs argon2 verify (**~41 ms** measured, plus the request);
- inserts the fixtures.

See T1 and T2.

## Summary

| ID | Item | Proposal | Risk | API change | DB change | ~LOC |
|---|---|---|---|---|---|---|
| **S1** | Idempotency-Key on payments/refunds | Remove | Medium | Yes | Yes | −190 |
| **S2** | `BookingVerifier` CAPTCHA hook (no-op) | Remove | Low | Yes (`captchaToken` field) | No | −40 |
| **S3** | `StorageService` interface + DI token | Make it one concrete class | Low | No | No | −25 |
| **S4** | `FILE_TOO_LARGE` check (unreachable) | Remove | Low | No (code is never emitted) | No | −10 |
| **S5** | Technical env vars nobody changes | Make them constants | Low | No | No | −25 |
| **S6** | `@nestjs/terminus` for one health ping | Plain `SELECT 1` | Low | Yes (health body) | No | −5, −1 dep |
| **S7** | Schedule overlap pre-check duplicating the DB constraint | Remove the pre-check | Low | Yes (`details.conflictingScheduleId`) | No | −25 |
| **D1** | "patientId or name+phone" duplicated | One `PatientsService` method | Low | No | No | −30 |
| **D2** | Hand-built "amount > 0" validation errors (3×) | One DTO decorator | Low | No* | No | −35 |
| **D3** | 12 hand-written `SELECT … FOR UPDATE` query builders | TypeORM's built-in `lock` option | Low | No | No | −40 |
| **D4** | `const toDate = …` copied in 4 services | One exported helper | Low | No | No | −6 |
| **D5** | Expense update hand-rolls the audit diff | Use `diffValues` like other modules | Low | No | No | −8 |
| **D6** | Micro-cleanups (trivial wrappers, dead exports) | Remove/inline | Low | No | No | −30 |
| **N1** | Stale "no listeners yet / future" comments | Fix the text | None | No | No | 0 |
| **N2** | Three ways to map entity → response DTO | Pick one for new code (CLAUDE.md) | None | No | No | 0 |
| **N3** | Two audit write APIs (`log` and `logAction`) | Keep `logAction` for entity changes; document | Low | No | No | ~0 |
| **N4** | `users/dto` split into 6 files, `audit/dto` into 2 | One `dto/<module>.dto.ts` like the other modules | Low | No | No | 0 |
| **T1** | `TRUNCATE` between tests | `DELETE` in one statement | Low | – | – | ~0, **~25 s** |
| **T2** | HTTP login + argon2 in every `beforeEach` | Sign access tokens directly in helpers | Low | – | – | +10, **~15 s** |
| **T3** | Same rule tested twice | Merge 4 pairs | Low | – | – | −80, ~3 s |
| **T4** | Role-only 403 checks repeated outside the permissions matrix | Remove the repeats | Low | – | – | −30 |

\* D2: same status and shape (`400`, `"Validation failed"`, `details[{ field, errors }]`); only the error text may change slightly.

Total if everything is approved: about **−600 lines**, one dependency fewer, and e2e estimated at **~60–65 s**
(down from 103 s; I will measure the real number in Step 2).

---

## Over-engineering and features beyond the spec

### S1. Idempotency-Key on payments and refunds — remove
- **Where:** `billing/payments.service.ts` (`run`, `findReplay`, `idempotency`, `PaymentResult.replayed`), `billing/payments.controller.ts`
  (`IDEMPOTENCY_HEADER`, `respond()`, `@Headers`, `@Res`), `billing/entities/payment.entity.ts` (`idempotency_key`, `idempotency_hash`,
  `PAYMENT_IDEMPOTENCY_UNIQUE`), the `Payments` migration, `ErrorCode.IDEMPOTENCY_KEY_REUSED`, 2 e2e tests and the README.
- **Why too complex:** idempotency keys protect against network retries from **automated clients and payment gateways**.
  Here a receptionist records cash they are holding. The real protections already exist: the invoice row lock and
  `OVERPAYMENT`, which stop paying more than the balance, plus a same-day void for mistakes. The key adds a
  hash-the-body comparison, a replay path, a unique-violation retry path, a response header and its own error code.
- **Proposal:** remove it. The frontend disables the button while the request runs. A rare double-recorded partial
  payment is fixed with **void** (same day, already built).
- **Risk:** medium. A double click on a *partial* payment would record two payments (visible on the receipt and in the
  daily summary, and fixable by void).
- **API:** the `Idempotency-Key` header is ignored, and `Idempotent-Replayed` and `IDEMPOTENCY_KEY_REUSED` are gone.
  **DB:** drop 2 columns and 1 unique index (see decision 2 above).
- **LOC:** about −190 (service ~85, controller ~35, entity ~12, tests ~55, docs).

### S2. `BookingVerifier` (CAPTCHA hook) — remove
- **Where:** `appointments/booking-verifier.ts`, `appointments.module.ts` (provider binding),
  `public-booking.service.ts` (inject + call), `PublicBookingDto.captchaToken`, README.
- **Why:** this is an interface plus a DI token with one no-op implementation, and no stage plans a CAPTCHA. Throttling
  (5 per 15 min per IP), the honeypot and the per-phone limit already do the real work. Unlike the two policy hooks, nothing
  is waiting for this one.
- **Proposal:** delete the file and the `captchaToken` field. If a CAPTCHA is ever needed, add a plain service call then.
- **Risk:** low. **API:** a client that sends `captchaToken` gets `400` (unknown fields are rejected). The website does
  not send it today, but please confirm. **DB:** none.
- **LOC:** about −40.

### S3. `StorageService` interface + `STORAGE_SERVICE` token — make it one concrete class
- **Where:** `common/storage/storage.service.ts`, `expenses/expenses.module.ts`, `expenses.service.ts`.
- **Why:** an interface, a symbol and `@Inject(STORAGE_SERVICE)` exist only for an S3 swap that no stage plans.
  `MIME_BY_EXTENSION` in `file-type.util.ts` also repeats the mime types that `detectFileType` already knows.
- **Proposal:** export one `@Injectable() class FileStorage` (local disk, same path-traversal checks) and inject it
  directly. Derive the mime type from one table.
- **Risk:** low. **API/DB:** none. **LOC:** about −25.

### S4. `FILE_TOO_LARGE` — unreachable code
- **Where:** `expenses.service.ts` `uploadReceipt()` size check, `ErrorCode.FILE_TOO_LARGE`.
- **Why:** `FileInterceptor({ limits: { fileSize } })` rejects big files with **413** before the service runs.
  The e2e test asserts 413, so the service check and the code are never hit.
- **Proposal:** remove the check and the enum member. **Risk:** low. **API/DB:** none. **LOC:** about −10.

### S5. Env vars nobody will realistically change — make them constants
- **Where:** `config/env.validation.ts`, `.env.example`, README, `app.module.ts`, `auth.module.ts`/`auth.service.ts`, `refresh-tokens.service.ts`.
- **Candidates:** `THROTTLE_TTL_MS`, `THROTTLE_LIMIT` (only the staff-wide default; login and public limits are already
  hardcoded), `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_DAYS`.
- **Keep:** `THROTTLE_ENABLED` (tests turn it off), DB/port/CORS/proxy/Swagger/log vars (they differ per deployment),
  `CLINIC_*`, `STORAGE_LOCAL_PATH` (tests change it), and the **business** knobs (`BOOKING_*`, `SLOT_INTERVAL_MINUTES`,
  `BACKDATE_MAX_DAYS`, `BILLING_OVERDUE_DAYS`, `RECEPTIONIST_MAX_DISCOUNT_PERCENT`).
- **Note:** `RECEPTIONIST_MAX_DISCOUNT_PERCENT` defaults to **100**, which means the receptionist cap is off unless
  someone sets it. Please confirm that is intended.
- **Risk:** low. **API/DB:** none. **LOC:** about −25.

### S6. `@nestjs/terminus` for a single DB ping — optional
- **Where:** `modules/health/*`, `package.json`.
- **Why:** a whole dependency and module for `SELECT 1`.
- **Proposal:** a plain controller returns `{ status: 'ok' }`, or 503 if `SELECT 1` fails.
- **Risk:** low. **API:** the health body shape changes (anything that parses `info.database.status` must change).
  **LOC:** about −5, one dependency fewer.

### S7. Schedule overlap: the service pre-check duplicates the exclusion constraint
- **Where:** `schedules/doctor-schedules.service.ts` `assertNoOverlap()` (called in create and in mutate).
- **Why:** the `btree_gist` exclusion constraint already decides overlaps, and `withOverlapMapping` already turns it into
  `409 SCHEDULE_OVERLAP`. The pre-check runs an extra query to produce the same answer. This follows your rule that
  the DB enforces what must never break.
- **Proposal:** remove `assertNoOverlap`, and keep the mapping.
- **Risk:** low. **API:** same status and code, but `details.conflictingScheduleId` disappears. **DB:** none. **LOC:** about −25.
- (Visits' `ALREADY_CHECKED_IN` pre-check is **not** the same case: without it the state machine answers 422 before the
  unique index can answer 409. Keep it.)

## Duplication

### D1. "Identify the patient by `patientId` or `name` + `phone`" is written twice
- **Where:** `appointments.service.ts` `create()` and `visits.service.ts` `walkIn()`. Both have the same XOR check and
  message, and the same `existsBy` / `findOrCreateByPhone` branch.
- **Proposal:** add `PatientsService.resolveForDesk({ patientId?, name?, phone? }, actor, manager)` that returns the
  `{ patient }` and does the 400 check once. **Risk:** low. **API/DB:** none. **LOC:** about −30.

### D2. "amount must be greater than 0" is built by hand 3 times
- **Where:** `payments.service.ts` `positiveAmount()`, `expenses.service.ts` `positiveAmount()`, and the `value > 0` part of
  `discounts.service.ts` `resolveRequest()`. Each builds a `BadRequestException({ message: 'Validation failed', details })` by hand.
- **Proposal:** add an `IsPositiveMoney()` decorator next to `IsMoney()` in `common/decorators/money.decorator.ts`, and use
  it in the DTOs. The percent `≤ 100` check stays in the discount service, because it depends on `type`.
- **Risk:** low. **API:** same 400 shape; error text may differ slightly. **LOC:** about −35.

### D3. 12 hand-written row locks
- **Where:** the `createQueryBuilder(...).where('x.id = :id').setLock('pessimistic_write').getOne()` + 404 pattern in
  appointments, public-booking, invoices (2), payments, visits, doctors (2), patients, clinic-services, schedules,
  expenses and expense categories.
- **Proposal:** use plain TypeORM `manager.findOne(Entity, { where: { id }, lock: { mode: 'pessimistic_write' } })`.
  That adds no helper and no abstraction. It is safe because none of these lock queries join relations.
- **Risk:** low (same SQL `FOR UPDATE`). **API/DB:** none. **LOC:** about −40.

### D4. `const toDate = (v) => parseIsoWithOffset(v) as Date` in 4 services
- **Where:** appointments, invoices, payments, visits services.
- **Proposal:** export it once from `common/time/clinic-time.util.ts`. **LOC:** about −6.

### D5. Expense update hand-rolls the old/new audit diff
- **Where:** `expenses.service.ts` `update()`. Every other module uses `diffValues()` from `audit/audit-diff.util.ts`.
- **Proposal:** use `diffValues` (same output). **LOC:** about −8.

### D6. Micro-cleanups
- `balanceOf(total, paid)` (`invoice-math.ts`) is just `subMoney`. Inline it (4 uses).
- `ClinicTimeService.addDays()` passes straight through to the util. Use the util.
- `.where('TRUE')` before `andWhere` (5 places). TypeORM already omits the leading `AND` (checked in
  `QueryBuilder.createWhereClausesExpression`), so it is noise.
- `TrimAndCollapse` and `normalizePersonName` hold the same regex. Make the decorator call the util.
- Dead code: `ALL_STAFF_ROLES` (unused), `PgErrorCode.NotNullViolation` / `InvalidTextRepresentation` (unused).
- `percentageOfBase` (`money.util.ts`) is used once. Leave it, or inline it into the discount cap.
- **Risk:** low. **LOC:** about −30 in total.

## Things that would confuse a new developer

### N1. Stale comments and docs
- `visits/visit.events.ts`: "No listeners yet". Billing listens to `CHECKED_IN` and `CANCELLED`.
- README `visits` section: "There are no listeners yet; billing (Stage 6) will subscribe."
- `patients.service.ts`: "Intended for public booking (Stage 4+)". The README says the same ("future public booking
  flow"), and so does the `patients.e2e-spec.ts` describe title. It has been used by booking and walk-ins since Stage 4/5.
- **Proposal:** fix the wording. No code change.

### N2. Three different ways to map an entity to its response
- Mapper files: `appointment.mapper.ts`, `visit.mapper.ts`, `invoice.mapper.ts`.
- `static fromEntity()` on the DTO: patients, users, audit, schedules, doctors.
- Private `toDto()` in the service: payments, expenses, expense categories, time off.
- **Proposal:** don't churn existing code. Record one rule in `CLAUDE.md` for new code: `static fromEntity()` on the response
  DTO, or a `<module>.mapper.ts` when the mapping needs `toIso` or several entities.

### N3. Two ways to write an audit entry
- `AuditService.log(entry, manager)` (auth, patient find-or-create) and `logAction(actor, action, type, id, values, manager)` (everything else).
- **Proposal:** keep both (auth entries have no entity). Document `logAction` as the default in `CLAUDE.md`.
  Optionally switch `findOrCreateWith` to `logAction`. About 0 LOC.

### N4. DTO file layout differs in two modules
- Most modules have `dto/<module>.dto.ts`. `users/dto/` has 6 files and `audit/dto/` has 2.
- **Proposal:** merge them into `users/dto/user.dto.ts` and `audit/dto/audit.dto.ts`. Import paths change, nothing else. Optional.

### Also worth writing down (no change proposed)
- Modules reach into each other's entities: `AppointmentsService.day()` reads `Visit` and `Invoice`, `BillingModule` registers
  `Expense` for the daily summary, and `ExpensesModule` imports `BillingModule` for `DocumentCounterService`. This is fine
  at this size, but a new developer should know that the reception day list is assembled in appointments.
- The known TypeORM issue: a Postgres enum shared by two tables is emitted twice by `migration:generate`. The README already
  covers it, and `CLAUDE.md` will too.

## Tests

### T1. Reset the DB with `DELETE` instead of `TRUNCATE`
- **Where:** `test/utils/test-app.ts` `resetDatabase()`.
- **Measured:** `TRUNCATE` of the 20 tables takes ~135 ms. One `DELETE FROM …` per table in a single statement takes ~2 ms
  (with `SET LOCAL session_replication_role = replica`, or deleted in FK order if the DB user is not a superuser).
  The deadlock retry loop becomes unnecessary; the wait for in-flight event listeners stays.
- About 200 tests reset the DB, so the estimate is **~25 s saved**. **Risk:** low (tests that depend on sequences restarting:
  none found). Gapless document numbers still start at 1 because `document_counters` rows are deleted.

### T2. Don't log in over HTTP in every `beforeEach`
- **Where:** `test/utils/auth-helpers.ts` `createLoggedInUser`, `test/utils/factories.ts` `createLoggedInDoctor`.
- **Why:** each call sends `POST /auth/login`, which runs argon2 verify (~41 ms measured) plus a refresh token insert.
  Visits does this 4 times per test.
- **Proposal:** sign the access token with the app's `JwtService` (`{ sub, role }`). Real login stays covered in
  `auth.e2e-spec.ts`, and tests that need a refresh token keep calling `login()`.
- **Estimate:** **~15 s saved**. **Risk:** low.

### T3. Same rule tested twice — merge
- `visits`: "a second check-in is 409 ALREADY_CHECKED_IN" + "5 parallel check-ins … exactly one visit": both test
  `uq_visits_appointment_live`. Keep the parallel one and also assert the 409 code there.
- `visits`: "a doctor can have only one session in progress" + "parallel starts for one doctor": both test
  `uq_visits_doctor_in_session`. Keep the parallel one.
- `auth` "stops accepting the access token once the user is deactivated" + `users` "deactivation signs the user
  out and blocks login": same rule. Keep the users one.
- `billing-invoices` "doctors have no access to billing" and `patients` "is forbidden for doctors": already rows in the
  permissions matrix. Delete them.
- **LOC:** about −80, ~3 s.

### T4. Role-only 403 assertions outside the matrix
- `permissions.e2e-spec.ts` already checks every route × every role × anonymous (388 cases, 2 s).
  About 10 extra role-only `403` assertions in module suites check the same thing. Remove them, but keep the
  **"doctor sees only own data → 404"** tests, which are a business rule and not a role check.
- **LOC:** about −30.

### Tests reviewed and kept
- `appointment-state-machine.spec.ts` (248 cases): an exhaustive table that runs in 33 ms. It is one table-driven test of
  one rule, and it is the cheapest guard on the state machine.
- The concurrency tests (parallel bookings, payments, check-ins, walk-ins, owner deactivation, invoice numbering) all cover
  DB-guaranteed rules (exclusion constraints, partial unique indexes, row locks), which matches the policy.
- The DB CHECK tests ("database CHECKs reject…") test the DB directly.
- The two rate-limit tests (login, public booking) are security rules, each with its own app.
- `global-setup.ts` runs the real `npm run migration:run` (including `nest build`, ~6 s). This is deliberate: it tests the
  production migration path.

## Considered and kept (not candidates)
Besides your protected list:
- **`CLOCK` / `ClinicTimeService`**: the injectable "now" is the test seam that 6 e2e suites rely on to freeze time.
- **`AppointmentWriter`**: one write path used by reception booking, public booking and visits. This is what keeps row, history
  and audit together.
- **`DoctorAccessService`**: the "doctor sees only own data" rule, used in 5 places.
- **Refresh-token rotation with reuse detection**: about 30 lines, standard for opaque refresh tokens, already tested.
- **Request id (`X-Request-Id`)**, **Swagger decorators**, **`PaginatedResponse`**, **`diffValues`/`pickValues`**,
  **`OptionalNotNull`** and the other DTO decorators: each is small and used in many places.
- **Document counters** (gapless `INV-/RCP-/EXP-` numbers): a business requirement, enforced in the same transaction.
- **Expense receipt upload** with magic-byte checks: part of the expenses scope (README); only the S3/S4 trimming applies.
- **`visit.started` / `visit.completed` events without listeners**: part of the protected events design, and cheap.
