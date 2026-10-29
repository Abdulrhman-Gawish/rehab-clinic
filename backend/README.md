# Rehab Clinic — Backend

NestJS + PostgreSQL backend for a physiotherapy/medical clinic. This covers the foundation: auth, staff users, audit trail, patients, doctors and the services catalog. Appointments, visits, billing and clinical records will come later as new modules.

- **Who logs in:** `OWNER`, `DOCTOR` and `RECEPTIONIST` staff.
- **Patients never log in.** A patient is identified only by their phone number, which is unique.
- **Every sensitive change is audited:** who did it, what changed (old and new values), when, and from which IP.

## Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 12 (ESM, TypeScript strict) |
| Database | PostgreSQL 16 + TypeORM 1.x, migrations only (`synchronize: false` everywhere) |
| Naming | `snake_case` in the DB (`SnakeNamingStrategy`), camelCase in TS |
| Auth | argon2id passwords, 15 min JWT access token, 7 day rotating opaque refresh token |
| Validation | `class-validator` DTOs + global `ValidationPipe` (whitelist, forbid unknown, transform) |
| Config | `@nestjs/config` + Joi schema (`src/config/env.validation.ts`) |
| Logging | `nestjs-pino`, one request id per request (`X-Request-Id` in and out) |
| Rate limiting | `@nestjs/throttler` (stricter on login and public endpoints) |
| Docs | Swagger UI at `/api/docs`, JSON at `/api/docs-json` |
| Tests | Vitest (Jest-compatible API) + supertest e2e against a real PostgreSQL |

## Getting started

Prerequisites: Node 24+, Docker.

```bash
npm install
cp .env.example .env          # then edit secrets (JWT_ACCESS_SECRET, DB_PASSWORD, SEED_OWNER_*)
docker compose up -d          # PostgreSQL 16 on localhost:5432
npm run migration:run         # create the schema
npm run seed                  # create the first OWNER from SEED_OWNER_* (safe to re-run)
npm run start:dev             # http://localhost:3000/api/v1
```

- Swagger: <http://localhost:3000/api/docs>. Log in with `POST /auth/login`, then click **Authorize** and paste the `accessToken`.
- Health check: `GET /api/v1/health`, which also checks the database connection.
- pgAdmin (optional): `docker compose --profile tools up -d`, then open <http://localhost:5050>.

## Environment variables

All variables are validated at startup; the app refuses to start on invalid config. See [.env.example](.env.example).

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | pino level (`silent` in e2e) |
| `CORS_ORIGINS` | *(empty)* | Comma separated allowed origins; empty disables CORS |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so the audit log records the real client IP |
| `SWAGGER_ENABLED` | `true` | Serve `/api/docs` |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | — | PostgreSQL connection (also used by `docker-compose.yml`) |
| `DB_LOGGING` | `false` | Log SQL |
| `DB_TEST_DATABASE` | `<DB_DATABASE>_test` | Database used by e2e tests. **It is wiped on every run** and must differ from `DB_DATABASE` |
| `JWT_ACCESS_SECRET` | — | At least 32 characters |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token lifetime |
| `JWT_REFRESH_TTL_DAYS` | `7` | Refresh token lifetime |
| `THROTTLE_ENABLED` | `true` | Global switch (off in e2e) |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | `60000` / `120` | Default limit per IP. Login: 5/min; refresh: 20/min; public endpoints: 30/min |
| `SEED_OWNER_NAME` / `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | — | First OWNER created by `npm run seed` |

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Run with watch mode |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run it |
| `npm run lint` | oxlint, warnings are errors |
| `npm run typecheck` | `tsc --noEmit` over source **and** tests |
| `npm test` | Unit tests (`src/**/*.spec.ts`) |
| `npm run test:e2e` | e2e tests (`test/**/*.e2e-spec.ts`). Creates or wipes the test DB, runs the real migrations, then runs the suites one after another |
| `npm run migration:generate -- src/database/migrations/<Name>` | Diff the entities against the DB and write a migration |
| `npm run migration:create -- src/database/migrations/<Name>` | Empty migration for hand-written SQL |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply, undo the last, or list migrations |
| `npm run seed` | Run seeds (currently: first OWNER). Idempotent |

The migration scripts build first, because the TypeORM CLI loads the compiled `dist/database/data-source.js`.

### Migration workflow

1. Change or add an entity.
2. `npm run migration:generate -- src/database/migrations/DescribeTheChange`.
3. Review the SQL. Add anything TypeORM can't express by hand. For example, the `pg_trgm` GIN index on `patients.name` is declared with `@Index({ synchronize: false })` so that the generator ignores it.
4. `npm run migration:run`, and check that `migration:revert` works.

## API overview

Every route is under `/api/v1` and needs `Authorization: Bearer <accessToken>` unless it is marked public.

| Group | OWNER | RECEPTIONIST | DOCTOR | Public |
|---|---|---|---|---|
| `/users` | RW | – | – | – |
| `/audit-logs` | R | – | – | – |
| `/patients` | RW | RW | R | – |
| `/doctors` | RW | R | R | – |
| `/clinic-services` | RW | R | R | – |
| `/public/doctors`, `/public/services` | – | – | – | R |

Errors always have this shape:

```json
{ "statusCode": 409, "error": "Conflict", "message": "A patient with this phone number already exists",
  "details": { "patientId": "…" }, "path": "/api/v1/patients", "timestamp": "2026-10-29T10:00:00.000Z" }
```

Validation errors have `message: "Validation failed"` and `details: [{ field, errors[] }]`.

## Modules

### `auth`
- `POST /auth/login` (email + password) returns an access JWT (`{ sub, role }`, 15 min), an opaque refresh token and the user. Inactive users get 403. Wrong credentials get a generic 401, with equalized timing for unknown emails.
- `POST /auth/refresh` **rotates** the refresh token: the old one is revoked and points to its replacement (`replaced_by_id`). Presenting an already revoked token is treated as theft. All of that user's tokens are revoked and the event is audited (`REFRESH_TOKEN_REUSE_DETECTED`).
- `POST /auth/logout` revokes a refresh token and is idempotent. `GET /auth/me` returns the current user.
- Only the SHA-256 of a refresh token is stored.
- Global `JwtAuthGuard`: everything is protected unless marked `@Public()`. It re-reads the user from the DB on every request, so deactivations and role changes apply immediately.
- Global `RolesGuard` + `@Roles()`. `@Auth(...roles)` combines `@Roles` with the Swagger docs. `@CurrentUser()` and `@CurrentActor()` (user id + IP, for auditing) are the param decorators.

### `users` (OWNER only)
- Create OWNER/RECEPTIONIST accounts, list (paginated; filter by role, active state or name/email), get, update, activate/deactivate, reset password.
- DOCTOR accounts are created and managed through `/doctors`, which keeps the account and the profile in sync. Password reset works for every role.
- **Rules:**
  - You cannot deactivate yourself.
  - At least one active OWNER must always remain. This is enforced with row locks, so two owners deactivating each other at the same time can't both succeed.
  - Deactivation and password reset revoke all of that user's refresh tokens.
- Emails are stored lowercased and protected by a unique constraint (409 on conflict). Responses never include `password_hash`. They are built from response DTOs, and the column is `select: false`.

### `audit`
- `AuditService.log(entry, manager?)` takes the caller's `EntityManager`, so the entry is committed or rolled back together with the change it describes.
- Recorded actions:
  - Login success and failure, logout, and refresh-token reuse.
  - User create, update, (de)activate and password reset.
  - Every patient, doctor, doctor-service and clinic-service mutation.
- Updates store only the fields that changed, in `old_values` and `new_values`.
- `GET /audit-logs` (OWNER) filters by `entityType`, `entityId`, `userId`, `action` and `from`/`to`, newest first. `user_id = NULL` means a public or system action.

### `patients`
- The phone number is the only unique business key. `normalizeEgyptianMobile()` (`src/common/utils/phone.util.ts`):
  - Accepts `01012345678`, `+201012345678`, `00201012345678` and `201012345678`, with spaces, dashes or Arabic-Indic digits.
  - Stores the number as `+201XXXXXXXXX`.
  - Only 010/011/012/015 mobiles are valid.
- Normalization happens in the DTO (before validation) **and again** in the service.
- Uniqueness is enforced by the DB constraint `uq_patients_phone`. A violation becomes `409` with `details.patientId` of the existing patient. This also applies when a PATCH changes the phone.
- `GET /patients?search=` matches part of the name (trigram index) or the phone in any format. `GET /patients/lookup?phone=` finds an exact number. `PATCH` changes are audited with old and new values.
- `PatientsService.findOrCreateByPhone({ name, phone, source, createdBy? }, manager?)` is for the future public booking flow:
  - Race-safe: `INSERT … ON CONFLICT (phone) DO NOTHING`, then `SELECT`.
  - Never renames an existing patient. It returns `nameMismatch: true` instead.
- There is **no public patient endpoint**. `notes` is for administrative notes only, never medical information.

### `doctors`
- `POST /doctors` (OWNER) creates the DOCTOR user and the doctor profile in **one transaction**.
- `PATCH` updates profile and account fields. Activate/deactivate changes both the profile and the login account, and deactivation signs the doctor out.
- `PUT/DELETE /doctors/:id/services/:serviceId` assigns or unassigns a service, with an optional `priceOverride`.
- Public endpoints:
  - `GET /public/doctors` and `GET /public/doctors/:id` return only active, public doctors whose account is active.
  - They expose only `id, name, specialty, bio, photoUrl, services[{id, name, description, durationMinutes, price}]`.

### `clinic-services`
- OWNER can create, update, activate and deactivate services; there is no hard delete. Staff can read them.
- `GET /public/services` returns active services only.
- Prices are `numeric(12,2)` and travel as decimal strings (`"350.00"`) end to end, so there is no float math. These are **current** prices: future invoices must snapshot the price at billing time.

## Project layout

```
src/
  app.module.ts, app.setup.ts (shared by main.ts and e2e), main.ts
  common/      decorators, guards, filters, pipes, dto, errors, utils, base entity, enums
  config/      env validation (Joi), logger config
  database/    data-source.ts (TypeORM CLI), typeorm.options.ts, migrations/, seeds/
  modules/     auth, users, audit, patients, doctors, clinic-services, health
test/          e2e suites + global setup (test DB reset + migrations) + helpers
```

## Conventions for new modules

- Entities extend `BaseEntity` (uuid `id`, `created_at` / `updated_at` as `timestamptz`). Business data is never hard deleted: use `is_active` or a status column.
- Name constraints explicitly (`uq_…`, `fk_…`, `chk_…`, `idx_…`). Services catch specific unique violations by name and turn them into 409s.
- Do multi-step writes in `dataSource.transaction(...)`, pass the `manager` to `AuditService.log`, and throw 409s from a `catch` **outside** the transaction (a failed transaction is aborted).
- Controllers only route. Business logic lives in services, and every input and output is a DTO.
- Wrap cross-referencing entity relations in `Relation<>` (required for ESM circular imports).
