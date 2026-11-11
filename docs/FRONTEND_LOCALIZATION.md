# Frontend localization (Arabic default, English)

This is the contract a frontend follows to support Arabic (default, RTL) and English (LTR). The backend part is done
(see "Languages" in `backend/README.md`). The clinic UI in `frontend/` implements everything below (see its README,
"Languages"): `src/i18n/` (catalogs and the current language), `src/format.ts` (display formatting) and the language
sync in `src/api.ts`.

## What the backend gives you

| Need | Source |
|---|---|
| The user's language | `user.preferredLanguage` (`"ar"` or `"en"`) in the `POST /auth/login` response and in `GET /auth/me` |
| Save a new choice | `PATCH /auth/me { "preferredLanguage": "en" }`: the caller's own account only, returns the updated user |
| Default | `"ar"` for every new and every existing account (DB default) |
| Business errors | `body.code` (`ErrorCode` in `backend/src/common/errors/app.exception.ts`), stable; `message` is English, for logs only |
| Validation errors | `body.details[] = { field, errors[], constraints[] }`; translate by `constraints` (and `field` for the label) |
| Statuses and types | English enum values (`CONFIRMED`, `NO_SHOW`, `CASH`, …), never translated by the API |
| Dates | ISO 8601 with the Cairo offset (`2026-11-05T10:00:00+02:00`); local-date filters as `YYYY-MM-DD` |
| Money | decimal strings (`"150.00"`), EGP |

Catalogs with every UI text, error code, validation constraint key and user-facing enum:
[`frontend/src/i18n/en.ts`](../frontend/src/i18n/en.ts) and [`ar.ts`](../frontend/src/i18n/ar.ts) (shared text: errors,
validation, fields, enums, the app frame) plus one pair of files per area in
[`frontend/src/i18n/areas/`](../frontend/src/i18n/areas/) (`desk`, `billing`, `owner`, `referral`, `site`). Every Arabic
file is typed against its English twin, so `tsc` rejects a missing or extra key, and `npm run i18n:check` also compares
the open maps (error codes, field names, …).

## Choosing the language

The account is the source of truth. Browser storage is only a cache so the first paint is right.

1. **App start, no session** (first visit, login page): use the cached language from `localStorage` if there is one,
   otherwise **`ar`**. Never default to the browser's language.
2. **Login**: apply `response.user.preferredLanguage` and write it to the cache. Do **not** send the cached value to the
   server: logging in must never overwrite what the user saved on another device.
3. **App start with a session**: render with the cache, call `GET /auth/me`, and switch if the account differs (it was
   changed on another device).
4. **Token refresh** returns no user: keep the current language.
5. **Switching**: apply at once, write the cache, send `PATCH /auth/me`. If the request fails, go back to the previous
   language and show the error. Only an explicit user action ever calls `PATCH`.
6. **Logout**: keep the cache (the login page stays in the last language). The next user's own preference is applied at
   their login.

## Applying a language

- Set `<html lang="ar" dir="rtl">` or `<html lang="en" dir="ltr">` on every switch (and in `index.html`: `lang="ar" dir="rtl"`,
  so the first paint before scripts run is Arabic).
- One central module, `frontend/src/i18n/index.ts`, owns the current language (`getLang`, `setLang`, `useI18n()`) and
  the two catalogs. Every component reads its text from it; no component hardcodes text.
- The catalogs are typed objects (`t.patients.title`, `t.common.by(name)`), not string keys, so `tsc` rejects a missing
  key (no dependency). A library such as `react-i18next` is only worth it if plurals and lazy loading become a real
  need, and adding it needs approval first (project rule).

### Keys

| Kind | Key | Example |
|---|---|---|
| UI text | `<page>.<thing>` | `patients.searchPlaceholder` |
| Field labels | `fields.<dto field>` | `fields.phone` (also used for `details[].field`) |
| Enums | `enums.<EnumName>.<VALUE>` | `enums.AppointmentStatus.NO_SHOW` |
| Business errors | `errors.codes.<CODE>` | `errors.codes.SLOT_UNAVAILABLE` |
| Validation | `validation.<constraint>` | `validation.isEnum`, fallback `validation.fallback` |
| HTTP fallback | `errors.http.<status>` | `errors.http.403` |

Error display: `errors.codes[code]` if `code` is set, else for 400 with `details` one line per field
(`fields[field]: validation[constraints[0]]`), else `errors.http[status]`, else `errors.generic`.
Never show `message` to users.

### Adding a translation

1. Add the key to **both** `en.ts` and `ar.ts` (or to the area's `*.en.ts` / `*.ar.ts` pair); `tsc` and
   `npm run i18n:check` (part of `npm run build`) fail when they differ.
2. Read it from `t` (`useI18n()`). For a new `ErrorCode` or enum value in the backend, add `errors.codes.<CODE>` /
   `enums.<Enum>.<VALUE>` in the same PR.

## RTL

- Use CSS logical properties everywhere: `margin-inline-start/end`, `padding-inline`, `inset-inline-start`,
  `border-inline-start`, `text-align: start/end`. No `left`/`right` in new CSS.
- Flex and grid follow `dir` automatically. Mirror only directional icons (arrows, chevrons, "back"); never mirror
  logos, clocks, media controls or charts' time axes.
- Keep phone numbers, reference codes (`APT-7K3Q9X`), invoice numbers, emails and amounts LTR inside Arabic text:
  wrap them in `<bdi>` or `dir="ltr"` spans (otherwise `+201012345678` renders as `201012345678+`).
- Check every third-party component in RTL (date pickers, selects, toasts, modals, tables with sticky columns). The
  frontend's own components (`frontend/src/ui/`, `frontend/src/styles/`) use logical properties only; the one
  third-party UI is the Quill editor on the blog page, whose list markers are flipped in RTL by the site styles.
- Directional icons (arrows, chevrons, back/next) are drawn pointing to the inline end and mirrored by the
  `icon-directional` class in RTL (`frontend/src/ui/icons.tsx`).
- Mixed content (Arabic name inside an English page and vice versa) needs no special handling beyond `<bdi>` for values.

## Formatting

Display only. Values sent to the API stay machine-readable: ISO with offset, `YYYY-MM-DD`, decimal strings.

| | Arabic | English |
|---|---|---|
| Locale | `ar-EG-u-nu-latn` (Arabic, Western digits) | `en-GB` |
| Dates/times | `Intl.DateTimeFormat(locale, { timeZone: 'Africa/Cairo', … })` | same |
| Numbers | `Intl.NumberFormat(locale)` | same |
| Money | `Intl.NumberFormat(locale, { style: 'currency', currency: 'EGP' })` | same |

- Always pass `timeZone: 'Africa/Cairo'`: the clinic's day, not the device's.
- Digits: Western (0-9) in both languages, as on the clinic's website (decided in
  `docs/visual-identity/DESIGN_SYSTEM_PROPOSAL.md` §3.2). Plain `ar-EG` would give Arabic-Indic digits (١٢٣); the
  choice lives in one place, `LOCALES` in `frontend/src/i18n/index.ts`.
- Money: format the decimal string for display only (`Number("150.00")` is exact for these amounts); never parse a
  formatted string back and never send one to the API. Totals always come from the server.
- Inputs (dates, amounts) stay in machine format; the backend already accepts Arabic-Indic digits in phone numbers.
- Machine helpers that build API values (for example `en-CA` to get `YYYY-MM-DD`) must not follow the UI locale.
- Adding a formatter: put it in the locale module next to the others (`formatDate`, `formatTime`, `formatMoney`, …),
  taking the current locale from there, so no component calls `Intl` with a hardcoded locale.

## Not translated

- Enum values, error codes and any value sent to or stored by the API.
- Names, notes and clinical text entered by staff: shown exactly as stored.
- Audit `oldValues` / `newValues` (raw data; label the field names only).

## Checklist for the frontend PR

- First visit and login page in Arabic, RTL; `<html lang dir>` correct in both languages.
- Switch to English, reload, log out and in, log in on a second browser: still English. Switch back: the other browser
  shows Arabic after `GET /auth/me`.
- Every page, dialog, table, empty state, toast and confirmation reads from the catalogs (no English left in Arabic).
- Every `ErrorCode`, validation constraint and status enum has both translations (key-set check in CI).
- Dates, times and money follow the locale and the Cairo time zone; requests still send ISO / decimal strings.
- RTL review of forms, tables, menus, dialogs, icons and third-party components; phone numbers and codes display LTR.
- Arabic names search across spelling variants (the API does this) and display unchanged.
