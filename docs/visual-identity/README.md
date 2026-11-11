# Rehab visual identity

These five documents analyse the clinic's legacy website (a separate Next.js repository) and define the design system
that [`frontend/`](../../frontend/) implements. They are copied here unchanged, so the line references (`styles/main.scss:19`,
`Components/Header.js:63`, …) point into the **legacy** repository, not this one.

| Document | What it is for |
|---|---|
| [VISUAL_IDENTITY_ANALYSIS.md](VISUAL_IDENTITY_ANALYSIS.md) | What the legacy UI does: colours, fonts, patterns, what to keep (brand) and what to modernise (UI) |
| [DESIGN_SYSTEM_PROPOSAL.md](DESIGN_SYSTEM_PROPOSAL.md) | The design tokens, component guidelines and brand patterns |
| [FRONTEND_IMPLEMENTATION_GUIDE.md](FRONTEND_IMPLEMENTATION_GUIDE.md) | Tokens as CSS, global styles, fonts, RTL rules, page templates, QA checklist |
| [ASSET_INVENTORY.md](ASSET_INVENTORY.md) | Every legacy image, font and icon, with stable asset IDs (`BR-01`, `HE-01`, …) |
| [ASSET_MIGRATION_GUIDE.md](ASSET_MIGRATION_GUIDE.md) | Which assets move to the new frontend, where, and how they are prepared |

## Where they live in `frontend/`

| Document section | Code |
|---|---|
| Tokens (proposal §2-5, guide §2) | `frontend/src/styles/tokens.css` (values identical) |
| Global styles (guide §4) | `frontend/src/styles/base.css` |
| Components (proposal §8, guide §7) | `frontend/src/styles/components.css` + `frontend/src/ui/` |
| Staff layout (guide §9.1 AdminLayout) | `frontend/src/layout/StaffLayout.tsx`, `frontend/src/styles/layout.css` |
| Icons (proposal §6) | `frontend/src/ui/icons.tsx` (inline SVG, no package) |
| Assets (migration guide §3-5) | `frontend/public/assets/` (imported once; originals in `frontend/design-source/legacy-import/`) |

Two choices differ from the documents: the icons are inline SVG instead of the `lucide-react` / `simple-icons`
packages, and the fonts load with a Google Fonts `<link>`. Both avoid adding dependencies (project rule: ask before
adding one). Switching to the packages later only touches `ui/icons.tsx` and `index.html`.

## Still open for the clinic (from the documents)

- A vector (SVG) master of the logo. The favicon and app icons are cut from the PNG for now.
- Licences for the stock photos and consent from the people pictured.
- Whether the video poster with the "TAAHEEL" wordmark may be used (it is not used now).
- A clean re-cut of the founder's portrait (the legacy cut-out is not used; the home page uses a framed photo).
