# Playground (throwaway test UI)

A deliberately ugly Vite + React UI for clicking through the clinic workflow by hand. **Not for production.
It will be deleted.** API problems found while building it are in [FINDINGS.md](FINDINGS.md).

## Run with Docker (simplest)

From the repo root: `docker compose up -d --build`. It starts the database and the backend, runs the migrations, the
OWNER seed and the demo seed, then serves this UI on http://localhost:5173. See "Run everything with Docker" in
`backend/README.md`.

## Run
```bash
# 1. backend (in backend/): CORS_ORIGINS must include http://localhost:5173 in backend/.env
#    Rate limits count per user (login: per email + IP), so switching roles is fine.
#    THROTTLE_ENABLED=false is only needed while seeding (public booking: 5 per 15 min per IP).
cd backend
npm run start:dev

# 2. playground
cd playground
npm install
npm run dev          # http://localhost:5173
```

The API URL defaults to `http://localhost:3000/api/v1`. Override it with `VITE_API_URL` (UI) or `API_URL` (seed).

## Demo data

```bash
cd playground
npm run seed:demo
```

- Runs **through the API**, logged in as the OWNER from `backend/.env` (`SEED_OWNER_*`).
- **Past days need the database too.** The API stamps everything with "now". So each past day is built through the API
  and then moved back N days with SQL (`pastDay` in the seed). Only timestamps change; every rule and total comes from
  the API. It connects with `DB_*` from `backend/.env` (Docker passes the `db` service), using the `pg` package.
- Expects a **freshly migrated** database (with only the owner seeded). It stops if doctors already exist.
- The history needs appointment times earlier in the day, so it is skipped if you seed before 03:00 Cairo time.
- If it reports a 429, restart the backend with `THROTTLE_ENABLED=false`. It waits out the normal limits on its own,
  but public booking is limited to 5 per 15 minutes per IP.

It creates:

- 1 receptionist and 3 doctors.
- 3 services (30/45/60 min, with different prices). Dr. Mona has a price override on physiotherapy.
- Schedules Sun–Thu 10:00–14:00 and 17:00–21:00.
- **Packages:** "10 physio sessions" for all doctors (2700.00, 10% offer from a week ago to 30 days ahead) and
  "5 sports massages" with Dr. Mona only (1800.00).
- **History (six days, 41 to 6 days ago, so the reports span two months):**
  - Omar: visits with all three doctors and signed notes (one addendum), a 10% student discount and its repeat, a
    no-show, a reschedule to Dr. Karim, a refund, and medical info updated twice.
  - Laila: a walk-in with a fixed discount, a no-show, a payment voided and entered again, a partial payment.
  - Youssef: a massage, an unpaid visit, a no-show, a partial payment.
  - Hana: a cancelled appointment. Plus three expenses.
- **Today:**
  - Omar: attended, 10% discount, paid, note written and signed in one call by Dr. Ahmed.
  - Laila: attended, fixed discount, partial card payment, no note yet.
  - Youssef: attended with Dr. Mona, draft note (so attend can no longer be undone).
  - Nour: confirmed, not here yet. She bought the massage package: attend her to use a session (0.00 line).
  - Kareem: mid-package (physio, 2430.00 with the offer, 1000.00 cash paid). Attended today with Dr. Ahmed. On
    **yesterday's** day list: one no-show whose session was given back, and one still using a session
    (`restoreSession`). Booked again tomorrow.
  - Hana: cancelled.
  - Salma: attended, unpaid (attend can still be undone).
  - Mostafa: no-show (can be undone today).
  - Tarek: walk-in.
  - Ola: attended by mistake and undone (voided visit, cancelled invoice, back to CONFIRMED).
  - One expense.
- **Tomorrow:**
  - Omar with Dr. Mona. She can see Dr. Ahmed's signed note (shared clinical history).
  - Rania, Sherif and Hossam: confirmed.
  - Dina: rescheduled (shows a RESCHEDULED row and a new CONFIRMED one).
- **Next working day:** 4 PENDING public bookings, including "Laila Mahmoud" on Laila's phone, which triggers the
  `nameMismatch` warning.

Today's and tomorrow's reception bookings use "outside schedule", so the seed works on any weekday. Public bookings
need a real slot, so they go to the next Sun–Thu.

### Accounts

| Role | Email | Password |
|---|---|---|
| OWNER | `SEED_OWNER_EMAIL` from `backend/.env` | `SEED_OWNER_PASSWORD` |
| RECEPTIONIST | reception@demo.local | Demo12345! |
| DOCTOR | ahmed@demo.local (Dr. Ahmed Hassan) | Demo12345! |
| DOCTOR | mona@demo.local (Dr. Mona Saleh) | Demo12345! |
| DOCTOR | karim@demo.local (Dr. Karim Adel) | Demo12345! |

The login page has a quick-login button for each of them. The owner button reads `backend/.env` at dev-server start.

## Reset the DB and re-seed

This wipes the database named in `DB_DATABASE` (default `clinic_db`). Stop the backend first.

```bash
cd backend
docker exec clinic-postgres psql -U clinic_user -d postgres \
  -c "DROP DATABASE IF EXISTS clinic_db WITH (FORCE)" -c "CREATE DATABASE clinic_db"
npm run migration:run
npm run seed                 # the OWNER
THROTTLE_ENABLED=false npm run start:dev
# other terminal:
cd playground && npm run seed:demo
```

To keep your dev data, use a separate database instead: prefix the backend commands with
`DB_DATABASE=clinic_db_playground` (`migration:run`, `seed`, `start:dev`) and drop/create that name.

## Trying a full day

1. **Public booking** (`/book`, no login): doctor → service → date → slot → name + phone → reference code. It starts
   PENDING.
   - The demo schedule has no slots on Fri/Sat. On those days, add a range for today first (Owner → Doctors → doctor →
     Weekly schedule).
2. **Receptionist**, Day list: the buttons on each row come from the API's `allowedActions`. Confirming is optional:
   a PENDING row can go straight to **attend** ("entered the doctor"), which creates the visit and its invoice. Use the
   status checkboxes to filter. Open the invoice: apply a discount, record a partial payment.
   - **undoAttend** (same day) is offered only while the doctor has no note and nothing is paid; void the payment
     first. **noShow** appears once the start time has passed, **undoNoShow** the same day.
3. **Doctor**, My day / Needs a note → patient: write the note (Save draft), then Save + sign in one call.
   - Signing is refused (`NOTE_INCOMPLETE`) without an assessment or the treatment done.
   - Notes can be written any day after the visit; "Needs a note" lists every visit still without a signed note.
4. **Receptionist**: open the invoice again, "fill balance", record the payment, then print the receipt from the
   payments table.
5. **Expenses**: add one.
6. **Daily summary** (reception: today only; owner: any day).
7. **Patient page** (Patients → Omar): the overview (next appointment, last visit, counts, doctors seen, balance, notes
   to write) and the timeline. Filter by type or dates, and use "Load more". Log in as a doctor to see that billing
   events and the balance disappear; as reception, the clinical events.
8. **Packages**:
   - Owner → **Services & packages**: services on top, packages underneath. Each has one form for create and
     **edit** (services: name, description, duration, price, doctors; packages: also sessions, offer with dates).
     **Delete** deactivates after a confirm (nothing is hard deleted: history points at it); tick "show deleted" to
     see and **restore** them. "Selling today" is the package's offer price.
   - Patient page → Packages: sell one (creates the invoice; pay part of it on the invoice page), "sessions" lists
     the usages with **restore** for a no-show; the owner can cancel a package.
   - Day list: **attend** opens a box to use the oldest usable package, pick one, or bill normally. The Package column
     shows the session a visit or no-show used; **restoreSession** gives a no-show's session back.
9. **Owner → Reports**: pick a date range (default: from the 1st of last month). There is one section per report, and
   revenue can be grouped by day, month, doctor, service or method.

Times are shown in Africa/Cairo. API errors appear at the top of the page as they are (status, `code`, message,
details).

## Layout

`src/api.ts` is the fetch wrapper (token, one shared refresh on 401, `REFRESH_RACE` retry, error bar). `src/time.ts` has the Cairo helpers, also
used by the seed. `src/pages/*` holds one file per area. `scripts/seed-demo.ts` is the seed.
