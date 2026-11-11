# Visual Identity Analysis: Rehab Physiotherapy Center (legacy frontend)

| | |
|---|---|
| **Subject** | مركز ريهاب للعلاج الطبيعي والتأهيل ("Rehab Center for Physical Therapy and Rehabilitation"), `rehabeg.clinic` |
| **Source analysed** | Legacy Next.js 14 (pages router) application in this repository. The analysis is read-only. |
| **Analysis date** | 2026-11-07 |
| **Purpose** | Record the existing visual identity and UI implementation exactly, so a new frontend in a separate repository can keep the brand and modernise the UI without access to this repository. |
| **Companion documents** | [ASSET_INVENTORY.md](ASSET_INVENTORY.md) · [DESIGN_SYSTEM_PROPOSAL.md](DESIGN_SYSTEM_PROPOSAL.md) · [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md) · [FRONTEND_IMPLEMENTATION_GUIDE.md](FRONTEND_IMPLEMENTATION_GUIDE.md) |

### Evidence labels used in all five documents

| Label | Meaning |
|---|---|
| **[Verified]** | Read directly in source code or measured from a file. Paths and line numbers point into the legacy repository. |
| **[Inferred]** | Follows from the code but was not observed in a running browser. |
| **[Recommendation]** | A proposal for the new frontend. It is not existing behaviour. |

Paths such as `styles/main.scss:16` are relative to the legacy repository root. The new repository will not contain them. They are included so the analysis can be audited.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Brand overview](#2-brand-overview)
3. [Styling architecture](#3-styling-architecture)
4. [Colour system](#4-colour-system)
5. [Typography](#5-typography)
6. [Layout and UI patterns](#6-layout-and-ui-patterns)
7. [Responsive design](#7-responsive-design)
8. [RTL / LTR behaviour](#8-rtl--ltr-behaviour)
9. [Accessibility observations](#9-accessibility-observations)
10. [Dead and unused UI code](#10-dead-and-unused-ui-code)
11. [Brand identity vs. outdated UI (Phase 3)](#11-brand-identity-vs-outdated-ui-phase-3)

---

## 1. Executive summary

1. **The brand is two colours: green `#309C53` and orange `#F89A3A`.** [Verified] Both come straight from the logo. Pixel sampling of `public/logo-header.png` gives green `#309C52` (52 % of opaque pixels) and orange `#F89A3A` (48 %). The CSS variables in `styles/main.scss:18-19` match them to within one unit. The physical clinic uses the same palette: orange accent walls, grey walls and the same logo signage (see `public/about-cover.png`).
2. **The web UI uses green heavily and orange rarely.** [Verified] `var(--Primary-Color)` (green) is used 156 times. `var(--Main-Color)` (orange) is used 8 times, and 5 of those are in a chat widget that is never rendered. In the live UI, orange appears only as section-heading underline bars, bullet dots and star ratings.
3. **Typography is a single Arabic typeface, Noto Kufi Arabic**, loaded through `next/font/google` (`utils/fonts.js:5-10`). [Verified] There is no English typeface. `Inter` is imported but never instantiated (`utils/fonts.js:1`).
4. **Styling is global SCSS with no component scoping, no Tailwind, no CSS modules and no theme provider.** [Verified] Thirteen page-level partials are `@use`d into one global `styles/main.scss`. Only seven CSS custom properties exist. Most colours are hard-coded, with 30+ distinct greys.
5. **Responsiveness is desktop-first and tuned to screen-zoom levels.** [Verified] Base styles target screens wider than 2048 px. Twelve or thirteen files repeat full override blocks at 2048 / 1921 / 1707 / 1537 px, and the layout switches to mobile at 1107 px. There are 44 distinct `max-width` breakpoints and no CSS Grid. On a common 1536 px laptop viewport, body copy shrinks to 10–11 px and buttons to 9–10 px.
6. **The site is Arabic, but the document is LTR.** [Verified] `pages/_document.js:18` sets `<Html lang="en">` with no `dir`. RTL appearance is faked with 40 `text-align: right`, 31 `flex-direction: row-reverse`, 5 `column-reverse` and 10 `align-items: flex-end` declarations, and with DOM reordering.
7. **There are no focus states anywhere.** [Verified] `outline: none` is set globally on buttons and inputs (`styles/main.scss:43,52`). Most buttons have no hover, active or disabled state either.
8. **Recognisable brand patterns worth keeping** (detail in §11):
   - photo banners tinted green
   - section titles with an orange underline bar
   - a statistics strip that overlaps the hero
   - green icon circles
   - the founder's portrait in the hero
   - a floating green WhatsApp button
   - a top utility bar with phones and socials
9. **Asset hygiene is poor.** [Verified] `public/` holds 80 MB, including two founder PNGs of 14.5 MB and 16.4 MB, one of them imported but never used. Seven files in `public/` are unused or referenced only by dead code: six images plus `message.mp3`. Details are in [ASSET_INVENTORY.md](ASSET_INVENTORY.md).

---

## 2. Brand overview

| Item | Value | Source |
|---|---|---|
| Arabic name | مركز ريهاب للعلاج الطبيعي والتأهيل | `next-seo.config.js:2` |
| Short / Latin name | "Rehab" (logo wordmark "Reh…" + "ريهاب"), alt texts "Physio Rehab Logo" and "Rehab EG Clinic" | `Components/Header.js:63`, `Components/Landing/Carousel.js:32` |
| Domain | `https://rehabeg.clinic/` (canonical uses `www.`) | `next-seo.config.js:7,38` |
| Locale (SEO) | `ar_AR` | `next-seo.config.js:6` |
| Founder / lead clinician | د. محمد يحيي جمال الدين (Dr. Mohamed Yehia Gamal El-Din). He appears in the full logo lockup, the hero carousel and the doctor section. | `public/logo.png`, `Components/Landing/Doctor-Profile.js:29` |
| Tagline (in full logo) | للعلاج الطبيعي و التأهيل | `public/logo.png` (visual) |
| Social handles | Facebook, Instagram and TikTok `rehabclinic11`; WhatsApp `wa.link/mtmbq6` | `Components/Footer.js:29-32` |
| Contact | `support@rehabeg.clinic`; 4 phone numbers; address in 6th of October City (Golden Mall) | `Components/Footer.js:21-26` |

### 2.1 Logo system [Verified, visual inspection]

| Variant | File | Description | Used |
|---|---|---|---|
| Primary | `public/logo-header.png` (1851×1486, transparent PNG) | Calligraphic Latin "Reh" in green. A green "figure" swoosh with an orange head (the person mark). An orange "A"-shaped stroke. Arabic مركز and ريهاب in green and orange. No tagline. | Header (`Components/Header.js:4,63`) |
| Reversed | `public/footer-logo.png` (2057×2038, transparent PNG) | The green parts become white and the orange stays orange, for use on green backgrounds. It includes the tagline and founder line in white. | Footer (`Components/Footer.js:5,50`) |
| Full lockup | `public/logo.png` (2057×2038, transparent PNG) | The primary mark plus the green tagline "للعلاج الطبيعي و التأهيل" and the founder's name in dark grey `#5A5B5B`. | **Not referenced anywhere** |
| Favicon | `public/favicon.ico` | One 256×206 32-bit BMP entry. It is not square and has no 16/32/48 px sizes. | Only by absolute URL in `next-seo.config.js:42,46` |

**Logo colours measured from pixels** [Verified] (exact values, sampled from `logo-header.png` and `logo.png`):

| Colour | Hex | Share of opaque pixels |
|---|---|---|
| Logo green | `#309C52` | 52 % (header logo), 50 % (full lockup) |
| Logo orange | `#F89A3A` | 48 % (header logo), 43 % (full lockup) |
| Lockup text grey | `#5A5B5B` | 8 % (full lockup only) |

**No vector logo (SVG/AI/PDF) exists in the repository.** [Verified]

### 2.2 Physical brand environment [Verified, visual inspection]

- `public/about-cover.png` is a photo of the clinic reception. It shows orange feature walls and an orange reception arch, grey walls, vertical wood slats, green plants, and the current "Rehab" logo as 3D signage on the reception desk and back wall.
- `public/poster.png` (video poster) shows a reception wall with the same person mark in green and orange, but the wordmark reads **"TAAHEEL"** (Arabic "تأهيل" = rehabilitation) above the founder's name. **This wordmark differs from the "Rehab" logo.** It may be an older brand or another branch. Confirm with the client before using `poster.png` in the new UI.

---

## 3. Styling architecture

### 3.1 Sources of styling [Verified]

| Layer | File(s) | How it is loaded | Notes |
|---|---|---|---|
| Global entry | `styles/main.scss` (626 lines) | `pages/_app.js:2` `import '@/styles/main.scss'` | Defines the `:root` tokens (lines 16-24), element resets (26-75), the spinner, the cookie bar, the route loader, the WhatsApp float, the filter component and their media queries. |
| Page / feature partials | `styles/Chat/Chat.scss`, `Header/Header.scss`, `Footer/Footer.scss`, `Landing/Landing.scss`, `Contact/Contact.scss`, `Blog/Blog.scss`, `Blogs/Blogs.scss`, `About/About.scss`, `Specialization/Specialization.scss`, `Sign/Sign.scss`, `Dashboard/Dashboard.scss`, `Reservation/reservation.scss`, `Profile/Profile.scss` | `@use` at `styles/main.scss:2-14` | **All global.** Class names are plain (`.blog`, `.dropmenu`, `.active`, `.layer-on`), so collisions exist. One example: `.change-password-container` is styled from both Sign.scss and Profile.scss. |
| Size of partials (lines) | Dashboard 14,162 · Sign 3,380 · Landing 3,198 · Profile 2,637 · reservation 2,509 · Contact 1,374 · About 923 · Blog 863 · Specialization 836 · Blogs 546 · Header 495 · Footer 441 · Chat 322 | | In most partials, two-thirds to four-fifths of the lines are repeated media-query overrides (Dashboard 76 %, About 82 %, reservation 81 %, Landing 67 %; Header 38 %; Chat has none). |
| Icon font CSS | `styles/icofont/webapp.css`, `medical.css`, `person.css`, `device.css` (+ 8 font files in `styles/icofont/fonts/`) | `pages/_app.js:8-11` | IcoFont v1.0.1 subsets. All four declare `@font-face { font-family: IcoFont }` with identical descriptors and no `unicode-range`. They work only if the browser falls back per glyph across faces. That is fragile. [Inferred] |
| Toast CSS | `styles/ReactToastify.css` (703 lines) | `pages/_app.js:17` | A vendored copy of react-toastify's CSS. The only visible customisation is `--toastify-font-family: 'Noto Kufi Arabic'` (line 23). Colours are library defaults (lines 4-7). |
| Third-party CSS | `react-quill/dist/quill.snow.css` | `pages/dashboard/write-blog.js:9` | Rich text editor theme. |
| Third-party CSS | `react-image-gallery/styles/css/image-gallery.css` | `pages/work/[work].js:11`, `pages/review/[review].js:11` | Gallery on work and review detail pages. |
| Font | `next/font/google` `Noto_Kufi_Arabic` | `utils/fonts.js:5-10` → `Layouts/Layout.js:13` (`className`) | Self-hosted by Next at build time. There are no font files in the repo. |
| Inline styles | `style={{…}}` in JSX | Many components | Mostly `objectFit` on `next/image`, the carousel transform, and spinner colour. |
| JS-defined colours | Chart.js datasets, `LoadingCircle` prop | `Components/System/*.js`, `Components/Loading-Circle.js:3` | See §4.4. |

**Not used** [Verified]: Tailwind, CSS Modules, styled-components or emotion, a theme provider, a design-token file, a component library (MUI, Chakra, etc.), Storybook, CSS Grid (`display: grid` appears 0 times).

### 3.2 Relationships

```
pages/_app.js
 ├─ styles/main.scss ──@use──► 13 page partials (all global selectors)
 │      └─ :root tokens (7 custom properties)
 ├─ styles/icofont/{webapp,medical,person,device}.css ──► styles/icofont/fonts/*.woff(2)
 ├─ styles/ReactToastify.css
 └─ Layouts/Layout.js
        ├─ className = notoKufiArabic.className   (utils/fonts.js)
        ├─ Components/Landing/Intro-Info.js  (top utility bar)
        ├─ Components/Header.js
        ├─ {page}
        ├─ WhatsApp float (markup in Layout.js:22-24, styles in main.scss:173-200)
        └─ Components/Footer.js
```

- Every route, including `/dashboard/*`, renders inside the public-site Layout. That means the intro bar, header, footer and WhatsApp button are present on admin pages too. [Verified] (`pages/_app.js:66`)
- **Reusable design components are minimal** [Verified]. The only shared UI components are:
  - `Components/Loading.js`: full-screen route loader
  - `Components/Loading-Circle.js`: spinner icon
  - `Components/System/Head.js`: dashboard page header
  - `Components/filterComponent.js`: filter dropdown, used on 2 pages
  - Buttons, inputs, dropdowns, cards and modals are re-implemented per page with copy-pasted SCSS. The agent extraction found `.date-header` duplicated 7×, the input block 4+×, and the day-information table 4×.

---

## 4. Colour system

### 4.1 Declared tokens (`styles/main.scss:16-24`) [Verified]

| Token | Value (hex) | Uses | Where used | Visual purpose | Verdict |
|---|---|---|---|---|---|
| `--Primary-Color` | `#309C53` | 156 | Dashboard 50, Sign 40, Profile 15, Landing 12, reservation 12, Header 11, main 4, Contact 3, About/Blog/Blogs/Specialization 2 each, Footer 1. Also hard-coded `#309C53` in 18 JS files (spinners, charts). | Primary brand colour: buttons, active states, icons, footer background, route loader, page-header bars, WhatsApp button, links and hover colour | **Preserve** as the brand anchor. **Adjust its use**: white text on it is only 3.50:1, so use a darker shade for text-bearing surfaces (see proposal). |
| `--Main-Color` | `#F89A3A` | 8 | Landing 3 (section underline bar `Landing.scss:339`, credential dots `:606`, review stars `:903`), Chat 5 (dead code) | Secondary brand accent | **Preserve and use more.** It is half of the logo and of the physical clinic. Never use it as a text colour on white (2.17:1). |
| `--Regular-Font-Color` | `#4A6F8A` (slate blue) | 8 | About, Blog, Contact, Specialization, Landing | Body and secondary text on public pages | **Preserve** as the secondary text colour (5.34:1 on white). |
| `--Headlines-Color` | `#232323` | 15 | About, Blogs, Contact, Landing, Sign | Headings, card titles | **Preserve** as the primary text colour (15.72:1). |
| `--Gray-Color` | `#CBCBCB` | 2 | Social icons in the intro bar (`Landing.scss:19`), doctor image backdrop (`:543`) | Muted icon colour | **Adjust.** 1.62:1 on white is too faint for meaningful icons. |
| `--Input-Background` | `rgb(241,241,241)` = `#F1F1F1` | 1 | Chat form only (dead) | Input fill | **Replace** with `#EDF1F1`, which is the real input fill used across the app. |
| `--Box-Shadow-Color` | `0 0 10px rgba(0,0,0,.5)` (a shadow, not a colour) | 4 | Chat only (dead) | Shadow | **Drop.** |

The variable naming is inverted relative to usage: `--Main-Color` is the minor accent and `--Primary-Color` is the main colour. [Verified]

### 4.2 Brand-green alpha variants (hard-coded) [Verified]

| Value | Effective look | Where | Purpose |
|---|---|---|---|
| `#309c526a` (≈42 % alpha) | Green photo tint | `About.scss:19`, `Blog.scss:20`, `Blogs.scss:18`, `Contact.scss:20`, `Specialization.scss:17` | Overlay on every page-banner photo (signature pattern) |
| `#309c5264` (≈39 %) | Green tint | `Landing.scss:242` | Hero slide overlay **on hover only** |
| `#309c5295` (≈58 %) → `#309c52c1` (≈76 %) on hover | Strong green tint | `Landing.scss:637,740` | Video teaser overlay |
| `#309c52b6` (≈71 %) | Lighter green | `Profile.scss:61` | Profile tab hover |
| `rgb(107,199,136)` = `#6BC788` | Light green | `Dashboard.scss:2548` | ERP rail button hover |
| `rgb(105,215,105)` = `#69D769` | Off-brand bright green | `Dashboard.scss:2134` | Segmented control hover |

### 4.3 Neutrals, surfaces, text, borders [Verified]

There are more than 30 distinct greys. They are grouped by role below.

| Role | Values found (most common first) | Main locations |
|---|---|---|
| Page background | `white` | `main.scss:30` |
| Input / control fill | `#EDF1F1` (26 uses), `#F0F0F0` (10), `rgb(239,239,239)`, `rgb(241,241,241)`, `#d7d7d7`, `rgb(225,225,225)`, `rgba(220,220,220,.368)`, `#c7c6c64e` | Sign/Profile/Dashboard inputs, `.dropmenu` (`Dashboard.scss:405`), reservation |
| Panel / tinted surface | `#c7c6c622`, `#c7c6c633`, `rgba(244,244,244,.732)`, `rgb(240,240,240)`, `#F5F5F5`, `#e9eef5cc`, `#cbcbcb48` | Profile sidebar and cards, reservation steps, ERP stats cards, contact form section (`Contact.scss:136`), About icon chips (`About.scss:100`), doctor-section backdrop shapes (`Landing.scss:523`) |
| Primary text | `#232323` (token), `black`, `rgb(0,0,0)` | Headings, dashboard |
| Secondary text | `#4A6F8A` (token), `rgb(87,87,87)` (header nav, `Header.scss:35`), `rgb(58,58,58)` (mobile nav), `rgb(55,55,55)`, `rgb(56,56,56)` | Body copy, nav |
| Muted text / icons | `rgba(128,128,128,.771)`, `rgba(128,128,128,.714)`, `rgba(128,128,128,.577)`, `gray`, `rgb(169,169,169)`, `rgb(180,180,180)`, `rgb(192,192,192)`, `rgb(196,196,196)`, `rgb(209,209,209)`, `rgb(164,164,164)`, `#CBCBCB` | Step labels, kebab icons, close icons, meta text |
| Dividers / borders | `rgb(228,228,228)` (card divider), `rgb(218,218,218)`, `rgb(235,235,235)` (3px dividers, 10×), `rgba(128,128,128,.09)` (ERP bars, 8×), `rgba(128,128,128,.299)` (mobile nav), `rgba(0,0,0,.268)` (profile), `rgba(223,223,223,.842)` (intro bar), **`black`** (dashboard tables) | Various |
| Shadows | `0 0 25px 0 rgba(221,221,221,.816)` (7×, cards), `0 0 30px 0 rgb(221,221,221)` (6×, stat strip and cards), `0 0 10px rgb(205,204,204)` (dropdowns), `0 0 10px #bebebe` (modals), `0 4px 10px rgba(221,221,221,.593)` (header), `0 0 15px rgba(221,221,221,.639)` (contact inputs) | The signature look is a soft, zero-offset grey halo. |
| Overlays | `rgba(0,0,0,.071)`, `.081`, `.118`, `.205`, `.233` + `backdrop-filter: blur(2–4px)` | Modals, mobile menu, video modal |

### 4.4 Semantic and status colours [Verified]

| Purpose | Values in use | Where |
|---|---|---|
| Error text | `rgb(218,27,27)` = `#DA1B1B` | Contact form inline errors (`Contact.scss:198,238,269`) |
| Danger buttons | `rgb(218,29,29)` = `#DA1D1D`; `red` (#FF0000, 9×); `rgb(238,60,60)` = `#EE3C3C` | `.red-btn` (`Dashboard.scss:2607`), remove pages, package delete, profile delete pop (`Profile.scss:565`) |
| Disabled surface | `rgb(255,235,235)`, `rgb(220,220,220)` (`.disabled-btn`, unused) | `Dashboard.scss:483-486, 466-470` |
| Info action | `#2196F3` | Package "info" icon button (`Dashboard.scss:2800`) |
| Edit action | `#FF9800` | Package "edit" icon button (`Dashboard.scss:2810`) |
| Paid / active | `#309C53` | Session payment `.paid` (`Dashboard.scss:3333-3336`) |
| Online / offline | `#05b113` / `#fb7676` | Chat header (dead) |
| Toasts (library defaults) | info `#3498db`, success `#07bc0c`, warning `#f1c40f`, error `#e74c3c`; `theme="colored"` | `styles/ReactToastify.css:4-7`, `pages/_app.js:94` |
| Chart series | income `#309C53`; outgoing `rgba(255,99,132,.6)`; legend swatch `#FC89A2` (mismatch) | `Components/System/IncomeOutgoingChart.js:16,22`, `ERP-Statistics.js:22-28`, `Dashboard.scss:3405` |
| Spinner default | `#3498db` (off-brand). Callers usually pass `#309C53` or `white`. | `Components/Loading-Circle.js:3` |
| Carousel arrow hover | `#12161E` | `Landing.scss:110` |

There is **no success / warning / info badge or alert component**. Feedback is delivered almost entirely by toasts. Package statuses such as "جارية" and "ملغية" are plain uncoloured text. [Verified]

### 4.5 Interaction-state colours [Verified]

| Element | Default | Hover | Active / selected | Focus | Disabled |
|---|---|---|---|---|---|
| Header nav link | `rgb(87,87,87)` 800 | `--Primary-Color` | none (desktop); mobile drawer `.active` = green bg + white | **none** | n/a |
| Header outline button | transparent, green text, 1px green border | green bg, white text | none | **none** | none |
| Header filled button | green bg, white | **none** | none | **none** | none |
| Hero CTA | white bg, green text | green bg, white text, 1px white border | none | **none** | none |
| Service card | white | entire card green, all text white | none | n/a | n/a |
| Generic page CTA (most) | green bg, white, square | **none** | none | **none** | none (buttons stay clickable while loading) |
| Sign/profile input | `#EDF1F1`, transparent border | 1px green border, green icon | n/a | `:focus-within` 1px green border (the only focus style in the app) | `disabled` has no styling |
| `.dropmenu` option | browser default bg | green bg, white | n/a | **none** | `.disabled` = `rgb(255,235,235)` |
| Profile tabs | transparent | `#309c52b6`, white | green, white | **none** | n/a |
| Toggle switch | off `#ccc` | n/a | on `--Primary-Color` | **none** | n/a |
| Reservation doctor card | white, 3px white border | `scale(1.03)` | 3px green border + green check | **none** | n/a |

### 4.6 Contrast audit (WCAG 2.x) [Verified, computed]

| Pair | Ratio | Result |
|---|---|---|
| White on `#309C53` (every green button and the footer) | **3.50:1** | Fails AA for normal text. Passes only for large text (≥ 24 px, or ≥ 18.66 px bold) and UI components. |
| `#309C53` text on white | 3.50:1 | Same as above |
| `#F89A3A` on white | **2.17:1** | Fails everything. Decorative use only. |
| `#232323` on `#F89A3A` | 7.24:1 | Passes AAA. Dark text works on orange. |
| `#4A6F8A` on white / on `#EDF1F1` | 5.34 / 4.69 | Passes AA |
| `#232323` on white | 15.72 | Passes AAA |
| `#CBCBCB` (social icons) on white | **1.62** | Fails |
| Toast success `#07bc0c` with white text | **2.56** | Fails |
| Toast warning `#f1c40f` with white text | **1.66** | Fails |
| `#DA1B1B` on white | 5.06 | Passes AA |

---

## 5. Typography

### 5.1 Font families [Verified]

| Font | Source | Weights loaded | Applied | Status |
|---|---|---|---|---|
| **Noto Kufi Arabic** | Google Fonts via `next/font/google` (`utils/fonts.js:2,5-10`). `subsets: ['arabic']`, `display: 'swap'`, `variable: '--Noto-Font'`. | 200, 300, 400, 500, 600, 700, 800 | `Layouts/Layout.js:13` puts `notoKufiArabic.className` on the root `div`, so all text inherits it | **Essential brand typeface.** The only family in use. |
| Inter | `next/font/google` import (`utils/fonts.js:1`) | none | Never instantiated | Unused |
| IcoFont | Local woff/woff2 (`styles/icofont/fonts/`) | 400 | `<i class="icofont-…">` on the landing page only | Icon font, not text |
| (fallback) | Browser default | n/a | n/a | No explicit fallback stack is declared |

**Font defects** [Verified unless marked]:

1. `styles/main.scss:46,50,62,551` and `styles/ReactToastify.css:23` set `font-family: 'Noto Kufi Arabic'` literally on `button`, `input`, `textarea` and toasts. `next/font` registers the face under a hashed family name and applies it through a class. The literal name therefore resolves only if the font is installed locally. **Form controls and toasts probably render in the browser's default font.** [Inferred, verify in a browser]
2. The CSS variable `--Noto-Font` is declared but never used, because `.className` is applied instead of `.variable`.
3. `styles/Sign/Sign.scss:61,434,604` contain `font-family: 900;`, which is invalid (the author meant `font-weight`).
4. `font-weight: 900` appears twice (`Sign.scss:316,387`), but only weights up to 800 are loaded, so the browser synthesises or clamps it. [Inferred]

### 5.2 Weights in use [Verified]

`700` ×82 · `500` ×30 · `800` ×21 · `600` ×19 · `400` ×4 · `300` ×3 · `200` ×3 · `900` ×2. The visual voice is heavy: bold and extra-bold headings and buttons, with light weights (200/300) used only for hero sub-headings and the doctor's title.

### 5.3 Heading hierarchy and sizes [Verified]

Many elements rely on browser default heading sizes (h1 = 2em, h2 = 1.5em, h3 = 1.17em). Explicit sizes are set per breakpoint. **There are 0 `line-height` declarations in the codebase**, so all text uses `normal`.

| Element | > 2048 px (base CSS) | ≤ 1537 px (typical laptop) | ≤ 1107 px (tablet / mobile) | Source |
|---|---|---|---|---|
| Hero title h1 | 75 px / 700 | 50 px | 50 px (no smaller override exists) | `Landing.scss:192-195`, 1537 block, 1107 block |
| Hero kicker h2 | 55 px / 300 | 30 px | 30 px | `Landing.scss:186-189` |
| Hero paragraph h3 | default (~22 px) / 200 | 13 px | 13 px | `Landing.scss:198-201` |
| Hero button | default / 700 | 10 px | 10 px | `Landing.scss:204-232` + media blocks |
| Page banner title h1 | 65 px / 800, white, `text-shadow 0 0 4px black` | smaller per breakpoint | smaller | `About.scss:29-35` and equivalents |
| Section heading `.global-headline h1` | 40 px / 800 `#232323` | **22 px** | smaller | `Landing.scss:330-334` |
| Doctor name h1 | 55 px | 35 px | 35 px | `Landing.scss:572-576` |
| Card title (service) h1 | default 32 px | 18 px | n/a | `Landing.scss:392-399` |
| Card body (service) h4 | default 16 px / 400 | **10 px** | **10 px** | `Landing.scss:402-410` |
| Header nav links | default 16 px / 800 | **11 px** | n/a (drawer 14 px) | `Header.scss:33-35, 457-458, 189` |
| Header buttons | default / 700 | **10 px** | drawer 11 px | `Header.scss:61, 469` |
| Intro bar text | default / 600 | **11 px** | hidden | `Landing.scss` 1537 block |
| Statistics numbers | 55 px green | 35 px | 30 px | `Landing.scss:309-312` |
| Dashboard / forms on mobile | n/a | 9–12 px | **8–10 px** | Agent extraction of `Dashboard.scss` and `Sign.scss` |

**Semantics are misused** [Verified]. `h1` is used for card titles and stat numbers, `h2`/`h3`/`h4` are used for body paragraphs, and many pages contain several `h1` elements. The new build should not copy heading levels from the legacy markup.

### 5.4 Arabic / English

- All UI copy is Arabic. There is no English UI and no i18n framework. [Verified]
- Digits are Western (0–9) everywhere: phone numbers, dates (`12-7-2024`), statistics. [Verified]
- Latin strings appear inline (email address, "MP4", "EMS", "TMJ") and render in the Arabic face or a fallback. [Inferred]
- **Essential to identity:** Noto Kufi Arabic, with its geometric Kufi letterforms and heavy weights in headings. The logo lettering is custom calligraphy, not a font, so it must always come from the logo artwork.

---

## 6. Layout and UI patterns

### 6.1 Global shell (all routes) [Verified]

| Part | Implementation | Styling (base, > 2048 px) | Behaviour |
|---|---|---|---|
| **Top utility bar** `.intro-info` | `Components/Landing/Intro-Info.js` | Height 80, bottom border `rgba(223,223,223,.842)`. Left: 4 social icons (35 px, `#CBCBCB` → green on hover). Right: 4 phones and the address (600, `#4A6F8A`, green icons, phone icon rotated 270°). | Hidden at ≤ 1107 px |
| **Header** `header` | `Components/Header.js`, `Header.scss:3-305` | White, height 90 (65 at ≤ 1537), `box-shadow 0 4px 10px rgba(221,221,221,.593)`, `position: sticky; top: 0; z-index: 1000`. Logo is 110×80 on the left. On the right are 6 nav links (800, `rgb(87,87,87)`, gap 55) and 2 buttons (200×55, 700): outline green "احجز الأن" (Book now) or "لوحة التحكم" (Dashboard, for admins), and filled green "التسجيل" (Sign up) or "الملف الشخصي" (Profile). | Nav order in the DOM is reversed so it reads right-to-left. The buttons navigate by clicking hidden `<Link>` elements (`Header.js:122-125`). |
| **Mobile drawer** | `Header.js:90-119`, `Header.scss:94-296` | Hamburger `HiBars3` 25 px. Overlay `rgba(0,0,0,.081)` + blur 2 px. Drawer 230 px white panel from the right, `-5px 0 10px -5px` shadow. Links are 55 px rows with an icon and a 1px divider; hover and active rows are green with white text. Buttons stack at the bottom (45 px). | Slides in over .3 s. Closes on outside click or route change. Shown at ≤ 1107 px. |
| **Footer** | `Components/Footer.js`, `Footer.scss` | Background `--Primary-Color`, white text, padding 20, three equal columns: contact (email, address, 4 phones, socials 35 px), site links, and the reversed logo (200×200) with an about text and "© 2024". | Stacks in `column-reverse`, centred, at ≤ 1107 px |
| **WhatsApp float** | `Layouts/Layout.js:22-24`, `main.scss:173-200` | Fixed bottom 50 / right 50, 90×90 green circle, white `FaWhatsapp` 50 px, faint shadow, z 5. | Always visible, including on dashboard pages |
| **Route loader** | `Components/Loading.js`, `main.scss:126-169` | Full-screen green layer (z 2000) with a white double-bounce spinner at 60 % opacity. | Shown on every `routeChangeStart` |
| **Toasts** | `pages/_app.js:84-96` | react-toastify: top-right, autoClose 5 s, no progress bar, `rtl`, `theme="colored"`, Flip transition. | Used for nearly all validation and server feedback |

### 6.2 Public pages [Verified]

**Landing (`pages/index.js`)** renders these sections in order:

1. **Hero carousel** (`Carousel.js`, `Landing.scss:64-256`):
   - Full-viewport height (100vh), 3 slides, each a stock clinic photo.
   - The left half shows a transparent-ish portrait of the founder, set to `contain`.
   - The right half holds centred white text with a black text-shadow: kicker h2 (300), title h1 (700), paragraph h3 (200), and a white button with green text and a calendar icon.
   - Round translucent prev/next buttons (70 px). Drag and swipe are supported. No autoplay and no dots.
   - A green tint appears on hover only.
   - At ≤ 1107 px the founder portrait half is hidden (`display: none`) and the text takes the full width.
2. **Statistics strip** (`Statistics.js`, `Landing.scss:259-323`):
   - White card at 85 % width, pulled up 170 px over the hero, radius 10, halo shadow.
   - Background is `dots.png` (dotted world map).
   - Five columns, each with a 75 px green IcoFont icon, a large green number animated by CountUp on scroll, and a slate label.
3. **Section heading pattern** `.global-headline` (`Landing.scss:325-346`): a right-aligned h1 (40 px / 800 / `#232323`) above a **150×8 px orange rounded bar**. It is used on every landing section.
4. **Services** (`Services.js`, `Landing.scss:348-433`):
   - Eight cards (400×360), radius 15, halo shadow.
   - Each card is a centred column with a 75 px green IcoFont icon, a title and a description.
   - On hover the **whole card fills green** and all text turns white.
5. **Specialisations** (`Our-Specializations.js`, `Landing.scss:435-491`): three link cards (550×550), radius 10. The top 60 % is a photo and the bottom 40 % holds a centred title and text.
6. **Doctor profile** (`Doctor-Profile.js`, `Landing.scss:494-620`):
   - The left 50 % shows the founder portrait over two grey rounded rectangles (`#cbcbcb48`) that float diagonally (framer-motion, infinite, 1.5 s).
   - The right 50 % has a faint stethoscope watermark (`tool.png`) that bobs vertically. Over it sit the name (55 px), a title (35 px / 300 / green), and credentials listed with **orange 11 px dots**.
7. **Video teaser** (`VideoMain.js`, `Landing.scss:623-846`):
   - 700 px tall poster image with a green overlay (`#309c5295`).
   - A 150 px white circular play button.
   - Bottom-right title and text with a white 8 px vertical accent bar.
   - Clicking opens a modal (dark overlay with blur; 50 % × 70 % white panel; native `<video>`, click to play or pause).
8. **Reviews** (`Reviews.js`, `Landing.scss:851-939`): one wide card with three columns. Each column has a 200 px circle with a 3px green border and a green user icon, **four orange stars plus one outline star**, and a quote. The "read more" link points to `#`.
9. **Recent blogs** (`Recent-Blogs.js`, `Landing.scss:941-1054`):
   - Three cards (600×750), radius 10. Image on top (zooms to 1.1 on hover), then title, excerpt, a 1px divider and a footer.
   - The footer holds the date with a calendar icon and an "اقرأ المذيد" link, both green.
   - The content is **hard-coded**, not fetched.

**Page-banner pattern** (About, Blogs, Blog detail, Contact, Reviews, Previous work, Specialisation; e.g. `About.scss:6-37`): a 600 px tall photo with a **42 % green overlay `#309c526a`** and a centred white h1 (65 px / 800) with a black text-shadow.

**Content listing pages** (`pages/blogs.js`, `reviews.js`, `previous-work.js`; `Blogs.scss:39-177`):
- Same cards as "recent blogs", wrapping in a flex row, `justify-content: flex-end`, gap 40.
- Work and review cards show an image, a gallery cover or a video thumbnail.
- **"Load more" pagination**: 200×65 green square button, 17 px / 700, with a white spinner while loading.

**Detail pages** (`pages/blog/[blog].js`, `work/[work].js`, `review/[review].js`, `specialization/[specialization].js`; `Blog.scss:41-199`):
- Two columns. The **sidebar is 30 %**: recent items as rows (190×160 rounded thumbnail plus title and meta in green) and a **tags cloud** of green chips (radius 10, padding 12×15, 16 px).
- The **content column is 70 %**, right-aligned: cover image (70 % × 700, radius 10), h1, and rich HTML from the CMS (`dangerouslySetInnerHTML`).
- Galleries use `react-image-gallery`. Videos are native `<video controls>` on a black box.

**About (`pages/about.js`, `About.scss`)**:
- The banner, then the doctor-section layout reused with the clinic text and orange dots.
- An "expertise" block with four white cards (520×310). Each card has a 60 px pale-blue icon chip `#e9eef5cc` that turns green on hover, and the cards sit beside a tall side photo with a radius on one side only.

**Contact (`pages/contact.js`, `Contact.scss`)**:
- The banner, then an info card overlapping the banner (pulled up 170 px, dotted-map background at 70 % opacity). It has three columns, each with a **120 px green circle and a white icon**.
- A form section on `#F5F5F5`: a 40 % photo plus a 60 % form on a network-pattern background.
- Inputs: white, 60 px, radius 10, soft shadow, no border.
- **The only inline validation in the app**: a red `#DA1B1B` text below the field, triggered on blur (`pages/contact.js:146-165`).
- Submit: 200×70 green square, 19 px / 800.
- Then an 800 px Google Maps iframe.

### 6.3 Account flows (sign-in, booking, profile) [Verified, agent extraction cross-checked]

**Sign-in / sign-up (`/sign`)**:
- Despite its name, `Components/Auth-Modal/Modal.js` is not a modal. It is a full-width two-panel slider that switches Register ↔ Sign-in over .7 s.
- Each panel is a **70 / 30 split**: a form plus a green panel showing `sign-cover.png` at 50 % opacity with white text and a **white outline pill button** (radius 25, 2px white border, hover white with green text).
- The main button is a green pill: 75 px tall, 50 % wide, radius 25, 2px white border.
- Inputs are `#EDF1F1`, 60 px, radius 10, with the icon after the input. Hover and `:focus-within` give a 1px green border.
- Gender and security question use a custom dropdown. Date of birth is native `type=date` with the indicator hidden.
- Validation is **toast-only**. There is no loading state on submit.

**Reservation (`/reservation`)**, a three-step wizard:
- **Stepper**: three 350×200 grey boxes (`#c7c6c633`, radius 10) joined by 300×5 bars. Active and completed steps both turn green with white text. There is no distinct "completed" state and no check-mark swap.
- **Step 1**: a filter sidebar (20 %) with a free-text date (validated by a native `alert()`), "type" and "time" dropdowns, and two green toggle switches (60×34). Doctor cards (white, height 150, radius 10, halo) show a check icon (grey → green), time, specialty, name and photo. The selected card gets a 3px green border and scales to 1.03.
- **Step 2**: a photo and form split. Inputs are `rgba(220,220,220,.368)`, 65 px, radius 10, with no border and no focus style.
- **Step 3**: the summary is plain right-aligned text rows, with "confirm" (green) and "back" (grey) buttons stacked at 50 % width.
- Buttons are square, with no hover or disabled state.

**Profile (`/profile`)**:
- A sidebar of three vertical tabs (75 px rows, `#c7c6c622`, 1px border): reservations, edit info, change password. Hover is `#309c52b6`; active is green with white text. The sidebar becomes a top segmented bar at ≤ 1107 px.
- Reservations are cards like the booking cards, each with a kebab menu (edit or delete).
- **No status badge** (upcoming, past, paid) is shown.
- Edit and delete open **popups**: overlay `rgba(0,0,0,.205)` + blur 4 px; white panel 70 % × 70 %, radius 10; a header with a bottom divider and a close icon. They close on an outside click or the X. There is no Escape support and no focus trap. The delete confirm button is pure `red`.

### 6.4 Admin dashboard (`/dashboard/*`) [Verified, agent extraction cross-checked]

| Pattern | Actual implementation |
|---|---|
| Navigation | **No sidebar.** The home page (`pages/dashboard/index.js`) is a grid of 23 tiles (350×300 white, radius 10, halo shadow, green icon and label 25 px / 700; on hover the tile fills green). Some tiles carry a 90 px green circular count badge. Each sub-page has a 90 px **green header bar** (`Components/System/Head.js`, `Dashboard.scss:87-108`) with a white back-arrow and title. The ERP page has a vertical **icon rail** of tabs (5 % width, `#F0F0F0`, 100 px buttons; hover `#6BC788`, active green, tooltip pill). |
| Tables | **No `<table>` elements.** There are three div-based patterns: (A) bordered grids with **1px black borders** and a fixed height of 500 px with scroll; (B) a booking timetable with 300×80 cells; (C) "block rows": grey cells (`#EDF1F1` / `rgb(239,239,239)`) separated by 3px white borders. There is no header styling, striping or row hover. |
| Forms | Inputs are borderless fills in five different greys. Some have radius 10 and some are square. There are **no `<label>` elements**: labels are sibling `<p>`, `<h2>` or placeholder text. Validation is toast-only. |
| Select | Custom `.dropmenu` (`Dashboard.scss:404-481`): `#EDF1F1`, 60 px, radius 10. The list is absolutely positioned with a shadow; options are 65 px and turn green with white text on hover. There is no keyboard support and usually no close on outside click. |
| Date inputs | Prev/next day buttons around a free-text `d/m/yyyy` input, validated by native `alert()`. Pay pages use `type=date` with `showPicker()`. |
| Checkbox / radio | Native, with `accent-color: var(--Primary-Color)` |
| Segmented control | 500×65 track `rgba(237,237,237,.781)`, radius 10. Hover is `#69D769`; active is green. |
| Buttons | More than 14 variants. Sizes include 200×65, 250×60, 300×60 %, 70 %×65 and 100 %×80; fonts range from 14 to 19 px. Danger buttons use three different reds. Round 40 px icon buttons come in blue `#2196F3`, red, orange `#FF9800` and green. Most are square. |
| Modals | `PopWindow` (blur overlay, 50 %×60 % panel, scale-in animation, close button only) and `Pop-Package` (70 %×90 %, outside-click close only). They are inconsistent with each other. Most destructive actions have **no confirmation**. |
| File upload | The hidden `<input type=file>` is triggered from a large clickable box (`FaPlus`). The preview is `next/image fill` inside the box. Gallery thumbnails are 100×100, and **clicking a thumbnail deletes it**. Video preview is native `<video controls>`. |
| Rich text | `react-quill` snow theme, 300 px, LTR by default. The live preview appears above the editor. |
| Charts | Chart.js `Bar` (income vs outgoing) and `Doughnut`, using green `#309C53` and pink `rgba(255,99,132,.6)`. The chart font is the Chart.js default, not Noto Kufi. [Inferred] |
| Status | Session "paid" toggle (green vs grey). Package states are text only. |
| Empty / loading | Seven different empty-state classes, all bold text only. Spinners are `#309C53` at 45 px for pages and 35 px for panels, and white at 25 px inside buttons. |
| Pagination | "Load more" only (all users, pays). There are no numbered pages. |

---

## 7. Responsive design

### 7.1 Breakpoint system [Verified]

The system is desktop-first and uses `max-width` only. **Base styles apply only above 2048 px.** Below that, every component is restyled in full at each step.

| Breakpoint | Files using it | Intent (from source comments and content) |
|---|---|---|
| `max-width: 2048px` | 12 | Commented "75 %". This is 2560 px screens with 125 % OS scaling. |
| `1921px` | 13 | Commented "80 %". 1920 px at 100 %. |
| `1707px` | 13 | Commented "90 %". 2560 px at 150 %. |
| `1537px` | 13 | Commented "100 %". 1920 px at 125 %, the most common Windows laptop viewport. |
| `1260px` / `1230px` | Landing / Dashboard, reservation, Profile | Small-laptop squeeze |
| **`1107px`** | 12 | **Main layout switch**: hamburger menu, intro bar hidden, footer stacks, two-column pages stack, dashboard stacks |
| `916px` | Sign | Sign layout switch (Sign has no 1107 rule) |
| 1063, 960, 934, 850, 821, 802, 791, 779, 744, 730, 717, 702, 636, 617, 591, 588, 564, 540, 517, 515, 482, 470, 456, 436, 432, 429, 428, 390, 379, 373, 338, 314 | 1–7 each | Ad-hoc fixes per component |

In total there are **44 distinct breakpoints**. No `min-width` queries and no container queries are used.

### 7.2 Behaviour by device [Verified]

| Device | Behaviour |
|---|---|
| Large desktop (> 1921) | The "intended" design: big type (40–75 px headings) and fixed-pixel cards (400–600 px wide) in 85 % wide containers with no max-width. |
| Laptop (1280–1537) | Everything shrinks proportionally. Body copy is 10–11 px, buttons 9–10 px, section headings 22 px, cards about 250–350 px. Text becomes hard to read. |
| Tablet (≤ 1107) | Hamburger drawer. Intro bar hidden. Two-column layouts stack. The statistics strip stays horizontal until 730 px. The services and specialisation cards wrap. The footer stacks. |
| Mobile (≤ 564) | Further shrink. Fonts reach **8–10 px** in forms, dashboard and steps. Doctor images are hidden on reservation and profile cards. The stepper shrinks to 100×70 boxes. |
| Dashboard ERP | **No rules below 1537 px.** Fixed widths (300 px buttons, 600 px cards) overflow on tablet and phone. [Inferred] |

### 7.3 Limitations

- Fixed pixel widths and heights everywhere (cards, buttons, panels).
- No fluid typography, no `rem`, no `clamp()`.
- No `max-width` container, so content stretches on ultra-wide screens.
- Font sizes fall below legibility thresholds at common viewports.
- Copy-pasted breakpoint blocks make the system hard to maintain: Dashboard.scss is 14k lines, 76 % of them overrides.

---

## 8. RTL / LTR behaviour

[Verified]

- The document direction is **LTR**: `pages/_document.js:18` has `<Html lang="en">` and no `dir`.
- The Arabic reading order is simulated with:
  - `text-align: right` ×40
  - `flex-direction: row-reverse` ×31
  - `column-reverse` ×5
  - `align-items: flex-end` ×10
  - `justify-content: flex-end`
  - DOM order tricks, such as icons placed after inputs and nav links listed in reverse
  - `direction: rtl` ×9, only on truncated text and blog HTML lists
- The global `input` and `textarea` rules force `text-align: right` (`main.scss:54,64`).
- Side effects:
  - Some layouts that should be mirrored are not. The reservation stepper runs left to right, so "step 1" appears on the left [Inferred]. The ERP icon rail is on the left.
  - Directional icons are hard-coded. `FaLongArrowAltLeft` means "read more" and `FaArrowAltCircleLeft` means "back".
  - The Quill editor is LTR.
- Toasts are configured `rtl={true}` (`pages/_app.js:90`).
- There is no English or LTR version of the UI.

---

## 9. Accessibility observations

[Verified unless marked]

- No visible focus indicator anywhere (`outline: none` globally).
- Contrast failures: white on green buttons (3.50), orange text (2.17), grey social icons (1.62), toast colours (§4.6).
- Font sizes of 8–11 px at common viewports, and no line-height declared.
- Missing `<label>` elements across forms. Placeholder-only fields in the dashboard and booking.
- Custom dropdowns are `div`s with `onClick`. They are not focusable and have no keyboard or ARIA support.
- Modals have no focus trap, no Escape support and no `role="dialog"`. Some close only via an outside click.
- Native `alert()` is used for date validation.
- `lang="en"` on Arabic content, so screen readers announce Arabic text with English rules. [Inferred]
- Infinite floating animations (framer-motion) ignore `prefers-reduced-motion`.
- Heading levels are used for visual size, not structure (§5.3).
- Positive points: `aria-label` and `title` are present on most links and icon buttons, and `next/image` is used with `alt` text (often generic: "Rehab EG Clinic").

---

## 10. Dead and unused UI code

[Verified by import tracing]

| Item | Evidence |
|---|---|
| Chat widget (`Components/Chat/*`, `styles/Chat/Chat.scss`, `utils/svg/user-chat-svg.js`, `public/message.mp3`) | `Components/Chat/main.js` is not imported anywhere. The styles are still compiled through `main.scss:2`. A 15 s timer in `utils/contextAPI.js` still fires on every page. |
| Cookie banner (`Components/Cookies.js`, `.cookies-acceptace-container` in `main.scss:102-123`) | Never imported |
| "Our doctors" section (`Components/Landing/Our-Doctors.js`) | Never imported. It is the only user of `public/doc2.png`. |
| Carousel imports `doc-mohamed-3.png`, `new-doctor2.png` | Imported at `Carousel.js:8,13` but never rendered |
| `Inter` font import | `utils/fonts.js:1`, never used |
| `.disabled-btn`, `.profile-icon`, `.reversed`, Circle-Stats subtitle plugin | Defined, never used |
| Social login buttons | Commented out (`Sign-In.js:86-92`, `Sign-Up.js:132-139`); their styles remain |

---

## 11. Brand identity vs. outdated UI (Phase 3)

### A. Brand identity: **preserve**

| Element | Evidence | Why it belongs here |
|---|---|---|
| **Brand green `#309C53`** (logo `#309C52`) | Logo pixels; 156 CSS uses; footer, loader, header bars | The dominant colour of the logo, the website and the clinic signage. Users recognise the brand by it. |
| **Brand orange `#F89A3A`** | Logo pixels (exact match); clinic reception walls (`about-cover.png`); section bars, dots, stars | Half of the logo and the main colour of the physical clinic. It is under-used online and should be brought forward as an accent, not removed. |
| **The logo (all three variants)** | `logo-header.png`, `footer-logo.png`, `logo.png` | The primary brand mark. The calligraphic wordmark and the person-figure symbol must be reproduced exactly. |
| **Noto Kufi Arabic** | `utils/fonts.js` | The only typeface. Its geometric Kufi style matches the logo's Arabic lettering. |
| **Heavy heading weights (700–800)** | §5.2 | Part of the confident, bold voice of the site |
| **Secondary text slate `#4A6F8A` and ink `#232323`** | `main.scss:21-22` | Established text colours. The cool slate gives the site its calm, clinical tone. |
| **Cool light-grey fill `#EDF1F1`** | 26 uses as the main input and control fill | The recognisable "filled field" look of every form |
| **Green-tinted photo banners** | 7 page banners (`#309c526a`); video teaser overlay | A consistent signature treatment for page heroes |
| **Section heading with orange underline bar** | `.global-headline` | A distinctive, repeated brand motif that combines both brand colours |
| **Orange accents for credentials and ratings** | Orange dots and stars | Small, consistent uses of the accent colour |
| **Green icon in a circle** | Contact info (120 px green circles), About chips, review avatars | A recurring iconographic device |
| **Statistics strip over the hero** | `Statistics.js` with `dots.png` | A memorable landing composition that communicates scale (7 beds, 160,000+ sessions, 20,000+ clients, 10 doctors, 21 years) |
| **Founder's presence** | Hero slides, doctor section, full logo lockup, signage | The clinic brand is tied to Dr. Mohamed Yehia Gamal El-Din. Hero and team imagery should keep him prominent. |
| **Clinic photography** | `about-cover.png` (reception), `poster.png` (signage) | Real-place imagery that matches the brand palette |
| **Floating WhatsApp button (green, bottom-right)** | `Layout.js:22-24` | A primary contact channel that users expect |
| **Top utility bar with phones and socials** | `Intro-Info.js` | A familiar way to reach the clinic directly |
| **Soft, zero-offset grey halo shadows and 10 px radius** | 370 uses of `10px`; halo shadows on all cards | Defines the soft, friendly card feel. Keep it, refined (see proposal). |

### B. UI implementation: **modernise**

| Element | Current problem | Why it can be redesigned |
|---|---|---|
| Zoom-tuned desktop-first breakpoints | 44 breakpoints; text at 8–11 px on laptops | Pure implementation detail. Users do not recognise it, and it hurts readability. |
| Fixed-pixel cards and containers | 400–600 px cards, 85 % widths without max-width | Layout mechanics, not brand |
| Typography scale and line-height | No line-height; misused heading levels | The typeface is the brand, the scale is not |
| Buttons | 14+ variants: square, pill, three reds, no states | Inconsistent; the brand is the green, not the shape |
| Forms | Five fill greys, no labels, no focus, toast-only validation, `alert()` | Usability and accessibility issues |
| Custom dropdowns | Not keyboard accessible | Replace with an accessible listbox or select |
| Tables | `div` grids with black 1px borders | Outdated; hard to scan |
| Modals | Two inconsistent implementations, no focus trap or Escape | Interaction pattern, not identity |
| Service cards that fill green on hover | Heavy, low-contrast white text on green | Keep the green-icon idea; change the hover treatment |
| Reservation stepper | Huge boxes, LTR order, no completed state | Interaction pattern |
| Dashboard navigation (tile grid + back button) | No persistent navigation | Admin UX can change freely; it carries little brand weight |
| Dashboard inside the public layout | Admin pages show the marketing header, footer and WhatsApp button | Information architecture |
| Mixed icon sets (14 react-icons sets + IcoFont) | Visual inconsistency | Icon style can be unified |
| Fake RTL via `row-reverse` | Fragile; blocks English/LTR | Implementation detail |
| Toast colours (library defaults) | Off-brand and low contrast | Should use brand semantic colours |
| Infinite floating animations | Distracting; ignore reduced-motion | Decorative behaviour |
| Hard-coded landing content (blogs, reviews) | Stale | Content wiring |
