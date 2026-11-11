# Docker deployment guide

How the clinic runs in Docker: the database, the backend API and the frontend UI each have their own image and Compose
file, and one root `docker-compose.yml` runs them together. Every command below is for **PowerShell, from the repository
root** (`docker` commands are the same in any shell).

Contents: [Architecture](#1-architecture) · [Folders](#2-folder-structure) · [First-time setup](#3-first-time-setup) ·
[Whole application](#4-run-the-whole-application) · [One service](#5-build-or-run-one-service) ·
[Configuration](#6-configuration-and-secrets) · [Database](#7-database-start-up-persistence-backups) ·
[Uploads](#8-uploaded-files) · [HTTPS and sharing](#9-https-cookies-and-sharing) · [Updating](#10-updating) ·
[Troubleshooting](#11-logs-and-troubleshooting) · [Never do](#12-never-do-this) · [Development database](#13-development-database)

## 1. Architecture

```
                 ┌──────────────── Compose project "rehab-clinic" ─────────────────────────────────────────┐
 browser ──:8080──► frontend (nginx)  ──/api/──►  backend (NestJS)  ──────────►  db (PostgreSQL 16)          │
                 │  UI + SPA fallback             wait for db → migrations       no published port           │
                 │  /api/ → backend:3000          → first OWNER → API :3000      volume db_data              │
                 │  network: web                  networks: web + data           network: data (internal)   │
                 │                                volume storage (uploads)                                   │
                 │                                127.0.0.1:3000 (this machine only)                         │
                 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Service | Image | Listens on | Reachable from | Persistent data |
|---|---|---|---|---|
| `db` | `database/Dockerfile` (official `postgres:16-alpine` + UTC + health check) | 5432 | the backend only (`data` network, internal) | volume `rehab-clinic_db_data` |
| `backend` | `backend/Dockerfile` (Node 24 Alpine, compiled NestJS, user `node`) | 3000 | the frontend (`web` network), and `127.0.0.1:${BACKEND_PORT:-3000}` on the host | volume `rehab-clinic_storage` (uploads) |
| `frontend` | `frontend/Dockerfile` (Vite build served by unprivileged nginx 1.30, uid 101) | 8080 | everyone: `${FRONTEND_PORT:-8080}` on the host | none |

- **One origin.** The browser loads the UI and calls the API at `/api/v1` on the *same* address; nginx forwards `/api/`
  to the backend. The login cookies (HttpOnly, Secure, SameSite=Strict) only work that way, so there is no API URL to
  configure in the frontend build.
- **One project.** All Compose files declare `name: rehab-clinic`. Starting a service from its own file or from the root
  file manages the *same* container, volume and network (`rehab-clinic-db-1`, `rehab-clinic_db_data`, …), never a copy.
- **No start order needed.** The root file only `include`s the three service files, unchanged, and every file works on
  its own. The three containers start together: the backend waits for the database itself (up to 60 s, also while a
  fresh volume is being initialised), and nginx starts without the backend (the API answers 502 for the few seconds
  until it is up). `docker compose up -d --wait` returns once all three are healthy. (Compose can't add `depends_on`
  to an included service from the root file without an extra override file per service, and nothing needs it.)
- **Health checks.** `db`: `pg_isready` over TCP. `backend`: `GET /api/v1/health`, which is 200 only when the database
  answers. `frontend`: nginx `GET /healthz`. `docker compose ps` shows `(healthy)`.

## 2. Folder structure

```
docker-compose.yml          the whole stack: includes the three service files below
database/
  Dockerfile                PostgreSQL 16 (official image), UTC, health check
  docker-compose.yml        service db, volume db_data, network data
  .env.example              DB_DATABASE / DB_USERNAME / DB_PASSWORD (copy to .env; the backend reads it too)
  .dockerignore, .gitignore
backend/
  Dockerfile                build → prod-deps → runtime (non-root)
  docker-compose.yml        service backend, volume storage, networks data + web
  docker-entrypoint.sh      wait for db → pending migrations → first OWNER → start the API
  src/database/wait-for-db.ts   the database wait (compiled into the image)
  docker-compose.dev.yml    development database + pgAdmin for running the API with npm (not part of the stack)
  .env.example, .dockerignore
frontend/
  Dockerfile                build (npm run build) → nginx
  nginx/default.conf.template   SPA routing, /api proxy, caching, security headers, /healthz
  docker-compose.yml        service frontend, network web
  .env.example, .dockerignore
```

## 3. First-time setup

Requirements: Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin. Tested with Docker 29.2 and
Compose v5.1. `include` needs Compose 2.20.3 or later; use a current release.

### 3.1 Create the configuration files

Each command creates the file only if it doesn't exist yet (it never overwrites your settings):

```powershell
if (-not (Test-Path database\.env)) { Copy-Item database\.env.example database\.env }
if (-not (Test-Path backend\.env))  { Copy-Item backend\.env.example backend\.env }
if (-not (Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }   # optional
```

Generate random secrets (PowerShell, no extra tools):

```powershell
function New-Secret([int]$bytes) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
New-Secret 24   # for DB_PASSWORD
New-Secret 48   # for JWT_ACCESS_SECRET
```

Then edit the files (`notepad database\.env`):

| File | Set | Notes |
|---|---|---|
| `database\.env` | `DB_PASSWORD` (and `DB_DATABASE`, `DB_USERNAME` if you want other names) | Used once, when the volume is empty. The backend container reads the same file. |
| `backend\.env` | `JWT_ACCESS_SECRET` (32+ characters), `SEED_OWNER_NAME`, `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` (8+ characters), `CLINIC_NAME`, `CLINIC_PHONE` | `SEED_OWNER_EMAIL` needs a real top-level domain (`.com`, `.eg`, …): a `.local` address is rejected. Consider `SWAGGER_ENABLED=false`. The `DB_*` lines here are **not** used by Docker. |
| `frontend\.env` | `FRONTEND_PORT` (default `8080`) | Optional: without the file the defaults apply. `127.0.0.1:8080` accepts only connections from this machine (see section 9). |

Every variable, and who reads it, is in section 6.1.

### 3.2 Upgrading from the earlier single `docker-compose.yml`

The previous setup ran the Vite dev server on port 5173 and took everything from `backend\.env`. The new files keep the
same project and volume names, so **the existing database and uploads are reused as they are**. Only these things change:

1. Its database was created with `clinic_db` / `clinic_user` / password `clinic-docker` (unless you had set
   `DOCKER_DB_PASSWORD`). Put exactly those values into `database\.env`, or the backend can't log in to the existing
   data (it then stops with "password authentication failed"; nothing is lost).
2. The UI moves from <http://localhost:5173> to <http://localhost:8080> (nginx, production build). The API is no longer
   published on all interfaces: it is on `127.0.0.1:3000` and, for the browser, on `/api` of the UI address. The
   database is no longer published on `127.0.0.1:5433`; use `docker compose exec db psql …` (section 7).
3. Run `docker compose up -d --build`. The three containers are recreated on the new images, and the volumes stay.
   The old `rehab-clinic_default` network is left unused; remove it later with `docker network rm rehab-clinic_default`
   (Docker refuses if something still uses it).

## 4. Run the whole application

| Task | Command |
|---|---|
| Build every image | `docker compose build` |
| Build with fresh base images (security updates) | `docker compose build --pull` |
| Start everything (detached) | `docker compose up -d` |
| Build and start | `docker compose up -d --build` |
| Start and wait until all are healthy | `docker compose up -d --build --wait` |
| Status and health | `docker compose ps` |
| Logs of everything / one service | `docker compose logs -f` / `docker compose logs -f backend` |
| Last 200 lines of the backend | `docker compose logs --tail 200 backend` |
| Stop (containers kept) | `docker compose stop` |
| Start again after `stop` | `docker compose start` |
| Restart | `docker compose restart` (one service: `docker compose restart backend`) |
| Stop and remove the containers (**data kept**) | `docker compose down` |

After `docker compose up -d --build`:

- the UI is at <http://localhost:8080> (public website and staff login);
- `Invoke-RestMethod http://localhost:8080/api/v1/health` returns `status: ok, database: up`;
- Swagger (if `SWAGGER_ENABLED=true`): <http://localhost:8080/api/docs>;
- the first login is the OWNER from `SEED_OWNER_*`. There is no other data: create services, doctors (with a weekly
  schedule) and staff in the UI.

## 5. Build or run one service

Each service can be built and started from its own folder's files. They join the same project, so it doesn't matter
which file started a container. Run these from the repository root.

| | Database | Backend | Frontend |
|---|---|---|---|
| Build with plain Docker | `docker build -t rehab-clinic-db .\database` | `docker build -t rehab-clinic-backend .\backend` | `docker build -t rehab-clinic-frontend .\frontend` |
| Build with its Compose file | `docker compose -f database\docker-compose.yml build` | `docker compose -f backend\docker-compose.yml build` | `docker compose -f frontend\docker-compose.yml build` |
| Start | `docker compose -f database\docker-compose.yml up -d` | `docker compose -f backend\docker-compose.yml up -d` | `docker compose -f frontend\docker-compose.yml up -d` |
| Logs | `docker compose -f database\docker-compose.yml logs -f db` | `docker compose -f backend\docker-compose.yml logs -f backend` | `docker compose -f frontend\docker-compose.yml logs -f frontend` |
| Stop | `docker compose -f database\docker-compose.yml stop` | `docker compose -f backend\docker-compose.yml stop` | `docker compose -f frontend\docker-compose.yml stop` |
| Remove its container (volumes kept) | `docker compose -f database\docker-compose.yml down` | `docker compose -f backend\docker-compose.yml down` | `docker compose -f frontend\docker-compose.yml down` |

- **Backend alone** needs the database running (start `database\docker-compose.yml` first). Without it, the backend
  waits 60 s, exits, and is restarted by Docker until the database is there.
- **Frontend alone** starts without the backend: the pages load, `/api` answers 502 until the backend is up.
- `down` from one service's file removes only that service's container. Shared networks still in use stay, and Compose
  prints "Resource is still in use", which is expected.
- `docker compose ps` and `logs` with any of these files show the whole project. Name the service to narrow them.
- `docker build -t …` with plain Docker tags an image but does not change the running containers. Compose builds and
  names its own images (`rehab-clinic-db`, `rehab-clinic-backend`, `rehab-clinic-frontend`).

## 6. Configuration and secrets

| What | Where it is set | When it applies | Reaches the browser? |
|---|---|---|---|
| Database name, user, password | `database\.env` | db: first start on an empty volume. backend: every start | No |
| API settings and secrets (JWT, OWNER seed, clinic, booking, billing, …) | `backend\.env` | backend start | No |
| Fixed by the Docker setup: `NODE_ENV=production`, `PORT=3000`, `DB_HOST=db`, `DB_PORT=5432`, `STORAGE_LOCAL_PATH=/app/storage`, `TRUST_PROXY=true` | `backend\docker-compose.yml` (`environment:`) | backend start; wins over both `.env` files | No |
| Host ports | `BACKEND_PORT` in `backend\.env`, `FRONTEND_PORT` in `frontend\.env` | `docker compose up` | No |
| nginx → backend address | `BACKEND_URL` in `frontend\.env` (default `http://backend:3000`) | frontend start (runtime, not build) | No |
| Frontend build options | none: the image always builds with `QUICK_LOGIN=false` | image build | Only the compiled UI |

Order of precedence for the backend container: `environment:` in its Compose file, then `database\.env` (`DB_*`), then
`backend\.env`.

- **Secrets stay out of images and git.** The `.dockerignore` files are allow-lists: no `.env`, upload or `node_modules`
  ever enters a build context. `.env` files are git-ignored in all three folders. Images contain no configuration;
  everything is read when a container starts.
- **The browser gets no secret.** The frontend image never receives `backend\.env`. The OWNER quick-login button is a
  dev-server convenience: the image is built with `QUICK_LOGIN=false` hard-coded (not a build argument), so the button
  and the OWNER credentials can't be in the production bundle. The backend doesn't read `QUICK_LOGIN`.
- **On a production server** create the three `.env` files on the server itself (never copy them through git or chat),
  readable only by the administrators who run Docker. After the first successful start you may delete
  `SEED_OWNER_PASSWORD` from `backend\.env`: the seed only runs on a database without an OWNER.
- **Applying a change**: edit the file, then `docker compose up -d`. Compose recreates only the containers whose
  configuration changed. (`restart` does not reload `.env` files.)

### 6.1 Every variable and who reads it

Three `.env` files, one per service, each next to its `.env.example` (the template, committed). Nothing reads a root
`.env`.

| File | Read by |
|---|---|
| `database\.env` | `database\docker-compose.yml` (creates the database), and `backend\docker-compose.yml` (the API connects with it) |
| `backend\.env` | the API (with or without Docker), migrations, seed and scripts, the e2e tests, `backend\docker-compose.dev.yml`, and the frontend **dev server** (`frontend\vite.config.ts`) |
| `frontend\.env` | `frontend\docker-compose.yml` (optional); the Vite dev server loads it too but only exposes `VITE_*` variables |

**`database\.env`**

| Variable | Default | Read by | Notes |
|---|---|---|---|
| `DB_DATABASE` | `clinic_db` | db (as `POSTGRES_DB`), backend in Docker | Applied to an empty volume only |
| `DB_USERNAME` | `clinic_user` | db (as `POSTGRES_USER`), backend in Docker | Applied to an empty volume only |
| `DB_PASSWORD` | required | db (as `POSTGRES_PASSWORD`), backend in Docker | Applied to an empty volume only; change it with `ALTER ROLE` (section 7) |

**`frontend\.env`**

| Variable | Default | Read by | Notes |
|---|---|---|---|
| `FRONTEND_PORT` | `8080` | `frontend\docker-compose.yml` | Host port; `127.0.0.1:8080` limits it to this machine |
| `BACKEND_URL` | `http://backend:3000` | nginx in the frontend container, at start | Runtime only: the image doesn't change |
| `VITE_API_URL` | unset | `frontend\src\api.ts` | **Leave unset.** The UI must call `/api/v1` on its own address (cookies). The Docker build never sees `.env` files |

**`backend\.env`**

| Variable | Default | Read by | In Docker |
|---|---|---|---|
| `NODE_ENV` | `development` | API (log format) | fixed `production` |
| `PORT` | `3000` | API | fixed `3000` |
| `BACKEND_PORT` | `3000` | `backend\docker-compose.yml` | host port, published on `127.0.0.1` |
| `LOG_LEVEL` | `info` | API | as set |
| `CORS_ORIGINS` | empty | API | as set; not needed (same origin) |
| `TRUST_PROXY` | `false` | API (audit log IP) | fixed `true` (behind nginx) |
| `SWAGGER_ENABLED` | `true` | API | as set; consider `false` |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | API, migrations, seed, e2e; `DB_PORT` also `docker-compose.dev.yml` | fixed `db` / `5432` |
| `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` | `clinic_db` / `clinic_user` / required | API, migrations, seed, e2e, `docker-compose.dev.yml` | taken from `database\.env` instead |
| `DB_LOGGING` | `false` | API, migrations | as set |
| `DB_TEST_DATABASE` | `<DB_DATABASE>_test` | e2e tests (wiped on every run) | not used |
| `JWT_ACCESS_SECRET` | required (32+) | API | as set |
| `THROTTLE_ENABLED` | `true` | API | as set |
| `CLINIC_TIMEZONE`, `SLOT_INTERVAL_MINUTES`, `BOOKING_MIN_LEAD_MINUTES`, `BOOKING_MAX_DAYS_AHEAD`, `BOOKING_MAX_ACTIVE_PER_PHONE`, `BACKDATE_MAX_DAYS` | see `backend\.env.example` | API (booking rules) | as set |
| `RECEPTIONIST_MAX_DISCOUNT_PERCENT`, `BILLING_OVERDUE_DAYS`, `CLINIC_NAME`, `CLINIC_PHONE` | see `backend\.env.example` | API (billing, receipts) | as set |
| `STORAGE_LOCAL_PATH` | `./storage` | API, `storage:orphans` | fixed `/app/storage` (volume) |
| `SEED_OWNER_NAME` / `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | required on a fresh database | seed (`npm run seed`, Docker start), only while there is no OWNER; frontend dev server (quick-login button) | read on the first start only |
| `QUICK_LOGIN` | `true` | frontend dev server only | not used; the frontend image is always built with `false` |
| `API_PROXY_TARGET` | `http://localhost:3000` | frontend dev server only (commented out in the template) | not used |
| `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` | `admin@example.com` / `admin` | `backend\docker-compose.dev.yml` (pgAdmin) | not used |

The backend container receives the whole `backend\.env`, so the development-only lines (`DB_TEST_DATABASE`,
`QUICK_LOGIN`, `API_PROXY_TARGET`, `PGADMIN_*`) end up in its environment unused. On a production server leave them out.

Set inside the images, not through `.env`: backend `NODE_ENV=production`, `PORT=3000`, `STORAGE_LOCAL_PATH=/app/storage`;
database `TZ=UTC`, `PGTZ=UTC`; frontend `QUICK_LOGIN=false` (build), `BACKEND_URL` default and `NGINX_ENVSUBST_FILTER`.

No longer read by anything (now constants in `src/modules/auth/auth.constants.ts` and the throttle decorators):
`JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_DAYS`, `THROTTLE_TTL_MS`, `THROTTLE_LIMIT`. Delete them from old `.env` files.

## 7. Database: start-up, persistence, backups

### What happens on every backend start

1. **Wait** until PostgreSQL accepts connections (up to 60 s). Wrong credentials or a missing database stop at once
   with a clear message: waiting can't fix those.
2. **Migrations**: only the pending ones run, in order, in one transaction. If one fails, all of them roll back and
   the container stops before the API starts. Nothing is dropped or reset, and an up-to-date database logs
   "No migrations are pending".
3. **First OWNER**: created only when the database has **no OWNER at all** (a fresh install). An existing database is
   never changed, even if the OWNER later changed their email or `SEED_OWNER_*` changed. Restarts can't add a second
   OWNER.
4. The API starts and the health check turns `healthy`.

There is no demo data, and no step deletes or truncates anything.

### What keeps and what deletes data

| Action | Database and uploads |
|---|---|
| `docker compose stop` / `start` / `restart` | kept |
| `docker compose down`, then `up -d` | kept (containers are recreated, volumes are reused) |
| `docker compose up -d --build`, rebuilding images, `docker compose build --pull` | kept |
| Rebooting the machine (containers restart by themselves: `restart: unless-stopped`) | kept |
| `docker compose down -v`, `docker volume rm …`, `docker volume prune`, `docker system prune --volumes` | **deleted for good** |

### Inspect the database

```powershell
docker compose exec db psql -U clinic_user -d clinic_db                  # interactive psql (\q to quit)
docker compose exec backend node node_modules/typeorm/cli.js migration:show -d dist/database/data-source.js
```

### Back up (database + uploads)

Back up before every update. The dump is written inside the container and then copied out, which keeps it binary-safe
in Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
docker compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/clinic.dump'
docker compose cp db:/tmp/clinic.dump ".\backups\clinic_$stamp.dump"
docker compose exec -T db rm /tmp/clinic.dump
docker compose cp backend:/app/storage ".\backups\storage_$stamp"
```

Keep copies off this machine. `backups\` holds patient data: protect it like the database.

### Restore (onto a new, empty installation)

Restore only into an **empty** database: a new machine, or a stack whose volumes were never used. The steps below
never overwrite an existing database: without `--clean`, `pg_restore` stops at the first object that already exists
(`--exit-on-error`) and drops nothing.

```powershell
$dump  = ".\backups\clinic_2026-11-11_1837.dump"      # your files
$files = ".\backups\storage_2026-11-11_1837"
docker compose up -d --wait db                         # the database only: the backend must not create tables first
docker compose cp $dump db:/tmp/clinic.dump
docker compose exec -T db sh -c 'pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --no-owner --exit-on-error /tmp/clinic.dump && rm /tmp/clinic.dump'
docker compose up -d --wait                            # backend: "No migrations are pending", "Owner seed skipped"
docker compose cp "$files\." backend:/app/storage
docker compose exec -T -u root backend chown -R node:node /app/storage
```

### Change the database password

`database\.env` only applies to an empty volume, so change the password in PostgreSQL first, then in the file:

```powershell
docker compose exec db psql -U clinic_user -d clinic_db -c "ALTER ROLE clinic_user PASSWORD 'the-new-password'"
notepad database\.env                                   # set DB_PASSWORD to the same value
docker compose up -d                                    # recreates the backend with the new password
```

## 8. Uploaded files

Expense receipts, patient attachments and blog covers are stored by the backend under `/app/storage`, on the named
volume `rehab-clinic_storage`. They are never served directly: the API streams them after its permission checks. The
volume survives `down`, rebuilds and recreation exactly like the database. Back it up together with the database
(section 7): a dump without the files, or the files without the dump, is incomplete.

Files left behind by a crash between upload and save can be listed (dry run) with
`docker compose exec backend node dist/database/storage-orphans.js`.

## 9. HTTPS, cookies and sharing

The login cookies are `Secure`: browsers only keep them over **https** or on **http://localhost**. So:

- <http://localhost:8080> on the server itself works;
- `http://<LAN-IP>:8080` from another computer shows the site, but **login does not stick**;
- for other computers, put HTTPS in front of port 8080:
  - quick test link (address changes every time): `cloudflared tunnel --url http://localhost:8080`;
  - permanent: a named Cloudflare Tunnel or a TLS reverse proxy (IIS, Caddy, nginx, …) on this machine, forwarding to
    `http://127.0.0.1:8080`. Then set `FRONTEND_PORT=127.0.0.1:8080` in `frontend\.env` so only the proxy can connect,
    and run `docker compose up -d`.

The production UI never has the OWNER quick-login button, so sharing needs no extra step.

`TRUST_PROXY=true` (set by the Docker setup) makes the audit log record the address that connected to nginx. Behind
another proxy (tunnel, IIS) that address is the proxy's.

## 10. Updating

```powershell
# 1. back up (section 7)
# 2. get the new code
git pull
# 3. rebuild (with fresh base images) and recreate what changed; pending migrations run on start
docker compose build --pull
docker compose up -d --wait
docker compose ps
# 4. optional: remove old, untagged images (never touches volumes)
docker image prune -f
```

If the backend doesn't become healthy, look at `docker compose logs backend`. A failed migration has rolled back and
the old data is untouched. Fix the cause, or go back to the previous code (`git checkout <previous commit>`), then
`docker compose up -d --build`.

## 11. Logs and troubleshooting

| Symptom | Cause and fix |
|---|---|
| `env file …\database\.env not found` | Create the `.env` files (section 3.1). |
| `required variable DB_PASSWORD is missing a value` | Set `DB_PASSWORD` in `database\.env`. |
| backend keeps restarting, log shows `Invalid environment configuration: …` | Fix the named variable in `backend\.env` (e.g. `JWT_ACCESS_SECRET` shorter than 32, `SEED_OWNER_EMAIL` with `.local`). Then `docker compose up -d`. |
| `Database db:5432/clinic_db is not usable: password authentication failed` | `database\.env` doesn't match the password the volume was created with (section 3.2 / 7). |
| `Waiting for the database …` for 60 s, then exit | The `db` container isn't running or healthy: `docker compose ps`, `docker compose logs db`. |
| `/api/...` answers **502** | The backend isn't running or is still starting: `docker compose ps`, `docker compose logs backend`. |
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Another program uses the port: set `FRONTEND_PORT` (or `BACKEND_PORT`) to a free one, then `docker compose up -d`. |
| Login works but you are logged out at once | The page is on plain http and not localhost (section 9). |
| `dependency failed to start: container rehab-clinic-backend-1 is unhealthy` | The backend failed during start-up: `docker compose logs backend`. |
| Old UI after an update | Rebuild the frontend (`docker compose up -d --build frontend`); browsers revalidate `index.html` on every visit. |

Useful commands:

```powershell
docker compose ps                                     # status + health
docker compose logs -f --tail 100 backend             # follow the API log (JSON lines)
docker inspect --format "{{json .State.Health}}" rehab-clinic-backend-1   # last health check results
docker compose exec backend sh                        # shell in the API container (as user node)
docker system df                                      # disk used by images, containers, volumes
```

## 12. Never do this

- `docker compose down -v`, `docker volume rm rehab-clinic_db_data` / `rehab-clinic_storage`, `docker volume prune`,
  `docker system prune --volumes`. They delete the clinic's data and uploads permanently.
- Running a second copy of this repository on the same machine with the same project name. Both copies would manage the
  **same** containers and volumes. For a separate test copy use another project name and other ports, for example
  `docker compose -p rehab-clinic-test up -d` with `FRONTEND_PORT`/`BACKEND_PORT` changed in that copy's `.env` files.
- Publishing the database port on a production server, or mounting the database volume into a second PostgreSQL
  container while the first is running (two servers on one data directory corrupt it).
- Changing `database\.env` and expecting the existing database's name, user or password to change (see section 7).

## 13. Development database

`backend\docker-compose.dev.yml` is not part of the stack. It is the PostgreSQL that `npm run start:dev` and the e2e
tests use (published on `127.0.0.1:${DB_PORT}`), with optional pgAdmin, configured from `backend\.env`. It is the same
container (`clinic-postgres`) and volume as before, and it never shares data with the stack.

```powershell
cd backend
docker compose -f docker-compose.dev.yml up -d                    # PostgreSQL for development
docker compose -f docker-compose.dev.yml --profile tools up -d    # + pgAdmin on http://localhost:5050
```
