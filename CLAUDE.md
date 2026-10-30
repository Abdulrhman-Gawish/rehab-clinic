# CLAUDE.md

Rehab clinic backend (NestJS 12 + PostgreSQL 16 + TypeORM, ESM, strict TS) in `backend/`. It is for a small clinic:
a few staff users and at most a few hundred patients a day. `backend/README.md` documents every module and endpoint.

## Project principles
- Business rules + CRUD. Prefer the simplest code that enforces the rule correctly.
- **No payment gateway, no online payments, no webhooks.** Every payment is a manual record the receptionist enters
  after receiving the money at the desk. `reference` is optional free text, never validated against anything.
- Patients are not users and never log in. Only OWNER, DOCTOR and RECEPTIONIST staff log in.
- Do not add abstractions, interfaces, generic base classes or new libraries unless the current stage needs them.
  **Ask before adding a dependency.** The only planned hooks are `VisitCompletionPolicy` and `VisitBillingPolicy`.
- Plain services and repositories. No CQRS, no repository layers on top of TypeORM, no event sourcing, no caching, no queues.
- A rule that must never break (uniqueness, overlaps, totals) is enforced by the **database** (unique/partial indexes,
  exclusion constraints, CHECKs). Everything else is enforced in the service. Don't duplicate a DB rule with a
  pre-check query unless the API needs a different answer.

## Conventions
- **Layout:** `src/modules/<name>/` holds `<name>.module.ts`, `*.controller.ts`, `*.service.ts`, `entities/*.entity.ts`,
  `dto/<name>.dto.ts` (one DTO file per module), and optional `<name>.mapper.ts`, `<name>.enums.ts`, `<name>.constants.ts`.
  Shared code lives in `src/common/` (decorators, errors, utils, time, storage).
- **New module:** create the folder, register entities with `TypeOrmModule.forFeature`, add the module to `app.module.ts`,
  write the migration, add the routes to `test/permissions.e2e-spec.ts`, add an e2e suite, and update the README.
- **Naming:** camelCase in TS, snake_case in the DB (`SnakeNamingStrategy`). Name every constraint: `uq_`, `fk_`, `chk_`, `idx_`.
- **Ids and timestamps:** entities extend `BaseEntity` (uuid `id`, `created_at`/`updated_at` timestamptz). Business data is
  never hard deleted (use `is_active` or a status).
- **Time:** every instant is `timestamptz` (UTC). The API takes and returns ISO 8601 **with offset**, rendered in
  `CLINIC_TIMEZONE` (Africa/Cairo, DST). Use `ClinicTimeService` (`now`, `today`, `dayBounds`, `toIso`) and
  `common/time/clinic-time.util.ts` (`isoToDate`, `addDays`); never hardcode an offset. Tests freeze time via `CLOCK`.
- **Money:** decimal strings (`"150.00"`) end to end, `numeric(12,2)`, arithmetic only through `common/utils/money.util.ts`
  (decimal.js). Use `@IsMoney()` / `@IsPositiveMoney()` in DTOs. The server computes totals, and DB CHECKs guard every amount.
- **Schema:** migrations only (`synchronize: false`). `npm run migration:generate -- src/database/migrations/<Name>`, then
  review the SQL. Known TypeORM issue: a Postgres enum shared by two tables (`appointment_status`) is emitted twice, so remove
  the duplicate `CREATE TYPE`/`DROP TYPE`. Extensions and `@Index({ synchronize: false })` indexes are written by hand.
  `typeorm migration:generate --check` must report no changes.
- **Writes:** `dataSource.transaction(async (manager) => …)`. Change + status history + audit go in the **same** transaction.
  Lock rows with `manager.findOne(Entity, { where: { id }, lock: { mode: 'pessimistic_write' } })`. Map DB violations
  (`isUniqueViolation`/`isExclusionViolation` by constraint name) to 409s in a `catch` **outside** the transaction.
- **Audit:** `auditService.logAction(actor, action, entityType, entityId, { oldValues, newValues }, manager)` is the default.
  Use `diffValues`/`pickValues` for old/new values. `auditService.log()` is only for entries without an entity (auth).
- **Errors:** business errors clients branch on use `conflict(...)`/`unprocessable(...)` with an `ErrorCode`, which gives a
  stable `code` in the error body. Validation errors are `400 { message: 'Validation failed', details: [{ field, errors }] }`.
- **Access:** `@Auth(...roles)` on every non-public route, and `@Public()` opts out. A DOCTOR sees only their own data via
  `DoctorAccessService`, and another doctor's data answers **404, not 403**.
- **Responses:** every input and output is a DTO. Map entities with `static fromEntity()` on the response DTO, or with a
  `<module>.mapper.ts` when the mapping needs `toIso` or several entities. Don't add a third style.
- **Events:** cross-module side effects use domain events emitted **only after commit**. Listeners run their own
  transaction, must be idempotent, and log failures instead of throwing.
- **Patients at the desk:** `assertDeskPatientInput(dto)` + `PatientsService.resolveForDesk(...)` (id, or name + phone
  find-or-create). Phones are normalized to `+201XXXXXXXXX` and unique.
- **Files:** `FileStorage` (local disk under `STORAGE_LOCAL_PATH`, never served statically). Check uploads with
  `detectFileType` (magic bytes).

## Testing policy
- Unit tests (`src/**/*.spec.ts`) cover pure logic: money, time/DST, state machines, slot generation.
- E2e tests (`test/*.e2e-spec.ts`) run against a real PostgreSQL with the real migrations. For each endpoint:
  - one happy path;
  - one test per business rule it enforces;
  - permissions for each role and anonymous, as rows in `test/permissions.e2e-spec.ts` (not repeated in module suites).
    Keep "doctor sees only own data → 404" tests in the module suites.
- Concurrency tests (parallel requests) only for rules the database guarantees. No duplicate tests for the same rule.
- Use `createLoggedInUser`/`createLoggedInDoctor` (signed tokens, no HTTP login). Call `login()` only when a test needs a
  refresh token or the LOGIN audit entry.

## Workflow
- One branch and one PR per stage (`feature/stage-N-<name>`). Report after each sub-stage.
- Before saying something is done, run in `backend/`: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`,
  `npm run test:e2e`, and migrations up **and** down (`npm run migration:run`, `npm run migration:revert`, then run again).
- Keep `backend/README.md` (endpoints, env vars, error codes) and `.env.example` in sync with the code.
