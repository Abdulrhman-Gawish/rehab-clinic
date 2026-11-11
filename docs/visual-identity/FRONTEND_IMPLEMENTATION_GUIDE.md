# Frontend Implementation Guide: Rehab (new repository)

| | |
|---|---|
| **Audience** | The developer or AI coding agent building the new frontend in a **separate repository without access to the legacy code** |
| **Read with** | [DESIGN_SYSTEM_PROPOSAL.md](DESIGN_SYSTEM_PROPOSAL.md) (what and why) · [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md) (asset files and paths) · [VISUAL_IDENTITY_ANALYSIS.md](VISUAL_IDENTITY_ANALYSIS.md) (legacy facts) · [ASSET_INVENTORY.md](ASSET_INVENTORY.md) (asset IDs) |
| **Stack assumptions** | None about the framework. Examples use plain CSS custom properties, which work everywhere. Optional snippets show Next.js (`next/font`) and Tailwind CSS. Static files are assumed to live under `public/` (adjust the prefix if your stack differs). |
| **Date** | 2026-11-07 |

---

## Contents

0. [How to use this guide](#0-how-to-use-this-guide)
1. [Design principles (summary)](#1-design-principles-summary)
2. [Design tokens (copy this file)](#2-design-tokens-copy-this-file)
3. [Font configuration](#3-font-configuration)
4. [Global styling requirements](#4-global-styling-requirements)
5. [Optional: Tailwind CSS mapping](#5-optional-tailwind-css-mapping)
6. [RTL / LTR requirements](#6-rtl--ltr-requirements)
7. [Component styling rules](#7-component-styling-rules)
8. [Reusable component recommendations](#8-reusable-component-recommendations)
9. [Layouts and page templates](#9-layouts-and-page-templates)
10. [Asset references](#10-asset-references)
11. [Responsive guidelines](#11-responsive-guidelines)
12. [Content, copy and configuration](#12-content-copy-and-configuration)
13. [Legacy anti-patterns: do not reproduce](#13-legacy-anti-patterns-do-not-reproduce)
14. [QA checklist (definition of done)](#14-qa-checklist-definition-of-done)

---

## 0. How to use this guide

1. **Do Stage A** of [ASSET_MIGRATION_GUIDE.md §5](ASSET_MIGRATION_GUIDE.md#5-stage-a-copy-originals-out-of-the-legacy-repository) first, or confirm a person has done it. The originals must be in `design-source/legacy-import/`. Then do Stage B (optimisation into `public/assets/…`).
2. Add `tokens.css` (§2) and `base.css` (§4) as the first global styles, and configure fonts (§3).
3. Build the primitives in §8 before any pages. Every page is composed from them.
4. Every visual value comes from a token. **If you need a value that has no token, add a token rather than hard-coding it.** Hard-coded values are what produced more than 30 greys in the legacy app.
5. Labels in the companion documents: **[Verified]** = legacy fact, **[Recommendation]** = design decision, **[Preserved]** = legacy value kept unchanged. Everything in this guide is a recommendation for the new build unless stated otherwise.

---

## 1. Design principles (summary)

- **Same brand, modern execution.** Keep the brand green `#309C53`, the brand orange `#F89A3A`, Noto Kufi Arabic, the logo, green-tinted photo banners, section headings with an orange bar, green icon circles, the stats strip and the founder's presence. Modernise everything else.
- **Green = action and brand; orange = accent.** Orange is never text on white, and white is never text on orange.
- **Arabic-first, real RTL.** `dir="rtl"` on `<html>`, logical properties, mirrored directional icons. English (LTR) must also work.
- **Readable, accessible, consistent.** Body text 16 px with line-height 1.75; WCAG 2.2 AA; one component per pattern; every state designed.

---

## 2. Design tokens (copy this file)

Save as `styles/tokens.css` (any path) and import it once globally, before every other stylesheet. Values are **identical** to [DESIGN_SYSTEM_PROPOSAL.md](DESIGN_SYSTEM_PROPOSAL.md) §2–§5.

```css
/* =========================================================
   Rehab design tokens
   Source of truth: DESIGN_SYSTEM_PROPOSAL.md
   ========================================================= */
:root {
  /* ---------- Brand green (primary) ---------- */
  --color-green-50:  #EDF7F0;
  --color-green-100: #D2EDDB;
  --color-green-200: #A6DBB8;
  --color-green-300: #72C390;
  --color-green-400: #47AC6A;
  --color-green-500: #309C53; /* [Preserved] legacy --Primary-Color; logo #309C52 */
  --color-green-600: #278545; /* white text 4.64:1, primary buttons */
  --color-green-700: #1F6C38;
  --color-green-800: #18552C;
  --color-green-900: #113D20;

  /* ---------- Brand orange (accent) ---------- */
  --color-orange-50:  #FEF4EA;
  --color-orange-100: #FDE4CA;
  --color-orange-200: #FCCB97;
  --color-orange-300: #FAB365;
  --color-orange-400: #F9A54C;
  --color-orange-500: #F89A3A; /* [Preserved] legacy --Main-Color; exact logo orange */
  --color-orange-600: #E07F1F;
  --color-orange-700: #B4621A;
  --color-orange-800: #874A16;
  --color-orange-900: #5F3511;

  /* ---------- Neutrals (cool grey) ---------- */
  --color-white:       #FFFFFF;
  --color-neutral-50:  #F6F8F8;
  --color-neutral-100: #EDF1F1; /* [Preserved] legacy input fill */
  --color-neutral-200: #DDE3E4;
  --color-neutral-300: #C4CDCF;
  --color-neutral-400: #85929A;
  --color-neutral-500: #5F6C72;
  --color-neutral-600: #4C585E;
  --color-neutral-700: #3D474C;
  --color-neutral-800: #2B3235;
  --color-neutral-900: #232323; /* [Preserved] legacy --Headlines-Color */
  --color-slate:       #4A6F8A; /* [Preserved] legacy --Regular-Font-Color */

  /* ---------- Error / info scales ---------- */
  --color-error-50:  #FDECEC;
  --color-error-100: #F9CFCF;
  --color-error-600: #DA1B1B; /* [Preserved] legacy contact-form error */
  --color-error-700: #B71717;
  --color-error-800: #8F1212;
  --color-info-50:   #EAF3FD;
  --color-info-100:  #C8E0FA;
  --color-info-600:  #1E6FC2;
  --color-info-700:  #185A9E;
  --color-info-800:  #11437A;

  /* ---------- Semantic aliases ---------- */
  --color-success-bg:     var(--color-green-50);
  --color-success-border: var(--color-green-200);
  --color-success-solid:  var(--color-green-600);
  --color-success-text:   var(--color-green-700);
  --color-warning-bg:     var(--color-orange-50);
  --color-warning-border: var(--color-orange-300);
  --color-warning-solid:  var(--color-orange-500);
  --color-warning-text:   var(--color-orange-800);
  --color-error-bg:       var(--color-error-50);
  --color-error-border:   var(--color-error-100);
  --color-error-solid:    var(--color-error-600);
  --color-error-text:     var(--color-error-700);
  --color-info-bg:        var(--color-info-50);
  --color-info-border:    var(--color-info-100);
  --color-info-solid:     var(--color-info-600);
  --color-info-text:      var(--color-info-700);

  /* ---------- Role tokens (use these in components) ---------- */
  --color-bg:              var(--color-white);
  --color-bg-subtle:       var(--color-neutral-50);
  --color-surface:         var(--color-white);
  --color-surface-muted:   var(--color-neutral-100);
  --color-surface-brand:   var(--color-green-50);
  --color-surface-accent:  var(--color-orange-50);
  --color-surface-inverse: var(--color-green-700);
  --color-text:            var(--color-neutral-900);
  --color-text-secondary:  var(--color-slate);
  --color-text-muted:      var(--color-neutral-500);
  --color-text-inverse:    var(--color-white);
  --color-text-link:       var(--color-green-700);
  --color-text-brand:      var(--color-green-600);
  --color-border:          var(--color-neutral-200);
  --color-border-input:    var(--color-neutral-300);
  --color-border-strong:   var(--color-neutral-400);
  --color-brand:           var(--color-green-500);
  --color-primary:         var(--color-green-600);
  --color-primary-hover:   var(--color-green-700);
  --color-primary-active:  var(--color-green-800);
  --color-primary-subtle:  var(--color-green-50);
  --color-on-primary:      var(--color-white);
  --color-accent:          var(--color-orange-500);
  --color-accent-hover:    var(--color-orange-600);
  --color-on-accent:       var(--color-neutral-900);
  --color-focus:           var(--color-green-600);
  --color-overlay:         rgba(35, 35, 35, 0.5);
  --color-banner-overlay:  rgba(17, 61, 32, 0.62);

  /* ---------- Typography ---------- */
  /* --font-arabic / --font-latin may be overridden by the font loader (see §3) */
  --font-arabic: "Noto Kufi Arabic";
  --font-latin:  "Inter";
  --font-sans:   var(--font-arabic), var(--font-latin), system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif;
  --font-mono:   ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

  --font-weight-regular:   400;
  --font-weight-medium:    500;
  --font-weight-semibold:  600;
  --font-weight-bold:      700;
  --font-weight-extrabold: 800;

  --text-display: clamp(2.25rem, 1.8rem + 2vw, 3.5rem);    --leading-display: 1.25;
  --text-h1:      clamp(1.875rem, 1.6rem + 1.25vw, 2.75rem); --leading-h1: 1.3;
  --text-h2:      clamp(1.5rem, 1.35rem + 0.75vw, 2.125rem); --leading-h2: 1.35;
  --text-h3:      clamp(1.25rem, 1.18rem + 0.35vw, 1.5rem);  --leading-h3: 1.4;
  --text-h4:      1.125rem;  --leading-h4: 1.5;
  --text-body-lg: 1.125rem;  --leading-body-lg: 1.8;
  --text-body:    1rem;      --leading-body: 1.75;
  --text-body-sm: 0.875rem;  --leading-body-sm: 1.7;
  --text-caption: 0.75rem;   --leading-caption: 1.6;
  --text-label:   0.875rem;  --leading-label: 1.5;
  --text-button:  1rem;      --leading-button: 1.25;
  --text-stat:    clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem); --leading-stat: 1.2;

  /* ---------- Spacing (4px base) ---------- */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;

  /* ---------- Layout ---------- */
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-2xl: 1440px;
  --gutter: 16px;            /* 24px ≥640, 32px ≥1024 (see media queries below) */
  --section-space: var(--space-16); /* 96px ≥1024 */

  --control-h-sm: 36px;
  --control-h-md: 44px;
  --control-h-lg: 52px;
  --input-h: 48px;
  --header-h: 64px;          /* 72px ≥1024 */
  --utility-bar-h: 40px;
  --sidebar-w: 264px;
  --sidebar-w-collapsed: 72px;

  --icon-xs: 16px;
  --icon-sm: 20px;
  --icon-md: 24px;
  --icon-lg: 32px;
  --icon-xl: 48px;

  /* ---------- Radius ---------- */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 10px;         /* [Preserved] legacy signature radius */
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* ---------- Borders & focus ---------- */
  --border-width: 1px;
  --border-width-strong: 2px;
  --focus-ring: 2px solid var(--color-focus);
  --ring-input-focus: 0 0 0 3px rgba(48, 156, 83, 0.25);

  /* ---------- Shadows ---------- */
  --shadow-xs: 0 1px 2px rgba(35, 35, 35, 0.05);
  --shadow-sm: 0 1px 3px rgba(35, 35, 35, 0.06), 0 1px 2px rgba(35, 35, 35, 0.04);
  --shadow-md: 0 4px 20px rgba(35, 35, 35, 0.07);
  --shadow-lg: 0 12px 32px rgba(35, 35, 35, 0.10);
  --shadow-xl: 0 24px 48px rgba(35, 35, 35, 0.14);

  /* ---------- Motion ---------- */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.3, 0, 0, 1);

  /* ---------- Z-index ---------- */
  --z-raised: 10;
  --z-dropdown: 1000;
  --z-sticky: 1100;
  --z-fab: 1150;
  --z-overlay: 1200;
  --z-modal: 1300;
  --z-popover: 1400;
  --z-toast: 1500;
}

/* Breakpoints (mobile-first). CSS variables cannot be used inside media queries:
   sm 640px · md 768px · lg 1024px · xl 1280px · 2xl 1536px */
@media (min-width: 640px)  { :root { --gutter: 24px; } }
@media (min-width: 1024px) { :root { --gutter: 32px; --section-space: var(--space-24); --header-h: 72px; } }

/* Script-aware font stacks */
:root:lang(en) {
  --font-sans: var(--font-latin), var(--font-arabic), system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
}
```

---

## 3. Font configuration

**Requirements**
- **Noto Kufi Arabic** **[Preserved brand typeface]**: weights 400, 500, 600, 700, 800; subsets `arabic` and `latin`; `font-display: swap`.
- **Inter** for Latin and English: weights 400, 500, 600, 700; subset `latin`.
- Both are SIL OFL 1.1, so they are free to self-host.
- Do not load weights 100–300 or 900. The legacy code used 900, which was never loaded, and 200/300 for light text that is hard to read.
- **Expose the fonts as CSS variables and apply them through `--font-sans`.** Never write a literal `font-family: 'Noto Kufi Arabic'` on individual elements. That is the legacy defect: form controls fell back to the system font because `next/font` registers a hashed family name.

### 3.1 Next.js (`next/font/google`)

```ts
// app/fonts.ts (or utils/fonts.ts)
import { Noto_Kufi_Arabic, Inter } from 'next/font/google';

export const notoKufiArabic = Noto_Kufi_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-noto-kufi-arabic',
});

export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});
```

```tsx
// Root layout (App Router) — the variables go on <html>
<html lang="ar" dir="rtl" className={`${notoKufiArabic.variable} ${inter.variable}`}>
```

```css
/* After tokens.css: point the font tokens at the loader's variables */
:root {
  --font-arabic: var(--font-noto-kufi-arabic), "Noto Kufi Arabic";
  --font-latin:  var(--font-inter), "Inter";
}
```

### 3.2 Any other stack

- Option A: npm `@fontsource/noto-kufi-arabic` and `@fontsource/inter`. Import the needed weights. The family names will be `"Noto Kufi Arabic"` and `"Inter"`, which matches the tokens as written.
- Option B: Google Fonts `<link>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

**Arabic typesetting rules:** no `letter-spacing`, no italics, no `text-transform`. Keep digits Western (0–9) **[Preserved]**.

---

## 4. Global styling requirements

Save as `styles/base.css` and import it right after `tokens.css`.

```css
/* ---------- Reset & document ---------- */
*, *::before, *::after { box-sizing: border-box; }

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  scroll-padding-top: calc(var(--header-h) + var(--space-4)); /* sticky header offset for anchors */
}

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--font-weight-regular);
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4, h5, h6 { margin: 0; color: var(--color-text); text-wrap: balance; }
p, figure, blockquote, dl, dd { margin: 0; }
ul[role="list"], ol[role="list"] { list-style: none; margin: 0; padding: 0; }

/* Form controls inherit the brand font (fixes the legacy defect) */
button, input, select, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; }

img, picture, video, canvas, svg { display: block; max-width: 100%; }
img, video { height: auto; }

a { color: var(--color-text-link); text-underline-offset: 3px; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }

/* ---------- Focus (never remove without replacement) ---------- */
:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
:focus:not(:focus-visible) { outline: none; }

::selection { background: var(--color-green-100); color: var(--color-text); }

/* ---------- Motion safety ---------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ---------- Typography utilities ---------- */
.text-display { font-size: var(--text-display); line-height: var(--leading-display); font-weight: var(--font-weight-extrabold); }
.text-h1      { font-size: var(--text-h1);      line-height: var(--leading-h1);      font-weight: var(--font-weight-extrabold); }
.text-h2      { font-size: var(--text-h2);      line-height: var(--leading-h2);      font-weight: var(--font-weight-extrabold); }
.text-h3      { font-size: var(--text-h3);      line-height: var(--leading-h3);      font-weight: var(--font-weight-bold); }
.text-h4      { font-size: var(--text-h4);      line-height: var(--leading-h4);      font-weight: var(--font-weight-bold); }
.text-body-lg { font-size: var(--text-body-lg); line-height: var(--leading-body-lg); }
.text-body    { font-size: var(--text-body);    line-height: var(--leading-body); }
.text-body-sm { font-size: var(--text-body-sm); line-height: var(--leading-body-sm); }
.text-caption { font-size: var(--text-caption); line-height: var(--leading-caption); font-weight: var(--font-weight-medium); }
.text-secondary { color: var(--color-text-secondary); }
.text-muted     { color: var(--color-text-muted); }
.tabular        { font-variant-numeric: tabular-nums; }

/* ---------- Layout utilities ---------- */
.container      { width: 100%; max-width: var(--container-xl);  margin-inline: auto; padding-inline: var(--gutter); }
.container-wide { width: 100%; max-width: var(--container-2xl); margin-inline: auto; padding-inline: var(--gutter); }
.section        { padding-block: var(--section-space); }
.section--subtle { background: var(--color-bg-subtle); }

/* ---------- Bidi helpers ---------- */
.ltr { direction: ltr; unicode-bidi: isolate; }                  /* phones, emails, codes */
[dir="rtl"] .icon-directional { transform: scaleX(-1); }          /* arrows/chevrons only */
[dir="rtl"] input[dir="ltr"],
[dir="rtl"] textarea[dir="ltr"] { text-align: right; }

.visually-hidden {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
```

Global requirements checklist:
- `<html lang="ar" dir="rtl">` on Arabic pages and `<html lang="en" dir="ltr">` on English pages.
- One `<main>` per page, plus landmark elements (`header`, `nav`, `footer`, `aside`). Add a skip link "انتقل إلى المحتوى" as the first focusable element.
- The page background is `--color-bg`. Alternate marketing sections may use `.section--subtle`.
- The header is sticky. Use `scroll-padding-top` (already set) so anchors are not hidden under it.
- No component sets `outline: none` without a `:focus-visible` replacement.

---

## 5. Optional: Tailwind CSS mapping

Use this only if the new repo uses Tailwind. Tailwind's default breakpoints (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`) **already equal** the proposed ones. Keep `tokens.css` as the source of truth and map Tailwind onto the CSS variables.

**Tailwind v3** (`tailwind.config.js`):

```js
const v = (name) => `var(--${name})`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((s) => [s, v(`color-${prefix}-${s}`)]));

module.exports = {
  theme: {
    extend: {
      colors: {
        green:   scale('green',   [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        orange:  scale('orange',  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        neutral: scale('neutral', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        error:   scale('error',   [50, 100, 600, 700, 800]),
        info:    scale('info',    [50, 100, 600, 700, 800]),
        slate:   v('color-slate'),
        brand:   v('color-brand'),
        primary: { DEFAULT: v('color-primary'), hover: v('color-primary-hover'), active: v('color-primary-active'), subtle: v('color-primary-subtle') },
        accent:  { DEFAULT: v('color-accent'), hover: v('color-accent-hover') },
        surface: { DEFAULT: v('color-surface'), muted: v('color-surface-muted'), brand: v('color-surface-brand'), accent: v('color-surface-accent'), inverse: v('color-surface-inverse') },
        content: { DEFAULT: v('color-text'), secondary: v('color-text-secondary'), muted: v('color-text-muted'), inverse: v('color-text-inverse'), link: v('color-text-link'), brand: v('color-text-brand') },
        line:    { DEFAULT: v('color-border'), input: v('color-border-input'), strong: v('color-border-strong') },
      },
      fontFamily: { sans: ['var(--font-sans)'], mono: ['var(--font-mono)'] },
      fontSize: {
        display: [v('text-display'), { lineHeight: v('leading-display'), fontWeight: '800' }],
        h1: [v('text-h1'), { lineHeight: v('leading-h1'), fontWeight: '800' }],
        h2: [v('text-h2'), { lineHeight: v('leading-h2'), fontWeight: '800' }],
        h3: [v('text-h3'), { lineHeight: v('leading-h3'), fontWeight: '700' }],
        h4: [v('text-h4'), { lineHeight: v('leading-h4'), fontWeight: '700' }],
        'body-lg': [v('text-body-lg'), { lineHeight: v('leading-body-lg') }],
        body: [v('text-body'), { lineHeight: v('leading-body') }],
        'body-sm': [v('text-body-sm'), { lineHeight: v('leading-body-sm') }],
        caption: [v('text-caption'), { lineHeight: v('leading-caption'), fontWeight: '500' }],
        stat: [v('text-stat'), { lineHeight: v('leading-stat'), fontWeight: '800' }],
      },
      borderRadius: { xs: v('radius-xs'), sm: v('radius-sm'), md: v('radius-md'), lg: v('radius-lg'), xl: v('radius-xl') },
      boxShadow: { xs: v('shadow-xs'), sm: v('shadow-sm'), md: v('shadow-md'), lg: v('shadow-lg'), xl: v('shadow-xl') },
      maxWidth: { 'container-xl': v('container-xl'), 'container-2xl': v('container-2xl') },
      zIndex: { dropdown: '1000', sticky: '1100', fab: '1150', overlay: '1200', modal: '1300', popover: '1400', toast: '1500' },
      transitionDuration: { fast: '120ms', base: '200ms', slow: '320ms' },
      transitionTimingFunction: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
};
```

- **Tailwind v4:** declare the same variables in an `@theme` block, or keep `tokens.css` and reference the variables with arbitrary values.
- **Use the logical utilities** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `rounded-s-*`, `border-s`). Use the `rtl:` / `ltr:` variants only for exceptions such as icon flipping. Never use `flex-row-reverse` to fake RTL.

---

## 6. RTL / LTR requirements

The legacy app was LTR with Arabic faked through `row-reverse` and `text-align: right` (see [VISUAL_IDENTITY_ANALYSIS.md §8](VISUAL_IDENTITY_ANALYSIS.md#8-rtl--ltr-behaviour)). The new app must use the document direction.

| Topic | Rule |
|---|---|
| Document | `<html lang="ar" dir="rtl">`. The English locale uses `lang="en" dir="ltr"`. Never hard-code direction inside components. |
| Layout | Normal source order with `flex` / `grid`. Content flows from the right automatically in RTL. **Never use `flex-direction: row-reverse` or `column-reverse` for direction.** |
| Spacing and position | Logical properties only: `margin-inline-start/end`, `padding-inline`, `inset-inline-start/end`, `border-inline-start`, `border-start-start-radius`, `text-align: start/end`. Physical `left`/`right` only for intentionally fixed placement (the WhatsApp button, see below). |
| Icons | Mirror **directional** icons (arrows, chevrons, "back", "next", "read more", breadcrumb separators, pagination) with `.icon-directional`. **Do not mirror** logos, play icons, check marks, phone or clock icons, or brand marks. Draw icons with LTR semantics ("arrow pointing to the end" = `arrow-right`) and let `.icon-directional` flip them. |
| Mixed-direction text | Wrap phones, emails, URLs, prices with Latin currency, codes and Latin brand names in `<bdi>` or `<span class="ltr">`. Phone, email and URL inputs get `dir="ltr"`. In RTL pages they are right-aligned by `base.css`. |
| Numbers | Western digits (0–9) **[Preserved]**. With `Intl`, force the Latin numbering system: `new Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' })`. The default `ar-EG` produces Arabic-Indic digits. |
| Dates | `new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })` → "الثلاثاء، 12 نوفمبر 2026". In compact tables use `dd/MM/yyyy` wrapped in `.ltr`. |
| Carousels / sliders | Configure the library's RTL option so swipe direction and "next" match. Arrows follow the icon rule. |
| Charts | Set the chart library's RTL / text-direction options. Use the app font. Put the legend at the top-start. |
| Rich text | The editor surface has `dir="rtl"`, with a per-block direction toggle. Rendered article HTML sits inside a `dir="rtl"` container; the CMS HTML must not carry inline `text-align` overrides. |
| Toasts / portals | Portals (modals, menus, toasts) must inherit `dir` (render inside `<html dir>` or pass `dir` explicitly). |
| Floating WhatsApp button | Physical bottom-right in both directions, preserving the legacy position (`right: 24px; bottom: 24px`). This is a documented exception. |
| Testing | Every component story or test runs in both `dir="rtl"` and `dir="ltr"`. |

---

## 7. Component styling rules

Full specifications are in [DESIGN_SYSTEM_PROPOSAL.md §8](DESIGN_SYSTEM_PROPOSAL.md#8-component-guidelines). The reference CSS below anchors the most-used primitives. The class names are suggestions; any component system works if it produces the same values.

### 7.1 Button

```css
.btn {
  --btn-h: var(--control-h-md);
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  min-height: var(--btn-h); padding-inline: 20px;
  border: var(--border-width) solid transparent; border-radius: var(--radius-md);
  font-size: var(--text-button); line-height: var(--leading-button); font-weight: var(--font-weight-semibold);
  text-decoration: none; white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard),
              color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}
.btn svg { width: var(--icon-sm); height: var(--icon-sm); flex: none; }
.btn--sm { --btn-h: var(--control-h-sm); padding-inline: 12px; font-size: var(--text-body-sm); }
.btn--lg { --btn-h: var(--control-h-lg); padding-inline: 28px; font-size: 1.0625rem; }
.btn--block { width: 100%; }

.btn--primary { background: var(--color-primary); color: var(--color-on-primary); }
.btn--primary:hover  { background: var(--color-primary-hover); }
.btn--primary:active { background: var(--color-primary-active); }

.btn--secondary { background: var(--color-surface); color: var(--color-green-700); border-color: var(--color-primary); }
.btn--secondary:hover  { background: var(--color-primary-subtle); }
.btn--secondary:active { background: var(--color-green-100); }

.btn--accent { background: var(--color-accent); color: var(--color-on-accent); }
.btn--accent:hover  { background: var(--color-accent-hover); }
.btn--accent:active { background: var(--color-accent-hover); box-shadow: inset 0 2px 0 rgba(0, 0, 0, 0.12); }

.btn--ghost { background: transparent; color: var(--color-text); }
.btn--ghost:hover  { background: var(--color-surface-muted); }
.btn--ghost:active { background: var(--color-neutral-200); }

.btn--danger { background: var(--color-error-600); color: var(--color-white); }
.btn--danger:hover  { background: var(--color-error-700); }
.btn--danger:active { background: var(--color-error-800); }

.btn--danger-outline { background: transparent; color: var(--color-error-700); border-color: var(--color-error-600); }
.btn--danger-outline:hover { background: var(--color-error-50); }

.btn--inverse { background: var(--color-white); color: var(--color-green-700); }
.btn--inverse:hover { background: var(--color-green-50); }
.btn--inverse-outline { background: transparent; color: var(--color-white); border: 1.5px solid var(--color-white); }
.btn--inverse-outline:hover { background: rgba(255, 255, 255, 0.12); }

.btn:disabled, .btn[aria-disabled="true"] {
  background: var(--color-neutral-100); color: var(--color-neutral-500); border-color: transparent;
  box-shadow: none; pointer-events: none;
}
.btn[aria-busy="true"] { pointer-events: none; }

@media (max-width: 639.98px) { .form-actions .btn--primary { width: 100%; } }
```

### 7.2 Field (label + input + help / error)

```css
.field { display: grid; gap: 6px; }
.field__label { font-size: var(--text-label); line-height: var(--leading-label); font-weight: var(--font-weight-semibold); color: var(--color-text); }
.field__optional { font-weight: var(--font-weight-regular); color: var(--color-text-muted); } /* "(اختياري)" */
.field__help  { font-size: var(--text-body-sm); color: var(--color-text-muted); }
.field__error { font-size: var(--text-body-sm); color: var(--color-error-text); display: flex; gap: var(--space-1); align-items: center; }

.input, .select, .textarea {
  width: 100%; min-height: var(--input-h); padding-inline: 14px;
  background: var(--color-surface-muted); color: var(--color-text);
  border: var(--border-width) solid var(--color-border-input); border-radius: var(--radius-md);
  font-size: var(--text-body); font-weight: var(--font-weight-medium);
  transition: border-color var(--duration-fast) var(--ease-standard),
              background-color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}
.textarea { min-height: 128px; padding-block: 12px; line-height: var(--leading-body); resize: vertical; }
.input::placeholder, .textarea::placeholder { color: var(--color-text-muted); opacity: 1; }
.input:hover, .select:hover, .textarea:hover { border-color: var(--color-border-strong); }
.input:focus, .select:focus, .textarea:focus {
  outline: none; /* replaced by the border + ring below */
  background: var(--color-surface); border-color: var(--color-primary); box-shadow: var(--ring-input-focus);
}
.input[aria-invalid="true"], .select[aria-invalid="true"], .textarea[aria-invalid="true"] { border-color: var(--color-error-600); }
.input:disabled, .select:disabled, .textarea:disabled {
  background: var(--color-neutral-50); color: var(--color-neutral-500); border-color: var(--color-neutral-200); cursor: not-allowed;
}
.select { appearance: none; padding-inline-end: 44px; /* chevron icon at inline-end, 20px, --color-text-muted */ }

/* Leading icon */
.input-wrap { position: relative; }
.input-wrap > svg { position: absolute; inset-inline-start: 14px; top: 50%; translate: 0 -50%;
                    width: var(--icon-sm); height: var(--icon-sm); color: var(--color-text-muted); pointer-events: none; }
.input-wrap:focus-within > svg { color: var(--color-brand); }   /* [Preserved] legacy behaviour */
.input-wrap > .input { padding-inline-start: 44px; }
```

### 7.3 Card, badge, section heading, page banner

```css
.card { background: var(--color-surface); border: var(--border-width) solid var(--color-border);
        border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-6); }
.card--marketing { border-color: transparent; box-shadow: var(--shadow-md); }
.card--interactive { transition: box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard); }
.card--interactive:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
@media (max-width: 639.98px) { .card { padding: var(--space-5); } }

.badge { display: inline-flex; align-items: center; gap: var(--space-1); height: 24px; padding-inline: 10px;
         border-radius: var(--radius-full); font-size: var(--text-caption); font-weight: var(--font-weight-semibold); }
.badge--neutral { background: var(--color-surface-muted); color: var(--color-neutral-700); }
.badge--success { background: var(--color-success-bg);   color: var(--color-success-text); }
.badge--warning { background: var(--color-warning-bg);   color: var(--color-warning-text); }
.badge--error   { background: var(--color-error-bg);     color: var(--color-error-text); }
.badge--info    { background: var(--color-info-bg);      color: var(--color-info-text); }
.badge--accent  { background: var(--color-accent);       color: var(--color-on-accent); }

/* [Preserved pattern] section heading with orange bar */
.section-heading { display: grid; gap: var(--space-3); justify-items: start; margin-block-end: var(--space-10); }
.section-heading--center { justify-items: center; text-align: center; }
.section-heading__kicker { font-size: var(--text-body-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-brand); }
.section-heading__title  { font-size: var(--text-h2); line-height: var(--leading-h2); font-weight: var(--font-weight-extrabold); }
.section-heading__title::after { content: ""; display: block; width: 56px; height: 6px; margin-block-start: var(--space-3);
                                 background: var(--color-accent); border-radius: var(--radius-full); }
.section-heading--center .section-heading__title::after { margin-inline: auto; }
.section-heading__desc   { font-size: var(--text-body-lg); line-height: var(--leading-body-lg); color: var(--color-text-secondary); max-width: 60ch; }

/* [Preserved pattern] photo banner with green tint */
.page-banner { position: relative; isolation: isolate; min-height: clamp(220px, 30vw, 400px);
               display: grid; place-items: center; color: var(--color-text-inverse); text-align: center; overflow: hidden; }
.page-banner > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
.page-banner::before { content: ""; position: absolute; inset: 0; z-index: -1;
                       background: linear-gradient(to top, rgba(17, 61, 32, 0.75), var(--color-banner-overlay)); }
.page-banner__title { font-size: var(--text-h1); line-height: var(--leading-h1); font-weight: var(--font-weight-extrabold); color: inherit; }
.page-banner__crumbs { font-size: var(--text-body-sm); color: rgba(255, 255, 255, 0.85); }
```

Check every banner photo: the title must reach at least 3:1 (large text) and the breadcrumbs at least 4.5:1. Increase the overlay opacity for very bright images.

### 7.4 Rules for every component

- Use tokens only. Animate only the listed properties (never `transition: all`).
- Define hover, active, `:focus-visible`, disabled, loading and error states where they apply.
- Hit area ≥ 44 × 44 px on touch. Icon-only buttons have an `aria-label` and a tooltip.
- Clickable elements are `<button>` or `<a>`, never a `div` with `onClick`. The legacy app navigated by `.click()`-ing hidden links and used `div` dropdowns.
- Every image has a fixed `aspect-ratio` (or width and height) and `object-fit: cover` / `contain` set explicitly. Legacy doctor images were stretched because `object-fit` was missing.
- Components render correctly in RTL and LTR.

---

## 8. Reusable component recommendations

If the stack is React, build on accessible headless primitives (**Radix UI** or **React Aria Components**) and style them with the tokens. For other frameworks, use their equivalents (e.g. Melt UI, Ark UI). Each row lists the legacy code it replaces, to help with parity checks.

| Group | Component | Key props / notes | Replaces legacy |
|---|---|---|---|
| **Primitives** | `Button` | `variant` (primary, secondary, accent, ghost, danger, danger-outline, inverse, inverse-outline, link), `size` (sm, md, lg), `loading`, `iconStart`, `iconEnd`, `block` | 14+ ad-hoc button styles |
| | `IconButton` | `label` (required, used for aria-label and tooltip), `variant`, `size` | Kebab, close and package-action circles |
| | `Icon` | Lucide wrapper; `directional` prop applies RTL flipping | 14 react-icons sets + IcoFont |
| | `Spinner`, `Badge`, `Avatar`, `Tooltip`, `Divider`, `VisuallyHidden` | | `LoadingCircle`, plain-text statuses |
| | `Card` | `variant` (base, marketing, interactive), `as` | Many per-page card classes |
| **Forms** | `Field` | Label, help, error and optional marker; wires `id`, `aria-describedby`, `aria-invalid` | Placeholder-only fields, `<p>` labels |
| | `Input`, `PasswordInput` (show/hide), `PhoneInput` (`dir="ltr"`, Egyptian mobile validation), `Textarea` | | Sign, profile, contact and dashboard inputs |
| | `Select` (native) and `Listbox` / `Combobox` (custom) | Keyboard and typeahead | `.dropmenu`, `.input-dropmenu` |
| | `Checkbox`, `RadioGroup`, `Switch`, `ChoiceCard` | | Native checkboxes, legacy toggle, doctor cards |
| | `DatePicker`, `TimeSlotPicker` | Disabled dates; Arabic month names with Latin digits | Free-text `d/m/yyyy` + `alert()`; time dropdown |
| | `FileDropzone`, `ImageUploader` (single), `GalleryUploader`, `VideoUploader` | Explicit remove buttons, progress, validation | Hidden file inputs, click-to-delete thumbnails |
| | `TagInput` | Enter to add; removable chips | Blog keyword chips |
| | `FormErrorSummary` | Lists errors and links to the fields | Toast-only validation |
| **Feedback** | `Alert`, `Toast` (provider), `EmptyState`, `Skeleton`, `ProgressBar` (route and upload), `ConfirmDialog` | | react-toastify defaults, 7 empty-state classes, route overlay |
| **Overlays** | `Dialog`, `Sheet` / `Drawer`, `DropdownMenu`, `Popover`, `Lightbox` | Focus trap, Escape, scroll lock | `PopWindow`, `Pop-Package`, `EditPop`, `DeletePop`, `VideoModal`, mobile menu, `react-image-gallery` |
| **Navigation** | `UtilityBar`, `SiteHeader`, `MobileNav`, `SiteFooter`, `WhatsAppFab`, `Breadcrumbs`, `Tabs`, `SegmentedControl`, `Stepper`, `Pagination`, `LoadMore` | | `Intro-Info`, `Header`, `Footer`, profile tabs, ERP rail, `Reservation-Steps` |
| | `AdminShell` (`AdminSidebar` + `AdminTopbar`) | Collapsible sidebar; drawer below lg | Dashboard tile grid, `HeadSystem`, ERP icon rail |
| **Data** | `DataTable` | Columns, sorting, pagination, row actions, responsive stacking below md, empty/loading/error slots | Div tables (black borders, grey rows) |
| | `KpiCard`, `ChartCard` (themed chart wrapper), `DescriptionList` | | ERP statistics, booking summary |
| **Marketing** | `SectionHeading` **[Preserved pattern]** | `kicker`, `title`, `description`, `align` | `.global-headline` |
| | `PageBanner` **[Preserved pattern]** | `image`, `title`, `breadcrumbs` | 7 `*-page-intro` blocks |
| | `Hero` (+ optional `HeroCarousel`) | Slides (bg, portrait, kicker, title, text, CTAs) | `Carousel.js` |
| | `StatsStrip` **[Preserved pattern]** | Items (icon, value, label); count-up once | `Statistics.js` |
| | `ServiceCard`, `SpecializationCard`, `DoctorFeature`, `CredentialList` **[Preserved pattern]**, `IconCircle` **[Preserved pattern]** | | `Services.js`, `Our-Specializations.js`, `Doctor-Profile.js` |
| | `MediaCard` | `type` (article, image, gallery, video), `href`, `date`, `excerpt` | Blog, work and review cards |
| | `ReviewQuote` | Stars (orange), quote, author | `Reviews.js` |
| | `VideoTeaser` + video `Dialog` | Poster, title, lazy video | `VideoMain.js`, `VideoModal.js` |
| | `ContactMethodCard`, `MapEmbed`, `ArticleBody` (prose) | | Contact page, blog detail HTML |

---

## 9. Layouts and page templates

### 9.1 Layouts

| Layout | Composition | Notes |
|---|---|---|
| **PublicLayout** | Skip link → `UtilityBar` (≥ lg) → sticky `SiteHeader` → `<main>` → `SiteFooter` → `WhatsAppFab` | All marketing pages |
| **AuthLayout** | Minimal header (logo plus a back-to-site link) → split card: a form panel and a brand panel (`--color-surface-inverse` with BG-02 network pattern at 15 % opacity and a short brand message) | Sign in, sign up, forgot password. The brand panel is hidden below md. |
| **AccountLayout** | PublicLayout plus a container with `Tabs` (my bookings / profile / password) | Patient profile |
| **AdminLayout** | `AdminSidebar` + `AdminTopbar` + content on `--color-bg-subtle`. **No public header, footer or WhatsApp button.** | Everything under `/dashboard` |

### 9.2 Page templates

The legacy information architecture and section order are preserved where marked. Section specs are in [DESIGN_SYSTEM_PROPOSAL.md §8–§9](DESIGN_SYSTEM_PROPOSAL.md#9-brand-patterns-signature-compositions).

| Page (legacy route) | Composition (top → bottom) |
|---|---|
| **Home** `/` | `Hero` → `StatsStrip` (overlapping the hero) → Services (`SectionHeading` "خدمات مركزنا" + 8 `ServiceCard`) → Specialisations ("تخصصاتنا" + 3 `SpecializationCard`) → `DoctorFeature` (founder) → `VideoTeaser` → Reviews ("آراء عملائنا" + 3 `ReviewQuote`, **from the CMS**) → Recent articles ("أحدث مدوناتنا" + 3 `MediaCard`, **from the CMS**). **[Preserved order]** from legacy `pages/index.js`. |
| **About** `/about` | `PageBanner` ("معلومات عنا", CV-01) → clinic intro (IM-04 photo + "معلومات عن مركزنا" + `CredentialList` of 8 offerings) → Expertise ("خبرتنا" + 4 cards with `IconCircle`, beside IM-05) → optional full logo lockup (BR-03) and team |
| **Contact** `/contact` | `PageBanner` ("تواصل معنا", CV-03) → 3 `ContactMethodCard` (location, email, phones; solid `IconCircle`) in a card overlapping the banner with the BG-01 texture → contact form (IM-06 beside the form, BG-03 background; fields: name, email, phone, subject, message; inline validation) → `MapEmbed` (Google Maps, lazy-loaded) |
| **Articles** `/blogs`, **Previous work** `/previous-work`, **Reviews** `/reviews` | `PageBanner` (CV-02 / CV-05 / CV-04) → optional filter → grid of `MediaCard` → `LoadMore` |
| **Detail** `/blog/[slug]`, `/work/[slug]`, `/review/[slug]`, `/specialization/[slug]` | `PageBanner` (category cover; specialisations use CV-06/07/08) → 2 columns at ≥ lg (content ≈ 70 % at the start + sidebar ≈ 30 % at the end; stacked below lg). Content: cover image / gallery / video, title, meta, `ArticleBody`. Sidebar: related items (thumbnail rows), specialisations, tags (`Badge`). |
| **Sign in / up** `/sign`, `/forgot-password` | AuthLayout. The sign-in / sign-up switch is a `SegmentedControl` or links (not a horizontal slider). Forgot password is a 3-step form with `Stepper` (compact). |
| **Booking** `/reservation` | `Stepper` (choose doctor → details → confirm). Step 1: filters (date picker, booking type, period) as a sidebar at the start (≥ lg) or a top bar below lg, then doctor `ChoiceCard`s with photos. Step 2: `TimeSlotPicker` + optional name and WhatsApp number, with a selected-doctor summary card. Step 3: `DescriptionList` summary + price + confirm. Require sign-in before step 1, or prompt with a dialog; never only a toast. |
| **Profile** `/profile` | AccountLayout → bookings list (cards with date, time, doctor, type `Badge`, status `Badge` upcoming/past, and actions edit/cancel via `DropdownMenu` → `Dialog` / `ConfirmDialog`), profile form, password form |
| **Admin home** `/dashboard` | KPI row (`KpiCard`: today's bookings, unpaid sessions, birthdays, new messages) + quick actions + recent bookings `DataTable`. Navigation lives in the sidebar, which replaces the 23 legacy tiles. Group them as Bookings, Schedule, Doctors, Patients and walk-ins, Finance (ERP), Content (blogs, works, reviews), Messages, Users and permissions, Data export. |
| **Admin list and CRUD pages** | `AdminTopbar` title + toolbar (search, filters, primary action) → `DataTable` → `Pagination`. Create/edit in a page or `Sheet` using `Field` components. Delete through `ConfirmDialog`. |
| **Admin finance (ERP)** | Tabs or sub-nav (statistics, billing, session payments, walk-ins, packages, outgoings) → `KpiCard` + `ChartCard` + `DataTable` with status `Badge`s |
| **404 / 500** | Centred: logo mark, `text-h1` title ("الصفحة غير موجودة"), description, Primary "الصفحة الرئيسية" + Secondary "تواصل معنا" |

---

## 10. Asset references

All paths below are **destination paths** created by [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md). Never reference legacy paths. Alt text is suggested in Arabic. Decorative images use `alt=""`.

| Where | Asset (ID) | Path | Alt text / notes |
|---|---|---|---|
| Header logo | BR-01 | `/assets/branding/logo-primary.png` (or `.svg` when supplied) | `alt="مركز ريهاب للعلاج الطبيعي والتأهيل"`; height 44 px (≥ lg) / 36 px; links to `/` |
| Footer logo | BR-02 | `/assets/branding/logo-reversed.png` | Same alt; only on `--color-surface-inverse` |
| About / print / OG | BR-03 | `/assets/branding/logo-lockup-full.png` | Same alt |
| Favicon and app icons | BR-04 (regenerated) | `/favicon.ico`, `/assets/branding/icon-192.png`, `/assets/branding/icon-512.png`, `/assets/branding/apple-touch-icon.png` | Manifest `theme_color: #309C53`, `background_color: #FFFFFF` |
| Social share image | derived | `/assets/branding/og-image.jpg` (1200×630) | Replaces legacy `bg4.jpg` |
| Hero background | HE-01 (HE-02 optional) | `/assets/images/hero/hero-clinic-1.jpg`, `/assets/images/hero/hero-clinic-2.jpg` | `alt=""` (decorative); `priority` / `fetchpriority="high"` for the first slide only |
| Hero portrait | PE-01 | `/assets/images/team/founder-portrait-cutout.webp` (`.png` fallback) | `alt="د. محمد يحيي جمال الدين، استشاري العلاج الطبيعي"` |
| Hero alt slides / doctor section | PE-02, PE-03 | `/assets/images/team/founder-white-coat.jpg`, `/assets/images/team/founder-shirt-tie.jpg` | Same alt pattern |
| Stats strip texture | BG-01 | `/assets/backgrounds/world-map-dots.png` | CSS background (decorative) |
| Specialisation cards | IM-01, IM-02, IM-03 | `/assets/images/specializations/orthopedics-spine.jpg`, `…/neuro-paralysis.jpg`, `…/obesity-body-shaping.webp` | Alt = specialisation title |
| Specialisation banners | CV-06, CV-07, CV-08 | `/assets/images/covers/specialization-orthopedics-spine.jpg`, `…-neuro-paralysis.jpg`, `…-obesity-body-shaping.jpg` | Map by **meaning**, not by legacy file number |
| Doctor section watermark | IL-01 | `/assets/illustrations/stethoscope-heart.png` | `alt=""`, static (no animation) |
| Video teaser | MD-01, MD-02 | `/assets/video/clinic-intro.mp4`, `/assets/video/clinic-intro-poster.jpg` | Poster only if approved (see the migration guide). Captions or a transcript are recommended. |
| About banner / intro / expertise | CV-01, IM-04, IM-05 | `/assets/images/covers/about.jpg`, `/assets/images/clinic/reception-desk.jpg`, `/assets/images/about/expertise.jpg` | IM-04 alt: "استقبال مركز ريهاب للعلاج الطبيعي" |
| Contact banner / form image / form background | CV-03, IM-06, BG-03 | `/assets/images/covers/contact.jpg`, `/assets/images/contact/contact-form.jpg`, `/assets/backgrounds/network-pattern-light.png` | Form background is a CSS background |
| Articles / work / reviews banners | CV-02, CV-05, CV-04 | `/assets/images/covers/blog.jpg`, `/assets/images/covers/previous-work.webp`, `/assets/images/covers/reviews.jpg` | `alt=""` (the title is in the banner text) |
| Auth brand panel | BG-02 | `/assets/backgrounds/network-pattern.png` | Decorative, about 15 % opacity on green |
| CMS media (articles, doctors, reviews, works) | UP-01…04 | URLs returned by the new API | Never `/api/getImage?...` (legacy) |

Image delivery:
- Use the framework image component (or `srcset` + `sizes`) with modern formats.
- Lazy-load below the fold. Only the first hero image is high priority.
- Always set `aspect-ratio` or width and height.

---

## 11. Responsive guidelines

**Breakpoints** (mobile-first `min-width`): `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`. There are no other breakpoints. Type scales fluidly through the `clamp()` tokens, so font sizes never need breakpoint overrides.

| Section | < 640 | ≥ 640 (sm) | ≥ 768 (md) | ≥ 1024 (lg) | ≥ 1280 (xl) |
|---|---|---|---|---|---|
| Header | Logo + menu button; drawer | same | same | Full nav + CTAs; utility bar shown | same |
| Hero | 1 column, centred text, portrait hidden or small | same | same | 2 columns (text at the start, portrait at the end) | same |
| Stats strip | 2 columns (last item spans 2) | 3 columns | 3 columns | 5 columns | same |
| Services grid | 1 column | 2 | 2 | 3 | 4 |
| Specialisations | 1 | 1 | 2 | 3 | 3 |
| Media cards (articles, work, reviews) | 1 | 2 | 2 | 3 | 3 |
| Doctor feature | Stacked (image then text) | same | same | 2 columns | same |
| Detail page | Stacked (content, then sidebar) | same | same | Content + sidebar | same |
| Contact methods | 1 | 1 | 3 | 3 | 3 |
| Contact form | Fields stacked; image hidden | 2-column field pairs | same | Image beside the form | same |
| Footer | 1 column | 2 | 2 | 4 | 4 |
| Booking filters | Top bar (collapsible) | same | same | Sidebar at the start | same |
| Booking doctor cards | 1 column, compact (photo 64 px) | same | 2 columns | same | same |
| Admin sidebar | Drawer | Drawer | Drawer | Expanded (collapsible to rail) | same |
| Data tables | Stacked cards | Stacked cards | Table | Table | Table |
| Dialogs | Bottom sheet | Centred | Centred | Centred | same |

Rules:
- Grid recipe for card lists: `display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));`. Use explicit column counts where the table above requires them.
- Containers: `.container` (1280 px max) for content; `.container-wide` (1440 px) for the header, footer and hero inner. Full-bleed backgrounds sit outside containers.
- Never shrink text below the token sizes on small screens. Reflow instead.
- Touch targets ≥ 44 px. Keep 8 px or more between adjacent targets.
- Images: provide `sizes` that match the grid. For example, a media card is `(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw`.
- Test at 360, 390, 768, 1024, 1280, 1440 and 1920 px, in both RTL and LTR, and at 200 % browser zoom (WCAG 1.4.4 / 1.4.10 reflow at 320 px CSS width).

---

## 12. Content, copy and configuration

### 12.1 Brand and contact data **[Verified legacy values]**

Store these in configuration or the CMS, not in markup.

| Key | Value | Legacy source |
|---|---|---|
| Site name (ar) | مركز ريهاب للعلاج الطبيعي والتأهيل | `next-seo.config.js:2` |
| Domain | `https://rehabeg.clinic` (canonical `https://www.rehabeg.clinic/`) | `next-seo.config.js:7,38` |
| Email | support@rehabeg.clinic | `Components/Footer.js:21` |
| Phones | +20 1204515349 · +20 1507110041 · +20 1066205166 · +20 1125902099 | `Components/Footer.js:23-26` |
| Address | السادس من اكتوبر - المحور المركزي - جولدن مول - اعلى مطعم رسلان وصيدليات مصر | `Components/Footer.js:22` |
| WhatsApp | https://www.wa.link/mtmbq6 | `Layouts/Layout.js:23` |
| Facebook / Instagram / TikTok | `rehabclinic11` on each platform | `Components/Footer.js:29-31` |
| Founder | د. محمد يحيي جمال الدين – استشاري العلاج الطبيعي - دكتوراه علاج طبيعي وتأهيل | `Components/Landing/Doctor-Profile.js:29-30` |
| Statistics | 7 beds · +160,000 sessions · +20,000 clients · 10 doctors · 21 years | `Components/Landing/Statistics.js:37-41` |
| Services (8) | نُخبة من الأطباء · التشخيص · الرعاية الصحية · الأجهزة المتقدمة · التأهيل · جلسات استشفاء · جلسات اون لاين · الأنظمة الغذائية | `Components/Landing/Services.js` |
| Specialisations (3) | تأهيل حالات العظام والعمود الفقري · تأهيل حالات الأعصاب والشلل بأنواعه · قسم السمنة وتنسيق القوام | `Components/Landing/Our-Specializations.js` |
| Hero titles | أفضل حل للحياة المؤلمة · نعيد تأهيلك لحياة أفضل · تعافيك هي أولويتنا | `Components/Landing/Carousel.js:41,69,98` |
| Legacy nav order (reading right to left) | الرئيسية · تواصل معنا · مدوناتنا · سابقة اعمالنا · اراء عملائنا · معلومات عنا | `Components/Header.js:69-74` (DOM was reversed) |

[Recommendation] Nav order: الرئيسية · معلومات عنا · التخصصات · سابقة أعمالنا · آراء عملائنا · المدونة · تواصل معنا. This gives a conventional order and adds the specialisations, which had no menu entry.

Analytics and pixels exist in legacy (`pages/_app.js:67-81`, `pages/_document.js`: GA4, Google Ads, GTM, Meta Pixel). They are not visual, but the new build should carry them over through a consent-aware tag manager.

### 12.2 Copy corrections **[Recommendation]**

These are verified spelling slips in the legacy UI strings.

| Legacy string | Location | Corrected |
|---|---|---|
| احجز الأن | `Components/Header.js:80`, `Carousel.js:47` | **احجز الآن** |
| اقرأ المذيد / اعرض المذيد / المذيد | `Recent-Blogs.js:36`, `pages/blogs.js:118`, dashboard | **اقرأ المزيد / عرض المزيد / المزيد** |
| إرسل | `pages/contact.js:168` | **أرسل** |
| اراء عملائنا | `Components/Header.js:70` | **آراء عملائنا** |
| سابقة اعمالنا | `Components/Header.js:71` | **سابقة أعمالنا** |
| © 2024 (hard-coded) | `Components/Footer.js:52` | Current year, computed |

---

## 13. Legacy anti-patterns: do not reproduce

| # | Legacy pattern | Do instead |
|---|---|---|
| 1 | `<html lang="en">` with RTL faked by `row-reverse` and `text-align: right` | `lang="ar" dir="rtl"` + logical properties (§6) |
| 2 | Desktop-first, zoom-level breakpoints (2048/1921/1707/1537) and 44 ad-hoc breakpoints | 5 mobile-first breakpoints + fluid type (§11) |
| 3 | Text at 8–11 px; no `line-height` | Type tokens; body 16 px / 1.75 |
| 4 | `outline: none` globally; no focus states | `:focus-visible` ring everywhere (§4) |
| 5 | Literal `font-family: 'Noto Kufi Arabic'` on controls (bypasses the font loader) | `font: inherit` + `--font-sans` |
| 6 | White text on `#309C53` (3.5:1); orange text on white (2.2:1) | `--color-primary` (#278545) for white text; dark text on orange |
| 7 | 30+ hard-coded greys, 3 reds, 3 hover greens | Role tokens only |
| 8 | `div` dropdowns, `div` tables, hidden-link `.click()` navigation | Semantic elements and accessible primitives |
| 9 | Native `alert()` validation; toast-only form errors | Inline field errors + error summary |
| 10 | Destructive actions without confirmation | `ConfirmDialog` |
| 11 | Click a thumbnail to delete it | An explicit remove button |
| 12 | Full-screen green overlay on every route change | Thin top progress bar |
| 13 | Infinite floating animations; `transition: .3s all linear` | Static decoration; tokenised transitions; reduced-motion support |
| 14 | `<Image fill>` without `object-fit` (stretched photos) | Explicit `aspect-ratio` + `object-fit` |
| 15 | 14 icon sets + an icon font | Lucide + Simple Icons |
| 16 | Admin rendered inside the public header, footer and WhatsApp chrome | `AdminLayout` |
| 17 | Hard-coded landing blogs and reviews; hard-coded copyright year | CMS data; a computed year |
| 18 | 16 MB PNGs, 5000 px JPEGs served raw | Optimised assets (migration guide §4) |
| 19 | Search firing on every keystroke | 300 ms debounce |
| 20 | Endless spinners when a request fails | Error state with retry |

---

## 14. QA checklist (definition of done)

**Brand fidelity**
- [ ] Logo (BR-01 / BR-02) is used unmodified: no recolouring, no stretching, clear space ≥ the height of the orange head dot.
- [ ] Brand green `#309C53` and orange `#F89A3A` appear as specified; orange is never body text.
- [ ] Noto Kufi Arabic renders on every element, **including inputs, buttons and toasts**. Check in DevTools under Computed → Rendered Fonts.
- [ ] Signature patterns are present: section heading with orange bar, green-tinted page banners, stats strip, green icon circles, orange stars and bullets, founder in the hero, WhatsApp button.

**Accessibility**
- [ ] Axe or Lighthouse: 0 serious or critical violations on every template.
- [ ] Everything works with the keyboard; focus is always visible; dialogs trap focus and close on Escape.
- [ ] Contrast meets AA (the token pairs in the proposal comply when used as specified).
- [ ] Every form control has a label; errors are inline and announced.
- [ ] `prefers-reduced-motion` disables decorative motion.

**RTL / LTR**
- [ ] `<html lang="ar" dir="rtl">`; no `row-reverse` used for direction; directional icons mirror.
- [ ] Phones, emails and prices render correctly (`bdi` / `.ltr`); digits are Western.
- [ ] Switching to `dir="ltr"` produces a correct mirrored layout.

**Responsive and performance**
- [ ] Layouts verified at 360 / 768 / 1024 / 1280 / 1920 px; no horizontal scroll; no text under 12 px.
- [ ] LCP image (hero) ≤ 450 kB and prioritised; all other images lazy-loaded with set dimensions.
- [ ] No legacy asset paths or `/api/getImage` URLs in the codebase.

**Consistency**
- [ ] No hard-coded colours, sizes, radii or shadows outside `tokens.css` (lint with stylelint `declaration-strict-value` or the Tailwind theme).
- [ ] Every interactive component has hover, active, focus-visible, disabled and loading states.
- [ ] One component per pattern (one Button, one Dialog, one Table, …).
