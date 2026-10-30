# API findings from the playground

Things that were missing, awkward or took several calls while building the throwaway UI. Each one has the screen,
what was hard, what the frontend does now and what the API could do instead. Rough priority: **high** = every
real frontend will hit it, **med** = annoying, **low** = cosmetic.

Everything listed was checked against the running backend (`origin/main` at `d3b9045`). Each entry now says what
`feature/desk-workflow` did about it.

Since then the clinic also clarified the desk workflow: reception does all attendance (attend / undo attend / no-show /
undo no-show / walk-in), doctors only write and sign notes, and visits are just ACTIVE or VOIDED. That removed the
start/complete buttons and the queue's waiting states from this UI.

## Reception

### 1. No "allowed actions" on day-list rows (high)
- **Status: fixed.** Every `GET /appointments/day` row has `allowedActions`, computed from the state machine plus the time and undo rules (`appointment-actions.ts`). `DayList.tsx` renders exactly those buttons.
- **Screen:** Reception day list.
- **Hard:** The UI has to copy the appointment *and* visit state machines to decide which buttons to show
  (confirm / cancel / no-show / check-in / undo / cancel visit / reschedule). Some rules aren't in the status at
  all: no-show only after `startAt`, check-in only on the appointment's day, undo only for non-walk-ins.
- **Now:** Hand-written conditions in `DayList.tsx`; anything they get wrong comes back as a 422.
- **Instead:** Add `allowedActions: string[]` to each `GET /appointments/day` row, computed from the state machines
  plus the time rules.

### 2. A PENDING booking can't be rescheduled (med)
- **Status: fixed.** `PENDING → RESCHEDULED` is allowed; the new appointment is CONFIRMED.
- **Screen:** Day list → reschedule.
- **Hard:** A patient phones to move an online (PENDING) booking. `POST /appointments/:id/reschedule` only accepts
  CONFIRMED, so reception has to confirm the booking first and then reschedule it: two calls and two history rows for
  one action.
- **Now:** The reschedule button only shows on CONFIRMED rows.
- **Instead:** Allow `PENDING → RESCHEDULED` (the new appointment is CONFIRMED anyway).

### 3. The invoice appears asynchronously after check-in (med)
- **Status: fixed.** Attend and walk-in create the invoice in the same transaction and return `invoiceId`. The listener, the visit events and `POST /visits/:id/invoice` are gone, and so is the "create invoice" workaround.
- **Screen:** Day list → "invoice" right after check-in.
- **Hard:** The invoice is created by an after-commit listener, so the check-in response has no `invoiceId` and a
  day-list reload made immediately afterwards can still say `NOT_INVOICED`.
- **Now:** Reload the list. When there's still no invoice, a "create invoice" button calls `POST /visits/:id/invoice`
  (idempotent).
- **Instead:** Return `invoiceId` in the check-in / walk-in response (e.g. call the same idempotent creation before
  responding), or document that clients should call `POST /visits/:id/invoice` when they need it immediately.

### 4. Patient lookup "not found" has no error code (low)
- **Status: fixed.** `200 { patient: null }` for an unknown phone.
- **Screen:** New booking / walk-in → phone lookup.
- **Hard:** `GET /patients/lookup?phone=` answers an unknown phone with a plain 404 (`No patient with this phone
  number`) and no `code`. "Unknown phone" is the normal case at the desk, not an error, and the client can't tell it
  apart from a wrong route.
- **Now:** Any 404 counts as "new patient", and the error bar is suppressed for it.
- **Instead:** Return `200 { patient: null }`, or add `code: PATIENT_NOT_FOUND`.

### 5. Staff availability can't show past times, but booking allows backdating (med)
- **Status: fixed.** With `includeOutsideSchedule`, past dates and times are listed (RECEPTIONIST back to `BACKDATE_MAX_DAYS`, OWNER any date), booked slots excluded. The free time input is gone.
- **Screen:** New booking / reschedule with "outside schedule".
- **Hard:** `includeOutsideSchedule=true` still starts at *now*, and a past date gives 422 `DATE_OUT_OF_RANGE`. But
  `POST /appointments` with `allowOutsideSchedule` accepts starts up to `BACKDATE_MAX_DAYS` back, so recording an
  appointment that already happened can't use the slot list.
- **Now:** With "outside schedule" ticked, a free time input next to the slot buttons.
- **Instead:** With `includeOutsideSchedule`, allow past dates/times within the backdate limit (still excluding booked
  slots).

### 6. Patient page takes 5 requests (med)
- **Status: fixed** in Stage 8: the page now makes one `GET /patients/:id/overview` call plus the paged
  `GET /patients/:id/timeline` (type filter, "load more").
- **Screen:** Patient page.
- **Hard:** `GET /patients/:id`, `/appointments`, `/visits`, `/invoices` and `/balance`: five round trips for one
  screen.
- **Now:** `Promise.all` of five calls.
- **Instead:** `GET /patients/:id/overview` with the patient, balance and the latest N appointments/visits/invoices.
  At minimum, put `balance` on the patient response.

### 7. "Who did it" is only an id (med)
- **Status: fixed.** Every "who did it" is `{ id, name }` (`receivedBy`, `appliedBy`, `createdBy`, `voidedBy`, `issuedBy`, `cancelledBy`, `updatedBy`, `uploadedBy`, `attendedBy`, `bookedBy`, `changedBy`), and audit rows have `user: { id, name, role }`. The UI shows names.
- **Screens:** Invoice (payments `receivedById`, discount `appliedById`), expenses (`createdById`, `voidedById`),
  audit log (`userId`), medical info (`updatedById`), attachments (`uploadedById`).
- **Hard:** A RECEPTIONIST can't call `/users`, so they can't turn these ids into names. Only the receipt has
  `receivedBy` as a name, and the daily summary's `discounts.byUser` has names.
- **Now:** The first 8 characters of the id. The audit log (OWNER) loads `/users` and maps the ids itself.
- **Instead:** Return `{ id, name }` objects (as `doctor` already is), e.g. `receivedBy: { id, name }`.

### 8. "Repeat last discount" can return this invoice's own discount (low)
- **Status: fixed.** `?excludeInvoiceId=` gives the previous discount, and there is `200 null` when there is none (`NO_PREVIOUS_DISCOUNT` removed).
- **Screen:** Invoice → repeat last discount.
- **Hard:** Once the current invoice has a discount, `GET /patients/:id/last-discount` returns that same discount.
  No previous discount is a 404 (`NO_PREVIOUS_DISCOUNT`), which is a normal case.
- **Now:** Hide the button when `last.invoiceId === invoice.id`. Treat 404 as "none" and don't show it as an error.
- **Instead:** `?excludeInvoiceId=` or "previous to this invoice" semantics, and `200 null` when there is none.

### 9. No `locked` flag on invoices (low)
- **Status: fixed.** `InvoiceDetailDto` has `isLocked` and `canCancel`; the invoice page uses them instead of guessing.
- **Screen:** Invoice.
- **Hard:** Items and the discount are locked once the invoice has ever had a valid payment. The client has to infer
  that from `payments` to grey out the discount form (and "ever had" can't be inferred after a void/refund).
- **Now:** Guess from the payments list. The API's `INVOICE_LOCKED` error is the real answer.
- **Instead:** Add `isLocked: boolean` (and maybe `canCancel`) to `InvoiceDetailDto`.

### 10. `DELETE /invoices/:id/discount` needs a JSON body (low)
- **Status: fixed.** `POST /invoices/:id/discount/remove { reason }`.
- **Screen:** Invoice → remove discount.
- **Hard:** A DELETE with a body (`{ reason }`) is unusual. Some HTTP clients, proxies and `fetch` wrappers drop it.
- **Now:** Works with plain `fetch`.
- **Instead:** `POST /invoices/:id/discount/remove { reason }` (like `POST /invoices/:id/cancel`).

### 11. Inconsistent date filters and verbs (low)
- **Status: fixed.** Every list endpoint takes local dates (`from=YYYY-MM-DD&to=YYYY-MM-DD`, inclusive, clinic time zone), and every action is a POST. `dayRange()` is gone from `time.ts`.
- **Hard:** Date filters come in three styles: `?date=YYYY-MM-DD` (day list, queue, summary, availability),
  `?from&to` as local dates (expenses) and `?from&to` as ISO with offset (appointments, visits, invoices, payments,
  audit logs, time off). For "today's visits" the client must build `2026-10-30T00:00:00+02:00` itself, with DST.
  Verbs are mixed too: `PATCH /appointments/:id/confirm|cancel|no-show` but `POST /appointments/:id/check-in|reschedule`
  and `POST /visits/:id/cancel`.
- **Now:** A `cairoIso()` / `dayRange()` helper in `time.ts` (Intl-based).
- **Instead:** Accept local dates (`from=2026-10-30&to=2026-10-30`, inclusive, clinic time zone) on every list
  endpoint, and use POST for every state-changing action.

## Doctor

### 12. Note "not found" is ambiguous (med)
- **Status: fixed.** `200 null` when there is no note yet; another doctor's draft is 404 `NOTE_NOT_VISIBLE`.
- **Screen:** Visit → note form.
- **Hard:** `GET /visits/:id/note` returns a 404 without a `code` both when the visit has no note yet (the normal
  first state) and when the note is another doctor's draft. The client can't tell "show an empty form" from
  "you can't see this".
- **Now:** Any 404 means "no note yet" and isn't shown as an error.
- **Instead:** `200 null` for "no note yet", and keep 404 (with a code) for "not visible".

### 13. Saving a note needs two different calls, and signing needs a third (low)
- **Status: fixed.** `PUT /visits/:id/note` upserts the draft, and `POST …/note/sign` takes the final fields (save + sign in one call).
- **Screen:** Visit → note form.
- **Hard:** The first save is `POST /visits/:id/note` and later saves are `PATCH`, so the client must track whether a
  note exists. "Save + sign" is two requests (save, then `POST …/sign` with no body).
- **Now:** Choose POST or PATCH from the loaded state, then sign.
- **Instead:** `PUT /visits/:id/note` as an upsert of the draft, and let `sign` optionally take the final fields.

### 14. Medical info rejects empty strings (med)
- **Status: fixed.** Optional text fields are trimmed and blank becomes `null` (`TrimOrNull`). `orNull()` is gone from the UI.
- **Screen:** Visit → edit medical info (and the note fields).
- **Hard:** `PUT /patients/:id/medical-info` replaces the record, so every field must be sent. Clinical text fields are
  `Length(1, 5000)`, so a cleared textarea (`""`) gives 400 instead of clearing the field. Every form must map `""`
  to `null`.
- **Now:** `orNull()` on every field before sending.
- **Instead:** Normalise blank/whitespace-only strings to `null` in the DTO (`Trim` + empty→null).

### 15. Completed visits drop out of the queue (low)
- **Status: fixed differently.** The queue is now the day's ACTIVE visits (nothing is "completed" any more), the doctor has their own day list (`GET /appointments/day`, own rows), and `GET /clinical-notes/needs-attention` lists every visit still without a signed note, on any day.
- **Screen:** Doctor queue.
- **Hard:** `GET /visits/queue` only has WAITING/IN_SESSION. To add an addendum or attachment to a visit that was just
  completed, the doctor needs another list.
- **Now:** The queue page also shows `GET /visits?from&to` for the day.
- **Instead:** `GET /visits/queue?includeCompleted=true`, or document the `/visits` filter for this.

### 16. Files need the Authorization header (low, by design)
- **Status: no change** (by design). Files stay behind the Authorization header.
- **Screens:** Attachments, expense receipts.
- **Hard:** `GET /attachments/:id/file` and `GET /expenses/:id/receipt` need a Bearer token, so `<a href>` / `<img src>`
  can't be used.
- **Now:** `fetch` → blob → object URL in a new tab.
- **Instead:** Fine for privacy. If thumbnails are wanted later, use a short-lived signed download URL
  (`GET …/file-url` → `{ url, expiresAt }`).

### 17. The login response has no doctor id (low)
- **Status: fixed.** Login and `/auth/me` include `doctorId` (null for non-doctors).
- **Screen:** Any doctor screen that needs "my doctorId" (own schedule, own availability).
- **Hard:** `POST /auth/login` and `GET /auth/me` return the *user*. The doctor profile id is different, so a doctor
  UI must call `GET /doctors` and match on `userId`.
- **Now:** Not needed yet (queue and visits are scoped automatically).
- **Instead:** Add `doctorId: string | null` to the user response.

## Owner

### 18. Audit filter needs exact enum values and has no names (low)
- **Status: half fixed.** Rows carry `user: { id, name, role }`. A `GET /audit-logs/meta` for the enums is not added; the list stays hardcoded here.
- **Screen:** Audit log.
- **Hard:** `action` and `entityType` must be exact enum values, and nothing lists them (only Swagger does). The rows
  have `userId` only (see #7).
- **Now:** A hardcoded entity-type list, a free-text action box and a `/users` lookup for names.
- **Instead:** Include `user: { id, name, role }` in the rows. The enums could be served from a small
  `GET /audit-logs/meta`.

## Public booking

### 19. No way to find the next day with free slots (med)
- **Status: deferred** to the website stage.
- **Screen:** Public booking.
- **Hard:** Slots are per date only. On closed days (Fri/Sat in the demo schedule) the patient gets an empty list
  and has to try dates one by one, which also uses up the 30/min public-read limit.
- **Now:** The date defaults to tomorrow, and the patient changes it by hand.
- **Instead:** `GET /public/doctors/:id/available-dates?serviceId&from&to` → `["2026-11-01", …]`, or return the
  next available date with an empty slot list.

## Cross-cutting

### 20. Rate limits are per IP, and the whole clinic shares one IP (high, before production)
- **Status: fixed.** Authenticated routes count per user, login per email + IP; per-IP limits remain only on public routes. `THROTTLE_ENABLED=false` is now only needed while seeding.
- **Hard:** Login is 5/min and everything else 120/min **per IP**. All the desks and doctors in one clinic usually sit
  behind the same router/NAT, so 5 staff logins in a minute (shift start) or a few screens polling the day list and
  queue will hit 429 for everyone. I hit the login limit by switching roles in the playground.
- **Now:** Run the backend with `THROTTLE_ENABLED=false` while using the playground (see README).
- **Instead:** Throttle login per email + IP, and authenticated routes per user id instead of per IP. Keep per-IP
  limits only for public endpoints.

### 21. Error bodies without `code` for normal "not found" answers (low)
- **Status: fixed.** Normal "nothing found" answers are `200 null` (note, last discount), `{ patient: null }` (lookup) or a 404 with a code (`REFERENCE_NOT_FOUND`, `NOTE_NOT_VISIBLE`).
- Same pattern as #4, #8 and #12. A client branches on these 404s as normal flow, so each one deserves either a
  `code` or a `200 null`.

## Things that worked well
- Error bodies (`status`, `code`, `message`, `details`) are easy to show as they are. `VISIT_COMPLETION_BLOCKED`,
  `NOTE_INCOMPLETE`, `OVERPAYMENT` and the others read clearly in the error bar.
- `GET /appointments/day` has nearly everything the desk needs in one call (patient, doctor, visit, payment status,
  balance, `nameMismatch`).
- Check-in of a PENDING booking confirms it on the way: one click.
- `POST /visits/:id/invoice` being idempotent made the async-invoice workaround trivial.
- The receipt endpoint returns exactly what a printed receipt needs.
- CORS via `CORS_ORIGINS` worked first time.
