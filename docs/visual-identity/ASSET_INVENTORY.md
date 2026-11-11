# Asset Inventory: Rehab legacy frontend

| | |
|---|---|
| **Scope** | Every visual and media asset in the legacy repository: `public/`, `styles/icofont/`, fonts, icon libraries, inline SVG, and CMS uploads in `uploads/` |
| **Method** | Each file was traced through `import` statements and string references in `Components/`, `pages/`, `Layouts/`, `styles/`, `utils/` and `next-seo.config.js`. Imported variables were checked for actual rendering. Dimensions and formats were read from file headers. Images were inspected visually. |
| **Analysis date** | 2026-11-07 |
| **Companion documents** | [VISUAL_IDENTITY_ANALYSIS.md](VISUAL_IDENTITY_ANALYSIS.md) · [DESIGN_SYSTEM_PROPOSAL.md](DESIGN_SYSTEM_PROPOSAL.md) · [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md) · [FRONTEND_IMPLEMENTATION_GUIDE.md](FRONTEND_IMPLEMENTATION_GUIDE.md) |

Evidence labels: **[Verified]** = read in code or measured from the file; **[Inferred]** = derived but not runtime-tested; **[Recommendation]** = proposal. Sizes are decimal (1 kB = 1,000 bytes). Paths are relative to the legacy repository root.

**Asset IDs** (`BR-01`, `HE-02`, …) are stable identifiers. The same IDs are used in [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md) and [FRONTEND_IMPLEMENTATION_GUIDE.md](FRONTEND_IMPLEMENTATION_GUIDE.md).

---

## 1. Summary

| Category | Count | Size | Notes |
|---|---|---|---|
| Files in `public/` | 42 | 80.1 MB | 35 in use (including the 3 non-visual files), 7 unused or used only by dead code (§9) |
| Brand assets | 4 (3 logo PNGs + favicon) | 0.68 MB | No vector logo in the repo |
| Photos and illustrations | 33 | 61.8 MB | Two founder PNGs alone are 30.9 MB |
| Video / audio | 2 | 17.6 MB | `video.mp4`, `message.mp3` |
| Non-visual public files | 3 | 2 kB | robots, sitemap, Google verification |
| Icon font (IcoFont subsets) | 4 CSS + 8 font files | 277 kB | 12 glyphs actually used, landing page only |
| Icon library (npm `react-icons`) | 14 icon sets, ≈ 100 distinct icons | n/a | No SVG files |
| Inline SVG components | 1 | n/a | `utils/svg/user-chat-svg.js` (dead chat feature) |
| Web fonts | 1 used (Noto Kufi Arabic, Google, via `next/font`) | n/a | No font files in the repo |
| CMS uploads (`uploads/`) | 109 media files | 966 MB | User-generated content served by `/api/getImage`, not design assets (§8) |
| Lottie / animation files | 0 | n/a | None found. Animations are code (framer-motion, CSS keyframes). |

---

## 2. Brand assets

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Page / component | Purpose | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **BR-01** | Primary logo | `public/logo-header.png` | PNG, RGBA (transparent) | 1851×1486 | 149 kB | `Components/Header.js:4` (import), `:63` (`<Image fill objectFit=contain>`) | Header, every page | Main brand mark: green `#309C52` + orange `#F89A3A`, no tagline | **Yes, critical** | Copy unchanged. Also request a vector master (SVG). |
| **BR-02** | Reversed logo | `public/footer-logo.png` | PNG, RGBA | 2057×2038 | 115 kB | `Components/Footer.js:5`, `:50` | Footer, every page | White + orange version for green or dark backgrounds. Includes the tagline and founder line in white. | **Yes** | Copy unchanged |
| **BR-03** | Full lockup | `public/logo.png` | PNG, RGBA | 2057×2038 | 196 kB | **None** (only appears as a substring of `footer-logo.png`) | n/a | Primary mark + green tagline "للعلاج الطبيعي و التأهيل" + founder name in grey `#5A5B5B` | Recommended (About page, print, OG image) | Copy unchanged |
| **BR-04** | Favicon | `public/favicon.ico` | ICO, one 32-bit BMP entry | 256×206 (not square) | 218 kB | `next-seo.config.js:42,46` (absolute URL `https://www.rehabeg.clinic/favicon.ico`); browsers also request `/favicon.ico` by convention | All pages (browser tab) | Site icon | **Yes** (function) | **Regenerate.** Non-square, oversized, and missing 16/32/48 px entries. Rebuild from the person mark of BR-01. |

**Logo colours** [Verified by pixel sampling]: green `#309C52`, orange `#F89A3A`, lockup text grey `#5A5B5B`. See [VISUAL_IDENTITY_ANALYSIS.md §2.1](VISUAL_IDENTITY_ANALYSIS.md#21-logo-system-verified-visual-inspection).

---

## 3. Images

### 3.1 Hero carousel backgrounds (landing page)

All three are rendered by `Components/Landing/Carousel.js` as full-bleed slide backgrounds (`<Image fill objectFit=cover>`), one per slide.

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Slide / use | Content [visual] | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **HE-01** | Hero 1 | `public/bg2.jpg` | JPEG | 5924×3949 | 1.40 MB | `Carousel.js:3` → `:32` (`priority`) | Slide 1, "أفضل حل للحياة المؤلمة" | Stock photo: therapist examining a seated patient's shoulder in a bright room | Yes (or replace) | **Optimise**: resize to 2560 px wide |
| **HE-02** | Hero 2 | `public/bg1.jpg` | JPEG (Canon EOS 60D EXIF) | 5184×3456 | 5.03 MB | `Carousel.js:2` → `:60` | Slide 2, "نعيد تأهيلك لحياة أفضل" | Stock photo: gait training between parallel bars. Same photo series and room as HE-03. | Optional | **Optimise.** Licensing unverified (see HE-03). |
| **HE-03** | Hero 3 + OG image | `public/bg4.jpg` | JPEG (Canon EOS 60D EXIF) | 5184×3456 | 571 kB | `Carousel.js:4` → `:89`; `next-seo.config.js:11` (`og:image`) | Slide 3, "تعافيك هي أولويتنا"; social share image | Stock photo: hand-splint therapy. **The therapist's polo shirt shows a third-party logo ("physio.co.uk").** | **Replace recommended** | Do not reuse as the OG image. Replace with the clinic's own photography (e.g. IM-04). |

### 3.2 Page banner covers

Each is rendered as a full-width 600 px banner (`<Image fill objectFit=cover>`) under a green 42 % overlay. None contains baked-in text [Verified visually], so all can be reused with a CSS overlay.

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Page | Content [visual] | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **CV-01** | About cover | `public/about-cover.png` | PNG RGB | 1381×543 | 699 kB | `pages/about.js:2` → `:23` | `/about` | **Real clinic reception** (panoramic): orange walls, logo signage | **Yes (brand photo)** | Convert to JPEG/WebP |
| **CV-02** | Blog cover | `public/blog-cover.png` | PNG RGB | 2560×880 | 1.41 MB | `pages/blogs.js:2` → `:71`; `pages/blog/[blog].js:3` → `:63` | `/blogs`, `/blog/[blog]` | Stock: hands typing on a laptop on a pink desk | Yes (page banner) | Convert and resize |
| **CV-03** | Contact cover | `public/contact-cover.png` | PNG RGB | 1440×500 | 564 kB | `pages/contact.js:3` → `:95` | `/contact` | Stock: person using a phone with floating contact icons | Yes (page banner) | Convert |
| **CV-04** | Reviews cover | `public/reviews-cover.png` | PNG RGB | 1440×500 | 659 kB | `pages/reviews.js:2` → `:51`; `pages/review/[review].js:4` → banner | `/reviews`, `/review/[review]` | Stock: hand writing in a notebook | Yes (page banner) | Convert |
| **CV-05** | Previous-work cover | `public/previous-work-cover.webp` | WebP | 1280×500 | 55 kB | `pages/previous-work.js:2` → `:66`; `pages/work/[work].js:4` → `:74` | `/previous-work`, `/work/[work]` | Stock: therapist supporting a patient between parallel bars | Yes (page banner) | Copy unchanged |
| **CV-06** | Specialisation cover: orthopaedics & spine | `public/specialization-1-cover.png` | PNG RGBA | 1440×500 | 836 kB | `pages/specialization/[specialization].js:3`, map at `:178` | `/specialization/تأهيل_حالات_العظام_والعمود_الفقري` | Stock: doctor's hands on a patient's back | Yes (page needs a cover) | Convert |
| **CV-07** | Specialisation cover: neuro & paralysis | `public/specialization-3-cover.png` | PNG RGB | 1440×500 | 633 kB | `[specialization].js:5`, map at `:179` | `/specialization/تأهيل_حالات_الأعصاب_والشلل_بأنواعه` | Stock: therapist guiding an older man in a balance exercise | Yes | Convert. **Note the filename/ID mismatch: the "3" file serves the neuro page.** |
| **CV-08** | Specialisation cover: obesity & body shaping | `public/specialization-2-cover.png` | PNG RGBA | 1440×500 | 1.14 MB | `[specialization].js:4`, map at `:180` | `/specialization/قسم_السمنة_وتنسيق_القوام` | Stock: waist measured with a tape | Yes | Convert. **The "2" file serves the obesity page.** |

### 3.3 Content and section images

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Page / component | Content and purpose [visual] | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **IM-01** | Specialisation card: orthopaedics & spine | `public/specialization1.png` | PNG RGB | 1024×683 | 651 kB | `Components/Landing/Our-Specializations.js:2` → `:19`; sidebar thumbnails in `pages/blog/[blog].js:8`, `review/[review].js:7`, `work/[work].js:7`, `specialization/[specialization].js:6` | Landing "تخصصاتنا" card 1; detail-page sidebars | Stock: back pain with a highlighted spine | Yes | Convert |
| **IM-02** | Specialisation card: neuro & paralysis | `public/specialization2.jpg` | JPEG | 1024×683 | 89 kB | `Our-Specializations.js:3` → `:28`; same four sidebars (`:9` / `:8` / `:8` / `:7`) | Landing card 2; sidebars | Stock: gait training with red parallel bars | Yes | Copy unchanged |
| **IM-03** | Specialisation card: obesity & body shaping | `public/specialization3.webp` | WebP | 1200×700 | 43 kB | `Our-Specializations.js:4` → `:38`; same four sidebars | Landing card 3; sidebars | A body-contouring device on a patient (looks like a video still, low quality) | Yes (or replace) | Copy. Replacing with a better photo is recommended. |
| **IM-04** | About: clinic reception | `public/about-pic.png` | PNG RGB | 1316×988 | 1.20 MB | `pages/about.js:3` → `:37` | `/about` intro (doctor-section layout) | **Real clinic reception desk**: logo signage, founder name in green, orange arch | **Yes (brand photo)** | Convert to JPEG/WebP |
| **IM-05** | About: expertise side image | `public/about-wall.png` | PNG RGB | 649×1067 | 860 kB | `pages/about.js:6` → `:115` | `/about` "خبرتنا" block | Stock: therapist adjusting a patient's neck | Recommended | Convert |
| **IM-06** | Contact form side image | `public/contact-message.png` | PNG RGB | 1531×1626 | 1.27 MB | `pages/contact.js:6` → `:135` | `/contact` form section | Stock: therapist with an older patient using a yellow resistance band | Recommended | Convert and resize |
| **IM-07** | Landing blog card 1 | `public/blog1.jpg` | JPEG | 800×585 | 298 kB | `Components/Landing/Recent-Blogs.js:3` → `:24`; `specialization/[specialization].js:12` | Landing "أحدث مدوناتنا" (hard-coded); specialisation sidebar | **Byte-identical duplicate** of `uploads/blogs/جهاز_شد_الفقرات_الإلكتروني/1726668732641blog1.jpg` | No | Do not migrate as a static asset. Fetch from the CMS. |
| **IM-08** | Landing blog card 2 | `public/blog2.jpg` | JPEG | 1000×667 | 56 kB | `Recent-Blogs.js:4` → `:43`; `[specialization].js:13` | Same | Duplicate of `uploads/blogs/تأهيل_حالات_الرباط_الصليبي_قبل_وبعد_العملية/1726668871162blog2.jpg` | No | Same as IM-07 |
| **IM-09** | Landing blog card 3 | `public/blog3.webp` | WebP | 840×560 | 40 kB | `Recent-Blogs.js:5` → `:62`; `[specialization].js:14` | Same | Duplicate of `uploads/blogs/تأهيل_حالات_ما_بعد_الجلطات/1726668989892blog3.webp` | No | Same as IM-07 |

### 3.4 People (team and founder photography)

All photos show real people. Re-using them requires the subjects' consent. The founder images show د. محمد يحيي جمال الدين.

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Page / component | Content [visual] | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **PE-01** | Founder, blazer (cut-out) | `public/doc-mohamed.png` | PNG RGBA | 2375×3964 | **16.37 MB** | `Carousel.js:6` → `:36` (slide 1); `Components/Landing/Doctor-Profile.js:3` → `:19` | Hero slide 1; landing doctor section | Founder in a grey houndstooth blazer. **The background removal is poor**: a posterised remnant of the street background and a white rectangle artefact top-right. | **Yes (key brand image)** | **Re-create** from PE-04 with clean background removal. Do not copy as is. |
| **PE-02** | Founder, white jacket on an orange wall | `public/doc-mohamed-2.png` | PNG RGBA (opaque content) | 798×1492 | 615 kB | `Carousel.js:7` → `:93` (slide 3); also `Our-Doctors.js:2` (dead) | Hero slide 3 | Founder in a white zip jacket with arms crossed, against an orange wall with wood slats (matches the clinic interior) | Yes | Convert to WebP/JPEG |
| **PE-03** | Founder, shirt and tie | `public/new-doctor.png` | PNG RGBA (opaque content) | 595×992 | 543 kB | `Carousel.js:12` → `:64` (slide 2) | Hero slide 2 | Founder in a white shirt and black tie, outdoors, in front of a building | Yes | Convert to JPEG/WebP |
| **PE-04** | Founder, original studio photo | `public/doctor-profile-1.jpg` | JPEG (Canon EOS 5D Mk III EXIF) | 3042×4564 | 7.93 MB | **None** | n/a | The uncropped professional original of the PE-01 pose, outdoors | **Yes, as a source file** | Keep as the master for re-cutting PE-01. Do not ship it. |
| **PE-05** | Founder, white jacket on white | `public/doctor-profile.jpg` | JPEG | 719×1280 | 76 kB | **None** | n/a | Founder in a white jacket, clean white background | Optional | Copy if a light-background portrait is needed (e.g. team card) |
| **PE-06** | Founder, blazer (alt pose, cut-out) | `public/doc-mohamed-3.png` | PNG RGBA | 2253×3629 | **14.54 MB** | `Carousel.js:8` (imported as `BackgroundAssetEight`, **never rendered**) | n/a | Same session as PE-01, buttoning the jacket. Same posterised background problem. | No | Do not migrate |
| **PE-07** | Founder, blazer with building | `public/new-doctor2.png` | PNG RGBA (opaque content) | 758×1278 | 1.75 MB | `Carousel.js:13` (imported as `NewDocTwo`, **never rendered**) | n/a | Founder in a blazer and tie, outdoors | No | Optional |
| **PE-08** | Second doctor | `public/doc2.png` | PNG RGBA | 718×1280 | 431 kB | `Components/Landing/Our-Doctors.js:3` (**component never mounted**) | n/a | Clinician in black scrubs, white background. Named in code as "د/ محمد احمد محمود – اخصائي علاج طبيعي" (`Our-Doctors.js:36-37`). | No | Do not migrate as static. Doctors come from the CMS (`uploads/doctors/`). |

### 3.5 Backgrounds, textures and illustrations

| ID | Asset | Path | Format | Dimensions | Size | Referenced in | Page / component | Content and purpose [visual] | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **BG-01** | Dotted world map | `public/dots.png` | PNG, 8-bit palette | 827×252 | 25 kB | `Components/Landing/Statistics.js:2` → `:34`; `pages/contact.js:4` → `:103` | Landing statistics strip; contact info card (at 70 % opacity) | Very light grey dot-matrix world map used as a card texture | Yes (signature texture) | Copy. An SVG redraw is optional. |
| **BG-02** | Network pattern (transparent) | `public/sign-cover.png` | PNG RGBA | 840×666 | 61 kB | `Components/Auth-Modal/Sign-In.js:2` → `:73`; `Sign-Up.js:3` → `:186` | `/sign` green side panel (at 50 % opacity over green) | Light grey "molecule / network" nodes-and-lines graphic | Recommended | Copy |
| **BG-03** | Network pattern (light background) | `public/contact.png` | PNG, 8-bit palette | 1080×704 | 30 kB | `pages/contact.js:7` → `:138` | `/contact` form background | The same network motif on `#F4F4F4` | Recommended | Copy |
| **IL-01** | Stethoscope-heart watermark | `public/tool.png` | PNG RGBA | 556×712 | 29 kB | `Doctor-Profile.js:5` → `:27`; `pages/about.js:5` → `:45` | Landing doctor section; About intro (animated bob) | Pale lavender (`≈#EEF0FA`) line illustration of a stethoscope forming a heart | Recommended | Copy, or redraw as SVG in a token colour |

---

## 4. Video and audio

| ID | Asset | Path | Format | Properties | Size | Referenced in | Page / component | Purpose | Essential? | Copy or adapt |
|---|---|---|---|---|---|---|---|---|---|---|
| **MD-01** | Clinic video | `public/video.mp4` | MP4 (ISO BMFF) | 1280×720, 158.4 s | 17.58 MB | `Components/Landing/Video/VideoModal.js:49` (`<source src="/video.mp4">`) | Landing video modal | Promotional clinic video (content not reviewed frame by frame) | Recommended | Copy. Hosting on a video CDN or YouTube is recommended. Re-encode with `+faststart`. |
| **MD-02** | Video poster | `public/poster.png` | PNG RGB | 1919×839 | 1.92 MB | `Components/Landing/Video/VideoMain.js:3` → `:24` | Landing video teaser (under a green overlay) | Clinic reception wall with the person mark and the wordmark **"TAAHEEL"** above the founder's name | Conditional | **Confirm with the client**: the wordmark differs from "Rehab". If approved, convert to JPEG/WebP. |
| **MD-03** | Chat notification sound | `public/message.mp3` | MP3, 256 kbps, 48 kHz | short | 33 kB | `Components/Chat/Chat-Icon.js:16` (`${NEXT_PUBLIC_BASE_URL}/message.mp3`) | Chat widget (**never mounted**) | Incoming-message sound | No | Do not migrate unless a chat feature is built |

**Lottie / JSON animations:** none in the repository. [Verified]

---

## 5. Fonts

| ID | Font | Source | Files in repo | Referenced in | Weights / subsets | Role | Essential? | Recommendation |
|---|---|---|---|---|---|---|---|---|
| **FN-01** | Noto Kufi Arabic | Google Fonts through `next/font/google` (downloaded and self-hosted at build time) | **None** | `utils/fonts.js:2,5-10`; applied at `Layouts/Layout.js:13`; literal name in `styles/main.scss:46,50,62,551`, `styles/ReactToastify.css:23` | 200–800; `subsets: ['arabic']`; `display: swap` | The only text typeface (all Arabic UI) | **Yes, brand typeface** | Load the same family (SIL Open Font License 1.1). See [FRONTEND_IMPLEMENTATION_GUIDE.md §3](FRONTEND_IMPLEMENTATION_GUIDE.md#3-font-configuration). |
| **FN-02** | Inter | `next/font/google` import | None | `utils/fonts.js:1` (imported, **never instantiated**) | n/a | None today | No (today) | [Recommendation] Use it for Latin and English text when the English UI is built (OFL 1.1). |
| **FN-03** | IcoFont (4 subsets) | Local, IcoFont v1.0.1 subset export (header `@license - https://icofont.com/license/`) | `styles/icofont/webapp.css`, `medical.css`, `person.css`, `device.css`; `styles/icofont/fonts/webapp.woff/.woff2` (85 kB / 72 kB), `icofont.woff/.woff2` (20 kB / 18 kB, used by `medical.css`), `person.woff/.woff2` (14 kB / 12 kB), `device.woff/.woff2` (12 kB / 10 kB) | `pages/_app.js:8-11` | 405 + 58 + 40 + 52 glyph classes defined | 12 icons on the landing page (§6.2) | No | **Do not migrate.** Replace the 12 glyphs with SVG icons. Its licence terms are not recorded in the repo. |

---

## 6. Icons

### 6.1 react-icons (npm package `react-icons@^5.2.1`) [Verified]

Every UI icon outside the landing statistics and services comes from `react-icons`. There are **14 different sets** mixed together, so stroke weight and style vary.

| Set (import path) | Files importing | Representative icons |
|---|---|---|
| `react-icons/io` (Ionicons 4) | 32 | `IoMdArrowDropdown` (21 files), `IoMdArrowDropup`, `IoIosRemoveCircle`, `IoMdSettings`, `IoIosStar`, `IoIosStarOutline`, `IoMdLock`, `IoMdClose`, `IoMdCloseCircle`, `IoLogoWhatsapp`, `IoIosStats` |
| `react-icons/fa` (Font Awesome 5) | 27 | `FaWhatsapp`, `FaFacebookSquare`, `FaInstagramSquare`, `FaWhatsappSquare`, `FaHome`, `FaPhone`, `FaUser`, `FaUserCircle`, `FaPlay`, `FaPlus`, `FaTrash`, `FaEdit`, `FaLongArrowAltLeft`, `FaArrowAltCircleLeft`, `FaBloggerB`, `FaMoneyBill`, `FaCoins`, `FaUserMd`, `FaBirthdayCake`, … |
| `react-icons/md` (Material) | 20 | `MdPhone`, `MdEmail`, `MdLocationPin`, `MdLocationOn`, `MdNavigateNext/Before`, `MdDashboard`, `MdWork`, `MdDelete`, `MdEditDocument`, `MdCurrencyExchange`, `MdOutlineEmail`, `MdOutlinePhoneEnabled`, … |
| `react-icons/fa6` (Font Awesome 6) | 19 | `FaUserDoctor` (6 files), `FaCalendar`, `FaRegCalendarDays`, `FaCircleInfo`, `FaCirclePlus`, `FaCircleMinus`, `FaCircleCheck`, `FaRegCircleCheck`, `FaEllipsisVertical`, `FaDownload`, `FaUsers`, `FaUserXmark`, `FaArrowsRotate`, `FaMoneyBillTrendUp` |
| `react-icons/io5` | 9 | `IoTicket`, `IoCloseCircle`, `IoCloseCircleSharp`, `IoChatbubbles`, `IoTime` |
| `react-icons/fi` (Feather) | 7 | `FiCalendar`, `FiUser`, `FiLock` |
| `react-icons/ai` | 6 | `AiFillTikTok`, `AiOutlineSafety`, `AiFillSchedule`, `AiOutlineLoading3Quarters` (the spinner) |
| `react-icons/ri` | 4 | `RiQuestionAnswerLine`, `RiCalendarScheduleFill`, `RiListSettingsFill`, `RiMessage2Fill` |
| `react-icons/bs` | 3 | `BsGenderMale`, `BsCalendar2MonthFill` |
| `react-icons/sl`, `bi`, `hi2`, `gr`, `gi` | 1–2 each | `SlCalender`, `BiSolidBookAdd`, `BiSolidCommentAdd`, `BiSolidUserPin`, `HiBars3` (hamburger), `GrAttachment`, `GiSwapBag` |

**Brand and social icons needed in the new UI:** WhatsApp, Facebook, Instagram, TikTok (header utility bar, footer, floating button).

### 6.2 IcoFont glyphs actually used [Verified]

| Glyph class | Subset CSS | Codepoint | Used at | Meaning |
|---|---|---|---|---|
| `icofont-patient-bed` | medical.css | `\ec2d` | `Components/Landing/Statistics.js:37` | "سرير متاح" (beds) |
| `icofont-first-aid` | medical.css | `\ec1d` | `Statistics.js:38`, `Services.js:51` | Sessions / recovery sessions |
| `icofont-people` | person.css | `\ecf9` | `Statistics.js:39` | Clients |
| `icofont-doctor-alt` | medical.css | `\ec18` | `Statistics.js:40` | Doctors |
| `icofont-badge` | webapp.css | `\eeaa` | `Statistics.js:41` | Years of experience |
| `icofont-doctor` | medical.css | `\ec19` | `Components/Landing/Services.js:15` | Elite doctors |
| `icofont-prescription` | medical.css | `\ec30` | `Services.js:22` | Diagnosis |
| `icofont-medical-sign` | medical.css | `\ec27` | `Services.js:29` | Healthcare |
| `icofont-icu` | medical.css | `\ec23` | `Services.js:36` | Advanced equipment |
| `icofont-crutch` | medical.css | `\ec13` | `Services.js:44` | Rehabilitation |
| `icofont-laptop-alt` | device.css | `\ea41` | `Services.js:58` | Online sessions |
| `icofont-herbal` | medical.css | `\ec21` | `Services.js:65` | Nutrition plans |

### 6.3 Inline SVG

| ID | Asset | Path | Referenced in | Purpose | Recommendation |
|---|---|---|---|---|---|
| **IC-03** | Chat agent avatar | `utils/svg/user-chat-svg.js` (97 lines; colours `#84d0f7`, `#aa392d`, `#7c211a`, `#eab198`, `#2d2d2d`) | `Components/Chat/Chat-Icon.js:2` (dead feature) | Illustrated avatar in the chat teaser | Do not migrate |

There are **no `.svg` files** anywhere in the repository. [Verified]

---

## 7. Non-visual public files

| ID | File | Path | Size | Purpose | Recommendation |
|---|---|---|---|---|---|
| **OT-01** | robots.txt | `public/robots.txt` | 243 B | Allows everything. Contains a meaningless `Allow: /public/` and points to the sitemap. | Regenerate in the new repo |
| **OT-02** | sitemap.xml | `public/sitemap.xml` | 1.8 kB | Static sitemap generated 2024-07-25 with a handful of URLs | Generate dynamically, including CMS routes |
| **OT-03** | Google Search Console verification | `public/googleccfbb267ac4290cb.html` | 53 B | Proves site ownership to Google | **Copy unchanged** to the new web root, at the same filename and root path |

---

## 8. CMS-uploaded media (`uploads/`)

These files are **content, not design assets**. Admins upload them through the dashboard (`pages/api/upload.js`), and they are served through `pages/api/getImage.js`. That endpoint resizes JPEG/PNG to 800 px wide with `sharp` and streams videos.

| ID | Folder | Files | Types | Served by (`/api/getImage?method=…`) | Consumed in |
|---|---|---|---|---|---|
| **UP-01** | `uploads/blogs/<blog_name>/` | 56 | 55 jpg, 1 webp | `get-blog-image` | `pages/blogs.js:94`, `pages/blog/[blog].js:47,84,154` |
| **UP-02** | `uploads/doctors/<id>/` | 11 | 10 jpg, 1 jpeg | `get-doctor-image` | `Components/Reservation/Reservation-Doctor.js:290,306`, `Reservation-Info.js:129`, `Components/Profile/Previous-Reservations.js:132` |
| **UP-03** | `uploads/reviews/<review_name>/` | 26 | 13 mp4, 12 jpg, 1 png | `get-review-image`, `get-video-review` | `pages/reviews.js:76-85`, `pages/review/[review].js:44-195` |
| **UP-04** | `uploads/works/<work_name>/` | 16 | 8 mp4, 8 jpg | `get-work-image`, `get-video` | `pages/previous-work.js:91-100`, `pages/work/[work].js:44-195` |

Total 966 MB. Folder names are Arabic titles with underscores, and some contain emoji or `؟` characters. Each folder also holds a placeholder `.txt` (`HereIsBlogs.txt` etc.).

**Duplicates found** [Verified by MD5]:
- `public/blog1.jpg`, `blog2.jpg`, `blog3.webp` are identical to files in `uploads/blogs/` (IM-07…IM-09).
- `uploads/doctors/726580232/…1000022344.jpg` = `uploads/doctors/825268429/…IMG_٢٠٢٤١٠١٣_٠٠٠٤٥١.jpg`
- `uploads/doctors/376900090/…2-1.jpg` = `uploads/doctors/497232762/…2-1.jpg`
- `uploads/reviews/قصة_نجاح_تأهيل_كابت_احمد_حسن…/…mp4` = `uploads/reviews/كابتن_احمد_حسن_مدرب_تنس…/…1000111424.mp4`
- `uploads/blogs/بدلة_التحفيز_الكهربائي_EMS/…jpg` = `uploads/works/EMS___بدلة_التحفيز_الكهربائى_للعضلات/…jpg`

**Migration:** this belongs to the backend and content migration, not the frontend asset copy. The new frontend should load these through whatever media API or storage the new backend provides. See [ASSET_MIGRATION_GUIDE.md §7](ASSET_MIGRATION_GUIDE.md#7-cms-uploaded-media-not-a-frontend-asset).

---

## 9. Unused assets (separate list)

| ID | Path | Size | Status | Evidence |
|---|---|---|---|---|
| BR-03 | `public/logo.png` | 196 kB | Unreferenced | Grep for `[/'"]logo\.png` returns nothing |
| PE-04 | `public/doctor-profile-1.jpg` | 7.93 MB | Unreferenced (but valuable as a source) | No references |
| PE-05 | `public/doctor-profile.jpg` | 76 kB | Unreferenced | No references |
| PE-06 | `public/doc-mohamed-3.png` | 14.54 MB | Imported, never rendered | `Carousel.js:8`; variable appears once |
| PE-07 | `public/new-doctor2.png` | 1.75 MB | Imported, never rendered | `Carousel.js:13`; variable appears once |
| PE-08 | `public/doc2.png` | 431 kB | Used only by a component that is never mounted | `Our-Doctors.js` is not imported anywhere |
| MD-03 | `public/message.mp3` | 33 kB | Used only by dead chat code | `Components/Chat/main.js` is not imported anywhere |
| FN-02 | Inter (`next/font`) | n/a | Imported, never instantiated | `utils/fonts.js:1` |
| FN-03 | Most of IcoFont | 277 kB | 12 of 555 glyph classes used | §6.2 |
| IC-03 | `utils/svg/user-chat-svg.js` | n/a | Dead chat feature | §6.3 |

---

## 10. Asset issues to resolve before or during migration

| # | Issue | Assets | Severity | Recommendation |
|---|---|---|---|---|
| 1 | **Third-party branding visible** in a stock photo that is also the OG share image | HE-03 (`bg4.jpg`) | High | Replace. Use IM-04 or CV-01 (real clinic) for OG and hero. |
| 2 | **Poor background removal** on the key founder image | PE-01 (`doc-mohamed.png`), PE-06 | High | Re-cut from PE-04 (`doctor-profile-1.jpg`). |
| 3 | **Oversized files**: 16.4 MB and 14.5 MB PNGs; 5 MB and 1.4 MB hero JPEGs at 5000+ px | PE-01, PE-06, HE-01, HE-02 | High (performance) | Resize and convert as specified in the migration guide |
| 4 | **Wordmark mismatch** ("TAAHEEL" vs "Rehab") | MD-02 (`poster.png`) | Medium | Confirm with the client before reuse |
| 5 | **No vector logo** | BR-01…03 | Medium | Request SVG or AI masters from the brand owner. Until then, use the PNGs at their native resolution. |
| 6 | **Broken favicon** (non-square, single size, 218 kB) | BR-04 | Medium | Regenerate a full icon set |
| 7 | **Stock photo licensing not documented** | HE-01…03, CV-02…08, IM-01…03, IM-05, IM-06 | Medium | Confirm licences or replace with owned photography. Several images look like common stock-library content. |
| 8 | **People in photos**: consent for re-use | PE-01…08, CMS reviews and works videos | Medium | Confirm consent for continued publication |
| 9 | Misleading filenames (spec cover 2 ↔ 3) | CV-07, CV-08 | Low | Rename by meaning during migration |
| 10 | Static duplicates of CMS content | IM-07…09 | Low | Do not migrate; fetch dynamically |
| 11 | Fragile icon font (four `@font-face` rules with the same family name) | FN-03 | Low | Replace with SVG icons |
