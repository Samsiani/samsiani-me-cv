# samsiani.me — CV website

Bilingual (English `/`, Georgian `/ka/`) static CV for Giorgi Samsiani.
No frameworks, no dependencies, no trackers. Design direction: **Precision** — sticky identity rail,
Chivo + JetBrains Mono + Noto Sans Georgian, cobalt accent, skills as a ledger table.

## Edit content
- `src/content/en.mjs` — English
- `src/content/ka.mjs` — Georgian (keys mirror `en.mjs`)

## Build & preview
```bash
npm run dev      # builds dist/ and serves http://localhost:4173
npm run build    # dist/ only
```
`BUILD_DATE=2026-09-05 node build.mjs` pins the "last updated" date; `SITE_URL` overrides the canonical origin.

## Deploy
Push to `main` — GitHub Actions builds and rsyncs `dist/` to the OpenLiteSpeed vhost on the
production server. The host, user, document root and deploy key all come from repository
secrets (`VPS_HOST`, `VPS_USER`, `VPS_PATH`, `VPS_SSH_KEY`), so no server details live in
this repository. Without them the workflow builds and skips the deploy step.

Manual fallback, using your own SSH config entry for the server:
```bash
node build.mjs && rsync -az --delete dist/ samsiani-me:/path/to/public_html/
```

## Structure
- `build.mjs` — renders both languages, hashes CSS/JS for immutable caching, writes sitemap, robots, `.htaccess`.
- `src/template.mjs` — one HTML template for both languages (hreflang, canonical, Open Graph, JSON-LD Person).
- `src/styles.css` — design tokens (light/dark via `prefers-color-scheme` + manual toggle), layout, A4 print stylesheet.
- `src/fonts/` — self-hosted woff2: Chivo + JetBrains Mono (Latin), Noto Sans Georgian.
- `src/main.js` — theme toggle, copy buttons, print, reveal-on-scroll, scroll-spy (progressive enhancement).

Optional: drop `og-en.png`, `og-ka.png` (1200×630) and `apple-touch-icon.png` (180×180) into `src/` and they are copied on build.

## Verified
- No horizontal overflow at any width from 320 to 1600 px.
- WCAG 2.1 AA contrast for every text token in both light and dark.
- "Save as PDF" produces a clean 5-page A4 document (6 pages in Georgian).
