# Playground (throwaway test UI)

A deliberately ugly Vite + React UI for clicking through the clinic workflow by hand. **Not for production.
It will be deleted.** API problems found while building it are in [FINDINGS.md](FINDINGS.md).

## Run

```bash
# 1. backend (in backend/): CORS_ORIGINS must include http://localhost:5173 in backend/.env
#    THROTTLE_ENABLED=false avoids 429s when you switch roles often (login is limited to 5/min per IP)
cd backend
THROTTLE_ENABLED=false npm run start:dev

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

- Runs **through the API only**, logged in as the OWNER from `backend/.env` (`SEED_OWNER_*`).
- Expects a **freshly migrated** database (with only the owner seeded). It stops if doctors already exist.
- If it reports a 429, restart the backend with `THROTTLE_ENABLED=false`. It waits out the normal limits on its own,
  but public booking is limited to 5 per 15 minutes.

It creates:

- 1 receptionist and 3 doctors.
- 3 services (30/45/60 min, with different prices). Dr. Mona has a price override on physiotherapy.
- Schedules Sun–Thu 10:00–14:00 and 17:00–21:00.
- **Today:**
  - Omar: completed, 10% discount, paid, signed note by Dr. Ahmed.
  - Laila: waiting, fixed discount, partial card payment.
  - Youssef: in session with Dr. Mona, draft note.
  - Nour: confirmed.
  - Hana: cancelled.
  - Salma: waiting, unpaid.
  - Mostafa: no-show.
  - Tarek: walk-in.
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

1. **Public booking** (`/book`, no login): doctor → service → date → slot → name + phone → reference code.
   - The demo schedule has no slots on Fri/Sat. On those days, add a range for today first (Owner → Doctors → doctor →
     Weekly schedule).
2. **Receptionist**, Day list: confirm → check-in. Open the invoice: apply a discount, record a partial payment.
3. **Doctor**, Queue → patient: start the session, write the note.
   - "Complete" is refused (`VISIT_COMPLETION_BLOCKED`) until the note is signed.
   - Signing is refused (`NOTE_INCOMPLETE`) without an assessment or the treatment done.
   - Save + sign, then complete.
4. **Receptionist**: open the invoice again, "fill balance", record the payment, then print the receipt from the
   payments table.
5. **Expenses**: add one.
6. **Daily summary** (reception: today only; owner: any day).

Times are shown in Africa/Cairo. API errors appear at the top of the page as they are (status, `code`, message,
details).

## Layout

`src/api.ts` is the fetch wrapper (token, one refresh on 401, error bar). `src/time.ts` has the Cairo helpers, also
used by the seed. `src/pages/*` holds one file per area. `scripts/seed-demo.ts` is the seed.
