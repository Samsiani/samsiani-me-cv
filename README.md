# samsiani.me — CV website

Bilingual (English `/`, Georgian `/ka/`) CV for Giorgi Samsiani. The public site is plain static HTML and CSS: no frameworks at runtime, no trackers.

## Edit content
All text lives once in `src/content/site.json`, with English and Georgian side by side (`{ "en": "…", "ka": "…" }`). The build validates it before rendering: no `javascript:` or `http:` links, no Cyrillic, length limits per field, both languages present. An admin panel for editing it is being built (see `docs/plans/admin-layouts-palettes.md`).

## Build & preview
```bash
npm run dev        # builds dist/ and serves http://localhost:4173
npm run build      # dist/ only
npm test           # unit tests
npm run check:stress   # every layout against the worst-case content fixture (needs Playwright)
```
`SITE_URL=http://localhost:4173` overrides the canonical origin for local previews; `SITE_JSON=path` builds another content file; `LAYOUT=` and `PALETTE=` override the settings for a test build.

## Deploy
Push to `main` — GitHub Actions builds and rsyncs `dist/` to the production server. The host, user, document root, file owner and deploy key all come from repository secrets (`VPS_HOST`, `VPS_USER`, `VPS_PATH`, `VPS_SITE_USER`, `VPS_SSH_KEY`), so no server details live in this repository. Without them the workflow builds and skips the deploy step.

## Structure
- `build.mjs` — validates `site.json`, renders every page through the active layout, hashes CSS/JS, writes `dist/`.
- `src/content/site.json` — the content.
- `src/schema/validate.mjs` — the content schema, validation rules and canonical serialisation.
- `src/render.mjs` — `renderSite(site, { layout, palette, assets })`: pure, no file system, shared by the build and the future admin preview.
- `src/shared/` — language localisation, escaping, icons, document head, JSON-LD, sitemap, web manifest.
- `src/layouts/<id>/` — each layout's manifest (`layout.mjs`), body template (`template.mjs`) and CSS. Registered in `src/layouts/index.mjs`.
- `src/main.js` — theme toggle, copy buttons, print, reveal-on-scroll, scroll-spy (progressive enhancement).
- `src/fonts/` — self-hosted woff2.
- `scripts/` — content migration and layout stress gate. `test/` — unit tests and the stress fixture.
- `docs/plans/` — design record: the build plan and its specs.
