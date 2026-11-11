# Design System Proposal: Rehab (modernised identity)

| | |
|---|---|
| **Goal** | A modern, consistent, accessible design system that is clearly an evolution of the existing Rehab identity, not a new brand |
| **Based on** | The findings in [VISUAL_IDENTITY_ANALYSIS.md](VISUAL_IDENTITY_ANALYSIS.md) and [ASSET_INVENTORY.md](ASSET_INVENTORY.md) |
| **Implementation reference** | Ready-to-use CSS custom properties and global styles are in [FRONTEND_IMPLEMENTATION_GUIDE.md §2](FRONTEND_IMPLEMENTATION_GUIDE.md#2-design-tokens-copy-this-file). Values there are identical to the tables below. |
| **Date** | 2026-11-07 |

Everything in this document is a **[Recommendation]** unless it is marked **[Preserved]**. **[Preserved]** means the value is carried over unchanged from the legacy code or the logo, and the legacy source is cited. Contrast ratios were computed with the WCAG 2.x relative-luminance formula.

---

## Contents

1. [Design principles](#1-design-principles)
2. [Colour tokens](#2-colour-tokens)
3. [Typography tokens](#3-typography-tokens)
4. [Spacing, sizing and layout tokens](#4-spacing-sizing-and-layout-tokens)
5. [Radius, border, shadow, motion, z-index](#5-radius-border-shadow-motion-z-index)
6. [Iconography](#6-iconography)
7. [Legacy → new token mapping](#7-legacy--new-token-mapping)
8. [Component guidelines](#8-component-guidelines)
9. [Brand patterns (signature compositions)](#9-brand-patterns-signature-compositions)
10. [UX guidelines](#10-ux-guidelines)

---

## 1. Design principles

1. **Green leads, orange accents.** Green `#309C53` stays the colour of trust and action. Orange `#F89A3A` comes back as a deliberate brand accent: heading bars, ratings, highlights and active-navigation marks. That mirrors the logo and the physical clinic. It is never used for body text.
2. **Arabic-first, truly bidirectional.** Pages use `dir="rtl"` and `lang="ar"`, logical CSS properties and mirrored directional icons. English (LTR) works with the same components.
3. **Calm and clinical.** The UI uses white and cool-grey surfaces (`#EDF1F1` family), soft shadows, generous spacing and one typeface, Noto Kufi Arabic.
4. **Readable at every size.** Body text is never below 16 px, and nothing is below 12 px. Arabic gets generous line heights. Type is fluid with `clamp()`; there are no zoom-level breakpoints.
5. **Consistent and stateful.** There is one button system, one input system and one modal system. Every interactive element has hover, active, focus-visible, disabled and loading states.
6. **Accessible by default.** The target is WCAG 2.2 AA: contrast, visible focus, labels, keyboard support and reduced motion.

---

## 2. Colour tokens

### 2.1 Brand green (primary)

| Token | Hex | White text on it | As text on white | Use |
|---|---|---|---|---|
| `--color-green-50` | `#EDF7F0` | 1.10 | n/a | Selected or hover backgrounds, success surface |
| `--color-green-100` | `#D2EDDB` | 1.24 | n/a | Subtle fills, progress tracks |
| `--color-green-200` | `#A6DBB8` | 1.56 | n/a | Success borders, chart tints |
| `--color-green-300` | `#72C390` | 2.12 | n/a | Decorative |
| `--color-green-400` | `#47AC6A` | 2.85 | n/a | Decorative, chart tint |
| **`--color-green-500`** | **`#309C53`** **[Preserved]** `styles/main.scss:19`; logo pixel `#309C52` | 3.50 | 3.50 | **Brand green**: logo-adjacent decoration, icons, large display text (≥ 24 px), stat numbers, focus accents, chart series 1 |
| `--color-green-600` | `#278545` | **4.64 ✓ AA** | 4.64 | **Interactive primary**: filled buttons, selected fills that carry white text, links ≥ 16 px |
| `--color-green-700` | `#1F6C38` | 6.44 | 6.44 | Hover on primary, text links, success text |
| `--color-green-800` | `#18552C` | 8.84 | 8.84 | Pressed state, dark brand surfaces |
| `--color-green-900` | `#113D20` | 12.27 | 12.27 | Overlay base for photo banners |

**Why the shift to 600 for buttons:** white text on `#309C53` is 3.50:1. That fails AA for normal-size text, and every legacy button has this problem. `#278545` is visibly the same brand green, one step deeper, and passes at 4.64:1.

### 2.2 Brand orange (accent)

| Token | Hex | Dark text `#232323` on it | As text on white | Use |
|---|---|---|---|---|
| `--color-orange-50` | `#FEF4EA` | 14.48 | n/a | Warning surface, highlight background |
| `--color-orange-100` | `#FDE4CA` | 12.82 | n/a | Subtle highlight |
| `--color-orange-200` | `#FCCB97` | 10.57 | n/a | Decorative |
| `--color-orange-300` | `#FAB365` | 8.76 | n/a | Warning border |
| `--color-orange-400` | `#F9A54C` | 7.87 | n/a | Accent hover (light) |
| **`--color-orange-500`** | **`#F89A3A`** **[Preserved]** `styles/main.scss:18`; logo pixel exact | **7.24 ✓** | 2.17 ✗ | **Brand accent**: heading bars, bullet dots, star ratings, active-nav indicator, accent buttons with **dark text** |
| `--color-orange-600` | `#E07F1F` | 5.41 | 2.91 | Accent button hover (dark text) |
| `--color-orange-700` | `#B4621A` | 3.52 | 4.47 | Large orange text only (≥ 24 px) |
| `--color-orange-800` | `#874A16` | 2.26 | 6.95 | Warning text |
| `--color-orange-900` | `#5F3511` | 1.50 | 10.48 | Rare |

**Rule:** orange is never used for body text on white, and white text is never placed on orange. Text on orange is always `--color-text` (`#232323`).

### 2.3 Neutrals (cool grey)

| Token | Hex | On white | Use |
|---|---|---|---|
| `--color-white` | `#FFFFFF` | n/a | Page and card background |
| `--color-neutral-50` | `#F6F8F8` | 1.07 | Subtle section background, table header, disabled fill |
| **`--color-neutral-100`** | **`#EDF1F1`** **[Preserved]** (26 legacy uses as the input fill, e.g. `Sign.scss:101`, `Dashboard.scss:405`) | 1.14 | **Input fill**, muted surfaces, skeletons |
| `--color-neutral-200` | `#DDE3E4` | 1.30 | Dividers, card borders |
| `--color-neutral-300` | `#C4CDCF` | 1.62 | Input borders at rest, decorative borders |
| `--color-neutral-400` | `#85929A` | 3.19 ✓ (UI ≥ 3:1) | Strong borders, input hover border, empty-star outline |
| `--color-neutral-500` | `#5F6C72` | 5.42 ✓ | Muted text, placeholders (4.76 on `#EDF1F1`), icons |
| `--color-neutral-600` | `#4C585E` | > 6.3 | Secondary icons |
| `--color-neutral-700` | `#3D474C` | 9.53 | Strong secondary text |
| `--color-neutral-800` | `#2B3235` | 13.04 | Tooltip background |
| **`--color-neutral-900`** | **`#232323`** **[Preserved]** `styles/main.scss:22` | 15.72 | **Primary text** |
| **`--color-slate`** | **`#4A6F8A`** **[Preserved]** `styles/main.scss:21` | 5.34 ✓ | **Secondary text** (body copy, descriptions) |

### 2.4 Semantic colours

| Role | Surface (bg) | Border | Solid / icon | Text on surface | Notes |
|---|---|---|---|---|---|
| **Success** | `--color-green-50` `#EDF7F0` | `--color-green-200` `#A6DBB8` | `--color-green-600` `#278545` | `--color-green-700` `#1F6C38` (5.88 on surface) | Uses the brand green, as the legacy UI did (paid state, success messages) |
| **Warning** | `--color-orange-50` `#FEF4EA` | `--color-orange-300` `#FAB365` | `--color-orange-500` `#F89A3A` | `--color-orange-800` `#874A16` (6.40 on surface) | Built from the brand orange. The legacy dashboard already uses orange `#FF9800` for "edit" and attention. |
| **Error / danger** | `--color-error-50` `#FDECEC` | `--color-error-100` `#F9CFCF` | `--color-error-600` `#DA1B1B` **[Preserved]** (`Contact.scss:198`) | `--color-error-700` `#B71717` (5.84 on surface) | Replaces the three legacy reds (`#DA1D1D`, `red`, `#EE3C3C`) and toast `#e74c3c`. White on `#DA1B1B` is 5.06. |
| **Info** | `--color-info-50` `#EAF3FD` | `--color-info-100` `#C8E0FA` | `--color-info-600` `#1E6FC2` | `--color-info-700` `#185A9E` (6.26 on surface) | Evolves the legacy `#2196F3` / `#3498db` (3.1:1) into an AA-compliant blue |

Extra error steps: `--color-error-800` `#8F1212`. Extra info step: `--color-info-800` `#11437A`.

**CSS alias names for the semantic roles** (each points to the palette step in the table above): `--color-{success|warning|error|info}-bg`, `-border`, `-solid`, `-text`. For example, `--color-warning-text` → `--color-orange-800`.

### 2.5 Role (alias) tokens

Components should use **role tokens only**, never raw palette steps.

| Role token | Value | Purpose |
|---|---|---|
| `--color-bg` | `--color-white` | Page background |
| `--color-bg-subtle` | `--color-neutral-50` | Alternate sections, admin content area |
| `--color-surface` | `--color-white` | Cards, modals, menus |
| `--color-surface-muted` | `--color-neutral-100` | Input fill, muted panels |
| `--color-surface-brand` | `--color-green-50` | Brand-tinted panels, selected items |
| `--color-surface-accent` | `--color-orange-50` | Highlight panels |
| `--color-surface-inverse` | `--color-green-700` | Footer, dark brand bands |
| `--color-text` | `--color-neutral-900` | Primary text and headings |
| `--color-text-secondary` | `--color-slate` | Body copy, descriptions |
| `--color-text-muted` | `--color-neutral-500` | Meta, helper text, placeholders |
| `--color-text-inverse` | `--color-white` | Text on green or dark surfaces and photos |
| `--color-text-link` | `--color-green-700` | Inline links |
| `--color-text-brand` | `--color-green-600` | Brand-coloured text (e.g. a doctor's title) |
| `--color-border` | `--color-neutral-200` | Dividers, card borders |
| `--color-border-input` | `--color-neutral-300` | Input border at rest |
| `--color-border-strong` | `--color-neutral-400` | Hover borders, emphasis |
| `--color-brand` | `--color-green-500` | Brand green: icons, decoration |
| `--color-primary` | `--color-green-600` | Primary action background |
| `--color-primary-hover` | `--color-green-700` | |
| `--color-primary-active` | `--color-green-800` | |
| `--color-primary-subtle` | `--color-green-50` | Subtle selected background |
| `--color-on-primary` | `--color-white` | Text on primary |
| `--color-accent` | `--color-orange-500` | Brand accent |
| `--color-accent-hover` | `--color-orange-600` | |
| `--color-on-accent` | `--color-neutral-900` | Text on accent (7.24:1) |
| `--color-focus` | `--color-green-600` | Focus outline (4.64:1 on white) |
| `--color-overlay` | `rgba(35, 35, 35, 0.5)` | Modal backdrop |
| `--color-banner-overlay` | `rgba(17, 61, 32, 0.62)` | Photo-banner green tint (evolution of `#309c526a`) |

Dark mode is out of scope. The legacy product has none, so this proposal does not define it. The role-token layer leaves room to add it later.

---

## 3. Typography tokens

### 3.1 Families

| Token | Value | Notes |
|---|---|---|
| `--font-arabic` | `"Noto Kufi Arabic"` **[Preserved]** | Brand typeface (`utils/fonts.js:5-10`). Load weights 400, 500, 600, 700, 800 and the `arabic` + `latin` subsets. |
| `--font-latin` | `"Inter"` | Latin and English text. Already imported but unused in legacy `utils/fonts.js:1`. Load weights 400, 500, 600, 700. |
| `--font-sans` (in `:lang(ar)`) | `var(--font-arabic), var(--font-latin), system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif` | Arabic pages |
| `--font-sans` (in `:lang(en)`) | `var(--font-latin), var(--font-arabic), system-ui, -apple-system, "Segoe UI", Arial, sans-serif` | English pages |
| `--font-mono` | `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace` | IDs and codes in the admin |

The legacy light weights (200 and 300, used for hero kickers and the doctor title) are dropped. Thin Kufi strokes are hard to read at small sizes, so those roles use 400.

### 3.2 Type scale

Fluid sizes use `clamp(min, preferred, max)` between 360 px and 1440 px viewports.

| Token | Size | Line height | Weight | Use | Legacy reference |
|---|---|---|---|---|---|
| `--text-display` | `clamp(2.25rem, 1.8rem + 2vw, 3.5rem)` (36 → 56 px) | 1.25 | 800 | Hero title | 75 px (> 2048) / 50 px (1536) |
| `--text-h1` | `clamp(1.875rem, 1.6rem + 1.25vw, 2.75rem)` (30 → 44) | 1.3 | 800 | Page-banner title, page H1 | 65 px / 800 |
| `--text-h2` | `clamp(1.5rem, 1.35rem + 0.75vw, 2.125rem)` (24 → 34) | 1.35 | 800 | Section headings | 40 px / 800 → 22 px at 1536 |
| `--text-h3` | `clamp(1.25rem, 1.18rem + 0.35vw, 1.5rem)` (20 → 24) | 1.4 | 700 | Card titles, sub-sections | Default h1 (32) → 18 at 1536 |
| `--text-h4` | `1.125rem` (18) | 1.5 | 700 | Dialog titles, small headings | n/a |
| `--text-body-lg` | `1.125rem` (18) | 1.8 | 400 | Lead paragraphs, hero text | Hero h3 200 weight → 13 px at 1536 |
| `--text-body` | `1rem` (16) | 1.75 | 400 | Default body | 10–16 px |
| `--text-body-sm` | `0.875rem` (14) | 1.7 | 400 | Meta, helper text, table cells | 9–11 px |
| `--text-caption` | `0.75rem` (12) | 1.6 | 500 | Badges, timestamps (**minimum size**) | 8–9 px |
| `--text-label` | `0.875rem` (14) | 1.5 | 600 | Form labels, tabs | n/a (no labels existed) |
| `--text-button` | `1rem` (16) | 1.25 | 600 | Buttons (md/lg); sm uses 14 px | 10–19 px |
| `--text-stat` | `clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)` (28 → 40) | 1.2 | 800 | Statistic numbers | 55 → 35 px |

CSS naming: the size is `--text-<name>` and the matching line height is `--leading-<name>` (e.g. `--text-h2` / `--leading-h2`). Weights are `--font-weight-regular` 400, `-medium` 500, `-semibold` 600, `-bold` 700, `-extrabold` 800.

Rules:
- **Never use `letter-spacing` on Arabic text.** It breaks the joining of letters.
- Never use italic for Arabic. Use weight or colour for emphasis.
- Use `font-variant-numeric: tabular-nums` for tables, prices, times and statistics.
- Keep the legacy convention of Western digits (0–9) [Preserved]. Do not switch to Arabic-Indic digits unless the client asks.
- Use one `h1` per page and nest headings in order. Heading level is chosen for structure, not size; size comes from the token class.
- Maximum line length: 72 ch for article text, 60 ch for descriptions.

---

## 4. Spacing, sizing and layout tokens

### 4.1 Spacing scale (4 px base)

| Token | Value | Typical use |
|---|---|---|
| `--space-0` | 0 | |
| `--space-1` | 4 px | Icon-to-text in badges |
| `--space-2` | 8 px | Icon-to-text in buttons, tight stacks |
| `--space-3` | 12 px | Input padding (vertical), small gaps |
| `--space-4` | 16 px | Default gap, mobile page gutter |
| `--space-5` | 20 px | Card padding (mobile) |
| `--space-6` | 24 px | Card padding, grid gutter (tablet) |
| `--space-8` | 32 px | Grid gutter (desktop), dialog padding (lg) |
| `--space-10` | 40 px | Heading-to-content |
| `--space-12` | 48 px | Large block separation |
| `--space-16` | 64 px | Section padding (mobile) |
| `--space-20` | 80 px | |
| `--space-24` | 96 px | Section padding (desktop); legacy used `margin-top: 100px` |
| `--space-32` | 128 px | Hero spacing |

### 4.2 Containers and gutters

| Token | Value | Use |
|---|---|---|
| `--container-sm` | 640 px | Auth forms, confirmations |
| `--container-md` | 768 px | Articles |
| `--container-lg` | 1024 px | |
| `--container-xl` | 1280 px | **Default content width.** It replaces the legacy `width: 85%` (85 % of 1536 ≈ 1306 px, so the perceived width is kept). |
| `--container-2xl` | 1440 px | Header, footer, wide hero |
| `--gutter` | `16px` (< 640), `24px` (≥ 640), `32px` (≥ 1024) | Page side padding (`padding-inline`) |

### 4.3 Breakpoints (mobile-first, `min-width`)

| Name | Min width | Replaces legacy | Key changes |
|---|---|---|---|
| `sm` | 640 px | 564–591 px | 2-column card grids |
| `md` | 768 px | 744–850 px | Side-by-side form fields, tables instead of stacked cards |
| `lg` | 1024 px | **1107 px** (legacy main switch) | Desktop header nav (hamburger below this), 2-column hero, utility bar visible, admin sidebar expanded |
| `xl` | 1280 px | 1230–1260 px | 3–4 column grids |
| `2xl` | 1536 px | 1537 / 1707 / 1921 / 2048 px | Wider gutters only. **No font shrinking or zoom-level rules.** |

### 4.4 Sizing

| Token | Value |
|---|---|
| `--control-h-sm` | 36 px |
| `--control-h-md` | 44 px (default; minimum touch target) |
| `--control-h-lg` | 52 px |
| `--input-h` | 48 px |
| `--header-h` | 72 px (≥ lg), 64 px (< lg) |
| `--utility-bar-h` | 40 px |
| `--sidebar-w` | 264 px (admin), `--sidebar-w-collapsed` 72 px |
| `--icon-xs/sm/md/lg/xl` | 16 / 20 / 24 / 32 / 48 px |

---

## 5. Radius, border, shadow, motion, z-index

### 5.1 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4 px | Checkboxes, small chips |
| `--radius-sm` | 6 px | Tooltips, small menu items |
| **`--radius-md`** | **10 px** **[Preserved]** (370 legacy uses) | Buttons, inputs, selects, dropdowns, alerts, thumbnails |
| `--radius-lg` | 16 px | Cards, banners, image containers |
| `--radius-xl` | 24 px | Modals, large feature panels, mobile bottom sheets |
| `--radius-full` | 9999 px | Badges, avatars, icon circles, pills, accent bars |

### 5.2 Borders

| Token | Value |
|---|---|
| `--border-width` | 1 px |
| `--border-width-strong` | 2 px (selected cards, dashed dropzone) |
| `--focus-ring` | `2px solid var(--color-focus)`, `outline-offset: 2px` |

### 5.3 Shadows

These refine the legacy soft, zero-offset grey halos (for example `0 0 25px rgba(221,221,221,.816)`) into layered shadows with a small y-offset.

| Token | Value | Use |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(35, 35, 35, 0.05)` | Inputs on white, segmented control thumb |
| `--shadow-sm` | `0 1px 3px rgba(35, 35, 35, 0.06), 0 1px 2px rgba(35, 35, 35, 0.04)` | Default card |
| `--shadow-md` | `0 4px 20px rgba(35, 35, 35, 0.07)` | Marketing cards (the "halo" successor), sticky header on scroll |
| `--shadow-lg` | `0 12px 32px rgba(35, 35, 35, 0.10)` | Card hover, dropdown menus, stats strip, floating button |
| `--shadow-xl` | `0 24px 48px rgba(35, 35, 35, 0.14)` | Modals |

### 5.4 Motion

| Token | Value |
|---|---|
| `--duration-fast` | 120 ms (hover colour, focus) |
| `--duration-base` | 200 ms (dropdowns, tabs, buttons) |
| `--duration-slow` | 320 ms (modals, drawers, hero transitions) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-emphasized` | `cubic-bezier(0.3, 0, 0, 1)` |

The legacy `.3s all linear` is replaced. Animate only `opacity`, `transform`, `color`, `background-color`, `border-color` and `box-shadow`, never `all`. Under `@media (prefers-reduced-motion: reduce)`, disable decorative motion (floating shapes, count-up, carousel auto-advance, image zoom).

### 5.5 Z-index

| Token | Value | Legacy |
|---|---|---|
| `--z-raised` | 10 | `1` (21×) |
| `--z-dropdown` | 1000 | `1` / `1000` mixed |
| `--z-sticky` | 1100 | header `1000` |
| `--z-fab` | 1150 | WhatsApp `5` |
| `--z-overlay` | 1200 | `1000`, `2000` |
| `--z-modal` | 1300 | `1000`, `2000`, `9999` |
| `--z-popover` | 1400 | `900`, `1000` |
| `--z-toast` | 1500 | library default |

---

## 6. Iconography

[Recommendation] Use **one** icon family for UI icons and one source for brand logos. This replaces 14 `react-icons` sets plus IcoFont.

| Purpose | Library | Licence | Style |
|---|---|---|---|
| UI icons | **Lucide** (`lucide-react` or the framework equivalent) | ISC | 24 px grid, 1.75–2 px stroke, round caps |
| Social brand marks (WhatsApp, Facebook, Instagram, TikTok) | **Simple Icons** | CC0 | Filled logos, used only in the footer, utility bar and floating button |

**Sizes:** 16 (inline meta), 20 (buttons, inputs, nav), 24 (default standalone), 32 (feature icons), 48 (empty states). Feature icons sit in a circle 2× their size: a 56 px or 64 px circle filled with `--color-surface-brand` and an icon in `--color-brand`. This is the legacy "green icon in circle" motif.

**Directional icons** (arrows, chevrons, "back", "read more") must flip in RTL. The default should point toward the inline end; see [FRONTEND_IMPLEMENTATION_GUIDE.md §6](FRONTEND_IMPLEMENTATION_GUIDE.md#6-rtl--ltr-requirements).

**Replacement map for the 12 IcoFont glyphs.** These are suggested Lucide names; verify them against the installed version.

| Legacy glyph | Meaning | Suggested replacement |
|---|---|---|
| `icofont-patient-bed` | Beds | `bed-double` |
| `icofont-first-aid` | Sessions / recovery | `briefcase-medical` |
| `icofont-people` | Clients | `users` |
| `icofont-doctor-alt` | Doctors | `stethoscope` |
| `icofont-badge` | Years of experience | `award` |
| `icofont-doctor` | Elite doctors | `stethoscope` |
| `icofont-prescription` | Diagnosis | `clipboard-check` |
| `icofont-medical-sign` | Healthcare | `heart-pulse` |
| `icofont-icu` | Advanced equipment | `activity` |
| `icofont-crutch` | Rehabilitation | `accessibility` |
| `icofont-laptop-alt` | Online sessions | `laptop` |
| `icofont-herbal` | Nutrition plans | `salad` |

---

## 7. Legacy → new token mapping

| Legacy value (source) | New token | Change |
|---|---|---|
| `--Primary-Color #309C53` (`main.scss:19`) | `--color-brand` for decoration and icons; `--color-primary` (`#278545`) for any surface that carries white text | Same hue, one step deeper for text contrast |
| `--Main-Color #F89A3A` (`main.scss:18`) | `--color-accent` | Unchanged value, wider use, dark text on it |
| `--Regular-Font-Color #4A6F8A` | `--color-text-secondary` | Unchanged |
| `--Headlines-Color #232323` | `--color-text` | Unchanged |
| `--Gray-Color #CBCBCB` | `--color-neutral-300` (decorative) / `--color-text-muted` (icons) | Darkened for icons |
| `--Input-Background rgb(241,241,241)`, `#EDF1F1`, `#F0F0F0`, `rgb(239,239,239)`, `#d7d7d7`, `rgb(225,225,225)`, `rgba(220,220,220,.368)`, `#c7c6c64e` | `--color-surface-muted` (`#EDF1F1`) | Eight greys consolidated into one |
| `#c7c6c622`, `#c7c6c633`, `rgba(244,244,244,.732)`, `rgb(240,240,240)`, `#F5F5F5` | `--color-bg-subtle` (`#F6F8F8`) | Consolidated |
| `#e9eef5cc` (About icon chip) | `--color-surface-brand` | Brand-tinted |
| Black 1px table borders, `rgb(228,228,228)`, `rgb(235,235,235)`, `rgba(128,128,128,.09)` | `--color-border` | Consolidated |
| `rgb(218,27,27)`, `rgb(218,29,29)`, `red`, `rgb(238,60,60)`, toast `#e74c3c` | `--color-error-600` `#DA1B1B` | One red |
| `#2196F3`, `#3498db` | `--color-info-600` `#1E6FC2` | AA-compliant |
| `#FF9800`, `#f1c40f` | warning tokens (orange family) | Brand-aligned |
| `#07bc0c` (toast success) | success tokens (green family) | Brand-aligned |
| `#309c52b6`, `rgb(105,215,105)`, `rgb(107,199,136)` (hover greens) | `--color-primary-hover` (darker) or `--color-primary-subtle` (light background) | Hover darkens a button or tints a row |
| `#309c526a` (banner overlay) | `--color-banner-overlay` + gradient | Stronger, consistent tint without a text-shadow |
| `rgba(255,99,132,.6)`, `#FC89A2` (chart "outgoing") | `--color-accent` (chart series 2) | Brand pair |
| `0 0 25px rgba(221,221,221,.816)` etc. | `--shadow-md` | Refined halo |
| `border-radius: 10px` | `--radius-md` | Unchanged |
| `.3s all linear` | `--duration-base` + `--ease-standard` | |

---

## 8. Component guidelines

All dimensions refer to tokens above. "Start" and "end" are logical directions: in Arabic, start = right and end = left.

### 8.1 Buttons

| Variant | Background | Text | Border | Hover | Active | Use |
|---|---|---|---|---|---|---|
| **Primary** | `--color-primary` | `--color-on-primary` | none | `--color-primary-hover` | `--color-primary-active` | The main action per view ("احجز الآن", "تأكيد الحجز", "حفظ") |
| **Secondary** | `--color-surface` | `--color-green-700` | 1 px `--color-primary` | bg `--color-primary-subtle` | bg `--color-green-100` | Second action. Evolution of the legacy outline "احجز الأن" header button. |
| **Accent** | `--color-accent` | `--color-on-accent` | none | `--color-accent-hover` (dark text, 5.41:1) | `--color-accent-hover` + `box-shadow: inset 0 2px 0 rgba(0,0,0,.12)` (dark text stays) | **At most one per page**, for marketing emphasis (e.g. the hero booking CTA). Optional; confirm with the client. |
| **Ghost** | transparent | `--color-text` | none | bg `--color-surface-muted` | bg `--color-neutral-200` | Toolbar and low-emphasis actions, "إلغاء" (cancel) |
| **Danger** | `--color-error-600` | white | none | `--color-error-700` | `--color-error-800` | Destructive confirms only |
| **Danger-outline** | transparent | `--color-error-700` | 1 px `--color-error-600` | bg `--color-error-50` | | Destructive triggers (they open a confirm dialog) |
| **Inverse** | `--color-white` | `--color-green-700` | none | bg `--color-green-50` | | On photos or green surfaces. Evolution of the legacy hero button (white with green text). |
| **Inverse-outline** | transparent | white | 1.5 px white | bg `rgba(255,255,255,0.12)` | | On green or photo surfaces. Evolution of the legacy sign-panel pill. |
| **Link** | none | `--color-text-link` | none | underline | | Inline actions |
| **Icon button** | as ghost or secondary | `--color-text-muted` | | bg `--color-surface-muted`, icon `--color-text` | | 36 or 44 px square, radius md. Always has an `aria-label` and a tooltip. |

| Size | Height | Padding (inline) | Font | Icon |
|---|---|---|---|---|
| sm | 36 px | 12 px | 14 px / 600 | 16 px |
| **md (default)** | 44 px | 20 px | 16 px / 600 | 20 px |
| lg | 52 px | 28 px | 17 px / 600 | 20 px |

- Radius `--radius-md`. Icon gap `--space-2`. Use a leading icon for meaning (e.g. calendar on "Book"). A trailing arrow points toward the end and is mirrored in RTL.
- **Focus-visible:** `outline: var(--focus-ring); outline-offset: 2px` on every variant.
- **Disabled:** bg `--color-neutral-100`, text `--color-neutral-500`, no border, `cursor: not-allowed`, no hover. Disabled buttons must not be clickable. In the legacy UI they stayed clickable while loading.
- **Loading:** keep the label, replace the leading icon with a 16–20 px spinner in the text colour, set `aria-busy="true"`, and disable the button.
- **Full width** below `sm` for primary form actions.
- Never use square corners and never use a pill shape. One radius (`md`) for all buttons replaces the legacy mix of 0, 10 and 25 px.

### 8.2 Inputs (text, email, tel, number, password, search)

| Property | Value |
|---|---|
| Height | `--input-h` (48 px); compact 40 px in dense admin tables |
| Background | `--color-surface-muted` (`#EDF1F1`) **[Preserved fill]** |
| Border | 1 px `--color-border-input` |
| Radius | `--radius-md` |
| Padding | 0 14 px (with a leading icon: start padding 44 px) |
| Text | 16 px `--text-body`, `--color-text`, weight 500. (Legacy used 600; 16 px prevents iOS zoom.) |
| Placeholder | `--color-text-muted`. Placeholders are examples only, never labels. |
| Leading icon | 20 px `--color-text-muted`, inset 14 px from the start. It turns `--color-brand` on focus (legacy behaviour, `Sign.scss:145-159`). |
| Hover | border `--color-border-strong` |
| Focus | bg `--color-surface`, border `--color-primary`, plus `box-shadow: 0 0 0 3px rgba(48, 156, 83, 0.25)` |
| Invalid | border `--color-error-600`, `aria-invalid="true"`, error message below in 14 px `--color-error-700` with a 16 px alert icon, linked by `aria-describedby` |
| Disabled | bg `--color-neutral-50`, text `--color-neutral-500`, border `--color-neutral-200` |
| Read-only | bg `--color-neutral-50`, border dashed `--color-neutral-300` |

**Field anatomy:** label (`--text-label`, `--color-text`) above the input, with 6 px gap → input → helper or error text (`--text-body-sm`, `--color-text-muted`) with 6 px gap. Mark **optional** fields with "(اختياري)" in `--color-text-muted`. The legacy UI used this wording, in green, at `reservation.scss:296-309`. Required fields need no marker.

**Validation:** validate on blur and on submit. Show the message inline under the field, as the legacy contact form did (`pages/contact.js:146-165`). Put a summary alert at the top of long forms. Never validate with `alert()`. Use toasts only for server results.

**Direction:** phone, email, URL and numeric inputs get `dir="ltr"`. In Arabic pages they are aligned to the right edge (see the implementation guide).

### 8.3 Selects

- **Native `<select>`** for short, simple lists (gender, booking type). Style it like an input. Add a 20 px chevron at the end, `appearance: none`.
- **Custom listbox** (from an accessible headless library) for long, searchable or rich lists (time slots, doctors, security questions):
  - Trigger: identical to an input.
  - Menu: `--color-surface`, 1 px `--color-border`, `--radius-md`, `--shadow-lg`, max-height 320 px with scroll, 4 px padding.
  - Option: 40 px, `--radius-sm`, 0 12 px padding. Hover `--color-surface-muted`. **Selected:** bg `--color-primary-subtle`, text `--color-green-700`, 16 px check icon at the end.
  - Full keyboard support (arrows, Home/End, typeahead, Enter, Escape). Closes on outside click.
- This replaces the legacy `.dropmenu` (`Dashboard.scss:404-481`), whose options turned solid green with white text on hover and which had no keyboard support.

### 8.4 Textareas

Same as inputs, plus: min-height 128 px, padding 12 px 14 px, `line-height: 1.75`, `resize: vertical`. Add an optional character counter (`--text-caption`, muted) at the bottom end.

### 8.5 Checkboxes, radios, switches

| Control | Spec |
|---|---|
| Checkbox | 20 × 20, `--radius-xs`, 1.5 px `--color-neutral-400` border. Checked: bg `--color-primary` with a white check. Label 16 px, 8 px gap, 44 px tall hit area. |
| Radio | 20 × 20 circle. Checked: 6 px `--color-primary` ring. Grouped in a `fieldset` with a `legend`. |
| Switch | Track 44 × 24, `--radius-full`. Off `--color-neutral-300`, on `--color-primary`. Thumb 20 px white with `--shadow-xs`, 200 ms. (Legacy: 60 × 34, off `#ccc`, on green, `reservation.scss:422-478`.) |
| Choice card | Bordered option card for doctors and booking types. 1 px `--color-border`, `--radius-lg`. Selected: 2 px `--color-primary` border, `--color-primary-subtle` bg, check badge at the top end. Evolution of the legacy selected doctor card (3 px green border, `reservation.scss:217-230`). |

### 8.6 Date and time

- Use a calendar date picker. A native `type="date"` is fine on mobile. Never use free-text `d/m/yyyy` entry.
- Show dates in Arabic with Western digits, e.g. `الثلاثاء 12 نوفمبر 2026`. Store them in ISO format.
- Time slots: a **grid of selectable chips** (40 px, `--radius-md`). Available: 1 px `--color-border`. Selected: `--color-primary` bg, white text. Unavailable: `--color-neutral-100` bg, `--color-neutral-400` text, struck through. This replaces the legacy time dropdown and gives a persistent selected state.
- Use a "previous day / next day" control (icon buttons that mirror in RTL) only alongside a picker.

### 8.7 Cards

| Type | Spec |
|---|---|
| **Base card** | `--color-surface`, 1 px `--color-border`, `--radius-lg`, `--shadow-sm`, padding `--space-6` (`--space-5` below sm) |
| **Marketing card** | No border, `--shadow-md` (the halo successor), `--radius-lg` |
| **Interactive card** (whole card is a link) | Hover: `--shadow-lg`, `translateY(-2px)`, title turns `--color-text-link`. Focus-visible ring around the card. Only one link per card (stretched link pattern). |
| **Media card** (blog, work, review) | Image on top at aspect ratio 16:10, `object-fit: cover`, inheriting the top radius. Hover zoom on the image: `scale(1.04)` (legacy 1.1). Body: meta row (date with calendar icon, `--text-body-sm`, muted), title `--text-h3` with a 2-line clamp, excerpt `--text-body-sm` `--color-text-secondary` with a 3-line clamp, footer link "اقرأ المزيد" with an end arrow. A video item shows a 48 px play badge centred on the image. |
| **Service card** | Centred column. Feature icon circle (64 px, `--color-surface-brand`, 32 px `--color-brand` icon), title h3, description body-sm secondary. **Hover:** the circle fills `--color-primary` and the icon turns white; the card lifts (`--shadow-lg`). This replaces the legacy full-green card fill. |
| **Doctor / team card** | Portrait at 4:5 ratio on a `--color-neutral-100` backdrop, `--radius-lg`. Name h3, title `--color-text-brand` body-sm, optional specialty badges. |
| **Stat item** | Icon circle (56 px), number `--text-stat` in `--color-brand`, label body-sm 600 secondary |

### 8.8 Tables (admin)

- Use semantic `<table>` with `<thead>`, `<th scope="col">` and `<caption>` (visually hidden if not needed).
- Container: `--color-surface`, 1 px `--color-border`, `--radius-lg`, `overflow: auto`.
- Header row: bg `--color-bg-subtle`, `--text-body-sm` / 600, `--color-text-secondary`, 44 px, sticky.
- Body rows: 56 px (dense 44 px), 1 px `--color-border` bottom. Hover bg `--color-bg-subtle`. Selected row bg `--color-primary-subtle`.
- Cells: padding 0 16 px. Text aligns to the start. **Numbers, dates and prices** use `tabular-nums` and align to the end.
- Status columns use **badges** (§8.13). Actions sit in the last column (end side) as icon buttons with tooltips. Group more than 2 actions into a kebab menu.
- Toolbar above the table: search input (with a 300 ms debounce; the legacy search fired on every keystroke), filters, primary action at the end.
- **Below `md`:** collapse each row into a stacked card with "label: value" lines, or allow horizontal scroll with the first column sticky.
- Empty, loading (skeleton rows) and error states render inside the table body.
- This replaces the legacy `div` grids with black 1px borders and the grey block rows.

### 8.9 Modals and dialogs

| Property | Value |
|---|---|
| Backdrop | `--color-overlay` with an optional `backdrop-filter: blur(2px)` (legacy used a 4 px blur) |
| Panel | `--color-surface`, `--radius-xl`, `--shadow-xl`, padding `--space-6` (`--space-8` ≥ md) |
| Widths | sm 440 px (confirm), md 600 px (forms), lg 880 px (details); max-height 90vh with a scrolling body |
| Header | Title `--text-h4` at the start; close icon button (36 px, `x` icon) at the end; 1 px `--color-border` divider |
| Footer | Actions aligned to the end: secondary first, then primary. Stacked full width below sm. |
| Mobile (< sm) | Bottom sheet: full width, top radius `--radius-xl`, drag handle |
| Motion | Fade the backdrop; the panel goes from scale 0.96 to 1 with opacity, over `--duration-slow` |
| Behaviour | `role="dialog"` with `aria-modal="true"` and `aria-labelledby`; focus trap; **Escape closes**; backdrop click closes (except in dirty forms); focus returns to the trigger; body scroll locked |
| **Confirm dialog** (destructive) | 48 px circle in `--color-error-50` with a `--color-error-600` alert icon, a title, a description naming the item ("هل ترغب في حذف باكيدج **أحمد**؟"), and Cancel (ghost) plus Delete (danger). **All destructive actions must confirm.** In the legacy dashboard most did not. |

### 8.10 Navigation

**Utility bar (public, ≥ lg only):**
- Height 40 px, `--color-bg-subtle`, 1 px bottom `--color-border`.
- Start side: phone numbers and address (`--text-body-sm`, `--color-text-secondary`, 16 px `--color-brand` icons; phones in `dir="ltr"` spans).
- End side: social icons (20 px, `--color-text-muted` → `--color-brand` on hover).
- This replaces the 80 px legacy intro bar, which was likewise hidden on mobile.

**Header (public):**
- Height `--header-h`, `--color-surface`, `position: sticky; top: 0`. Gets `--shadow-md` once the page is scrolled.
- Logo BR-01 at the **start** (right in Arabic), 44 px tall (≥ lg) or 36 px (< lg).
- Nav links in the centre or after the logo: `--text-body` / 600, `--color-text`, 16 px horizontal padding. Hover `--color-text-link`. **Active page:** `--color-text-link` plus a 3 px × 24 px `--color-accent` bar under the label (`--radius-full`). This echoes the orange heading bar.
- End side: Secondary button (account: "تسجيل الدخول" or the profile menu) and Primary button "احجز الآن" with a calendar icon.
- Admins see a "لوحة التحكم" link in the profile menu, not in place of the booking button.
- **< lg:**
  - Hamburger icon button at the end; logo at the start.
  - The drawer slides in from the end edge. Width `min(320px, 85vw)`.
  - Rows are 48 px with a 20 px icon and label. Active row: `--color-primary-subtle` background, `--color-text-link` text and a 3 px start bar in `--color-brand`.
  - Buttons are full width at the bottom.
  - The drawer traps focus, closes on Escape, on backdrop click and on route change.
  - The legacy drawer had the same structure, without focus handling.

**Footer (public):**
- Background `--color-surface-inverse` (`--color-green-700`). Legacy was `#309C53`; the deeper green brings white text from 3.50 to 6.44:1.
- Text `--color-text-inverse` (body copy at 85 % opacity).
- Columns (≥ md): brand (reversed logo BR-02 at 72 px plus the about text), site links, contact (email, address, phones), socials.
- Bottom row with a 1 px `rgba(255,255,255,0.15)` divider: copyright with the **current** year (legacy hard-coded 2024).
- Links underline on hover.
- Columns stack below md.

**Admin shell:**
- **Sidebar** (`--sidebar-w`) on the start side, with `--color-surface` and a 1 px `--color-border` on the end edge.
  - Logo at the top. Grouped nav: Bookings, Schedule, Doctors, Patients, Finance (ERP), Content, Settings. Group captions use `--text-caption` muted.
  - Items are 40 px, `--radius-md`, with a 20 px icon and a 14 px / 600 label. Hover `--color-surface-muted`. Active: `--color-primary-subtle` background, `--color-green-700` text and a `--color-brand` icon.
  - The sidebar collapses to a 72 px icon rail with tooltips, and becomes a drawer below lg.
- **Top bar** (64 px): page title `--text-h4`, breadcrumbs, a search slot and the user menu.
- Content area: `--color-bg-subtle`, padding `--space-6` / `--space-8`.
- **The admin does not render the public header, footer or WhatsApp button.**
- This replaces the legacy tile grid, the per-page green header bar, and the ERP icon rail.

**Breadcrumbs:** `--text-body-sm`. The separator is a chevron that mirrors in RTL. The current page is `--color-text` and the other crumbs are `--color-text-muted` links.

### 8.11 Tabs and segmented controls

| Control | Spec |
|---|---|
| **Tabs** (page sections, e.g. profile: bookings / info / password) | Horizontal list with a 1 px `--color-border` bottom. Tab is 44 px, `--text-label`, `--color-text-secondary`, 16 px horizontal padding. Hover `--color-text`. **Selected:** `--color-text-link` with a 2 px `--color-primary` underline indicator. Keyboard: arrow keys, `role="tablist"`. Scrolls horizontally on mobile. Replaces the legacy vertical green-fill profile tabs. |
| **Vertical tabs / side nav** (settings) | Same as admin sidebar items |
| **Segmented control** (2–4 exclusive options, e.g. review type: image / gallery / video) | Track `--color-surface-muted`, `--radius-md`, 4 px padding. Segment 36 px, `--text-label`. **Selected:** `--color-surface` background, `--shadow-xs`, `--color-text-link` text. Replaces the legacy green-fill segments (`Dashboard.scss:2108-2155`). |

### 8.12 Stepper (booking wizard)

- **Horizontal** (≥ md):
  - Each step has a 32 px circle and a label. Steps are joined by a 2 px connector.
  - **Upcoming:** circle `--color-surface-muted` with a `--color-text-muted` number; label muted.
  - **Current:** circle `--color-primary` with a white number; label `--color-text` / 600; `aria-current="step"`.
  - **Completed:** circle `--color-primary-subtle` with a `--color-green-700` check icon; label `--color-text-secondary`. It is clickable to go back.
  - Connector: `--color-border`, turning `--color-brand` once the step is complete.
  - Order follows the document direction, so step 1 sits at the start (the right, in Arabic). The legacy stepper ran LTR and had no completed state.
- **Compact** (< md): "الخطوة 2 من 3: بيانات الحجز" plus a 4 px progress bar (`--color-brand` on `--color-neutral-100`).
- **Summary step:** a definition list inside a card (`dt` muted 14 px / `dd` 16 px 600), with an "Edit" link per section and price totals in `tabular-nums`.

### 8.13 Badges and status

| Variant | Background | Text | Use |
|---|---|---|---|
| Neutral | `--color-surface-muted` | `--color-neutral-700` | Booking type "كشف" / "جلسة", tags |
| Success | `--color-green-50` | `--color-green-700` | Paid "مدفوع", completed "مُكتملة", confirmed |
| Warning | `--color-orange-50` | `--color-orange-800` | Unpaid "غير مدفوع", "مُكتملة غير مدفوعة", doctor on leave |
| Error | `--color-error-50` | `--color-error-700` | Cancelled "ملغية", failed |
| Info | `--color-info-50` | `--color-info-700` | In progress "جارية", upcoming reservation, "مدفوعة بالكامل غير مُكتملة" |
| Accent (solid) | `--color-accent` | `--color-on-accent` | Marketing highlight: "جديد", "الأكثر طلباً" |

- Height 24 px, horizontal padding 10 px, `--radius-full`, `--text-caption` / 600. Optional 6 px dot at the start in the solid colour.
- **Status must never rely on colour alone.** Always include the text label.
- The status labels above are the actual values found in the legacy code (`Components/System/Pop-Package.js:42,252-281`, `Session-Payment.js:88`). Legacy displayed them as plain text.
- **Tags/chips** (blog keywords) use the Neutral badge at 28 px. When removable, add a 16 px `x` icon button at the end; it is never click-anywhere-to-remove. Legacy used green chips.

### 8.14 Alerts and toasts

**Inline alert:**
- `--radius-md`, padding 12 px 16 px, 1 px semantic border, semantic surface background.
- 20 px semantic icon at the start. Title `--text-body` / 600 in `--color-text`; description `--text-body-sm` in `--color-text-secondary`.
- Optional action link and dismiss button at the end.
- Use it for form-level errors, persistent warnings (e.g. "الدكتور في إجازة هذا اليوم") and confirmations that must stay visible.

**Toast:**
- `--color-surface`, `--radius-md`, `--shadow-lg`, 4 px semantic bar on the start edge, semantic icon, `--text-body-sm`, max-width 400 px.
- Auto-dismiss after 5 s for success and info only; errors persist until dismissed. Pause on hover.
- Position top-right, matching the legacy placement. On mobile, top-centre at full width minus the gutter.
- `role="status"` (or `alert` for errors).
- This replaces react-toastify's off-brand "colored" theme.

### 8.15 File upload

**Dropzone:**
- 2 px dashed `--color-neutral-300` border, `--radius-lg`, `--color-bg-subtle` background, padding `--space-8`, content centred.
- Content: a 56 px circle (`--color-surface-brand` with a 28 px `upload` icon in `--color-brand`), the title "اسحب الملفات هنا أو اختر من جهازك" (16 / 600), and a hint with accepted types and the size limit (14, muted).
- **Drag-over:** border `--color-brand`, background `--color-primary-subtle`. **Error:** border `--color-error-600` plus an inline message.
- It is a real `<button>` / label for the file input, so it is keyboard reachable. The legacy UI hid the input off-screen behind a `div`.

**Single image (cover):**
- An aspect-ratio frame (16:9 for blog covers, 4:5 for doctor photos) with a preview image.
- Overlay actions at the bottom end: "استبدال" (replace, secondary sm) and "حذف" (remove, danger-outline sm).

**Gallery:**
- Thumbnails 96 × 96, `--radius-md`, in a wrapping grid with an 8 px gap.
- Each has a **visible remove button**: 28 px circle, white, `--shadow-sm`, `x` icon, at the top end. Never use click-to-delete on the image; the legacy UI did (`pages/dashboard/write-review.js:309-321`).
- Drag to reorder (optional). Upload progress is a 4 px bar under each thumbnail.

**Video:** a `<video controls>` preview at 16:9 with `object-fit: contain` on black, the file name and size, and a poster-frame chooser.

### 8.16 Image previews and galleries (public)

- **Lightbox:** dark backdrop at `rgba(0, 0, 0, 0.9)`, the image contained, prev/next buttons (mirrored in RTL), a counter "3 / 8", Escape to close, and swipe on touch.
- **Thumbnails strip:** 64 px, `--radius-sm`, current one ringed in `--color-brand`.
- This replaces `react-image-gallery`'s default theme. It can still be used if restyled to these tokens.

### 8.17 Empty, loading and error states

| State | Spec |
|---|---|
| **Empty** | Centred. 80 px circle in `--color-surface-muted` with a 40 px muted icon, title `--text-h4`, description body-sm muted (max 40 ch), optional primary or secondary action. Example: "لا توجد حجوزات بعد" with the action "احجز موعدك الأول". One component replaces seven legacy empty-state classes. |
| **Loading (content)** | Skeletons in the shape of the content: `--color-neutral-100` blocks with a subtle shimmer toward `--color-neutral-200` (static when reduced motion is on). |
| **Loading (inline)** | 16–24 px spinner in `--color-brand` (or `currentColor` inside buttons). The legacy default `#3498db` is removed. |
| **Route transitions** | A 3 px top progress bar in `--color-brand`. This replaces the full-screen green overlay on every navigation (`Components/Loading.js`). |
| **Error (section)** | Inline alert (error) with a "إعادة المحاولة" (retry) button. Never an endless spinner. |
| **Error pages (404/500)** | Centred illustration or logo mark, `--text-h1` title, a description, and Primary "الصفحة الرئيسية" plus Secondary "تواصل معنا" buttons |

### 8.18 Pagination

- **Admin tables:** numbered pagination.
  - 36 px square buttons, `--radius-md`, ghost style. Current page: `--color-primary` with white text.
  - Prev/next chevrons mirror in RTL.
  - Show "عرض 1–20 من 248" in body-sm muted.
  - Page-size select (20 / 50 / 100).
- **Public lists** (blogs, works, reviews): keep the legacy **"load more"** pattern [Preserved behaviour].
  - Use a Secondary button, centred, with "عرض المزيد" and a count "12 من 56".
  - Show a loading state in the button; hide the button when everything is loaded.

### 8.19 Other components

| Component | Spec |
|---|---|
| **Tooltip** | `--color-neutral-800` background, white `--text-caption`, `--radius-sm`, padding 6 px 10 px, 300 ms delay. Shown on hover and on focus. |
| **Avatar** | Circle at 32 / 40 / 56 / 96 px. Fallback: initials on `--color-surface-brand` in `--color-green-700`. Legacy used a green outlined user icon. |
| **Rating** | Five 20 px stars: filled `--color-accent`, empty `--color-neutral-300` **[Preserved colour]**. Accessible text "4 من 5". |
| **Dropdown menu** (kebab, user menu) | Same surface as the select menu. Items 40 px with a 20 px icon. Destructive items in `--color-error-700`, separated by a divider. |
| **Rich text editor** (admin) | The toolbar uses icon buttons. The editor surface is styled like a textarea at min-height 320 px, with **`dir="rtl"` by default** and a direction toggle. The preview uses article typography (below). |
| **Article typography** (blog, specialisation, work detail) | Max-width 72 ch. Paragraphs 16–18 px / 1.9. h2 `--text-h2`, h3 `--text-h3`, with 1.5em space above. Lists indented at the start by 1.5em, with `--color-brand` markers. Blockquote: 4 px start border in `--color-accent` on `--color-bg-subtle`, padding 16 px. Links `--color-text-link`, underlined. Images `--radius-lg`, full width with a caption. |
| **Charts** (admin) | Series order: `--color-brand`, `--color-accent`, `--color-info-600`, `--color-neutral-400`, `--color-error-600` (for refunds and returns). Font: `--font-sans` in `--color-text-secondary`. Grid lines `--color-border`. Always show a legend with the same colours. The legacy swatch `#FC89A2` did not match its series. |
| **Floating WhatsApp button** **[Preserved pattern]** | 56 px circle (52 px < sm), `--color-primary` background, 28 px white WhatsApp logo, `--shadow-lg`, fixed bottom 24 px / right 24 px (physical right in both directions, as in legacy), `--z-fab`, `aria-label="تواصل معنا عبر واتساب"`, opens in a new tab. **Hidden in the admin** and while a modal is open. |

---

## 9. Brand patterns (signature compositions)

These recreate the recognisable compositions identified in [VISUAL_IDENTITY_ANALYSIS.md §11.A](VISUAL_IDENTITY_ANALYSIS.md#a-brand-identity-preserve) with modern implementation.

### 9.1 Section heading with orange bar **[Preserved pattern]**

```
[optional kicker, 14px/600, --color-text-brand]
خدمات مركزنا                       ← --text-h2, 800, --color-text
▬▬▬▬                               ← 56×6 px bar, --color-accent, --radius-full, 12 px below the title
[optional description, --text-body-lg, --color-text-secondary, max 60ch]
```
Aligned to the start by default, which is right in Arabic, as in legacy (`Landing.scss:325-346`). A centred variant is allowed for single-column sections.

### 9.2 Photo page banner with green tint **[Preserved pattern]**

- Height `clamp(220px, 30vw, 400px)`. Legacy was a fixed 600 px.
- Full-bleed image with `object-fit: cover`.
- Overlay: `linear-gradient(to top, rgba(17, 61, 32, 0.75), var(--color-banner-overlay))`.
- Content in the container: breadcrumbs (white at 80 % opacity) and the title (`--text-h1`, white, 800). No text-shadow is needed.
- Centred, as in legacy, or start-aligned on detail pages.
- Images: CV-01…CV-08 (see the asset guide).

### 9.3 Hero

- Height `min(88vh, 760px)` on ≥ lg; content height plus padding on mobile.
- Background: a photo with a gradient overlay from `--color-green-900` at 80 % on the text side to 20 % on the other side.
- **Two columns (≥ lg):**
  - Text column at the start (right in Arabic): kicker (`--text-body-lg` / 600, white at 85 %), title `--text-display` (white), paragraph `--text-body-lg` (white at 90 %, max 52 ch). Then CTAs: **Inverse** "احجز الآن" with a calendar icon, and **Inverse-outline** "تواصل عبر واتساب".
  - Founder portrait at the end (left in Arabic, as in legacy): PE-01, re-cut, bottom-aligned, about 90 % of the hero height.
- **< lg:** single column, text centred. Show the portrait smaller below the text, or hide it as legacy did at ≤ 1107 px.
- **Carousel:** optional. If kept: up to 3 slides, no auto-advance (or 7 s with a visible pause button), 44 px arrow buttons (mirrored in RTL), dot indicators, swipe. A static hero is the performance-friendly default.

### 9.4 Statistics strip overlapping the hero **[Preserved pattern]**

- A card container overlaps the bottom of the hero by `--space-16` (64 px). Legacy overlapped by 170 px.
- Card: `--color-surface`, `--radius-lg`, `--shadow-lg`.
- BG-01 world-map texture as a background at 60 % opacity.
- Grid of stat items: 5 columns (≥ lg), 3 (md), 2 (< md).
- The count-up animation runs once when visible; under reduced motion it shows the final values.
- Content (current values): 7 beds, +160,000 sessions, +20,000 clients, 10 doctors, 21 years of experience (`Components/Landing/Statistics.js:37-41`). These should come from the CMS or config in the new build.

### 9.5 Credential list with orange dots **[Preserved pattern]**

A list with 8 px `--color-accent` circular markers aligned to the first text line, items at `--text-body` with `--color-text`, and a 12 px gap. It is used for the doctor's credentials and the About feature list.

### 9.6 Green icon circle **[Preserved pattern]**

Used for contact info, services, stats and empty states: a circle (56 / 64 / 96 px) with `--color-surface-brand` and a `--color-brand` icon. A **solid** variant (`--color-primary` circle with a white icon) is reserved for emphasis, such as the three contact methods on the Contact page. Legacy used 120 px solid circles there.

### 9.7 Founder / doctor feature section

- Two columns: the portrait in a `--radius-lg` frame on a `--color-neutral-100` backdrop, and the content.
- Content: name `--text-h2`, title `--text-h4` in `--color-text-brand`, credential list (§9.5), and an optional quote.
- Optional decorative IL-01 stethoscope watermark at 50 % opacity behind the content, static. Legacy animated it infinitely.
- Optional **static** offset backdrop shapes in `--color-neutral-100` (the legacy floating shapes, without the motion).

---

## 10. UX guidelines

### 10.1 Visual hierarchy
- One primary action per view, in `--color-primary`. The accent CTA is used at most once per page.
- Each page follows the same order: page title (h1) → section headings (h2 with the orange bar on marketing pages, plain h2 in the app) → card titles (h3).
- Colour is for meaning: green for actions and brand, orange for brand decoration and highlights, red for destructive or error, slate for secondary text.
- The admin is denser and quieter: no orange bars or marketing shadows; base cards and tables only.

### 10.2 Consistent spacing
- Use only `--space-*` tokens. Vertical rhythm: 8 px within components, 16–24 px between related groups, 48–96 px between sections.
- Section padding: `--space-16` on mobile, `--space-24` on desktop.
- Grids use CSS Grid with `gap`: 16 / 24 / 32 px by breakpoint. Use container max-widths instead of percentage widths.

### 10.3 Readability
- Body text at 16 px with line-height 1.75 (Arabic needs more than Latin). Articles at 18 px / 1.9.
- Minimum text size 12 px (captions only). Legacy reached 8–11 px.
- Line length: 60–72 ch.
- Text on photos always sits on an overlay that gives at least 4.5:1. Avoid text-shadow hacks.

### 10.4 Accessibility (WCAG 2.2 AA)
- Contrast: text ≥ 4.5:1 (large text ≥ 3:1); UI components and focus indicators ≥ 3:1. All role tokens above comply when used as specified.
- **Visible focus on every interactive element** (`:focus-visible` ring). Never set `outline: none` without a replacement.
- Every form control has a `<label>`. Group related controls in a `fieldset` with a `legend`. Errors are announced (`aria-live`) and linked with `aria-describedby`.
- Keyboard: everything reachable and operable. Menus, listboxes, tabs and dialogs follow the WAI-ARIA Authoring Practices patterns.
- Targets at least 24 × 24 px (WCAG 2.5.8), with 44 × 44 px as the default for touch.
- `lang="ar"` and `dir="rtl"` on `<html>`. Use `lang="en"` on embedded English fragments.
- Respect `prefers-reduced-motion`.
- Images have meaningful Arabic `alt` text (not "Rehab EG Clinic" everywhere). Decorative images get `alt=""`.
- Never use native `alert()` or `confirm()`.

### 10.5 Responsive layouts
- Mobile-first, with `min-width` breakpoints from §4.3 only. Use fluid type through `clamp()`.
- Use CSS Grid and flex with `gap`. Avoid fixed pixel widths on cards; let grid tracks size them (e.g. `repeat(auto-fill, minmax(280px, 1fr))`).
- Images are responsive (`srcset` / `sizes`, modern formats, lazy-loaded below the fold) with a set `aspect-ratio` to prevent layout shift.
- The admin must work on tablets. Tables collapse below md, and the sidebar becomes a drawer below lg. Legacy ERP had no rules below 1537 px.

### 10.6 RTL / LTR support
- Logical properties only: `margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`, `border-start-start-radius`. **Never use `row-reverse` to fake RTL.**
- Mirror directional icons; do not mirror logos, media controls (play), checkmarks or brand marks.
- Isolate LTR fragments (phones, emails, URLs, codes) with `<bdi>` or `dir="ltr"`.
- Every component must be tested in both directions.

### 10.7 Interaction feedback
- Every interactive element defines **hover, active, focus-visible, disabled and loading** states.
- Use optimistic, immediate feedback: button loading state, then a success toast or inline confirmation.
- Destructive actions require confirmation (§8.9). Offer an undo where feasible.
- Forms keep entered values on error and focus the first invalid field.
- Long operations (uploads) show progress. Never use an unbounded spinner without a timeout or error path.
- Booking-specific: show available slots visually (§8.6). Disable unavailable days in the calendar. Show a persistent summary of selections as the user moves through the steps.
