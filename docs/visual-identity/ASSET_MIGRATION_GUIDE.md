# Asset Migration Guide: legacy Rehab → new frontend

| | |
|---|---|
| **Purpose** | Exactly which assets to transfer into the new repository, where each goes, and what preparation each needs |
| **Inputs** | Asset IDs and facts from [ASSET_INVENTORY.md](ASSET_INVENTORY.md) |
| **Used by** | [FRONTEND_IMPLEMENTATION_GUIDE.md](FRONTEND_IMPLEMENTATION_GUIDE.md) (asset references use the destination paths defined here) |
| **Date** | 2026-11-07 |

---

## 1. Ground rules

1. **The legacy repository is read-only.** Copy files out of it; never move, rename, edit or delete anything inside it.
2. **Do not assume legacy paths exist in the new repository.** Every asset gets a new, meaningful destination path, listed in §3. Code in the new repository must reference only the destination paths.
3. **Copy only what is listed.** Files not listed in §3, and files listed under "Do not migrate" in §3.4, stay behind. A file existing in `public/` does not mean it is used (see [ASSET_INVENTORY.md §9](ASSET_INVENTORY.md#9-unused-assets-separate-list)).
4. **Two stages:**
   - **Stage A**, done by a person with access to both repositories: copy the original files byte for byte into a staging folder in the new repo (§5).
   - **Stage B**, which an agent can do inside the new repo: produce optimised web assets from the staged originals into the web root (§4).
5. The destination layout assumes the new project serves static files from a folder named `public/`. Next.js, Vite, Astro, Remix and CRA all do this by convention. If the new stack uses another static root, keep the same sub-tree (`assets/…`) under that root and adjust only the prefix. `design-source/` is a non-served folder for originals; any name outside the web root works.

---

## 2. Target directory structure

```
<new-repo>/
├── design-source/                      # NOT served. Originals and masters, kept for provenance.
│   └── legacy-import/                  # Stage A output: byte-identical copies, original filenames
│
└── public/                             # Web root (served at "/")
    ├── favicon.ico                     # BR-04 (regenerated)
    ├── googleccfbb267ac4290cb.html     # OT-03 (copied unchanged; Google Search Console)
    ├── robots.txt                      # OT-01 (new, written for the new site)
    └── assets/
        ├── branding/
        │   ├── logo-primary.png        # BR-01
        │   ├── logo-primary.svg        # BR-01 vector (only when supplied by the brand owner)
        │   ├── logo-reversed.png       # BR-02
        │   ├── logo-lockup-full.png    # BR-03
        │   ├── apple-touch-icon.png    # derived from BR-01 mark, 180×180
        │   ├── icon-192.png            # derived, 192×192
        │   ├── icon-512.png            # derived, 512×512 (maskable-safe)
        │   ├── icon.svg                # derived vector mark (only if the vector master is supplied)
        │   └── og-image.jpg            # derived, 1200×630
        ├── images/
        │   ├── hero/
        │   │   ├── hero-clinic-1.jpg   # HE-01
        │   │   └── hero-clinic-2.jpg   # HE-02 (optional)
        │   ├── covers/
        │   │   ├── about.jpg                               # CV-01
        │   │   ├── blog.jpg                                # CV-02
        │   │   ├── contact.jpg                             # CV-03
        │   │   ├── reviews.jpg                             # CV-04
        │   │   ├── previous-work.webp                      # CV-05
        │   │   ├── specialization-orthopedics-spine.jpg    # CV-06
        │   │   ├── specialization-neuro-paralysis.jpg      # CV-07
        │   │   └── specialization-obesity-body-shaping.jpg # CV-08
        │   ├── specializations/
        │   │   ├── orthopedics-spine.jpg       # IM-01
        │   │   ├── neuro-paralysis.jpg         # IM-02
        │   │   └── obesity-body-shaping.webp   # IM-03
        │   ├── clinic/
        │   │   └── reception-desk.jpg          # IM-04
        │   ├── about/
        │   │   └── expertise.jpg               # IM-05
        │   ├── contact/
        │   │   └── contact-form.jpg            # IM-06
        │   └── team/
        │       ├── founder-portrait-cutout.webp   # PE-01 (re-created from PE-04)
        │       ├── founder-portrait-cutout.png    # PE-01 fallback (same cut-out)
        │       ├── founder-white-coat.jpg         # PE-02
        │       ├── founder-shirt-tie.jpg          # PE-03
        │       ├── founder-white-coat-light.jpg   # PE-05 (optional)
        │       └── founder-blazer-outdoor.jpg     # PE-07 (optional)
        ├── backgrounds/
        │   ├── world-map-dots.png          # BG-01
        │   ├── network-pattern.png         # BG-02
        │   └── network-pattern-light.png   # BG-03
        ├── illustrations/
        │   └── stethoscope-heart.png       # IL-01
        └── video/
            ├── clinic-intro.mp4            # MD-01
            └── clinic-intro-poster.jpg     # MD-02 (only if the client approves the "TAAHEEL" signage)
```

There is no `fonts/` or `icons/` folder because none are needed:
- Fonts load through the framework's font loader or Google Fonts (§6).
- Icons come from npm packages (§6).

If the project must self-host fonts without a loader, add `public/assets/fonts/noto-kufi-arabic/` and `public/assets/fonts/inter/` with files downloaded from Google Fonts. Those files are not in the legacy repo.

---

## 3. Migration table

Column meanings:
- **Keep original** means the staged file in `design-source/legacy-import/` stays byte-identical.
- **Web output** is what is placed in `public/`.
- Sizes and dimensions of originals are listed in [ASSET_INVENTORY.md](ASSET_INVENTORY.md).

### 3.1 Tier 1: must migrate

| ID | Original path (legacy) | Destination (new repo) | Keep original? | Preparation / conversion | Dependencies, licensing, notes |
|---|---|---|---|---|---|
| BR-01 | `public/logo-header.png` | `public/assets/branding/logo-primary.png` | Yes | **Copy unchanged** (1851×1486 transparent PNG). Let the framework's image component resize it. Without one, also export 480 px and 960 px wide versions. | Clinic-owned mark. **Request an SVG master** from the brand owner and save it as `logo-primary.svg`. |
| BR-02 | `public/footer-logo.png` | `public/assets/branding/logo-reversed.png` | Yes | Copy unchanged | For dark or green backgrounds only (the white parts disappear on white) |
| BR-04 | `public/favicon.ico` | `public/favicon.ico` (**new file**) | Yes (reference only) | **Regenerate** (§4.3). Do not ship the legacy 256×206 single-image ICO. | Derived from the BR-01 person mark |
| HE-01 | `public/bg2.jpg` | `public/assets/images/hero/hero-clinic-1.jpg` | Yes | Resize to 2560 px wide; JPEG q80 progressive; strip metadata. Target ≤ 450 kB. | Stock photo, **licence unverified**. Confirm or replace with clinic photography. |
| CV-01 | `public/about-cover.png` | `public/assets/images/covers/about.jpg` | Yes | PNG → JPEG q82 at native 1381 px width (do not upscale) | Real clinic photo (owned) |
| CV-02 | `public/blog-cover.png` | `public/assets/images/covers/blog.jpg` | Yes | PNG → JPEG q80, resize to 1920 px wide | Stock, licence unverified |
| CV-03 | `public/contact-cover.png` | `public/assets/images/covers/contact.jpg` | Yes | PNG → JPEG q80 at native 1440 px | Stock, licence unverified |
| CV-04 | `public/reviews-cover.png` | `public/assets/images/covers/reviews.jpg` | Yes | PNG → JPEG q80 at native 1440 px | Stock, licence unverified |
| CV-05 | `public/previous-work-cover.webp` | `public/assets/images/covers/previous-work.webp` | Yes | Copy unchanged (already WebP, 55 kB) | Stock, licence unverified |
| CV-06 | `public/specialization-1-cover.png` | `public/assets/images/covers/specialization-orthopedics-spine.jpg` | Yes | PNG → JPEG q80 (RGBA is opaque; flatten on white) | Stock, licence unverified |
| CV-07 | **`public/specialization-3-cover.png`** | `public/assets/images/covers/specialization-neuro-paralysis.jpg` | Yes | PNG → JPEG q80 | **The "3" file belongs to the neuro page** (`[specialization].js:179`) |
| CV-08 | **`public/specialization-2-cover.png`** | `public/assets/images/covers/specialization-obesity-body-shaping.jpg` | Yes | PNG → JPEG q80 (flatten RGBA) | **The "2" file belongs to the obesity page** (`[specialization].js:180`) |
| IM-01 | `public/specialization1.png` | `public/assets/images/specializations/orthopedics-spine.jpg` | Yes | PNG → JPEG q80 at 1024 px | Stock, licence unverified |
| IM-02 | `public/specialization2.jpg` | `public/assets/images/specializations/neuro-paralysis.jpg` | Yes | Copy unchanged (89 kB) | Stock, licence unverified |
| IM-03 | `public/specialization3.webp` | `public/assets/images/specializations/obesity-body-shaping.webp` | Yes | Copy unchanged (43 kB) | Low quality (video still). A replacement is recommended. |
| IM-04 | `public/about-pic.png` | `public/assets/images/clinic/reception-desk.jpg` | Yes | PNG → JPEG q82 at native 1316 px | Real clinic photo (owned). Also the recommended source for `og-image.jpg`. |
| PE-01 | `public/doc-mohamed.png` (current) / **source: `public/doctor-profile-1.jpg` (PE-04)** | `public/assets/images/team/founder-portrait-cutout.webp` + `.png` fallback | Yes (both) | **Re-create** (§4.2). The legacy cut-out has background artefacts and is 16.4 MB. | Photo of a real person. Confirm consent for continued use. |
| PE-02 | `public/doc-mohamed-2.png` | `public/assets/images/team/founder-white-coat.jpg` | Yes | PNG → JPEG q82 (opaque content), keep 798×1492 | Real person, consent |
| PE-03 | `public/new-doctor.png` | `public/assets/images/team/founder-shirt-tie.jpg` | Yes | PNG → JPEG q82, keep 595×992 | Real person, consent |
| PE-04 | `public/doctor-profile-1.jpg` | `design-source/legacy-import/doctor-profile-1.jpg` **only** (not served) | Yes | None. It is the master for PE-01. | Professional photo (Canon 5D Mk III). Confirm usage rights with the photographer or the clinic. |
| BG-01 | `public/dots.png` | `public/assets/backgrounds/world-map-dots.png` | Yes | Lossless PNG optimisation (e.g. `oxipng -o 4`) | No licence information. Generic map graphic. |
| OT-03 | `public/googleccfbb267ac4290cb.html` | `public/googleccfbb267ac4290cb.html` | Yes | **Copy unchanged**, same filename, served at the site root | Needed to keep Google Search Console verification for `rehabeg.clinic` |

### 3.2 Tier 2: should migrate (used by the redesigned pages)

| ID | Original path (legacy) | Destination (new repo) | Keep original? | Preparation / conversion | Dependencies, licensing, notes |
|---|---|---|---|---|---|
| BR-03 | `public/logo.png` | `public/assets/branding/logo-lockup-full.png` | Yes | Copy unchanged | Currently unused. Full lockup for the About page, print and the OG image. |
| MD-01 | `public/video.mp4` | `public/assets/video/clinic-intro.mp4` (or an external video host) | Yes | Re-encode (§4.5) to ≤ 10 MB with `+faststart` | Clinic-owned content. If it contains background music, confirm the music licence. |
| IM-05 | `public/about-wall.png` | `public/assets/images/about/expertise.jpg` | Yes | PNG → JPEG q80 | Stock, licence unverified |
| IM-06 | `public/contact-message.png` | `public/assets/images/contact/contact-form.jpg` | Yes | PNG → JPEG q80, resize to 1200 px wide | Stock, licence unverified |
| BG-02 | `public/sign-cover.png` | `public/assets/backgrounds/network-pattern.png` | Yes | Lossless PNG optimisation; keep transparency | Decorative |
| BG-03 | `public/contact.png` | `public/assets/backgrounds/network-pattern-light.png` | Yes | Lossless PNG optimisation | Decorative |
| IL-01 | `public/tool.png` | `public/assets/illustrations/stethoscope-heart.png` | Yes | Lossless optimisation. An SVG redraw in `--color-neutral-200` is optional. | Decorative |

### 3.3 Tier 3: optional or conditional

| ID | Original path (legacy) | Destination (new repo) | Condition | Preparation |
|---|---|---|---|---|
| HE-02 | `public/bg1.jpg` | `public/assets/images/hero/hero-clinic-2.jpg` | Only if a multi-slide hero is kept. It is from the same stock series as HE-03 (licence unverified). | Resize to 2560 px; JPEG q80 (source is 5 MB) |
| MD-02 | `public/poster.png` | `public/assets/video/clinic-intro-poster.jpg` | **Only if the client approves the "TAAHEEL" wordmark** visible in it. Otherwise extract a new poster frame from MD-01. | PNG → JPEG q80 at 1920 px |
| PE-05 | `public/doctor-profile.jpg` | `public/assets/images/team/founder-white-coat-light.jpg` | If a light-background team portrait is needed | Copy unchanged (76 kB) |
| PE-07 | `public/new-doctor2.png` | `public/assets/images/team/founder-blazer-outdoor.jpg` | If an extra founder photo is needed | PNG → JPEG q82 |

### 3.4 Do not migrate

| ID | Original path | Reason |
|---|---|---|
| HE-03 | `public/bg4.jpg` | Shows a third-party clinic logo ("physio.co.uk") on clothing. It is the current OG image; replace it (§4.4). |
| PE-06 | `public/doc-mohamed-3.png` | Never rendered; 14.5 MB; same background artefacts as PE-01 |
| PE-08 | `public/doc2.png` | Only used by a component that is never mounted. Doctors should come from the CMS (UP-02). |
| IM-07, IM-08, IM-09 | `public/blog1.jpg`, `blog2.jpg`, `blog3.webp` | Byte-identical duplicates of CMS blog images. Recent posts must be fetched from the CMS. |
| MD-03 | `public/message.mp3` | Belongs to a chat widget that was never mounted. Copy it only if a chat feature is built. |
| OT-01 | `public/robots.txt` | Write a new one (the legacy file contains a meaningless `Allow: /public/`). |
| OT-02 | `public/sitemap.xml` | Static and outdated (2024). Generate one from routes and CMS content. |
| FN-03 | `styles/icofont/**` | Replaced by an SVG icon library (§6) |
| IC-03 | `utils/svg/user-chat-svg.js` | Dead chat feature |
| n/a | `_feature_proposal.html`, `_review_deliverable.html` (repo root) | Report documents with their own unrelated palette. Not part of the app. |
| UP-01…04 | `uploads/**` | CMS content. Migrate it with the backend (§7), not as frontend assets. |

---

## 4. Preparation specifications (Stage B)

### 4.1 General image rules

| Category | Max dimensions | Format (shipped) | Quality / target size |
|---|---|---|---|
| Hero backgrounds | 2560 px wide | JPEG progressive (the framework can add AVIF/WebP variants) | q80, ≤ 450 kB |
| Page covers | 1920 px wide (never upscale; 1440 px sources stay 1440) | JPEG | q80, ≤ 250 kB |
| Content and section photos | 1600 px longest edge | JPEG (WebP sources stay WebP) | q80, ≤ 200 kB |
| Team photos (opaque) | 1600 px tall | JPEG | q82, ≤ 250 kB |
| Cut-out portrait (transparent) | 1600 px tall | WebP with alpha + PNG fallback | WebP q85, ≤ 300 kB |
| Logos | Native | PNG unchanged (SVG when available) | n/a |
| Patterns and illustrations | Native | PNG, losslessly optimised | n/a |

- Strip EXIF and GPS metadata from shipped files (`-strip`), except colour profiles. Convert to sRGB.
- Opaque PNGs with an unused alpha channel (PE-02, PE-03, PE-07, CV-06, CV-08) should be flattened on white before JPEG export.
- Example commands, using ImageMagick 7 (`magick`), Google `cwebp` and `oxipng`. Any equivalent tool is fine:

```bash
# Hero (resize + JPEG)
magick design-source/legacy-import/bg2.jpg -resize 2560x\> -strip -colorspace sRGB \
  -interlace Plane -quality 80 public/assets/images/hero/hero-clinic-1.jpg

# PNG cover → JPEG (flatten alpha, no upscaling)
magick design-source/legacy-import/specialization-3-cover.png -background white -flatten \
  -resize 1920x\> -strip -quality 80 public/assets/images/covers/specialization-neuro-paralysis.jpg

# Lossless PNG optimisation (patterns)
cp design-source/legacy-import/dots.png public/assets/backgrounds/world-map-dots.png
oxipng -o 4 --strip safe public/assets/backgrounds/world-map-dots.png
```

### 4.2 Founder portrait re-cut (PE-01) — designer or tool task

- **Source:** `design-source/legacy-import/doctor-profile-1.jpg` (3042×4564, clean studio-quality original).
- **Task:** remove the background cleanly around the hair, beard and blazer edges. Do not posterise. Leave no rectangles or remnants. The legacy `doc-mohamed.png` shows both problems.
- **Framing:** knees-up or waist-up, centred, with about 4 % padding above the head. The bottom edge may crop the body; it is bottom-anchored in the hero.
- **Output:**
  - `founder-portrait-cutout.png`: transparent, 1600 px tall
  - `founder-portrait-cutout.webp`: same image, alpha, q85
- **Fallback:** if a clean re-cut is not available at launch, use PE-02 (`founder-white-coat.jpg`) inside a rounded frame instead of a cut-out.

### 4.3 Favicon and app icons

The logo's **person mark** (green swoosh with an orange head, at the top right of BR-01) is the most legible element at small sizes. It is **not** available as a separate file, so a designer must crop it or (better) take it from the vector master.

| File | Size | Spec |
|---|---|---|
| `public/favicon.ico` | 16, 32, 48 px entries | Person mark only, transparent background |
| `public/assets/branding/icon-192.png` | 192×192 | Person mark on white, about 10 % padding |
| `public/assets/branding/icon-512.png` | 512×512 | Person mark on white, inside the maskable safe zone (central 80 %) |
| `public/assets/branding/apple-touch-icon.png` | 180×180 | Person mark on white (iOS adds its own rounding) |
| `public/assets/branding/icon.svg` (optional) | vector | Only if the vector master is supplied |

Theme colour for the web manifest and browser UI: `#309C53` (`--color-brand`).

### 4.4 Open Graph image

- **Replace** the legacy `og:image` (HE-03 `bg4.jpg`, which shows third-party branding).
- Create `public/assets/branding/og-image.jpg` at 1200×630, JPEG q85:
  - Background: IM-04 (`reception-desk.jpg`) cropped to 1200×630.
  - A `rgba(17,61,32,0.55)` green overlay.
  - The reversed logo (BR-02) at about 220 px tall on the start side.
  - Optional Arabic site name in Noto Kufi Arabic 800, white.
- Simple fallback: BR-03 (full lockup) centred on white at 1200×630.

### 4.5 Video (MD-01)

```bash
ffmpeg -i design-source/legacy-import/video.mp4 -c:v libx264 -profile:v high -preset slow \
  -crf 26 -vf "scale=1280:-2" -c:a aac -b:a 128k -movflags +faststart \
  public/assets/video/clinic-intro.mp4
```
- Target ≤ 10 MB (the source is 17.6 MB, 1280×720, 158 s).
- Preload `none` or `metadata`. Load it only when the user opens the video. The legacy code also mounted the player only on click.
- **Better:** host it on a video platform or CDN and embed it (no autoplay with sound).
- Poster: MD-02 only if approved (§3.3). Otherwise extract a frame:
  `ffmpeg -ss 5 -i …/video.mp4 -frames:v 1 -q:v 3 public/assets/video/clinic-intro-poster.jpg`

---

## 5. Stage A: copy originals out of the legacy repository

Run this from a machine that has both repositories. It **only copies**; it never touches or modifies the legacy repo. Set the two variables first.

### 5.1 Bash (macOS / Linux / Git Bash)

```bash
OLD_REPO="/c/Users/Abdulrahman/Downloads/rehab/rehab"   # legacy repo (read-only)
NEW_REPO="/path/to/new/frontend"                        # new repo root
STAGE="$NEW_REPO/design-source/legacy-import"
mkdir -p "$STAGE"

FILES=(
  # Tier 1
  logo-header.png footer-logo.png favicon.ico bg2.jpg
  about-cover.png blog-cover.png contact-cover.png reviews-cover.png previous-work-cover.webp
  specialization-1-cover.png specialization-2-cover.png specialization-3-cover.png
  specialization1.png specialization2.jpg specialization3.webp
  about-pic.png doc-mohamed.png doctor-profile-1.jpg doc-mohamed-2.png new-doctor.png
  dots.png googleccfbb267ac4290cb.html
  # Tier 2
  logo.png video.mp4 about-wall.png contact-message.png sign-cover.png contact.png tool.png
  # Tier 3 (optional; remove lines you don't need)
  bg1.jpg poster.png doctor-profile.jpg new-doctor2.png
)

for f in "${FILES[@]}"; do
  cp -p "$OLD_REPO/public/$f" "$STAGE/$f" || echo "MISSING: $f"
done

# Verify byte-identical copies
( cd "$OLD_REPO/public" && md5sum "${FILES[@]}" ) > /tmp/old.md5
( cd "$STAGE" && md5sum "${FILES[@]}" ) > /tmp/new.md5
diff /tmp/old.md5 /tmp/new.md5 && echo "All copies verified"
```

### 5.2 PowerShell (Windows)

```powershell
$OldRepo = 'C:\Users\Abdulrahman\Downloads\rehab\rehab'   # legacy repo (read-only)
$NewRepo = 'D:\path\to\new\frontend'                      # new repo root
$Stage   = Join-Path $NewRepo 'design-source\legacy-import'
New-Item -ItemType Directory -Force $Stage | Out-Null

$Files = @(
  'logo-header.png','footer-logo.png','favicon.ico','bg2.jpg',
  'about-cover.png','blog-cover.png','contact-cover.png','reviews-cover.png','previous-work-cover.webp',
  'specialization-1-cover.png','specialization-2-cover.png','specialization-3-cover.png',
  'specialization1.png','specialization2.jpg','specialization3.webp',
  'about-pic.png','doc-mohamed.png','doctor-profile-1.jpg','doc-mohamed-2.png','new-doctor.png',
  'dots.png','googleccfbb267ac4290cb.html',
  'logo.png','video.mp4','about-wall.png','contact-message.png','sign-cover.png','contact.png','tool.png',
  'bg1.jpg','poster.png','doctor-profile.jpg','new-doctor2.png'   # optional tier 3
)

foreach ($f in $Files) {
  $src = Join-Path $OldRepo "public\$f"
  if (Test-Path $src) { Copy-Item $src (Join-Path $Stage $f) }
  else { Write-Warning "MISSING: $f" }
}

# Verify byte-identical copies
foreach ($f in $Files) {
  $a = (Get-FileHash (Join-Path $OldRepo "public\$f")).Hash
  $b = (Get-FileHash (Join-Path $Stage $f)).Hash
  if ($a -ne $b) { Write-Warning "HASH MISMATCH: $f" }
}
```

After Stage A, the new repository contains everything it needs. **The agent working in the new repo does not need the legacy repo.**

`design-source/legacy-import/` holds 64.1 MB of originals (33 files, including all optional ones). Decide whether to commit it, store it with Git LFS, or keep it outside version control. It is not served to users either way.

---

## 6. Fonts and icons (no files to copy)

| Item | Action in the new repo | Licence |
|---|---|---|
| **Noto Kufi Arabic** (FN-01) | Load through the framework font loader (e.g. `next/font/google`) or `@fontsource/noto-kufi-arabic`, weights 400/500/600/700/800, subsets `arabic` + `latin`. See [FRONTEND_IMPLEMENTATION_GUIDE.md §3](FRONTEND_IMPLEMENTATION_GUIDE.md#3-font-configuration). | SIL OFL 1.1 (free to self-host) |
| **Inter** (FN-02) | Same loader, weights 400/500/600/700, subset `latin` | SIL OFL 1.1 |
| **UI icons** | Install `lucide-react` (or the Lucide package for your framework). IcoFont replacements are in [DESIGN_SYSTEM_PROPOSAL.md §6](DESIGN_SYSTEM_PROPOSAL.md#6-iconography). | ISC |
| **Social logos** | Install `simple-icons` (or copy the 4 SVG paths: WhatsApp, Facebook, Instagram, TikTok) | CC0 icon data. The trademarks belong to their owners; follow each brand's usage guidelines. |
| IcoFont (FN-03), react-icons | **Do not install or copy** | n/a |

---

## 7. CMS-uploaded media (not a frontend asset)

`uploads/blogs`, `uploads/doctors`, `uploads/reviews` and `uploads/works` (109 files, 966 MB) are **content**. They belong to the backend and content migration:

- Move them to the new storage (object storage or CDN) together with the database records that reference them by folder name and filename. See `PROJECT_FUNCTIONALITY_ANALYSIS.md` in the legacy repo for the data model.
- Deduplicate the identical files listed in [ASSET_INVENTORY.md §8](ASSET_INVENTORY.md#8-cms-uploaded-media-uploads).
- Generate responsive renditions (the legacy API resized everything to 800 px on every request).
- Folder names contain Arabic text, emoji and `؟`. Prefer ID-based storage keys in the new system and keep the human titles in the database.
- The new frontend should only consume URLs returned by the new API. It must not reference `/api/getImage?method=…`, which is legacy.

---

## 8. Licensing and consent checklist

| # | Item | Assets | Action owner |
|---|---|---|---|
| 1 | Logo ownership and vector master | BR-01…03 | Clinic / brand owner: supply SVG/AI/PDF |
| 2 | Stock photo licences (source and licence type unknown) | HE-01, HE-02, CV-02…08, IM-01…03, IM-05, IM-06 | Clinic: confirm licences or approve replacements |
| 3 | Third-party branding in a photo | HE-03 (not migrated) | Resolved by not migrating it |
| 4 | Consent of people pictured | PE-01…07, CMS reviews and works videos | Clinic |
| 5 | Photographer usage rights | PE-04 (professional shoot) | Clinic |
| 6 | Wordmark "TAAHEEL" vs "Rehab" | MD-02 | Clinic: approve or replace |
| 7 | Video music rights (if any) | MD-01 | Clinic |
| 8 | Fonts | Noto Kufi Arabic, Inter | OFL 1.1, no action |
| 9 | Icons | Lucide (ISC), Simple Icons (CC0 + trademark guidelines) | No action beyond attribution files if the bundler requires them |

---

## 9. Verification checklist

- [ ] Stage A: every file in §5 copied, and hashes match the legacy originals.
- [ ] No file in the legacy repository was modified, moved or deleted (`git status` / file timestamps in the legacy repo unchanged).
- [ ] Every destination path in §2 exists, and nothing else was added to `public/assets/`.
- [ ] No reference in the new codebase points to a legacy path (`/bg2.jpg`, `/logo-header.png`, `/api/getImage`, `styles/icofont`).
- [ ] Shipped image sizes meet §4.1 targets. No shipped file is above 500 kB except the video.
- [ ] `favicon.ico`, the app icons and `og-image.jpg` were regenerated. The legacy `bg4.jpg` is not used anywhere.
- [ ] The CV-07 and CV-08 mapping is checked: the neuro page shows the balance-exercise image; the obesity page shows the tape-measure image.
- [ ] The founder cut-out has no background remnants at 100 % zoom on both white and green backgrounds.
- [ ] `googleccfbb267ac4290cb.html` is reachable at `https://<domain>/googleccfbb267ac4290cb.html`.
- [ ] The licensing and consent items in §8 have an owner and a decision.
