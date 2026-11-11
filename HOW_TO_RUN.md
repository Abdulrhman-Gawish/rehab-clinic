# How to run the clinic app

These steps start the whole app (website, staff app, database) on one computer with Docker.
You don't need Node.js or PostgreSQL: Docker brings everything.

Commands are for **Windows PowerShell**. On macOS or Linux, use the "macOS / Linux" lines where they differ.

## 1. Install Docker

Install **Docker Desktop** from <https://www.docker.com/products/docker-desktop/>, start it, and wait until it says it
is running. Check it in a terminal:

```powershell
docker compose version
```

## 2. Open the project folder

Open a terminal **in the project folder** (the one that contains `docker-compose.yml`), for example:

```powershell
cd E:\rehab-clinic
```

## 3. Create the settings files

The app reads three settings files. Create them from the examples (this never overwrites files that already exist):

```powershell
if (-not (Test-Path database\.env)) { Copy-Item database\.env.example database\.env }
if (-not (Test-Path backend\.env))  { Copy-Item backend\.env.example backend\.env }
if (-not (Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }
```

macOS / Linux: `cp -n database/.env.example database/.env; cp -n backend/.env.example backend/.env; cp -n frontend/.env.example frontend/.env`

## 4. Fill in the required settings

Make two random passwords (run it twice, and copy each result):

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
```

macOS / Linux: `openssl rand -hex 32`

Then open the files (for example `notepad database\.env`) and change these lines:

| File | Line | Put |
|---|---|---|
| `database\.env` | `DB_PASSWORD=` | the first random password |
| `backend\.env` | `JWT_ACCESS_SECRET=` | the second random password |
| `backend\.env` | `SEED_OWNER_NAME=` | the clinic owner's name |
| `backend\.env` | `SEED_OWNER_EMAIL=` | the owner's login email (a real address, e.g. `name@gmail.com`; **not** `.local`) |
| `backend\.env` | `SEED_OWNER_PASSWORD=` | the owner's first password (at least 8 characters) |
| `backend\.env` | `CLINIC_NAME=`, `CLINIC_PHONE=` | printed on receipts |

Leave everything else as it is. (The `DB_...` lines in `backend\.env` are not used by Docker; don't worry about them.)

## 5. Start the app

```powershell
docker compose up -d --build --wait
```

The first time takes a few minutes (it downloads and builds everything). It is done when you see three lines ending in
**Healthy**.

## 6. Open it

- Website and staff login: <http://localhost:8080>
- Click **Staff login** and use `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from step 4.

The app starts empty: only the owner exists. As the owner, create in this order:
1. **Services** (name, duration, price)
2. **Doctors**, each with a **weekly schedule** (no booking times appear without one)
3. **Staff**: the receptionists

## Everyday commands

Run them in the project folder.

| To | Run |
|---|---|
| Stop the app (all data is kept) | `docker compose down` |
| Start it again | `docker compose up -d --wait` |
| See if it is running | `docker compose ps` |
| See the logs (Ctrl+C to leave) | `docker compose logs -f` |
| Update after getting new code | `docker compose up -d --build --wait` |

If the app was running when the computer shut down, it starts again by itself once Docker Desktop is running.

> **Never run `docker compose down -v`.** The `-v` deletes the database and all uploaded files for good.

## If something goes wrong

| Problem | What to do |
|---|---|
| `env file ... not found` | Do step 3 again. |
| `port is already allocated` | Another program uses port 8080: in `frontend\.env` set `FRONTEND_PORT=8081`, run step 5 again, and open <http://localhost:8081>. |
| A container is not healthy, or the page shows an error | Run `docker compose logs backend` and read the last lines. A message like `Invalid environment configuration: "X" ...` names the setting to fix in `backend\.env`. |
| Login works on this computer but not from another one | Logins need `https` (or `localhost`). See section 9 of [docs/DOCKER.md](docs/DOCKER.md). |

Everything else (backups, updates, sharing with other computers, each service on its own) is in
[docs/DOCKER.md](docs/DOCKER.md).
