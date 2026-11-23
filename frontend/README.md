# Frontend (Rehab clinic UI)

The clinic's web UI: React 19 + TypeScript + Vite, Arabic first (RTL) with English. It was the throwaway
`playground/` and is now rebuilt on the Rehab design system. One app serves two audiences:

- **Public website** (no login): home (`/`), online booking (`/book`), blog (`/blog`, `/blog/:id`).
- **Staff app** (`/login`, then by role): reception desk (day list, booking and walk-ins, patients, invoices, expenses,
  daily summary), doctors (my day, notes), and the owner (staff, doctors, services and packages, salaries, referring doctors,
  reports, marketing, audit log, blog, client reviews).

API problems found while building the first version are in [FINDINGS.md](FINDINGS.md).

## Structure

```
src/
  main.tsx, App.tsx       entry and routes (public layout, /login, staff layout)
  api.ts                  fetch wrapper: cookie session, one shared refresh, error + success toasts (showError, notify, act)
  i18n/                   current language; en.ts / ar.ts (shared text) + areas/<area>.{en,ar}.ts (page text)
  format.ts, time.ts      display formatting (locale, Cairo time) / machine values for the API
  ui/                     the design-system components (Button, Field, Card, Table, StatusBadge, Dialog, Tabs, …)
  layout/                 StaffLayout (sidebar + top bar), PublicLayout (header, footer, WhatsApp), LanguageSwitcher
  components.tsx          domain pickers shared by several pages (doctor/service, slots, doctors)
  pages/                  one file per area
  styles/                 tokens.css, base.css, components.css, layout.css, areas/<area>.css
public/                   favicon, manifest, brand assets (public/assets/…, see "Brand assets")
scripts/                  check-i18n.ts (ar/en catalogs match; part of npm run build)
src/*.test.ts             unit tests of pure modules (npm test: node:test through tsx, no extra dependency)
nginx/                    default.conf.template: the Docker image's nginx (SPA fallback, /api proxy, caching)
```

## Design system

The look follows the Rehab visual identity in [docs/visual-identity/](../docs/visual-identity/) (brand green
`#309C53`, accent orange `#F89A3A`, Noto Kufi Arabic, 10 px radius, green-tinted photo banners, section headings with
the orange bar). The rules that keep it consistent:

- **Tokens only.** Every colour, size, radius, shadow and duration comes from `src/styles/tokens.css` (identical to the
  design proposal). Need a value that has no token? Add a token.
- **Components, not one-off markup.** Pages are built from `src/ui` (import from `'../ui'`): `PageHeader` (the page's
  `h1` and tab title), `Card`, `Table` (cells with class `num` for amounts, `actions` for buttons), `StatusBadge` for
  every API enum, `EmptyState`, `Loading`, `Pagination`, `Tabs`, `Stepper`, `Dialog`, `Field` + `Input`/`Select`.
- **Lists page on the server.** Every list that can grow uses `usePaged(path, limit)` from `src/components.tsx` and puts
  its `pager` under the table (or in the card footer). It goes back to page 1 when `path` (patient, filters, search)
  changes, to the last page when the list got shorter, and never shows an older response after a newer request.
  Never fetch `limit: 100` to show a whole list; that is only for small fixed sets (staff, doctors, services, packages)
  used as pickers.
- **No `window.prompt/confirm/alert`.** Use `confirmAction`, `askReason` (a required reason, 3+ characters as the API
  wants) and `ask` (several fields). Destructive actions use `tone: 'danger'`.
- **Feedback.** API errors appear as an error toast (by code, then validation rule, then HTTP status); successes call
  `act(fn, t.x.saved)` for a short confirmation toast. `Button` shows a spinner while its async `onClick` runs, so
  nothing is submitted twice. `Button` defaults to `type="button"`: pass `type="submit"` in forms.
- **Accessibility:** visible focus everywhere, labels on every field, dialogs are native `<dialog>` (focus trap, Escape),
  icons are decorative unless they are the only content (`IconButton` requires a `label`).
- **No new dependencies** without approval (project rule). Icons are inline SVG in `src/ui/icons.tsx`, fonts load from
  Google Fonts in `index.html`.

### Brand assets

`public/assets/` (logos, favicon and app icons, share image, photos, patterns) was imported once from the legacy
website: the originals were copied into `design-source/legacy-import/` (git-ignored, not served) and turned into
resized, metadata-free web files. The import is done; the files in `public/assets/` are now the source. Asset IDs and
the open licensing questions are in
[docs/visual-identity/ASSET_MIGRATION_GUIDE.md](../docs/visual-identity/ASSET_MIGRATION_GUIDE.md).

## Languages (Arabic default, English)

The whole UI is in **Arabic (right-to-left) by default**, including the login page on a first visit, with **English**
as the alternative. It follows [docs/FRONTEND_LOCALIZATION.md](../docs/FRONTEND_LOCALIZATION.md).

- **Switcher** in the top bar and the public header (also before login). Logged in, the choice is saved on the account
  (`PATCH /auth/me { preferredLanguage }`), so it follows the user to every device; it is reverted if saving fails.
- **Which language shows:** before login the last one used in this browser, else Arabic. At login and on every app
  start (`GET /auth/me`) the account's language wins. Logging out keeps the last language for the login page.
- **Text:** shared text in `src/i18n/en.ts` / `ar.ts`, page text in `src/i18n/areas/<area>.en.ts` / `.ar.ts`. Each
  Arabic file is typed against its English twin, so a missing or extra key fails `tsc`. `npm run i18n:check` also
  compares the open maps (error codes, field names, validation rules, …) and runs in `npm run build`. Components read
  `const { t } = useI18n()`; dialogs opened from event handlers use `msg()` at click time.
- **API values are never translated:** statuses, codes and enum values are labelled with `label(t.enums.X, value)` or
  `<StatusBadge kind="X" value={…} />`; errors are shown by `code`, then by validation `constraints`, then by HTTP status.
- **Formatting:** `src/format.ts` (`fmtDateTime`, `fmtDate`, `fmtTime`, `fmtMoney`, `fmtNumber`, `fmtWeekday`, …) uses
  `ar-EG-u-nu-latn` (Arabic with Western digits, as on the clinic's website) / `en-GB` and Cairo time. `src/time.ts`
  keeps the machine helpers that build API values.
- **RTL:** `<html lang dir>` is set from the language; all CSS uses logical properties, and arrows/chevrons mirror
  automatically. Phone numbers, codes and emails are wrapped in `<Ltr>` so they stay left-to-right inside Arabic text.
- **Adding text:** add the key to the English file, then to the Arabic one (tsc tells you), and use `t.section.key`.
- Data entered by staff (names, service names, notes) is shown as stored.

## Run with Docker (simplest)

From the repo root: `docker compose up -d --build` (after creating `database/.env` and `backend/.env`, see
[docs/DOCKER.md](../docs/DOCKER.md)). It starts the database and the backend, runs the migrations and the OWNER seed,
then serves the **production build** of this UI with nginx on http://localhost:8080 (only the OWNER exists: see
"First login").

- `Dockerfile`: `npm run build` (tsc, i18n check, vite build), then `nginxinc/nginx-unprivileged` serves `dist/`.
  `nginx/default.conf.template` sends unknown paths to `index.html` (React Router), caches the hashed bundles for a
  year and forwards `/api/` to the backend (`BACKEND_URL`, default `http://backend:3000`) on the same origin.
- The image is always built with `QUICK_LOGIN=false` and never sees `backend/.env`: no quick-login button and no
  credentials in the bundle.
- On its own: `docker compose -f frontend/docker-compose.yml up -d --build` (the API answers 502 until the backend is
  up). Port: `FRONTEND_PORT` in `frontend/.env` (`frontend/.env.example`).
- The Vite dev server (below) is for development only.

## Run
```bash
# 1. backend (in backend/)
#    Rate limits count per user (login: per email + IP), so switching roles is fine.
#    Public booking allows 5 per 15 min per IP; THROTTLE_ENABLED=false turns the limits off.
cd backend
npm run start:dev

# 2. frontend
cd frontend
npm install
npm run dev          # http://localhost:5173

# 3. optional, share it (another terminal; set QUICK_LOGIN=false in backend/.env and restart step 2 first)
cloudflared tunnel --url http://localhost:5173
# Stop: Ctrl+C in each terminal.
```

The UI calls the API on `/api/v1` of its own address and Vite forwards it to `http://localhost:3000`
(`API_PROXY_TARGET`). Keep it that way: the login sets **HttpOnly cookies** (the UI never sees a token, nothing is in
`localStorage` but the logged-in user's name and role), and they only work when the API is on the same origin.

## First login

The database starts with **only the OWNER** (`SEED_OWNER_*` in `backend/.env`, created by `npm run seed` or by the
Docker backend on start, only while the database has no OWNER). There is no demo data: log in as the OWNER and create
the rest in the UI, in this order:

1. **Services** (Owner → Services & packages): name, duration and price.
2. **Doctors** (Owner → Doctors): each with their services and a **weekly schedule**; the booking pages show no time
   slots until a doctor has one.
3. **Staff** (Owner → Users): the receptionists.
4. Optional: packages, referring doctors, blog posts.

With the dev server, the login page has a quick-login button for the OWNER (it reads `backend/.env` at dev-server
start); `QUICK_LOGIN=false` removes it. The Docker image never has it.

## Reset the DB

This wipes the database named in `DB_DATABASE` (default `clinic_db`) and leaves only the OWNER. Stop the backend first.

```bash
cd backend
docker exec clinic-postgres psql -U clinic_user -d postgres \
  -c "DROP DATABASE IF EXISTS clinic_db WITH (FORCE)" -c "CREATE DATABASE clinic_db"
npm run migration:run
npm run seed                 # the OWNER
npm run start:dev
```

## Trying a full day

0. **Website** (`/`, no login): the home page (hero, figures, services, specialisations, founder, latest posts) with
   **Book now** in the header and the floating WhatsApp button. Staff use **Staff login** in the header; once logged
   in, the header shows **Dashboard** instead. Switch ع / EN anywhere: the page flips between right-to-left and
   left-to-right.
1. **Public booking** (`/book`): a four-step wizard. Doctor (cards) → service, or one of that doctor's packages (offer
   badge, old price struck through) → date (previous / next day) and a time slot → name and phone beside a summary.
   The last screen shows the reference code with a copy button. The appointment starts PENDING.
   - Picking a package also picks its service. It is only a request: the day list shows "wants: …", and **Attend**
     preselects "sell it and use it" (sells the package, then covers the visit with its first session). Nothing is
     paid online.
   - A doctor shows no slots until they have a weekly schedule for that day (Owner → Doctors → doctor →
     Weekly schedule).
2. **Receptionist / owner**, Day list (`/reception`, `pages/Schedule.tsx`): a calendar. **Day** view (default) has one
   column per active doctor on a shared time axis (hatched = outside the doctor's weekly schedule, striped = time off,
   red line = now) and a separate **Walk-ins** column (listed by arrival, not placed on the time axis). **Week** view
   (Saturday to Friday) has one column per day, with a walk-ins row under the day headers; a day's header opens it in
   Day view. Each view is two requests: `GET /appointments/day` (with `to` for the week) and `GET /working-hours`. The toolbar has the view switch,
   previous / next, a date, **Today**, a chip per doctor (hide / show a column) and the status chips (none selected =
   every status); everything is kept in the address. Overlapping appointments sit side by side; cancelled and moved
   ones are dashed. On wide screens the page makes room for the side panel. Four counts sit above the calendar: on the list, attended, waiting, no-show. Clicking a card opens
   the **side panel** (patient, appointment, visit and billing, and the buttons from the API's `allowedActions`); the
   calendar stays as it was behind it, and an action reloads the data without moving it. Doctors keep the table
   (`/doctor`, `pages/DayList.tsx`), which shares the same action handlers (`useRowActions`).
   - **Appointment type** (Examination / Follow-up / Session): a badge on the cards, the side panel and the doctors'
     table. A receptionist changes it in the side panel (**Change type**, any status, walk-ins too); the owner and the
     doctors only see it. The owner's side panel also shows the visit's clinical note (read-only); reception never
     sees clinical text.
   - Confirming is optional: a PENDING row can go straight to **Attend** ("entered the doctor"). It opens a dialog
     (package choice as cards when the patient has one) and creates the visit and its invoice.
   - **Patient details before the doctor** (`checkInDetails.tsx`, rules in `patientIdentity.ts`): when the patient
     lacks an identity document (National ID, or a passport for a non-Egyptian), gender, date of birth or a referral
     source, the Attend dialog (and the **Walk-in** form, step 4) asks for them and sends them with the check-in.
     **Doctor referral** as the source asks for the referring doctor and shows its terms (the patient page's
     `TermsFields`): the referral is recorded with the check-in, so this session's invoice is already covered.
     A valid National ID sets the date of birth and gender (shown read-only, "from the National ID"); with a
     passport they are typed. The age is shown under the date of birth. A malformed ID or a missing field is
     flagged before sending. A complete patient shows "details complete" with the patient code (RH…).
   - **Cancel**, **No-show** and the undo actions ask for a reason in a dialog (at least 3 characters). Closing the
     dialog sends nothing. **Reschedule** opens a dialog with the slot picker.
   - **Undo attend** (same day) is offered only while the doctor has no note and nothing is paid; void the payment
     first. **No-show** appears once the start time has passed, **Undo no-show** the same day.
   - An attended row whose session invoice was cancelled shows **Invoice cancelled** in the Payment column and a
     **Create invoice** button: it shows the API's preview (the cancelled invoice and the new one, with the patient's
     current referral and discount) to confirm, issues the new invoice and refreshes the list.
   - Every action confirms with a green toast.
3. **Booking at the desk** (`/reception/book`): switch between **Appointment** and **Walk-in** (each form keeps what
   was typed). Both ask for the **appointment type** (required, nothing preselected; the public booking asks the
   patient too). Type the phone and press **Search**: a known patient shows as a card, an unknown number asks for a
   name. `/reception/book?phone=01…` fills and looks up the number (the patient page's **Book appointment** uses it).
4. **Invoice** (open it from the day list): items and totals on one side, **Discount** and **Payment** cards on the
   other. Apply a discount, record a partial payment, then **Fill balance** and pay the rest. **Print** a payment's
   receipt from the payments table (80 mm layout).
   - Wrong doctor referral: void the receipts and end the referral, then **Correct invoice** (asks for a reason) cancels
     the invoice and opens its replacement. A cancelled session invoice offers **Create invoice** instead. Both show
     the API's preview first; the buttons appear only when the API allows them (`canCorrect` / `canReissue`). The two
     invoices link to each other ("Replaced by …" / "Replaces …").
5. **Doctor**, My day / Needs a note → visit: write the note (**Save draft**), then **Sign** (it asks to confirm).
   - The visit's **appointment type** (badge in the header) decides the note's fields (`noteFields.ts`, mirroring the
     API): **Examination**: chief complaint, assessment, diagnosis, treatment plan, pain level and the visit's
     attachments (with an upload); **Session**: treatment provided, progress, pain level; **Follow-up**: assessment,
     progress, treatment plan, pain level. An appointment from before types ("Type not set") shows every field.
   - Every field is optional, also for signing. A signed note stays editable (**Save changes**); every change is in
     the owner's audit log. Addenda are still added under a signed note.
   - When reception changes the type later, values written under the old type stay visible, read-only, under
     "Recorded under another appointment type" (also in the patient's clinical tab).
   - Notes can be written any day after the visit; "Needs a note" lists every visit still without a signed note.
6. **Expenses**: **Add expense** opens a dialog; the period filter and the total of valid expenses are at the top.
7. **Daily summary** (reception: today only; owner: any day, with previous / next day): totals by payment method and
   the expected cash in the drawer, then **Outstanding at the end of the day**: what patients still owed and (owner
   only) what the clinic owed its doctors (salaries, referral commissions), with how each moved during the day. A past
   day keeps showing what was unpaid then, even if it was paid later. **Full details** opens the reports on that day.
8. **Patient page** (Patients → search, or any patient from today's list): the header (phone, source, registration date,
   **Book appointment**) and the tabs. The open tab is kept in the address (`?tab=`), so a reload stays on it.
   - **Personal** shows the patient code, the date of birth with the **age** (computed as of today) and (owner,
     reception) the identity document; **Edit details** changes the
     identity document, gender, date of birth and notes. Once there is a code, a receptionist sees the document as
     read-only (only the owner can correct it). The patients search also finds a code, National ID or passport number.
   - **Overview**: counts, balance, next appointment, last visit, doctors seen, notes still to write.
   - **Medical & clinical** (owner, doctors): medical info, then the notes and the attachments, each with its own
     pages (10 per page). The owner has no **Appointments** tab (reception and doctors do).
   - **Timeline**: filter by type or dates, and use **Load more**.
   - Log in as a doctor to see that billing events and the balance disappear; as reception, the clinical events.
9. **Packages**:
   - Owner → **Services & packages**: services on top, packages underneath. **New** and **Edit** open a dialog
     (services: name, description, duration, price, doctors; packages: also sessions, offer with dates).
     **Deactivate** hides one for a while (a service can't be booked, a package can't be sold, neither is on the
     website) and **activate** shows it again. **Delete** asks in a red confirm dialog and removes it for good.
     A service with packages can't be deleted until its packages are; patients keep the sessions of a deleted
     package. "Selling today" is the package's offer price.
   - Patient page → Packages: sell one (creates the invoice; pay part of it on the invoice page), **Sessions** lists
     the usages with **Restore** for a no-show; the owner can cancel a package (with a reason).
   - Day list: the Package column shows the session a visit or no-show used; **Restore session** gives a no-show's
     session back.
10. **Owner → Reports**: pick a date range or a preset (this month, last month, last 30 days, this year; default: from
    the 1st of last month). Money and activity figures come first. Revenue is drawn as a chart (days and months
    always run left to right, even in Arabic) with the same numbers in a table, grouped by day, month, doctor, service
    or method.
    - **Money flow and what is owed**: the two balances at the start and end of the range and what moved them (for a
      single day, the daily summary's numbers), every transaction (payments, refunds, expenses, with what each expense
      pays for), what the clinic owes at the end of the range (per doctor and month, per referring doctor; advances
      apart) and what patients owe (per patient, with the unpaid invoices).
11. **Owner → Doctors** → a doctor: three cards. **Services** (a special price per service), **Weekly schedule**
    (time ranges per weekday, each one can be paused) and **Time off** (it warns about appointments that overlap).
    - On the doctors list, **deactivate** hides a doctor for a while (no login, no booking, not on the website) and
      **activate** brings them back.
    - **Delete** (red confirm dialog) removes the doctor for good: the login stops, and they leave every list,
      service and package. Past visits and invoices keep the name. It is refused (`DOCTOR_HAS_APPOINTMENTS`) while
      they have pending or confirmed appointments from today on; cancel or move those first.
12. **Owner → Salaries** (`/owner/salaries`): a month picker and a doctor dropdown. Without a doctor: every doctor's
    pay type, sessions, commission, earned, paid and remaining, with totals. Pick a doctor (dropdown or **Open**):
    - **Salary terms** → **Set terms**: applies from a month, fixed monthly salary (0 = commission only), commission
      none / per session (one rate) / per service (a rate per service, "None" = no commission), each a fixed amount or a
      percentage. Earlier versions are listed; a month that has a payment can't get new terms.
    - **Statement**: fixed + commission = earned, paid, remaining (or overpaid), and every attended session with its
      value (invoice or package session), rate and commission. Undo a visit and it drops out.
    - **Record payment** (advances and parts allowed) and **Void**; each payment is also an expense (Expenses shows it
      locked as "Doctor salary").
    - **Staff → Employees** (`?staff=employees`): the same month overview and statement for employees, with a fixed
      monthly salary only (**Set salary**: from a month, 0 = not paid from then), payments and voids; their expenses
      show as "Employee salary".
    - **Owner → Employees** (`/owner/employees`): the staff directory (name, job title with suggestions, phone, notes,
      an optional login account that is never a doctor's, an optional first salary). **Deactivate** can also stop the
      salary from a chosen month (a 0 salary version; earlier months stay owed).
13. **Owner → Referring doctors** and **Marketing**: referring doctors with their agreements, ledger and payouts; new
    patients by source, online campaigns (utm) and referrals over a date range, with CSV export.
14. **Blog**:
    - Owner → **Blog** (`/owner/blog`): two cards. The editor (Quill: heading, bold, italic, underline, lists, align,
      link, clear formatting; it loads only on this page) and the details: title, description, keywords (type one and
      press Enter; at least 5, a repeated one is ignored, × removes it), the category, and the cover (drop a picture
      on the box or click it; JPG, PNG or WEBP). **Publish** puts it on the website at once (no drafts). The table
      below has **edit** (loads the post into the form; a new cover is optional), **delete** (red confirm dialog; gone
      from the website for good) and **view**. The server cleans the HTML: try pasting a `<script>` or a
      `javascript:` link.
    - The website's blog (`/blog`): filter by category, newest first, **Load more** adds the next 6. A post opens at
      `/blog/:id` with its date, category, cover, content and keywords. The home page shows the latest 3.

15. **Client reviews** (OWNER only):
    - Owner → **Client reviews** (`/owner/reviews`, in the Website group). Other roles never see it, are sent back to
      their own home from `/owner/reviews...`, and the API answers 403 to them.
    - The list: search (client, text, keyword; Arabic spelling variants match), type and status filters (kept in the
      URL), 20 per page from the server. Each row has **view** (dialog with the whole text, the keywords and the files,
      pictures previewed), **edit**, **publish / unpublish** and **delete** (red confirm).
    - The form (`/owner/reviews/new`, `/owner/reviews/:id/edit`): review type (Text, Image, Gallery), client name, the
      review, keywords (Enter or a comma adds one), the attachments (click or drop on the box; JPG, PNG, WEBP or PDF,
      5 MB each, 10 per review; × removes one) and **Published**. One save sends everything; **Cancel** asks first when
      something changed.

Times are shown in Africa/Cairo, with Western digits in both languages. API errors appear as an error toast (top end
of the screen) in the UI language, with the technical details (status, `code`, message) folded underneath. When a
dialog is open, the error is shown inside the dialog too, because the dialog covers the toast.
