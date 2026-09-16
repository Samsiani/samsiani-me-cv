# samsiani.me · admin, three layouts, colour palettes: master build plan

| | |
|---|---|
| Owner request | "need admin panel where user can add / edit info. also from dashboard i need option to choose different layouts. at first lets make 3 different layouts. also option to choose color palette." |
| Status | Ready to build. Written 2026-09-15 against `main` at `96e784e`; revised the same day after review (Review log at the end). |
| Specs this plan executes | [data-model.md](data-model.md) (content, validation, refactor) · [palettes.md](palettes.md) (+ `palettes.json`, `check-palettes.mjs`) · [layout-studio.md](layout-studio.md) · [layout-ledger.md](layout-ledger.md) · [admin-ops.md](admin-ops.md) (service, security, ops) |
| Public-repository rule | This file names no server IP, SSH user, unix user or host-identifying path. Server values appear only as `$SITE_HOME`, `$WEB_ROOT`, `$SITE_USER`, `$NODE_BIN`; they live in GitHub secrets and in root-only files under `/opt/samsiani-admin/shared/` (`APP_HOME`, a fixed path chosen by this plan that identifies no server). |

**How to use this document.** It is the only document the builder executes. Each section summarises one spec and links it for detail. Precedence when sources disagree: **this document > the spec > the spec's reference code > the spec's prose**. Every disagreement found between the specs, and its resolution, is listed in Appendix A. Reference code was run and verified; copy it with the map in Appendix B instead of retyping it.

**Rules for every milestone.** Work on a feature branch. The owner reviews, commits and pushes; commits carry no `Co-Authored-By` trailer. Never write a server detail into a tracked file. Never apply `text-transform` to Georgian. All copy comes from `site.json`; nothing is copied from the design explorations (they contain retired copy such as "KA · EN · RU", "Education", "Georgian bank gateways"). Every regenerated public asset gets a content-hashed file name, because Cloudflare caches fixed names.

**Re-verified while writing this plan (2026-09-15):**
- The data-model refactor reproduces today's `dist/` byte for byte (`diff -r`, 19 files) on the current `main`.
- The Precision CSS edits of M2 plus the cobalt palette block give **pixel-identical** full-page screenshots at 390, 768, 1080, 1440 and 1920 px, EN and KA, light and dark (20/20). The only differing shots are EN 1280 px and KA 1600 px, where the top nav is hidden instead of wrapping into two lines (a live bug, fixed on purpose).
- The palette gate passes **432/432** with Studio's and Ledger's final neutrals merged into one `palettes.json`.
- npm registry: `hono 4.13.7`, `@hono/node-server 2.1.1`, `satori 0.33.4`, `@resvg/resvg-wasm 2.6.2`, `vue 3.5.42`, `vite 8.3.0`, `@vitejs/plugin-vue 6.0.9` are the current releases. Satori's dependency tree contains no native addon (HarfBuzz and Yoga ship as WASM).
- satori + resvg-wasm render a mixed Latin/Georgian 1200×630 card in ~100 ms cold and ~25 ms warm, with static TTF instances that the Google Fonts css2 API returns to clients sending no browser User-Agent (no `fvar` table, OS/2 weight class 600). No fonttools step is needed.
- After review (same day, scratch builds of the reference code with this revision's edits): M1 output still byte-identical; the M2 Precision stylesheet with every review edit gives **30/30** identical screenshots (390–1920 px × EN/KA × light, OS dark, `?theme=dark`); the new `docs/plans/site.stress.json` (every limit reached, §4) passes the extended stress gate and a full 320→1600 px overflow sweep in all three layouts, and fails Precision without the edits (EN 320 px +57 px, KA 320 px +225 px); CDP's accessibility tree shows no unnamed link or button at 390 or 1440 px in Precision and Studio.

---

## 0. Decisions for the owner

| # | Decision | Recommended | Why | Main alternative |
|---|---|---|---|---|
| D1 | How the public site is served | **Stays static.** OLS serves pre-rendered files; the admin renders them on Publish. | Visitors never depend on a Node process, so an admin outage never touches the site; today's speed, caching and verified renderer stay. | Rewrite as Next.js/SSR: a runtime on every request and a rewrite of a working site. |
| D2 | Content storage | **JSON files on the server**: draft, live, 30 revisions, 30 daily backups. | One 65 KB document and one writer. Atomic file writes are enough, and nothing needs compiling on AlmaLinux 8. | SQLite: `better-sqlite3` is a native module (gcc 8.5, python 3.6 on the box). |
| D3 | Single source of truth for content | **The server's `data/site.json`**; the repository copy becomes the first-boot seed. | The server holds no GitHub write token, so a compromised admin cannot push code that CI runs with the root deploy key. Publishing takes about a second. | Admin commits `site.json` to GitHub and CI deploys: history in git, but 1–3 min per publish and a repo-write token on a shared server. |
| D4 | Admin address and access | **`samsiani.me/admin/`**, one admin account with a password, reachable only through Cloudflare: the app refuses any `/admin/` request without a secret header that a Cloudflare Transform Rule adds (§9.3). Cloudflare Access (email one-time PIN) can be added as a second gate later. | One OLS proxy context in the existing vhost; no new DNS name or certificate. The header check is what makes the rate limits and Access hold, because the origin address is public (older commits) and other tenants share the box. | `admin.samsiani.me`: a new vhost, DNS record and certificate for no functional gain. |
| D5 | Admin UI stack | **Vue 3 + Vite**, compiled in CI and served as static files by the admin process. | The owner already maintains a Vue 3 CRM; `v-model` suits a dense EN/KA form; bundle size does not matter for one user. | Preact: smaller, but more code for nested form state. |
| D6 | Social cards (OG) and icons | **Rendered on the server at Publish** with satori + resvg-wasm (pure JS/WASM), named by content hash. | The cards show editable content (name, role, facts) and the icons show the monogram and palette; CI never sees admin edits. Verified with Georgian. | Playwright on the Mac or in CI: cards go stale after the first admin edit. |
| D7 | Palettes | **Six palettes** (Cobalt = today's accent and the default, Lime, Emerald, Amber, Crimson, Graphite), chosen independently of the layout; only the chosen one ships. | All 432 contrast checks pass for every layout in both themes; no JavaScript; a palette change renames the CSS file, so Cloudflare cannot serve a stale one. | Visitor-facing palette switcher: six times the CSS for a feature nobody asked for. |
| D8 | First-visit theme of Studio | **Dark** when the owner picks "Follow the visitor's system", because Studio is a dark-first design. An explicit Light or Dark choice in the dashboard overrides it; a visitor's own toggle always wins. | Studio's light theme is its secondary look. | Studio follows the OS like the other layouts. |

**Owner inputs needed during the build (not decisions):**
1. Before M1 is merged: add the GitHub secret `VPS_SITE_USER` (the unix user that owns the web root). M1 moves it out of `deploy.yml`, which is the last server detail in the repository.
2. Before Ledger is published: check the four new Georgian interface strings **თემა** (Theme), **ჯგუფი** (Group), **უნარი** (Skill), **დონე** (Depth). They are editable later under Content → Interface strings.
3. At M9: approve the system changes (the root-owned `/opt/samsiani-admin` tree; `pm2-logrotate`, which applies to every PM2 app on the box; a Node binary under `/opt` if the site user cannot run the current one), choose the admin username, create the two root-only env files, create the Cloudflare rules of §9.3 (including the Transform Rule that carries `EDGE_SECRET`), add the GitHub secret `VPS_KNOWN_HOSTS` (required) and the optional `DENYLIST` (private literals for the leak check, §11). After the cut-over, delete the secrets `VPS_PATH` and `VPS_SITE_USER` (§9.6 step 9).
4. At M10: decide the optional hardening (Cloudflare Access, OLS Cloudflare-only rule, WAF login rule, encrypted weekly backup).

---

## 1. What ships

- **One content file.** Every text on the site lives once in `site.json`, English and Georgian side by side, validated on every save (no Cyrillic, no Russian, no education section, only `https:`/`mailto:`/`tel:` links, length limits measured against every layout).
- **An admin at `samsiani.me/admin/`.** Dashboard: layout, palette, default theme for new visitors, last-updated date, live preview of unsaved changes (EN/KA, desktop/mobile, light/dark). Content: every field in EN and KA side by side, with character counters, add/remove/reorder for every list, keyboard-operable. SEO: titles, descriptions, search-result and social-card previews. Revisions: 30 snapshots, restore into the draft, live builds with one-click rollback. Account: password, sessions, audit log, export and import.
- **Publish** renders the static files on the server in about a second and swaps them in file by file; **rollback** takes under a second.
- **Three layouts.** A · Precision (today's design, unchanged), B · Studio (dark bento), C · Ledger (white, numbered index column). All bilingual, responsive from 320 px, light and dark, A4 print, WCAG 2.1 AA.
- **Six palettes** that work with every layout in both themes.
- **Social cards and icons** regenerate from the name, role, facts, monogram and palette.
- **Operations.** A PM2 service on port 3097 behind one OLS proxy context; CI builds a tested release; the public site keeps working when the admin is stopped.

---

## 2. Architecture

```text
 visitor ── https ──┐                                   owner's browser ── https ──┐
                    ▼                                                             ▼
 ┌──────────────────────────────── Cloudflare (proxied) ─────────────────────────────────┐
 │ public paths: hashed assets cached as immutable; HTML not cached                     │
 │ /admin*: a Transform Rule adds the secret x-sm-edge header; the "bypass" Cache Rule  │
 │ and the Configuration Rule (Rocket Loader, Email Obfuscation off) are last in order  │
 └──────────────┬───────────────────────────────────────────────────────┬───────────────┘
                │ every path except /admin/…                             │ /admin/…
                ▼                                                        ▼
 ┌───────────── OpenLiteSpeed vhost ─────────────────────────────────────────────────────┐
 │ context /        static files in $WEB_ROOT (unchanged)   context /admin/ (new): proxy │
 └──────────────▲────────────────────────────────────────────────────────┬──────────────┘
                │ serves                                                 │ http://127.0.0.1:3097
                │                                                        ▼
 $WEB_ROOT (public_html, owner $SITE_USER)        ┌── Node 24 · Hono · PM2 fork · uid $SITE_USER ──┐
   index.html  ka/index.html  404.html            │ /admin/               Vue SPA (built in CI)      │
   styles.<h>.css  main.<h>.js  fonts/*.woff2     │ /admin/api/*          JSON API (session + CSRF)  │
   og-en.<h>.png  og-ka.<h>.png  icon *.<h>.png   │ /admin/preview/<t>/*  draft rendered in memory   │
   site.<h>.webmanifest  sitemap.xml  robots.txt  └───────┬─────────────────────────┬──────────────┘
                ▲                                         │ read / write            │ buildSite() + brand renderer
                │ per-file atomic rename,                 ▼                         ▼
                │ assets first, HTML last       $SITE_HOME/data/ (700)      $SITE_HOME/builds/<buildId>/
                └───────────────────────────────  draft.json  site.json       full site + manifest.json
                                                  revisions/  backups/        (10 kept → rollback)
                                                  auth.json  sessions.json
                                                  brand-cache/  audit.log

 /opt/samsiani-admin/ (root:root, outside $SITE_HOME): releases/<sha>/  current  shared/ (env files, ecosystem)  logs/

 GitHub Actions, push to main: test + gates → release tarball (code + production node_modules + SPA; no deploy/)
   → rsync to /opt/samsiani-admin/releases/<sha>/ → ecosystem file from the deploy job's own checkout → flip current
   → pm2 startOrReload → health check (auto-revert) → cli publish --source=published --if-changed (new templates)
   CI never uploads content or dist/ after the cut-over (M9). Root never runs, sources or chowns a file under $SITE_HOME.
```

- **One renderer.** `buildSite()` (§5.5) serves `build.mjs` (laptop, CI), the preview (in memory) and Publish (to `builds/`). The same input gives the same bytes everywhere.
- **Writers.** After the cut-over the admin process is the only writer of `data/` and `$WEB_ROOT`. CI writes only `/opt/samsiani-admin/releases/` and `shared/ecosystem.config.cjs`. Its CLI (`admin/server/cli.mjs`, run as `$SITE_USER`) takes the same locks as the service.
- **Trust boundaries.** Cloudflare → OLS (TLS) → `127.0.0.1:3097` only. Every `/admin/` request except `GET /admin/api/health` must carry the `x-sm-edge` secret that only Cloudflare adds, so a direct request to the origin or from another tenant on the box gets 403 (§8.4). The Node process has the site user's rights and holds no GitHub credential. Its code lives in root-owned `/opt/samsiani-admin`, outside the site user's home, and root never sources, executes, chowns, chmods or rsyncs anything under `$SITE_HOME` (§9.1).
- **Failure isolation.** `pm2 stop samsiani-admin` makes `/admin/` answer 503; `/` and `/ka/` keep serving the same bytes.

---

## 3. Repository after the change

Legend: `+` new · `~` changed · `→` moved · `-` deleted · `=` unchanged · `[Mn]` milestone.

```text
.github/workflows/deploy.yml     ~ [M1] Node 24, unix user read from a secret · replaced [M9] test + gates → release → deploy
.github/workflows/backup.yml     + [M10, optional] weekly encrypted backup artifact
.gitignore                       ~ + .cache/ data/ .builds/ admin/web/dist/ .env* release/ release.tgz
README.md                        ~ [M1] content + structure · [M9] Admin, deploy, runbook index
package.json                     ~ [M1] scripts · [M2] playwright (dev) · [M5] hono, engines >=24 · [M7] satori · [M8] vue, vite
package-lock.json                + [M2] committed; exact pins everywhere
build.mjs                        ~ [M1] data-model reference · [M2] thin CLI over buildSite()
serve.mjs                        =
scripts/
  migrate-content.mjs            + [M1] one-time migration CLI · - [M9]
  check-layout-stress.mjs        + [M1] from data-model-ref · ~ [M2] playwright import, serve-dir
  check-pages.mjs                + [M2] generic page gate: overflow, contrast, Georgian casing, focus (incl. clipping), names, motion, print
  check-precision-pixels.mjs     + [M2] screenshot identity vs a baseline build or URL
  check-all.mjs                  + [M4] the page-gate matrix over the registered layouts (CI entry point)
  check-secrets.mjs              + [M9] leak check against a private denylist
  checks/studio.mjs              + [M3] ← docs/plans/layout-studio/check-studio.mjs
  checks/ledger.mjs              + [M4] ← docs/plans/layout-ledger/verify.mjs
  lib/serve-dir.mjs              + [M2] static server on an ephemeral port for the gates
  lib/dom-checks.mjs             + [M2] in-page overflow/contrast/casing/focus functions (gates + admin e2e)
  fetch-fonts.sh                 + [M3] every font download, with expected sizes (run on the Mac, never on the server)
  dev.mjs                        + [M8] runs dev:server + dev:web
test/
  fixtures/site.stress.json      → [M1] from docs/plans/site.stress.json (every limit reached)
  unit/*.test.mjs                + [M1…M7] validate, render, render-draft, layouts, stress-fixture, theme, palettes, build-site, brand
  e2e/admin.e2e.mjs              + [M8]
src/
  content/site.json              + [M1] content; after [M9] the seed only
  content/en.mjs, ka.mjs         - [M1]
  template.mjs                   - [M1]
  styles.css, fonts.css          → [M1] src/layouts/precision/
  render.mjs                     + [M1] renderSite() · ~ [M2] ctx additions
  build-site.mjs                 + [M2] buildSite() → Map<path, file>
  schema/validate.mjs            + [M1]
  shared/localize.mjs escape.mjs icons.mjs jsonld.mjs fragments.mjs     + [M1]
  shared/document.mjs theme-init.mjs manifest.mjs                       + [M1] · ~ [M2]
  shared/sitemap.mjs                                                    + [M1] · ~ [M6] robots Disallow
  shared/brand.mjs               + [M7] ogInputs, iconInputs, brandName, brandNames (pure)
  layouts/index.mjs              + [M1] precision · ~ [M3] studio · ~ [M4] ledger
  layouts/precision/layout.mjs template.mjs     + [M1] (with `description`; template edits of Appendix B) · ~ [M8] thumbnail
  layouts/precision/styles.css fonts.css        → [M1] · ~ [M2] styles.css edits (M2 task 8)
  layouts/studio/{layout.mjs,template.mjs,styles.css,fonts.css}         + [M3]
  layouts/ledger/{layout.mjs,template.mjs,styles.css,fonts.css}         + [M4]
  admin-thumbs/studio.svg        + [M3] · precision.svg, ledger.svg + [M8]
  palettes.json                  + [M2] ← docs/plans/palettes.json, final Studio + Ledger neutrals
  palettes.mjs                   + [M2] ← docs/plans/check-palettes.mjs
  main.js                        = never changes (keeps the name main.1d55c0e3.js)
  fonts/                         + [M3] archivo-latin-wdth-wght.woff2, OFL-Archivo.txt
                                 + [M4] ibm-plex-sans-latin-wght-100-700.woff2, ibm-plex-mono-latin-400.woff2,
                                        ibm-plex-mono-latin-500.woff2, OFL-IBM-Plex.txt
  brand/committed.mjs            + [M2] interim brand provider (hashes the committed PNGs) · - [M7]
  brand/render.mjs, cards.mjs    + [M7] satori + resvg-wasm renderer, card and icon trees
  brand/fonts/*.ttf, OFL.txt     + [M7] six static TTF instances for satori
  brand/make.mjs                 ~ [M1] reads site.json · - [M7]
  brand/icon.html, og.html, icon-*.png, og-en.png, og-ka.png            - [M7]
admin/
  shared/draft-rules.mjs diff.mjs                                        + [M5]
  server/index.mjs app.mjs config.mjs cli.mjs                            + [M5] (cli grows in M6, M7)
  server/routes/{health,auth,account,registry,draft,revisions,io}.mjs    + [M5]
  server/routes/{preview,publish}.mjs                                    + [M6] · og-preview [M7]
  server/lib/{fsx,lock,store,auth,guard,headers,audit,backup}.mjs        + [M5]
  server/lib/{preview,publish,swap,cloudflare}.mjs                       + [M6]
  web/ (index.html, vite.config.mjs, src/…)                              + [M8]
  test/*.test.mjs                                                        + [M5…M8]
deploy/
  admin.env.example deploy.env.example                                   + [M5]
  ecosystem.config.cjs ols-admin-context.conf remote-deploy.sh           + [M9] (never in the release tarball: the deploy job sends its own checkout's copies)
docs/plans/                      the specs, their reference code and this plan (design record; not deployed)
```

`package.json` scripts, final state (milestone that adds each): `build` `node build.mjs` [M1] · `check:stress` `SITE_JSON=test/fixtures/site.stress.json OUT_DIR=/tmp/dist-stress node build.mjs && node scripts/check-layout-stress.mjs --dist /tmp/dist-stress` [M1] · `test` `node --test "test/unit/**/*.test.mjs"` [M1], from M5 `node --test "test/unit/**/*.test.mjs" "admin/test/**/*.test.mjs"` · `check:all` `node scripts/check-all.mjs` [M4] · `cli` `node --env-file-if-exists=.env.development admin/server/cli.mjs` [M5] · `dev`, `dev:server`, `dev:web`, `build:admin` (admin-ops §10.1) and `test:e2e` `node --test test/e2e/admin.e2e.mjs` [M8] · `check:secrets` `node scripts/check-secrets.mjs` [M9].

---

## 4. Data model and migration

Detail: [data-model.md](data-model.md) §2–§7; server envelopes and draft rules: [admin-ops.md](admin-ops.md) §3.

- **Shape.** `site.json` = `schemaVersion` (1), `settings` (`layout`, `palette`, `defaultTheme`, `updated`, `autoUpdateDateOnPublish`, `siteUrl`), `person`, `meta`, `ui`, `hero`, `contact`, `sections` (`profile`, `skills`, `abilities`, `workstyle`, `principles`, `experience`, `languages`, `contact`).
- **Bilingual strings** are `{ "en": "…", "ka": "…" }` with exactly those keys. Values that do not translate (ids, hrefs, levels, years, contact values, monogram, settings) are stored once. Each list item exists once and carries both languages, so EN and KA cannot drift apart.
- **Fixed structure in code:** the two languages, paths `/` and `/ka/`, the eight sections, their order, numbering and anchors (`#work-style` is a public URL), and the three skill levels. The admin edits content, never structure.
- **Stable ids** on every list item (`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`); the admin creates new ones as 8 random base36 characters.
- **Limits** measured in the real fonts against all layouts: name parts ≤ 10 letters, nav label ≤ 28 and ≤ 100 for all eight per language, exactly 4 facts, fact value ≤ 10, `ui.langShort` and `ui.printShort` ≤ **4** (5 overflowed the 320 px header in all three layouts), and 91 limits in total from `limitsTable()`.
- **Stress fixture.** `docs/plans/site.stress.json` (revised in review, copied to `test/fixtures/` in M1) reaches the limit of every `limitsTable()` row in both languages, except `settings.siteUrl` (fixed by `SITE_URL`) and the nav labels (total 98 EN / 99 KA with one label at 28, because eight labels cannot all be 28). It also carries two unbreakable tokens: the 29-letter `ინფრასტრუქტურისადმინისტრირება` in `sections.skills.title.ka` and `WordPress/WooCommerce/WPGraphQL/StoreAPI` as the first skill name. It validates with 0 errors and 10 warnings (`LONG` ×4, `LONG_TOKEN` ×3, `LONG_WORD` ×3). Every layout must pass the gates with it; `test/unit/stress-fixture.test.mjs` (M2) keeps it at the limits.
- **Validation** (`src/schema/validate.mjs`, zero dependencies, browser-safe) returns errors and warnings with `$.path` locations. Hard rules include: no Cyrillic, no `RU` token or "Russian"/"რუსულ", no unknown key (so no education section), `https:`/`mailto:`/`tel:` links only, with the whitespace, case and `mailto:?bcc=` tricks refused, and `GEORGIAN_IN_CAPS` (error) for a Georgian letter in the `.en` value of a field that layouts render in capitals. Warning `LONG_TOKEN` flags a whitespace-free run over 24 characters in a heading, name, role or lead. `build` and `save` modes differ only for an unknown palette (fallback warning vs error). Code for both new rules: Appendix B, M1.
- **Canonical form.** Every stored document goes through `canonicalize()`; its ETag is `sha256(canonical JSON)`.
- **Draft rules** (admin-ops §3.3). The draft may hold content errors while the owner types (empty KA, half-typed URL) but never structural ones (`DRAFT_BLOCKING`: `TYPE MISSING MISSING_LANG UNKNOWN_KEY LANG_KEY RUSSIAN-as-key ID DUPLICATE_ID ENUM INT CONTROL_CHAR`, any unknown code, and **any error whose path starts with `$.settings.`**, so a bad date or origin never reaches a renderer). The server overwrites `settings.siteUrl` with `SITE_URL` before validating a save, import, preview or publish. Publish requires zero errors and explicitly acknowledged warnings.
- **New UI strings** seeded by the migration: `ui.themeShort`, `ui.colGroup`, `ui.colSkill`, `ui.colDepth` (Georgian values need the owner's check, §0).
- **Later schema changes** ship a pure `migrate_vN_to_vN+1(site)` next to the validator and a `cli migrate [--dry-run]` that applies it to the draft, the live document and every revision. `cli init` never migrates. The deploy stops the service, backs up and migrates before it flips the release, and restores that backup if the new release fails its health check (admin-ops §10.3).

**Migration (M1).** `node scripts/migrate-content.mjs` reads `src/content/en.mjs` + `ka.mjs`, writes `src/content/site.json`, and exits 1 on any conflict, lossy field or validation error. Result on today's content: 0 conflicts, exact round trip for both languages, output byte-identical to `docs/plans/site.example.json`. The twelve fields that are not plain copies (name split, skill `name · detail` split, experience periods, renamed Languages section, and so on) are listed with their handling in data-model §0.

---

## 5. Rendering

Detail: [data-model.md](data-model.md) §5, §8, §10; [palettes.md](palettes.md) §5–§6; [layout-studio.md](layout-studio.md) §0.3; [layout-ledger.md](layout-ledger.md) §9.2; [admin-ops.md](admin-ops.md) §5.1.

### 5.1 Modules

| Module | Role |
|---|---|
| `src/shared/localize.mjs` | constants (`LANGS`, `LOCALES`, `SECTIONS`, `LEVELS`) and `localize(site, lang)` → the per-language tree `c` (the exact shape of the old `en.mjs`/`ka.mjs` plus additive keys: `navLabel`, `givenName`/`familyName`, skill `label`/`detail`, `contact.primary`/`buttons`, ids); `siteContext(site)` |
| `src/shared/document.mjs` | `renderDocument(c, ctx, body)` and `renderHead(c, ctx)`: doctype, head (meta, hreflang, OG, JSON-LD, icons, preload, stylesheet, theme script), skip link, script tag |
| `src/shared/fragments.mjs` | `copyButton`, `themeToggle`, `printButton`, `langSwitchLink`, `orderedSections`, `isExternal`: markup whose `data-*` attributes are the contract with `src/main.js` |
| `src/shared/{escape,icons,jsonld,theme-init,sitemap,manifest}.mjs` | `esc`, `pad`, `jsonForScript`; SVG icons; schema.org Person; inline theme script; sitemap/robots; web manifest |
| `src/render.mjs` | `renderSite(site, { layout, palette, assets })` → `{ 'index.html', 'ka/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'site.webmanifest' }`; pure |
| `src/build-site.mjs` | `buildSite(site, opts)` → every file of a deployable site, in memory (§5.5) |
| `src/layouts/index.mjs` | `LAYOUTS = { precision, studio, ledger }`, each `{ meta, renderBody }`; `settings.layout` is validated against its keys |
| `src/palettes.{json,mjs}` | palette data, contrast gate, CSS generator (§7) |

### 5.2 Layout contract

A layout is a folder `src/layouts/<id>/` with `layout.mjs` (default export = manifest), `template.mjs` (`export function renderBody(c, ctx)`) and the CSS files its manifest lists.

| Manifest field | Req. | Precision | Studio | Ledger | Used by |
|---|---|---|---|---|---|
| `id` (= folder = `settings.layout`) | yes | `precision` | `studio` | `ledger` | registry, validation |
| `label` | yes | `A · Precision` | `B · Studio` | `C · Ledger` | admin picker |
| `description` (one line) | yes (Precision's added in M1) | "The current design: identity rail on the left, content on the right, skills as a ledger table." | "Dark-first. Bento hero, wide Archivo headings, hairline bands, skills as a three-column table." | "Pure white, IBM Plex, numbered index column, skills as a table." | admin picker |
| `thumbnail` (path under `src/`) | yes from M8 | `admin-thumbs/precision.svg` | `admin-thumbs/studio.svg` | `admin-thumbs/ledger.svg` | admin picker |
| `css` (files in the folder, joined with `\n`) | yes | `fonts.css`, `styles.css` | same | same | buildSite |
| `fonts` (woff2 basenames in `src/fonts/`) | yes | chivo, jetbrains-mono, noto-georgian | archivo, jetbrains-mono, noto-georgian | plex-sans, plex-mono-400, plex-mono-500, noto-georgian | buildSite copies only these |
| `preload` `{ en: [], ka: [] }` | yes | EN: Latin faces; KA: Noto Sans Georgian first, then the Latin faces (each layout's `layout.mjs`) | same rule | same rule | document.mjs |
| `themeColor` `{ light, dark }` | yes | `#fafafb` / `#151619` | `#f5f7f9` / `#101419` | `#ffffff` / `#0d1013` | `<meta name="theme-color">` |
| `manifestBackground` | yes | `#111318` | `#101419` | `#0d1013` | web manifest |
| `defaultTheme` (`light`\|`dark`) | no | — | `dark` | — | effective theme (§5.4) |
| `headExtra(c, ctx)` → string | no | — | — | print running footer | document.mjs, before the stylesheet link |
| `og(inputs)` → satori tree | no | — | — | — | brand renderer; default is the Precision card (later: per-layout cards) |

`ctx` (built by `renderSite`; templates read only `c` and `ctx`):

| Key | Value |
|---|---|
| `siteUrl`, `host`, `updated`, `person`, `authorName`, `email`, `telephone` | from `siteContext(site)` |
| `layout` | the manifest |
| `paletteId` | the effective palette id (after the unknown-id fallback) |
| `defaultTheme` | the effective default theme, `system`\|`light`\|`dark` (§5.4) |
| `alt` | the other language's localized tree |
| `assets` | `{ base, cssHref, jsHref, manifestHref, icons: { i32, i180, i192, i512 }, og: { en, ka } }`. Every URL except `og` starts with `base` (`/`, or `/admin/preview/<token>/` in the preview). `og` values are always root paths on the public origin, because `og:image` is an absolute URL (`siteUrl + og[lang]`). |

Rules every layout follows (checked by the gates in §11):
1. Pure: no filesystem, clock or randomness; every string through `esc()`, `ctx.updated` included; no content hard-coded in templates.
2. `<main id="main">`; each section `id = sec.id`; navs use `sec.navLabel`; numbering from `orderedSections(c)`.
3. Copy, theme, print and language controls come from `fragments.mjs`; `src/main.js` needs no change for any layout.
4. Never declare the six palette tokens. Text in the accent colour uses `--accent-ink`; fills use `--accent` with `--on-accent` content; focus rings use `--focus`.
5. Dark neutral blocks sit inside `@media screen …`, so print always gets light values.
6. Casing only through a `--caps`-style token that is `none` under `html[lang="ka"]`; Georgian labels switch from mono faces to Noto Sans Georgian.
7. `overflow-wrap: anywhere` on fact values, display names and contact values; top-nav links `white-space: nowrap` and shown only where the 100-character budget fits.
7a. `overflow-wrap: break-word` on `body` (a long token in a heading or skill name wraps instead of widening the page; it does not change min-content sizes, so normal content renders the same).
8. Asset URLs from `ctx.assets`; `@font-face` URLs relative (`url('fonts/…')`), so they resolve under both `/` and the preview base.
9. Reduced motion removes transitions and reveals; every focusable element shows a 2 px ring that no `overflow: hidden` ancestor clips; every visible link and button has an accessible name at every width (a label that hides on small screens is visually hidden, never `display: none`).
10. `renderBody` never throws for a document that passes `DRAFT_BLOCKING`: lists may be empty or over their maximum, KA strings may be empty, and `c.sections.contact.primary` may be `null` (the big email and CTA row are then omitted).

### 5.3 Palette application

- **Build time, one palette.** CSS = the layout's `css[]` joined with `"\n"`, then `"\n" + paletteCss(pal, ':root', tokens)`, named `styles.<md5-8>.css`. Changing the palette changes the file name.
- Generated shape: light values on `:root`; dark values under `@media screen and (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `@media screen { :root[data-theme="dark"] }`. Print therefore always resolves to the light values.
- `<html data-layout="…" data-palette="…">` is stamped on every page.
- **Admin preview only:** `palettes-all.<md5-8>.css` (`allPalettesCss()`), scoped `:root[data-palette="x"]` at specificity (0,2,0)/(0,3,0), overrides the public block in every state. It is never linked from a public page.
- An unknown palette id (e.g. removed after saving) builds with `palettes.json → default` and a `PALETTE_FALLBACK` warning. No raw colour ever travels from the admin into CSS: the admin stores an id.
- `site.webmanifest` `theme_color` = `parseColor(pal.light['--accent']).hex` (cobalt `#0056bc`).

### 5.4 Default theme

Precedence: `?theme=` URL parameter > the visitor's stored choice (`localStorage.theme`) > `settings.defaultTheme` when `light`/`dark` > the layout's `defaultTheme` > `prefers-color-scheme`.

```js
// src/shared/theme-init.mjs
export const effectiveTheme = (setting, layoutMeta) =>
  setting === 'light' || setting === 'dark' ? setting : layoutMeta.defaultTheme ?? 'system';
```

`renderDocument` adds ` data-theme="<t>"` to `<html>` when the effective value is not `system` (no-JS visitors get it too) and passes it to `themeInitScript(t)`. For `system`, the script is byte-identical to today's. `main.js` already reads `html[data-theme]` and needs no change. `theme-color`: for `system`, the `prefers-color-scheme` pair from `layout.themeColor` (Precision unchanged); for `light` or `dark`, one `<meta name="theme-color" content="${layout.themeColor[t]}">` without `media`, so a first-time Studio visitor on a light-OS phone gets a dark browser bar over the dark page.

### 5.5 `buildSite()` and `build.mjs`

```js
// src/build-site.mjs
/** @returns {Promise<Map<string, { body: Buffer|string, type: string, immutable: boolean }>>} */
export async function buildSite(site, {
  mode = 'publish',          // 'publish' | 'preview'
  base = '/',                // prefix for every asset URL; preview: '/admin/preview/<token>/'
  brand,                     // { files: Map<name, Buffer>, og: { en, ka }, icons: { i32, i180, i192, i512 } }, names already hashed (§8.8)
  today,                     // 'YYYY-MM-DD' in Asia/Tbilisi, passed to validate()
  palettes = loadPalettes(), // injectable for tests
}) {}
```

Steps:
1. **publish:** `validate(site, { mode: 'build', layoutIds: Object.keys(LAYOUTS), paletteIds, today })`; any error throws `BuildValidationError(errors)`. **preview:** content errors are tolerated, but every href that fails `hrefError()` is replaced by `#invalid-link` in a copy first.
2. Resolve layout and palette (fallback, §5.3). `checkPalettes()` must report 0 failures, else throw.
3. CSS → `styles.<md5-8>.css`; `src/main.js` → `main.<md5-8>.js`; `layout.meta.fonts` → `fonts/<name>.woff2`.
4. Brand files from `brand`; `site.<md5-8>.webmanifest` referencing the hashed icons.
5. `renderSite()` → the HTML files; publish mode adds `sitemap.xml`, `robots.txt`, and `.htaccess` + `_headers` verbatim (OLS ignores their `Header` lines; they stay for parity with other hosts).
6. `immutable: true` for hashed files and fonts; `false` for HTML, XML, TXT and dotfiles.

`build.mjs` becomes a CLI over `buildSite()`: read `SITE_JSON` (default `src/content/site.json`; a server envelope `{ kind, …, site }` is also accepted), apply `LAYOUT` / `PALETTE` overrides before validation and `SITE_URL` / `BUILD_DATE` after it, obtain `brand` (M2–M6: `committedBrand()`, and when the palette is not `cobalt` print `BRAND_STALE: icons and OG cards stay cobalt until M7`; M7+: `renderBrand()` with the cache `.cache/brand/`), and write the Map into `OUT_DIR` (default `dist`) after removing it. It exits 1 before touching `OUT_DIR` on any validation or palette-gate failure and logs `built dist/ (<layout>, <palette>, styles.<h>.css, main.<h>.js) · updated <date>`.

**Asset naming rules.** Styles, script, manifest, icons and OG cards carry an 8-hex md5 in the name. Fonts keep descriptive fixed names and are never replaced with different bytes: a changed font gets a new name, and the swap refuses to overwrite an immutable file (§8.7). HTML, XML and TXT are served uncached.

---

## 6. The three layouts

**Common to all three:** content only from `site.json`; the eight sections in order (hero, 01 Profile in two columns on wide screens, 02 Stack & skills with the Core/Strong/Working scale and never percentage bars, 03 Abilities, 04 How I work, 05 Principles, 06 Experience, 07 Languages, 08 Contact, footer with the pinned last-updated date); light and dark; A4 print in light colours at every screen theme, EN ≤ 5 pages and KA ≤ 6 pages; no horizontal scroll from 320 px; AA contrast with all six palettes; no uppercase Georgian; the stress fixture passes. None uses a photo, project list, cream/beige ground, terracotta, serif display, dotted texture, pill chip or rounded 3-column card grid.

**A · Precision** (live design; current `src/template.mjs` + `src/styles.css`). Sticky 340 px identity rail, content column, hero tagline with a four-item facts strip, skills ledger table, cobalt accent. **It stays pixel-identical to production.** M1 reproduces today's output byte for byte. M2 moves accent colours to the palette block, adds data attributes and the fixes below; screenshots at 390/768/1080/1440/1920 px, EN and KA, light, OS dark and `?theme=dark`, must be identical (verified 30/30 with every edit of M2 task 8). Deliberate differences, all bug fixes:
1. The top nav shows from 1440 px (EN) and 1680 px (KA) instead of 1280/1600 px, because today it wraps into two lines between 1280 and ~1305 px (EN) and fails the stress fixture; the rail nav and the menu cover navigation below those widths.
2. Printing while the screen theme is dark prints dark text on white paper (today it prints near-white text: the print rule loses to the dark selectors on specificity).
3. The printed accent is `#0056bc` (the screen value) instead of `#1f4fbf`.
4. Fact values may wrap inside a word, which only matters for long values entered in the admin.
5. Below 600 px the brand link keeps its accessible name: the name is visually hidden instead of `display: none` (today the link has no name there, and Lighthouse mobile scores 0.96).
6. Below 380 px the header uses the 14 px gutter and the narrower controls that today's `max-width: 400px` block intends but the later `max-width: 600px` block overrides; without it the stress fixture's header ends at 316 of 320 px (the gate requires ≤ 312).
7. `body { overflow-wrap: break-word; }`: a 29-letter Georgian word or a 40-character tool list wraps instead of widening the page.
8. The focus ring of the language link sits inside the `.lang` box (`outline-offset: -3px`), which clips it today.
9. Between 601 and about 640 px a 10+10-letter Georgian name in the header wraps onto two lines instead of pushing the controls off-screen (`.brand { flex: 0 1 auto; min-width: 0; }`; found while verifying the revised fixture: the full-width sweep overflowed KA 610–640 px by up to 34 px, and already by 6 px with the old fixture).
Items 5–9 do not change the 30 identity screenshots. Known exemption, kept for identity: Precision's mono stack has no Noto Sans Georgian, so Georgian typed into an EN mono label renders in a system font.

**B · Studio** ([layout-studio.md](layout-studio.md); module in `docs/plans/layout-studio/`). Dark-first (D8). Sticky 64 px header: lime-able GS mark, section nav shown from a tier the template computes from the real labels (live content: EN 1280 px, KA 1600 px; otherwise a Sections menu), language switch, theme, Save as PDF. The hero is a 12-column bento of four flat tiles: name 7 + role 5 over contact 5 + facts 7 at ≥ 1080 px; 12 / 6 + 6 / 12 at 768–1079; one column below. Sections are full-width bands separated by 1 px rules with content capped at 1360 px; skills are a three-column hairline table with level squares; abilities, principles and experience are split rows, not cards. Archivo (width 100–112 %) for display, JetBrains Mono labels in EN, Noto Sans Georgian first on `/ka/` with its own scale (h1 78 px) and sans labels. The name and big values shrink to fit their tile, so 10-letter names never break. Designed with Lime; works with all six palettes. Print: bento as outlined boxes, EN 4 / KA 5 pages. Adds 90 KB of fonts (Archivo variable, Google's latin file). Review edits (M3): the brand name is visually hidden below 600 px instead of `display: none`; `--st-mono` lists Noto Sans Georgian second, so Georgian in EN mono labels uses the self-hosted face; the contact block is omitted when there is no primary email.

**C · Ledger** ([layout-ledger.md](layout-ledger.md); module in `docs/plans/layout-ledger/src/layouts/ledger/`). Light-first, pure white, IBM Plex Sans 300/400/500 and Plex Mono 400/500. A numbered index column ("spine") holds 00–08 on the baseline of each h2 (measured 0.0 px off) and hanging sub-numbers 3.1… and 5.1…. Skills are a real table (Group / Skill / Depth, ARIA roles kept when it stacks below 720 px) with border-drawn ■ ◧ □ marks that print without background graphics. 62 px sticky header with an inline nav from a computed breakpoint (live: EN 1280 px, KA 1440 px), else a Sections menu. The most monochrome layout: a palette changes only section numbers, COPY, the email underline, the primary button and focus rings. Georgian h1 in Noto Sans Georgian 350 at 0.8× the EN size (the existing Noto file is variable 100–900). Print keeps the spine, repeats the table header, and adds a running footer "name · host  n / N" (via `headExtra`); EN 5 / KA 6 pages. Adds 60 KB of fonts. Review edits (M4): `body { overflow-wrap: break-word; }` (without it the stress fixture's long tokens scroll the page by 21 px EN and 148 px KA at 320 px) and `@media (min-width: 401px) { .lg-leg { display: inline-block; max-width: 100%; white-space: normal; } }` (a legend item at its limit, 14-letter level plus 32-letter hint, is `nowrap` today and overflowed KA 410–450 px by up to 41 px; now it wraps inside itself only when it alone is wider than the line; the seed renders identically at 390–1920 px).

---

## 7. Palettes

Detail: [palettes.md](palettes.md). A palette owns exactly six tokens: `--accent` (fills), `--on-accent` (text on fills), `--accent-ink` (accent text and thin markers), `--accent-soft` (small tints, alpha ≤ 0.3), `--accent-line` (decorative hairlines), `--focus` (focus ring). Layouts own every neutral.

| id | EN / KA label | Light fill | Light text/markers | Dark fill | Dark text | Model |
|---|---|---|---|---|---|---|
| `cobalt` (default) | Cobalt / კობალტი | `#0056bc` | `#0056bc` | `#78c0ff` | `#78c0ff` | today's accent, value for value |
| `lime` | Lime / ლაიმი | `#b6e630` | `#406c07` | `#b6e630` | `#b6e630` | light fill + dark text in both themes |
| `emerald` | Emerald / ზურმუხტი | `#0c6f4d` | `#0c6f4d` | `#62d8a6` | `#62d8a6` | as cobalt |
| `amber` | Amber / ქარვა | `#febf12` | `#805708` | `#febf12` | `#febf12` | light fill + dark text |
| `crimson` | Crimson / ჟოლოსფერი | `#ba1b35` | `#ba1b35` | `#cc243d` (white text) | `#f56b7a` | dark fill in both themes |
| `graphite` | Graphite / გრაფიტი | `#2e3948` | `#2e3948` | `#d9dee6` | `#d9dee6` | near-monochrome; links keep underlines |

- **Contrast gate.** `node src/palettes.mjs` checks every palette × {Precision, Studio, Ledger, worst-case envelope} × {light, dark} for accent text on page and surface (≥ 4.5), text on fills and on hovered fills (≥ 4.5), focus ring (≥ 3.0), text on soft tints (≥ 4.5), hairlines (≥ 1.8). Result: **432/432**. Lowest margins: 5.07 (lime text, envelope), 4.76 (crimson dark hover), 4.52 (crimson dark on tint). `build.mjs`, `buildSite()` and CI refuse to continue when it fails.
- **Grep gates** on every layout stylesheet (must print nothing): no declaration of the six tokens; no `color: var(--accent)`; no outline using `--accent`.
- **Final neutrals** recorded in `src/palettes.json → layouts` (M2): Studio light `bg oklch(97.5% 0.003 258)`, `surface oklch(94% 0.005 258)`, `ink oklch(19% 0.012 258)`; Studio dark `bg oklch(19% 0.012 258)`, `surface oklch(23.5% 0.012 258)`, `ink oklch(96% 0.004 250)`; Ledger light `bg #fff`, `surface oklch(96.5% 0.003 250)`, `ink oklch(17% 0.008 250)`; Ledger dark `bg oklch(17% 0.008 250)`, `surface oklch(21.5% 0.008 250)`, `ink oklch(96% 0.003 250)`.
- **Picker** (admin): palettes.md §8 markup and CSS, verbatim. Native radio list, 128×48 two-half swatches drawn over the selected layout's light and dark page colours, meta line "`<light accent-ink hex>` · min X : 1" read from `GET /registry` (`paletteHex[id].light['--accent-ink']`, `paletteMin[id][layout]`; the SPA never converts colours itself). Changing layout never changes the palette.
- Adding a 7th palette is data only (palettes.md §11): add the object, run the gate, done; icons and cards follow automatically (M7).

---

## 8. Admin application

Detail: [admin-ops.md](admin-ops.md) §3–§7, §11.

### 8.1 Stack and process

Node 24; **Hono 4.13.7 + @hono/node-server 2.1.1** (two pure-JS packages, no transitive dependencies) on `127.0.0.1:3097`; PM2 fork mode, one instance, `uid`/`gid` = `$SITE_USER`; the app exits at boot when it runs as root in production. **Vue 3.5.42 + Vite 8.3.0 + @vitejs/plugin-vue 6.0.9** are devDependencies: the SPA is compiled in CI and served from `admin/web/dist/`. Runtime dependencies (exact pins, lockfile committed): `hono`, `@hono/node-server`, `satori`, `@resvg/resvg-wasm`. Everything is mounted under `/admin/` because OLS forwards the original URI and the session cookie is `Path=/admin`.

### 8.2 Screens (hash routes, English UI copy)

| Route | Contents |
|---|---|
| `#/login` | username, password; errors never say which field was wrong; 429 shows the wait; forced password change after the first login |
| `#/` Dashboard | status strip (live rev, publish time, layout, palette, "Draft differs from live in N fields", Publish, Discard draft); **Layout** radio group with 320×200 thumbnails, label and description; **Palette** picker (§7); **Default theme** ("Follow the visitor's system", or "Layout default (dark)" for Studio; Light; Dark); **Last updated** date + "Set to today when content changes on publish"; **live preview** (EN/KA, Desktop 1440/Mobile 390, Light/Dark, Reload, Open in new tab) showing unsaved edits |
| `#/content/<tab>` | form generated from `buildSchema()`; tabs Person & hero, Contact rail, Profile, Stack & skills, Abilities, How I work, Principles, Experience, Languages, Let's talk, Interface strings, each with an issue count; EN and KA inputs side by side (stacked below 1100 px) with `n / max` counters (warning at ⌊0.9 × max⌋, error above max); "Copy EN → KA"; Add/Remove for optional fields; list editor with Move up/Move down/Remove (10 s undo toast)/Add, focus managed; nav budget meter (100 per language, 28 per label); validation in the browser on every change (same module as the server) |
| `#/seo` | titles and descriptions per language with a search-result preview; EN/KA social-card previews; alternate name, address, `sameAs`; `siteUrl` read-only |
| `#/revisions` | live builds (roll back), revisions (preview, changes vs draft, restore to draft), save checkpoint with a note |
| `#/account` | change password; sessions, sign out others; last 50 audit events; export draft/live; import JSON into the draft |

Visual rules: `--adm-*` tokens of admin-ops §6.3 (all text ≥ 4.5 : 1 in light and dark, measured); system UI font plus self-hosted Noto Sans Georgian, `lang="ka"` on Georgian inputs; corners 2–4 px, 1 px hairlines, no pills, no shadows; 2 px focus ring on every control; hit targets ≥ 32 px; no transitions under reduced motion; usable at 390 px (preview and side-by-side editing target ≥ 1280 px). Autosave (admin-ops §6.6): 1.5 s debounce (≤ 10 s while typing); the ETag is read only from the JSON body's `etag` field and sent as `If-Match: "<etag>"` (Cloudflare turns a compressed response's `ETag` header into a weak `W/"…"`); conflict dialog on 412 whose two choices each keep the other version in Revisions (`pre-overwrite` snapshot, or a checkpoint of the local copy); an offline copy in `localStorage` offered at every boot, even when the server draft moved on; login modal on 401 that resends the queued save; `Ctrl/Cmd+S`. Publish, discard, restore and import first settle the autosave queue (§8.7).

### 8.3 API (base `/admin/api`, JSON; every call sends `X-Requested-With: samsiani-admin`)

"fresh" = valid session and the first-login password change done. In production every `/admin/*` request except `GET /health` must also carry Cloudflare's `x-sm-edge` header (else 403 `edge`, §8.4).

| Endpoint | Auth | Does | Main error responses |
|---|---|---|---|
| `GET /health` | none | `{ ok, release, startedAt, auth, data }` (PM2 health check) | — |
| `GET /session` | header only | session state and expiry times | — |
| `POST /auth/login` | none | `{ username, password }` → session cookie | 400, 401 `invalid_credentials`, 429 `rate_limited`/`busy`, 503 `not_initialised` |
| `POST /auth/logout` · `POST /auth/password` | session | end session · change password (sessions epoch + 1) | 400 `weak_password`, 401, 429 |
| `GET /account/sessions` · `POST /account/sessions/revoke-others` · `GET /account/audit` | fresh | sessions, revoke, audit events | 401 |
| `GET /registry` | fresh | layouts (`id, label, description, thumbnail, defaultTheme`), `palettes.json`, palette check rows, `paletteHex` (`{ id: { light: { token: '#rrggbb' }, dark } }` via `parseColor(v).hex`), `paletteMin` (`{ id: { layoutId: lowest accent-ink/bg or accent-ink/surface ratio over both themes } }`), `limitsTable()`, `buildSchema()` | — |
| `GET /draft` · `PUT /draft` | fresh (+ `If-Match`) | read · autosave `{ site, force? }`; `force` snapshots the server draft as `pre-overwrite` first | 400 `draft_rejected`, 412 `precondition_failed`, 428 |
| `POST /draft/discard` · `POST /draft/checkpoint` | fresh | draft = live · named snapshot `{ note, site? }` (`site`, under the draft rules, stores a document that is not the draft) | 412 |
| `POST /validate` | fresh | full save-mode rules | 400 |
| `POST /preview` | fresh | render draft/site/revision → `{ token, base, expiresAt }` | 400, 422 `preview_render_failed` (previous token stays valid), 429 |
| `GET /admin/preview/:token/*` | capability token | rendered files from memory | 404 "Preview expired" |
| `POST /og-preview` | fresh | PNG card for `{ lang, site? }` | 400, 429 |
| `POST /publish` | fresh + `If-Match` | publish the draft `{ acknowledgeWarnings, note? }` → summary plus `draft: { rev, etag, updated }` | 400 `invalid`, 409 `warnings_unacknowledged`, 412, 423 `locked`, 500 `publish_failed {stage}` |
| `GET /builds` · `POST /builds/rollback` | fresh | kept builds · roll back `{ buildId? }` | 404, 423 |
| `GET /revisions` · `GET /revisions/:id` · `POST /revisions/:id/restore` | fresh | history · document + changes vs draft · restore into the draft | 404, 423 |
| `GET /export?source=draft\|published` · `POST /import` | fresh | download envelope · replace the draft (≤ 320 KB) | 400, 413 |

Ids are checked by regex before any filesystem access, in the API and in the CLI (`rollback --to`, `restore-build --from`, revision ids inside a restored backup): revision `^\d{8}T\d{9}Z-[a-z-]+-r\d+$`, build `^\d{8}T\d{6}Z-r\d+$`, token `^[A-Za-z0-9_-]{43}$`. `If-Match` is parsed leniently: an optional `W/` and the quotes are stripped, the value is split on commas, and every part must equal the draft ETag. Errors return `{ error, message, requestId }`, never a stack.

### 8.4 Authentication, sessions, CSRF, headers

- **Edge check (first guard, production):** every `/admin/*` request except `GET /admin/api/health` must carry `x-sm-edge`, and every comma-separated value of it must equal `EDGE_SECRET` (`timingSafeEqual` of the sha256 digests); else 403 `edge`. A Cloudflare Transform Rule sets the header on `/admin*` and overwrites any value a client sends (§9.3), so requests that bypass Cloudflare (the origin address is in old commits; other tenants reach `127.0.0.1:3097` directly) never get further. Production boot refuses to start without an `EDGE_SECRET` of ≥ 32 bytes; in development the check is off.
- **Password:** scrypt `N=65536, r=8, p=2, keylen=64, maxmem=128 MiB` (Node's default `maxmem` rejects these parameters, so pass it), format `scrypt$1$N$r$p$salt$key`, 12–128 characters after NFKC, compared with `timingSafeEqual`; an unknown username still costs one scrypt. The first password comes from `ADMIN_INITIAL_PASSWORD`, used only on a true first boot (no `publish-state.json` yet), and must be changed at first login; otherwise a missing `auth.json` means `not_initialised` until `cli set-password`, which also creates the file.
- **Session cookie:** `__Secure-sm_admin` (`sm_admin` in local dev), `HttpOnly; Secure; SameSite=Strict; Path=/admin`; value `v1.<payload>.<HMAC-SHA256>` with `sid`, issued-at, last-seen and epoch; 12 h idle, 7 d absolute; server-side allowlist of at most 10 sessions; new `sid` on every login; `SESSION_SECRET_PREV` for rotation. `auth.json` and `sessions.json` are the only authority: the service keeps no in-memory copy, re-parses either file when its `mtimeMs` or `ino` changes (checked on every request), and changes them only by read-modify-write under the `write` lock, as `cli set-password` does. A password reset from the CLI therefore takes effect on the next request.
- **Rate limits** (checked before hashing; the client key is read only after the edge check): 5 failed logins per client per 15 min, 60 per hour overall; client = `CF-Connecting-IP` (first value of a doubled header), IPv6 keyed per /64. **Device cookie:** a successful login sets `__Secure-sm_dev=v1.<16 random bytes>.<HMAC-SHA256(SESSION_SECRET, 'dev.' + id)>` (b64url; `HttpOnly; Secure; SameSite=Strict; Path=/admin/api/auth; Max-Age=34560000`). A login that carries a valid device cookie skips the per-client and global locks and has its own limit, 5 failures in 15 min per device id, so an attacker who keeps the global lock closed cannot lock the owner out of a known browser. Also: scrypt queue 1 running + 3 waiting; preview 60/min, publish 10/min, import 10/h, any call 600/min.
- **CSRF:** the custom header on every call; on unsafe methods an `Origin` whose every comma-separated value is allowed (accepts the Cloudflare + OLS doubled `https://samsiani.me, https://samsiani.me`, rejects a mixed pair or `null`); `Sec-Fetch-Site: same-origin` when present; the same every-value rule for `X-Requested-With`, `Sec-Fetch-Site`, `x-sm-edge` and `If-Match`, which pass through the same proxy; `SameSite=Strict`; JSON bodies only; 256 KB limit (import 320 KB). Hono's own `csrf` middleware is not used (it rejects the doubled Origin).
- **Headers on every `/admin/` response:** `X-Robots-Tag: noindex, nofollow, noarchive`, `nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, HSTS, `X-LiteSpeed-Cache-Control: no-cache`. SPA: `no-store`, CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; manifest-src 'self'`, `X-Frame-Options: DENY`, COOP/CORP same-origin. The SPA contains no inline script, no `style` attribute and no `v-html`.
- **Audit log** (`data/audit.log`, JSONL, 1 MiB rotation): logins, failures, locks, password and session changes, discard, checkpoint, restore, import, publish, publish failure, `publish_recovered`, `publish_reverted`, rollback, recovery, boot. Bodies, cookies, passwords and tokens are never logged.

### 8.5 Storage and concurrency

`data/draft.json`, `data/site.json` and `data/revisions/*.json` are envelopes `{ kind, rev, etag, …, site }`. Writes are atomic (temp file opened `wx`, `fsync`, `rename`, directory `fsync`; on any error, a full disk included, the handle is closed and the temp file removed) and serialised by an in-process mutex plus an `O_EXCL` lockfile (`publish` then `write`, never the reverse), because the service and the CLI can both write. Boot removes stale `.*.tmp` files anywhere under `data/` and `builds/.tmp-*`. Revisions: `publish`, `pre-restore`, `pre-import`, `pre-discard`, `pre-rollback`, `pre-overwrite` (the server draft, before a forced save replaces it; exempt from the 20-minute rule), `pre-migrate`, `checkpoint` and `autosave` (the previous draft is snapshotted when the newest revision is older than 20 min); newest 30 kept plus the live one; identical content is never snapshotted twice. Daily `data/backups/YYYY-MM-DD.json.gz` (draft, live, publish state, revisions; never credentials), 30 kept. A corrupt `draft.json` recovers from the newest revision at read time. `cli restore-backup` checks the whole file first (revision ids against the regex, draft rules on the draft and revisions, full validation of the live document), stages it in `data/.restore-<ts>/` and only then renames it into place; any failure rejects the whole file.

### 8.6 Preview

`POST /preview` applies the draft rules to the posted document (after setting `settings.siteUrl` to `SITE_URL`), then `buildSite(site, { mode: 'preview', base: '/admin/preview/<token>/', brand })` renders both languages into an in-memory map behind a 256-bit token (15 min TTL, 20 kept). `brand` needs no build on disk, so the preview works right after `cli init` (buildId `null`): M6 uses `committedBrand({ namesOnly: true })`; from M7, `brandNames(site, palette, layoutMeta, RENDERER_ID)` (pure, `src/shared/brand.mjs`) returns `{ files: new Map(), og, icons }` with the names the next publish will produce. `buildSite` runs inside `try/catch`: a throw returns 422 `{ error: 'preview_render_failed', message }`, the previous token stays valid, and the frame shows "Preview cannot render this draft: <message>" above the last good render. Before `</head>` the server injects `<meta name="robots" content="noindex">`, the `palettes-all.<md5-8>.css` link and a bridge script that accepts `postMessage({ type: 'sm-preview', palette, theme })` only from `PUBLIC_ORIGIN` with allow-listed values, and keeps the `/` ↔ `/ka/` links inside the preview. Responses: `no-store`; HTML carries `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src <origin> 'unsafe-inline'; style-src <origin> 'unsafe-inline'; font-src <origin>; img-src <origin> data:; frame-ancestors <origin>; base-uri 'none'; form-action 'none'`; other files carry `Access-Control-Allow-Origin: *` (font requests from an opaque origin are CORS requests). The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`, so the preview has an opaque origin and cannot reach the admin session. Content and layout changes re-render after 600 ms; the re-render key is `JSON.stringify({ ...site, settings: { ...site.settings, palette: null, defaultTheme: null } })`, so palette and theme changes go through the bridge with no request, and the parent re-posts `{ type: 'sm-preview', palette, theme }` on every iframe `load` (the EN ↔ KA links reload the frame). Desktop mode renders a 1440×900 frame scaled to fit; mobile 390×844. Tokens are masked in logs and refreshed every 14 min while the page is visible.

### 8.7 Publish and rollback

`publish()` under the `publish` lock (HTTP gives up after 3 s with 423). The SPA first settles its autosave queue (waits for the PUT in flight, sends the pending one), publishes with the resulting ETag and keeps the form inert until the response arrives.
1. Load the draft; `If-Match` must equal its ETag (412).
2. `validate(mode 'save')`: errors → 400; unacknowledged warnings → 409.
3. Date rule: with `autoUpdateDateOnPublish`, set `settings.updated` to today in Asia/Tbilisi only when `person`, `meta`, `ui`, `hero`, `contact` or `sections` differ from live; layout, palette or theme changes keep the date.
4. Brand images (§8.8): cache hit, reuse, or render.
5. `buildSite(mode 'publish')` → `builds/.tmp-<buildId>/` + `manifest.json` (path, sha256, bytes, immutable, type) + `.site.json`; every file written `0644` and `fsync`ed, the directory `fsync`ed, then renamed to `builds/<buildId>/` (`YYYYMMDDTHHMMSSZ-r<rev>`).
6. Verify: both HTML files have the right `lang`, `404.html` exists, every local `href`/`src`/`url()` resolves, < 200 files, < 10 MB.
7. `--if-changed` (deploy re-render): run swap pass 1 against the **real web root**; the publish is a no-op only when the plan is empty, so any drift in `$WEB_ROOT` is repaired.
8. Write-ahead record (under the `write` lock): `publish-state.json.pending = { buildId, rev, source, draftEtag, startedAt }`.
9. Swap into `$WEB_ROOT`: pass 1 decides and refuses to overwrite an immutable name with different bytes; pass 2 **hard-links** each changed file from the build directory to a temp name in the web root and `rename(2)`s it, **immutable assets first, then XML/TXT/manifest, then 404, KA, EN HTML**. No bytes are copied, so a full disk cannot fail the swap or the automatic re-apply of the previous build after a mid-swap failure (`builds/` and the web root must share a filesystem; `cli verify` checks `st_dev`).
10. Commit (under the `write` lock): `site.json`, the `publish` revision, `publish-state.json` with `pending` cleared. Then re-read `draft.json`: when step 3 changed the date, the published document becomes the draft if its ETag still equals `If-Match`; if an autosave landed meanwhile, only `settings.updated` is set on the current draft (read-modify-write). The response carries `draft: { rev, etag, updated }`; the SPA copies `updated` into its document before adopting the ETag. Audit; optional Cloudflare purge of the six fixed-name URLs (only if they are cached at the edge, §9.3); keep 10 builds; GC in the web root deletes only hashed names absent from the last three manifests and older than 24 h (fonts, HTML, dotfiles, `.well-known/` and unknown files are never touched).

**Reconcile.** `reconcile()` (in `lib/publish.mjs`) runs under the `publish` lock at service boot, before `listen`, and at the start of every CLI command that writes. When `pending` is set, it hashes the web root's `index.html` and `ka/index.html`: if both match `builds/<pending>/manifest.json`, it completes step 10 from `builds/<pending>/.site.json` (audit `publish_recovered`); otherwise it re-applies `builds/<current>` (when there is one) and clears `pending` (audit `publish_reverted`). A crash, reboot, OOM restart or `SIGKILL` between swap and commit therefore never leaves `site.json` behind the live files, so the next deploy's re-render cannot undo a publish.

Budget: p95 < 3 s with a brand-image cache miss, < 800 ms with a hit. **Rollback** writes the same `pending` record, re-applies a kept build's files and its `.site.json` (after a `pre-rollback` snapshot), leaves the draft alone, and takes < 1 s. CLI equivalents: `cli publish [--source=draft|published] [--reason] [--if-changed]`, `cli rollback [--to=<buildId>]`, `cli builds`, `cli restore-build --from=<buildId>`. After discard, restore, import or a publish that returns `draft`, the SPA cancels queued saves and replaces its document from the response (or `GET /draft`) before autosave resumes.

### 8.8 Brand images (OG cards and icons)

- **Inputs** (`src/shared/brand.mjs`, pure): `ogInputs(site, lang, palette, layoutMeta)` = template version, lang, card id (`default` unless the layout has `og`), monogram, eyebrow, display name, role, subrole, the four facts, host, palette dark `--accent` (left bar) and dark `--accent-ink` (host text). `iconInputs(site, palette)` = template version, monogram, palette light `--accent` (fill) and light `--on-accent` (glyph and a 16 % bar).
- **Names:** `brandName(stem, inputs, RENDERER_ID)` = `<stem>.<md5-8 of JSON { inputs, rendererId }>.png`, stems `og-en`, `og-ka`, `favicon-32`, `apple-touch-icon` (180), `icon-192`, `icon-512`. `RENDERER_ID` joins the satori and resvg-wasm versions, the card-template version and the sha256 of the font files, so a renderer or font change produces new names instead of new bytes under an old name.
- **Renderer** (`src/brand/render.mjs`, `cards.mjs`): satori element trees (flexbox only) → SVG → `@resvg/resvg-wasm` PNG (`Buffer.from(…asPng())`). The OG card ports `src/brand/og.html` (1200×630, 6 px accent bar, 86 px rail with a 52×52 monogram mark, eyebrow 15 px mono uppercase in EN and Noto 16 px without uppercase in KA, two-line name 82 px Chivo 600 (KA 64 px Noto), role, subrole, four facts under a rule, host top right). The icon ports `src/brand/icon.html` (glyph Chivo 600 at 0.453 × size for two letters, top offset −0.012 × size, bottom bar max(2, 0.066 × size); one or three letters scale so nothing clips at 32 px). Colours are converted from oklch to hex with `parseColor(…).hex`; the card's neutrals are fixed dark values from `og.html`.
- **Fonts** (`src/brand/fonts/`, OFL): Chivo 400 and 600, JetBrains Mono 400 and 500, Noto Sans Georgian 400 and 600, as static TTF instances (satori reads neither WOFF2 nor variable axes).
- **Where images come from:** publish: `data/brand-cache/<name>` → else the same name in the current build directory → else render (so an existing name always keeps its bytes); `build.mjs`: `.cache/brand/`; preview: `brandNames()` (the names only, computed from the same inputs and `RENDERER_ID`; no rendering, no build needed). `RENDERER_ID` is computed once when `src/brand/render.mjs` is imported (package versions and font sha256; satori and the WASM still load lazily). `POST /og-preview` renders on demand for the SEO screen.

---

## 9. Operations

Detail: [admin-ops.md](admin-ops.md) §1, §2.2, §8–§10, §12 (runbooks R1–R11).

### 9.1 Server layout

```text
/opt/samsiani-admin/   root:root 755 (APP_HOME): everything root executes, sources or lets PM2 open
  releases/<sha>/      code + production node_modules + admin/web/dist, root-owned, read-only for others (5 kept)
  current -> releases/<sha>
  shared/              root 700: deploy.env, admin.env (600), ecosystem.config.cjs (600, written by the deploy job),
                       DISABLED (optional flag, runbooks R4/R6)
  logs/                root 700: samsiani-admin.{out,err}.log (PM2, rotated by pm2-logrotate)
$SITE_HOME/            CyberPanel home, owned by $SITE_USER (711): root never writes, runs or sources anything here
  public_html/         = $WEB_ROOT, OLS docRoot, real directory, owner $SITE_USER, 755
  data/                owner $SITE_USER, 700; files 600 (site.json, draft.json, auth.json, sessions.json, publish-state.json,
                       revisions/, backups/, brand-cache/, locks/, audit.log)
  builds/              owner $SITE_USER, 755 (10 builds + current); same filesystem as public_html (the swap hard-links)
  logs/                the vhost's own OLS logs; not used by the admin
```

**Root rule.** The site user owns `$SITE_HOME` and can rename any entry in it, so a root-owned tree there (code, env files, logs) could be swapped for one the site user controls, and a root `install -d`/`chown` would follow a planted symlink. Therefore root never sources, executes, chowns, chmods or rsyncs a path under `$SITE_HOME`; every command that writes there runs through `runuser -u "$SITE_USER"` (the deploy script, the `CLI` alias, the runbooks). Reading (`stat`, `find`, `sha256sum`, `curl`) is fine; `node -e "require('<file under $SITE_HOME>')"` is not (it follows a symlink to a `.js` file and runs it). Preflight T0.8 (`stat -c '%U %a' "$SITE_HOME"` → `<site user> 711`) confirms the ownership that makes this rule necessary; acceptance: `find /opt/samsiani-admin ! -user root` prints nothing.

### 9.2 OLS vhost (`deploy/ols-admin-context.conf`, applied by hand once)

In `/usr/local/lsws/conf/vhosts/<domain>/vhost.conf`, after a dated backup copy: the existing static `context /`, `errorpage 404` and `expires` blocks stay as they are. Add before the first `context`:

```text
extprocessor samsianiadmin {
  type                    proxy
  address                 http://127.0.0.1:3097
  maxConns                10
  pcKeepAliveTimeout      60
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}

context /admin/ {
  type                    proxy
  handler                 samsianiadmin
  addDefaultCharset       off
}
```

and as the first rule inside the `rules` block of `context /`: `RewriteRule ^/?admin$ /admin/ [R=301,L]`. Restart gracefully (`/usr/local/lsws/bin/lswsctrl restart`). The app sets all admin headers itself, so the proxy context has no `extraHeaders`. If CyberPanel regenerates the file and drops the block, only the admin goes offline; the deploy's probe warns and the snippet is re-applied. Optional extra (M10), on top of the mandatory edge check: an `accessControl` block limiting `/admin/` to Cloudflare's ranges, only if the preflight shows `useIpInProxyHeader` absent or `0` (admin-ops §8.3). It cannot stop other tenants on the box; the edge check does.

### 9.3 Cloudflare

- **Transform Rule (required, M9):** Request Header Transform Rule "admin edge", `starts_with(http.request.uri.path, "/admin")` → Set static `x-sm-edge` = `EDGE_SECRET` (`openssl rand -base64 32`; stored only here and in `admin.env`). Free plan: 10 Transform Rules. Rotation: change the rule, then `admin.env` and reload; `/admin/` answers 403 `edge` for the seconds in between.
- **Order matters:** Cloudflare applies every matching Cache Rule and Configuration Rule, and for a conflicting setting the last matching rule wins. So the Cache Rule "admin bypass" (`starts_with(http.request.uri.path, "/admin")` → Bypass cache) and the Configuration Rule on the same expression (Rocket Loader off, Email Obfuscation off; both rewrite HTML/JS and would break the strict CSP) are the **last** rules in their lists, and every other Cache Rule and Configuration Rule on the zone gets `and not starts_with(http.request.uri.path, "/admin")` in its expression (including an existing Cache Everything rule that T0.6 finds).
- **Check after any Cloudflare rule change** (runbook R11): run `curl -s -D- -o /dev/null -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/draft` twice without a cookie; both must return 401 and neither may show `cf-cache-status: HIT`.
- Public caching unchanged: hashed assets immutable, HTML not cached. Preflight T0.6 checks `cf-cache-status` for `/`, `/ka/`, `/404.html`, `/sitemap.xml` and `/robots.txt` (today `/robots.txt` is an edge HIT with `max-age=14400`). If any shows `HIT`, `MISS`, `EXPIRED` or `REVALIDATED`, either add a "bypass" Cache Rule for `/robots.txt` and `/sitemap.xml` (placed after any Cache Everything rule) or set `CF_API_TOKEN` + `CF_ZONE_ID` so Publish purges the six fixed-name URLs.
- Optional: Cloudflare Access (free Zero Trust, email one-time PIN) for `samsiani.me/admin*`, which the edge check makes impossible to route around; WAF rate-limit rule on `POST /admin/api/auth/login` (5 per 10 s per IP).

### 9.4 PM2 and environment

`deploy/ecosystem.config.cjs` (committed, no server facts; code in admin-ops §9.1) is written by the deploy job from its own checkout to `/opt/samsiani-admin/shared/ecosystem.config.cjs`, the only copy root's PM2 ever evaluates. It reads `deploy.env` and `admin.env` from its own directory with `util.parseEnv` and defines `samsiani-admin`: `cwd` `/opt/samsiani-admin/current`, `script: admin/server/index.mjs`, `interpreter: $NODE_BIN`, `exec_mode: fork`, `instances: 1`, `uid`/`gid` = `$SITE_USER`, `filter_env: true` (nothing leaks in from root's shell), `env` built from an explicit key list: `NODE_ENV=production HOST=127.0.0.1 PORT=3097 PUBLIC_ORIGIN=https://samsiani.me SITE_URL=https://samsiani.me SITE_HOME WEB_ROOT SESSION_SECRET EDGE_SECRET`, plus `SESSION_SECRET_PREV ADMIN_INITIAL_PASSWORD ADMIN_USERNAME CF_API_TOKEN CF_ZONE_ID` always present and set to `''` when absent (PM2 keeps a variable that disappears from the file, PM2 issue #3486, so a removed secret must be overwritten, not dropped). `wait_ready: true` (the app sends `ready` after listening), `listen_timeout 10000`, `kill_timeout 10000` (lets a publish finish), `max_memory_restart: '400M'`, `exp_backoff_restart_delay 200`, logs in `/opt/samsiani-admin/logs/`. Changing `uid`/`gid`/`interpreter` needs `pm2 delete` + start. Every command: `pm2 startOrReload /opt/samsiani-admin/shared/ecosystem.config.cjs --update-env`.

| File (`/opt/samsiani-admin/shared/`, root:root 600) | Keys |
|---|---|
| `deploy.env` | `SITE_USER`, `NODE_BIN`, `SITE_HOME`, `WEB_ROOT`, `PORT=3097` |
| `admin.env` | `SESSION_SECRET` (`openssl rand -base64 48`), `EDGE_SECRET` (`openssl rand -base64 32`, same value as the Cloudflare Transform Rule), `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD` (first boot only, then deleted), optional `SESSION_SECRET_PREV`, `CF_API_TOKEN`, `CF_ZONE_ID` |

After removing a key from `admin.env` and reloading, `tr '\0' '\n' < /proc/$(pm2 pid samsiani-admin)/environ | grep -E '^(ADMIN_INITIAL_PASSWORD|SESSION_SECRET_PREV)=.'` must print nothing.

`admin/server/config.mjs` treats an empty string as unset and refuses to boot in production when running as root (unless `ALLOW_ROOT=1`), `SESSION_SECRET` < 32 bytes, `EDGE_SECRET` missing or < 32 bytes, `PUBLIC_ORIGIN` not `https:`, `DATA_DIR`/`WEB_ROOT` not writable, or `NODE_APP_INSTANCE` ≠ 0. Local defaults: `DATA_DIR=./data`, `WEB_ROOT=./dist`, `BUILDS_DIR=./.builds`, `PUBLIC_ORIGIN=http://localhost:5173`, non-`Secure` cookies `sm_admin`/`sm_dev`, no edge check.

Logs: boot, errors and one line per mutating API call (`method path status ms requestId`), except 401, 403, 413 and 429 responses, which are counted and written once a minute (`rejected 401=3 429=41`), so a login flood cannot fill the disk shared with other sites. `pm2-logrotate` (`max_size 10M`, `retain 10`, `compress true`) is a required M9 step.

### 9.5 CI/CD (`.github/workflows/deploy.yml`, replaced in M9)

Triggers: push to `main`, pull requests, manual. `permissions: contents: read`; concurrency group `production-deploy` (no cancel). Code: admin-ops §10.2 and §10.3. Every install is `npm install --ignore-scripts --no-audit --no-fund` (**not** `npm ci`: a macOS lockfile omits the Linux optional packages that Vite's bundler needs; no dependency install script ever runs). Every `uses:` is pinned to a full commit SHA with the tag in a comment (looked up 2026-09-15): `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`, `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`, `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0`; checkouts use `persist-credentials: false`.

**test** job (every trigger): seed notice when `src/content/site.json` changed → install → `npm test` → `! grep -rn "v-html" admin/web/src` → `node src/palettes.mjs` → `npm run check:secrets` (with the `DENYLIST` secret).

**gates** job (every trigger, uploads nothing; `fetch-depth: 0` for the pixel baseline): install (Playwright is the exact devDependency `playwright@1.59.1`) → `npx playwright install --with-deps chromium` → `npm run build:admin` → `npm run check:all` → `npm run check:stress` → `npm run test:e2e`.

**release** job (`needs: [test, gates]`, push/manual on `main` only), fresh workspace: install → `npm run build:admin` → `npm prune --omit=dev` → `release/` = `package.json`, lockfile, `node_modules`, `src`, `admin/server`, `admin/shared`, `admin/web/dist`, `RELEASE` (short sha). **No `deploy/`**: a compromised package can reach only code that runs as the site user, never a file root evaluates. → `release.tgz` artifact (7 days).

**deploy** job (`needs: release`, `environment: production`): its own checkout (for `deploy/`) → download the artifact → SSH key from `VPS_SSH_KEY`, host key from `VPS_KNOWN_HOSTS` (required; `StrictHostKeyChecking=yes`) → `rsync` to `/opt/samsiani-admin/releases/<sha>/` → write the checkout's `deploy/ecosystem.config.cjs` to `/opt/samsiani-admin/shared/` over SSH (`umask 077; cat > .eco.tmp && mv -f .eco.tmp ecosystem.config.cjs`) → `bash -s -- <sha>` with the checkout's `deploy/remote-deploy.sh`: chown the release to root read-only; stop here if `shared/DISABLED` exists; create `data/` and `builds/` **as the site user**; `cli verify`; `cli migrate --dry-run` and, when it exits 10, `pm2 stop` → `cli backup --name=pre-migrate-<sha>` → `cli migrate`; `cli init`; flip `current`; `pm2 startOrReload … --update-env`; poll `http://127.0.0.1:3097/admin/api/health` for the new sha for 20 s, else restore the pre-migrate backup (if one was taken), flip back and fail; `cli publish --source=published --reason=deploy --if-changed`; `pm2 save`; prune releases (keep 5, never current or previous); probe `/admin/api/health` through the local OLS and warn if the vhost block is missing. Secrets used: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (and `DENYLIST` in `test`); `VPS_PATH` is no longer read. The workflow never writes the web root and hard-codes no unix user.

### 9.6 First boot and cut-over (M9, once, in this order)

1. Tag the last commit deployed by the static pipeline `pre-admin` (fallback, runbook R8).
2. Preflight as root (admin-ops §1): T0.1 the site user can execute a Node 24 binary; T0.2 port 3097 free; T0.3 PM2 ≥ 4 running as root; T0.4 web root owned by `$SITE_USER`; T0.5 `useIpInProxyHeader`; T0.6 `cf-cache-status` of `/`, `/ka/`, `/404.html`, `/sitemap.xml`, `/robots.txt`; T0.7 `runuser`; T0.8 `stat -c '%U %a' "$SITE_HOME"` → `<site user> 711`. Create `/opt/samsiani-admin/{releases,shared,logs}` (root; `shared` and `logs` 700) and the two env files. Install `pm2-logrotate` (`max_size 10M`, `retain 10`, `compress true`). Back up `vhost.conf` (root, under `/usr/local/lsws`) and `public_html` as the site user: `runuser -u "$SITE_USER" -- cp -a "$WEB_ROOT" "$SITE_HOME/public_html.bak-$(date +%F)"`. Add the GitHub secret `VPS_KNOWN_HOSTS`.
3. Merge to `main`. CI deploys; `init` seeds `data/` from `src/content/site.json`; the service creates `auth.json` from `ADMIN_INITIAL_PASSWORD`; the re-render swaps the seed build into `public_html`.
4. Apply the vhost change (§9.2), restart OLS; run T1.1 (full URI reaches the app) and T1.2 (a renamed file is served within 1 s).
5. Add the Cloudflare rules (§9.3): the Transform Rule, then the bypass Cache Rule and Configuration Rule as the last rules, and the `/admin` exclusion on every other rule. Check: `curl -sk --resolve samsiani.me:443:127.0.0.1 -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/session` and `curl -s -H 'X-Requested-With: samsiani-admin' http://127.0.0.1:3097/admin/api/session` both return 403; the same request through Cloudflare returns 200; the R11 check passes.
6. Log in, change the password, delete `ADMIN_INITIAL_PASSWORD` from `admin.env`, `pm2 startOrReload /opt/samsiani-admin/shared/ecosystem.config.cjs --update-env`; the `/proc/<pid>/environ` check of §9.4 prints nothing.
7. Publish without edits: the result must report `changedFiles: 0`.
8. `find /opt/samsiani-admin ! -user root` prints nothing.
9. Delete the GitHub secrets `VPS_PATH` and `VPS_SITE_USER`. A re-run of any pre-M9 workflow run (GitHub allows re-runs for 30 days, with today's secrets) then ends in its own "Deploy secrets are not set - skipping deploy" branch instead of rsyncing a stale `dist/` over the admin's content with `--delete`.

### 9.7 Retention

| What | Where | Kept |
|---|---|---|
| Revisions | `data/revisions/` | newest 30 + the live publish revision |
| Daily backups | `data/backups/YYYY-MM-DD.json.gz` | 30 |
| Builds (rollback targets) | `$SITE_HOME/builds/` | 10 + current |
| App releases | `/opt/samsiani-admin/releases/` | 5, never current or previous |
| Brand cache | `data/brand-cache/` | files used by kept builds + newest 20 |
| Audit log | `data/audit.log` | rotates at 1 MiB (one old file) |
| PM2 logs | `/opt/samsiani-admin/logs/` | pm2-logrotate: 10 MB × 10, compressed |
| Off-box | Export button; optional weekly encrypted artifact (`backup.yml`, AES-256 with `BACKUP_PASSPHRASE`, 90 days) | — |

### 9.8 Local development

```bash
cp deploy/admin.env.example .env.development     # SESSION_SECRET=$(openssl rand -base64 48); ADMIN_INITIAL_PASSWORD=<12+ chars>;
                                                 # leave EDGE_SECRET empty (no edge check in development)
npm install --ignore-scripts && npx playwright install chromium
npm run cli -- init                              # ./data from src/content/site.json
npm run dev                                      # API on :3097 + Vite on :5173
open http://localhost:5173/admin/                # SPA with hot reload; /admin/api and /admin/preview proxied
node serve.mjs                                   # serves ./dist, which the local admin's Publish writes (:4173)
npm run build && node serve.mjs                  # or: build the seed (or LAYOUT=… PALETTE=…) without the admin
```

---

## 10. Build milestones

Each milestone ends with every earlier gate still green (`npm test`, and from M4 `npm run check:all`). "Ships" says whether the milestone may be merged to `main` and deployed by the **current** static workflow. M1–M4 can each ship that way (content still comes from the repository). M5–M8 stay on the feature branch until M9, because from M7 on `build.mjs` needs `npm install`, which only the new workflow runs.

### M1 · Content model, migration and module refactor (no visible change)

Spec: data-model.md §6, §8, §11 phase 1. Depends on: nothing. Ships: yes.

Tasks
1. Baseline, reproducible on any clone (add `.cache/` to `.gitignore`): `git worktree add --detach .cache/base 96e784e && (cd .cache/base && node build.mjs)` (the pre-refactor build needs no install). `96e784e` is the commit M1 starts from; if `main` moved first, use that commit, and set the same value as `PIXEL_BASE` in `scripts/check-all.mjs` (M4).
2. Copy the M1 rows of Appendix B (the exact sequence verified while writing this plan), then apply the M1 edits listed there (Precision template: primary guard and escaped date; Precision `layout.mjs`: `description`; `validate.mjs`: limits 4/4, `LONG_TOKEN`, `GEORGIAN_IN_CAPS`):
   ```bash
   cp docs/plans/data-model-ref/build.mjs build.mjs
   mkdir -p scripts test/fixtures && cp docs/plans/data-model-ref/scripts/*.mjs scripts/
   cp -R docs/plans/data-model-ref/src/. src/
   cp docs/plans/site.stress.json test/fixtures/site.stress.json
   ```
3. `node scripts/migrate-content.mjs` (it still reads `en.mjs`/`ka.mjs`), then `cmp src/content/site.json docs/plans/site.example.json`.
4. `git rm src/content/en.mjs src/content/ka.mjs src/template.mjs`; `git mv src/styles.css src/layouts/precision/styles.css`; `git mv src/fonts.css src/layouts/precision/fonts.css`.
5. `package.json` scripts: `build`, `migrate`, `test` (`node --test "test/unit/**/*.test.mjs"`), `check:stress` (§3).
6. Tests:
   - `test/unit/validate.test.mjs`: the 23 mutation cases of data-model §0, plus `GEORGIAN_IN_CAPS` on `hero.eyebrow.en` and `LONG_TOKEN` on a 30-letter skill-group title; the seed gives 0 errors and 0 warnings; the stress fixture gives 0 errors and 10 warnings (`LONG` ×4, `LONG_TOKEN` ×3, `LONG_WORD` ×3); `canonicalize(seed)` reproduces the file byte for byte and restores key order after shuffling and junk keys.
   - `test/unit/render.test.mjs`: same input → identical output; a `meta.description` of `</script><script>alert(1)</script>` appears in the JSON-LD block only with `<` written as the escape `\u003c` (backslash, u, 0, 0, 3, c), never as a raw `</script>`; a tagline `<img src=x onerror=alert(1)>` appears only as `&lt;img …`; a `settings.updated` of `2026-06-07"><script>x</script>` produces no raw `<script>x` (rendered with `renderSite()` directly, no validation).
   - `test/unit/render-draft.test.mjs`: for every registered layout, `renderSite()` does not throw when the primary contact item is deleted, `contact.items = []`, `hero.facts = []`, `skills.groups = []`, a group has `items = []`, every KA string is `''`, or every list is at its maximum + 1 (extended as M3 and M4 register layouts). *Verified in review: the unedited Precision and Studio templates throw on the first two cases; the edited ones pass all seven in all three layouts.*
   - `test/unit/layouts.test.mjs`: every manifest has `id`, `label`, `description`, `css`, `fonts`, `preload`, `themeColor`, `manifestBackground`; every `fonts[]` file exists in `src/fonts/`; from M8 also `thumbnail`, and each `src/admin-thumbs/*.svg` has `viewBox="0 0 320 200"`, `role="img"`, a non-empty `aria-label` and no `<text>`.
7. `.github/workflows/deploy.yml`: `node-version: 24`; replace the literal unix user in the `chown` line with `"$SITE_USER:$SITE_USER"` from `secrets.VPS_SITE_USER`. Keep the existing "Deploy secrets are not set - skipping deploy" test first (it keys on `VPS_PATH`) and only after it fail when `SITE_USER` is empty, so that deleting `VPS_PATH` after the cut-over (§9.6 step 9) turns every re-run of this workflow into a skip. The owner adds the secret first (§0).
8. `README.md`: "Edit content" → `src/content/site.json`; "Structure" per data-model §8.5.

Acceptance
- `node scripts/migrate-content.mjs` exits 0 and prints `round trip exact for en and ka`; `cmp` prints nothing.
- `node build.mjs && diff -r dist .cache/base/dist` prints nothing (19 files). *Verified, also with the M1 edits of Appendix B.*
- `ls src/content/en.mjs src/content/ka.mjs src/template.mjs src/styles.css src/fonts.css` reports all five missing; `grep -rn "content/en.mjs\|content/ka.mjs" src build.mjs scripts` prints nothing.
- A copy of `site.json` with `contact.items[2].href = "javascript:alert(1)"`: `SITE_JSON=<copy> node build.mjs` exits 1, prints `error HREF_SCHEME $.contact.items[2].href`, and `dist/` is unchanged.
- `SITE_URL=http://localhost:4173 node build.mjs && grep -c 'http://localhost:4173' dist/index.html` prints a number > 0.
- `npm test` passes; `git grep -nF "<the unix user>"` (run locally with the real value) prints nothing.

### M2 · Palettes, shared shell, build seam, Precision fixes, page gates

Spec: palettes.md §5, §6, §10; data-model.md §9, §11 phase 2; layout-studio.md §0.3(a); layout-ledger.md §9.2; admin-ops.md §5.1. Depends on: M1. Ships: yes, with `settings.palette = "cobalt"` in `src/content/site.json` until M7 (icons and OG cards stay the committed cobalt PNGs until then; `build.mjs` warns `BRAND_STALE` otherwise).

Tasks
1. `npm install -D -E playwright@1.59.1` (the version every measurement in the specs used) and `npx playwright install chromium`. Every script imports `playwright` normally; remove the `PLAYWRIGHT`/`PLAYWRIGHT_MJS` variables and the absolute path in `check-layout-stress.mjs`.
2. `cp docs/plans/palettes.json src/palettes.json`; replace `layouts.studio` and `layouts.ledger` with the final values of §7 (`_source`: "layout-studio.md §0.3(c)" / "layout-ledger.md §1.2"). `cp docs/plans/check-palettes.mjs src/palettes.mjs` (default data path is its own folder; update the header comment only).
3. Write `src/build-site.mjs` (§5.5) and reduce `build.mjs` to the CLI of §5.5.
4. `src/brand/committed.mjs` (interim, deleted in M7): read `src/brand/icon-{32,180,192,512}.png` and `src/og-{en,ka}.png`, name each `<stem>.<md5-8 of its bytes>.png`, return `{ files, og, icons }`; `committedBrand({ namesOnly: true })` returns the same names with `files = new Map()` (the M6 preview).
5. `src/shared/manifest.mjs`: icons from `assets.icons`, `theme_color` from the palette; file named `site.<md5-8>.webmanifest`.
6. `src/shared/document.mjs`: `<html lang dir data-layout data-palette [data-theme]>`; effective theme into `themeInitScript`; `theme-color` per §5.4 (one meta without `media` when the effective theme is `light` or `dark`); `${layout.headExtra ? layout.headExtra(c, ctx) : ''}` immediately before the stylesheet link; icons, manifest and font preloads from `ctx.assets` (`${assets.base}fonts/<name>.woff2`).
7. `src/shared/theme-init.mjs`: add `effectiveTheme()` (§5.4). `src/render.mjs`: set `ctx.paletteId`, `ctx.defaultTheme` (effective), `ctx.assets`.
8. `src/layouts/precision/styles.css` (line numbers as in today's `src/styles.css`):
   - delete the `--accent`/`--on-accent` declarations at lines 13–14, 39–40, 57–58 and the `--accent: #1f4fbf; --on-accent: #fff;` part of the print block (line 323);
   - `var(--accent)` → `var(--accent-ink)` at lines 99, 110, 150, 151, 153, 159, 160, 179, 221, 229, 239, 240; line 82 `:focus-visible` → `var(--focus)`; lines 83, 120, 154, 243 unchanged;
   - line 28 `@media (prefers-color-scheme: dark) {` → `@media screen and (prefers-color-scheme: dark) {`; wrap lines 47–63 (`:root[data-theme="dark"] {…}`) in `@media screen { … }`;
   - lines 306 and 309: `min-width: 1280px` → `1440px`, `1600px` → `1680px`; append `.topnav a { white-space: nowrap; }` and `.fact-value { overflow-wrap: anywhere; }`;
   - line 265, inside `@media (max-width: 600px)`: `.brand-name { display: none; }` → `.brand-name { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }`;
   - append `body { overflow-wrap: break-word; }`, `.lang a:focus-visible { outline-offset: -3px; }`, `.brand { flex: 0 1 auto; min-width: 0; }` and `@media (max-width: 379px) { :root { --pad-x: 14px; } .lang > * { padding: 0 8px; } .ctl-primary { padding: 0 9px; } .menu summary, .ctl-icon { width: 36px; } }` (deliberate differences 5–9 of §6; none shows in the identity screenshots).
9. Scripts: `scripts/lib/serve-dir.mjs`; `scripts/lib/dom-checks.mjs` (lift checks 1–3 of `check-studio.mjs`: overflow, text-contrast DOM walk with the large-text threshold, Georgian casing; plus the focus-clip and accessible-name checks below); `scripts/check-pages.mjs --dist <dir> [--only overflow,contrast,casing,focus,names,motion,print] [--max-pages en=5,ka=6]` (overflow: EN/KA × light/dark, 320→1600 px step 10; contrast and casing: EN/KA × light/dark × 1440/390; focus: the first 12 tab stops at 1440 show an outline ≥ 2 px, and the ring rectangle (border box inflated by `outline-offset + outline-width`) lies inside the padding box of every ancestor whose computed `overflow` is not `visible`, else `focus ring clipped by <selector>`; names: at 390 and 1440 px every visible `a[href]` and `button` has a non-empty name in CDP `Accessibility.getFullAXTree`; motion: with `reducedMotion: 'reduce'`, every `.sec`, `.intro` and `[data-reveal]` element has opacity 1 and no translate right after load, and `html` has `scroll-behavior: auto`; print: A4 PDF from `?theme=dark`, page count ≤ max, printed `body` colour dark on white); `scripts/check-precision-pixels.mjs --baseline <dir|url> --candidate <dir|url> [--widths 390,768,1080,1440,1920]` (full-page PNGs at height 900 in three modes, light, OS dark and `?theme=dark`, `reducedMotion: 'reduce'`, after `document.fonts.ready`; pass = byte-identical PNGs; on mismatch it counts differing pixels in-page and saves both images to `.cache/pixels/`). `scripts/check-layout-stress.mjs` gets the normal `playwright` import and `serve-dir`, and fails when the last visible child of the header's inner row (`header > :first-child`: `.topbar-inner`, `.st-top-in`, `.lg-top-in`) ends beyond `innerWidth - 8`. Every gate that serves a directory (`check-layout-stress`, `check-pages`, `checks/studio`, `checks/ledger`, `check-precision-pixels`) exits 1 when `--dist` lacks `index.html` or `ka/index.html`, when any `page.goto()` status is not 200, or when `main#main` is missing (today a missing directory prints `PASS`).
10. Tests: `test/unit/palettes.test.mjs` (gate 432/432; malformed data throws; lime with `--accent-ink` = `--accent` fails), `test/unit/theme.test.mjs` (the five precedence cases of §5.4; `system` script byte-identical to M1's; `theme-color` is the media pair for `system` and a single meta with `layout.themeColor.dark` for `dark`), `test/unit/stress-fixture.test.mjs` (for every `limitsTable()` row except `settings.siteUrl` and `sections.*.nav`, some instance in the fixture reaches `max` in each language; nav labels total ≥ 98 per language with one label at 28), `test/unit/build-site.test.mjs` (only the active layout's fonts; `base: '/x/'` prefixes every root-relative `href`/`src` except `/` and `/ka/`; preview mode omits `robots.txt`, `sitemap.xml`, `.htaccess`, `_headers`; identical input → identical Map; every PNG and the manifest have hashed names).

Acceptance
- `node src/palettes.mjs` prints `PASS: 432/432 …` and exits 0.
- The three grep gates (palettes.md §10) print nothing for `src/layouts/precision/styles.css`.
- `node build.mjs && node scripts/check-precision-pixels.mjs --baseline .cache/base/dist --candidate dist` → `30/30 identical`. *Verified with every edit of task 8.*
- `PALETTE=lime node build.mjs`: the CSS file name differs from the cobalt build; `grep -o 'styles\.[0-9a-f]\{8\}\.css' dist/index.html | sort -u` prints exactly one name; `grep -o '<html[^>]*>' dist/index.html` → `<html lang="en" dir="ltr" data-layout="precision" data-palette="lime">`.
- `PALETTE=nope node build.mjs` prints a `PALETTE_FALLBACK` warning and builds `data-palette="cobalt"`.
- `npm run check:stress` → `PASS: 24 viewport checks` (Precision, stress fixture, header-row check included); the same with the seed. *Verified; without the task-8 review edits it fails at EN 320/360 px (+57/+17 px) and KA 320/360/400 px (+225/+185/+145 px), and the header row ends at 316 of 320 px.*
- `node scripts/check-pages.mjs --dist dist` passes; the contrast part also passes for each palette: `bash -c 'for P in cobalt lime emerald amber crimson graphite; do PALETTE=$P OUT_DIR=.cache/p/$P node build.mjs && node scripts/check-pages.mjs --dist .cache/p/$P --only contrast || exit 1; done'` exits 0.
- A fixture copy with `settings.defaultTheme = "dark"`: `<html … data-theme="dark">`, the init script contains `t='dark'`; in the browser, empty storage → dark, `localStorage.theme = 'light'` → light, `?theme=light` with stored dark → light.
- Lighthouse accessibility is **100** for `/` and `/ka/`, each run twice (`node serve.mjs` running; `npx lighthouse http://localhost:4173/ --only-categories=accessibility --quiet --chrome-flags=--headless`, which is the mobile preset, and the same with `--preset=desktop`). The baseline build scores 0.96 on mobile (unnamed brand link); record all scores in the pull request.
- `ls dist` shows no PNG and no manifest without an 8-hex hash; `npm test` passes.

### M3 · Layout B · Studio

Spec: layout-studio.md (all). Depends on: M2. Ships: yes (set `settings.layout` in the repository's `site.json`), with `settings.palette = "cobalt"` until M7.

Tasks
1. `curl -o src/fonts/archivo-latin-wdth-wght.woff2 https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2` (fallback: layout-studio.md §7.1); add `src/fonts/OFL-Archivo.txt` (SIL OFL 1.1 text from the Archivo repository). Record the command and the expected size in `scripts/fetch-fonts.sh`.
2. Copy the Studio rows of Appendix B and apply their edits: delete `name` in `layout.mjs` (the admin reads `label`); in `styles.css`, Noto Sans Georgian second in `--st-mono` (line 36) and the visually hidden brand name below 600 px (lines 144 and 343); in `template.mjs`, the primary guard (lines 180–186) and the escaped date (line 193).
3. Register: `import studio from './studio/layout.mjs'; import { renderBody as studioBody } from './studio/template.mjs';` and `studio: { meta: studio, renderBody: studioBody }` in `src/layouts/index.mjs`.
4. `cp docs/plans/layout-studio/admin-thumb-studio.svg src/admin-thumbs/studio.svg`.
5. `scripts/checks/studio.mjs` ← `check-studio.mjs` (normal `playwright` import; accepts a directory via `serve-dir` or a URL; add `--skip print` for the stress build, whose page count does not apply; the HTTP-status rule of M2 task 9).
6. `render-draft.test.mjs` and `layouts.test.mjs` now cover Studio.

Acceptance
- `wc -c < src/fonts/archivo-latin-wdth-wght.woff2` prints `90096`.
- `LAYOUT=studio PALETTE=lime OUT_DIR=.cache/st node build.mjs && node scripts/checks/studio.mjs .cache/st` prints `ALL PASSED` (overflow, contrast, Georgian casing, header and bento geometry at 1920/1600/1440/1280/1279/1080/768/390/320, raw `<html … data-layout="studio" … data-theme="dark">`, runtime default dark, toggle, reduced motion, focus ring, print EN ≤ 5 / KA ≤ 6).
- `node scripts/check-pages.mjs --dist .cache/st` passes, and `--only contrast` passes for each of the six palettes.
- `SITE_JSON=test/fixtures/site.stress.json LAYOUT=studio OUT_DIR=.cache/st-stress node build.mjs && node scripts/check-layout-stress.mjs --dist .cache/st-stress --topnav .st-nav` → `PASS: 24 viewport checks`; `node scripts/checks/studio.mjs .cache/st-stress --skip print` passes too. *Verified with the revised fixture: `check-studio.mjs` fails only its print page counts (15/16 pages), which `--skip print` skips.*
- Grep gates print nothing for `src/layouts/studio/styles.css`; `node src/palettes.mjs` passes; `ls .cache/st/fonts` lists only Archivo, JetBrains Mono and Noto Sans Georgian.
- With `LAYOUT=studio PALETTE=lime node build.mjs && node serve.mjs` running, Lighthouse accessibility is 100 for `/` and `/ka/`, with the default (mobile) run and with `--preset=desktop`. (Without the brand-name edit the mobile run scores 0.96 on `/ka/`.)
- Side-by-side review against `docs/plans/layout-studio/ref-*.png` (layout-studio.md §8.2 table) shows no difference in structure.

### M4 · Layout C · Ledger

Spec: layout-ledger.md (all). Depends on: M2 (M3 not required: `check-all.mjs` covers whatever is registered). Ships: yes, after the owner has checked the four Georgian strings, with `settings.palette = "cobalt"` until M7.

Tasks
1. Download the three IBM Plex files with the commands in layout-ledger.md §7 into `src/fonts/` (`ibm-plex-sans-latin-wght-100-700.woff2` 40,240 B, `ibm-plex-mono-latin-400.woff2` 10,052 B, `ibm-plex-mono-latin-500.woff2` 10,060 B, ±3 %); add `src/fonts/OFL-IBM-Plex.txt` (IBM/plex `LICENSE.txt`); append to `scripts/fetch-fonts.sh`.
2. Copy the Ledger rows of Appendix B and apply their edits (E6: two lines appended to `styles.css`; escaped date at `template.mjs` line 149); register `ledger` in `src/layouts/index.mjs`; `render-draft.test.mjs` and `layouts.test.mjs` now cover Ledger.
3. `scripts/checks/ledger.mjs` ← `verify.mjs` (normal `playwright` import; the HTTP-status rule of M2 task 9).
4. `scripts/check-all.mjs` (the matrix of §11, iterating `Object.keys(LAYOUTS)` through its per-layout table) and `npm run check:all`.

Acceptance
- `LAYOUT=ledger OUT_DIR=.cache/lg node build.mjs && node scripts/checks/ledger.mjs .cache/lg` prints `ALL LEDGER CHECKS PASS` (A1–A7), with `PALETTE` cobalt, lime and crimson.
- The commands A10, A11, A12, A16 of layout-ledger.md §8.2 print the expected output (`0 0`, one `--caps: uppercase` line, nothing, nothing), with A10 run on `.cache/lg/index.html .cache/lg/ka/index.html`; A13 font sizes hold; A14: with `LAYOUT=ledger node build.mjs && node serve.mjs` running, `npx lighthouse http://localhost:4173/ --only-categories=accessibility --quiet --chrome-flags=--headless` scores 100 for `/` and `/ka/`, and so does the same run with `--preset=desktop`.
- Stress gate with `--topnav .lg-nav` → `PASS: 24 viewport checks` for the seed and the stress fixture (*verified with the revised fixture; without the `body` rule the long tokens scroll the page by 21 px EN and 148 px KA at 320 px, and without the legend rule the `check-all` sweep overflows KA 410–450 px; `verify.mjs` on the stress build then fails only its print counts*).
- `grep -o '<style media="print">[^<]*</style>' .cache/lg/index.html` → `<style media="print">@page{@bottom-left{content:"Giorgi Samsiani · samsiani.me"}}</style>`; a unit test calling `ledger.headExtra(localize(site, 'en'), ctx)` (or `renderSite()` directly, with no validation, since the family name exceeds its limit) with family name `X</style><script>` finds `\3C /style>` and no `</style><script>` in the output.
- `npm run check:all` exits 0 for every registered layout; `npm test` passes.

### M5 · Admin service core: storage, auth, draft API, CLI

Spec: admin-ops.md §2–§4, §9.3, §10.4. Depends on: M2. Ships: no (feature branch until M9).

Tasks
1. `package.json`: `"engines": { "node": ">=24" }`; `npm install -E hono@4.13.7 @hono/node-server@2.1.1`.
2. `admin/shared/draft-rules.mjs` (`DRAFT_BLOCKING`, plus every error under `$.settings.`; counter threshold ⌊0.9 × max⌋), `admin/shared/diff.mjs` (`diffPaths(a, b)`, ignoring `settings.siteUrl`).
3. `admin/server/config.mjs` (empty string = unset; `EDGE_SECRET` required in production), `app.mjs` (`createApp(cfg, deps)`, pure, wiring of admin-ops §4.1 with the edge guard first), `index.mjs` (listen, `process.send('ready')`, graceful stop waiting ≤ 8 s for the publish lock, root refusal), `cli.mjs` (`init`, `migrate [--dry-run]`, `verify`, `set-password`, `backup [--name=]`, `restore-backup`, `export`, `import`; rules in admin-ops §10.3: `init` never migrates and, when `data/` is gone but a build exists, restores from the newest build instead of the seed; `migrate` refuses while the health endpoint answers and `--dry-run` exits 10 when migrations are pending; `set-password` takes the `write` lock and creates `auth.json` when it is missing).
4. `admin/server/lib/{fsx,lock,store,auth,guard,headers,audit,backup}.mjs` and routes `health`, `session`, `auth`, `account`, `registry` (with `paletteHex`, `paletteMin`), `draft`, `validate`, `revisions` (list, get with changes, restore), `checkpoint` (optional `site`), `export`, `import`. `today` = Asia/Tbilisi date. Per §8.4–§8.5: edge guard, device cookie, every-value header rule, lenient `If-Match`, auth and session files read from disk (stat on every request) and changed only under the `write` lock, `pre-overwrite` snapshot on `force`, `siteUrl` overwritten with `SITE_URL`, temp files removed on any write error, 401/403/413/429 counted instead of logged one by one. `cli verify` also checks every registered layout's fonts exist and the palette gate passes.
5. `deploy/admin.env.example` and `deploy/deploy.env.example` (keys only, `EDGE_SECRET` included); `.gitignore` += `data/ .builds/ .env*`.
6. Tests `admin/test/{draft-rules,fsx,lock,store,auth,guard,api,backup}.test.mjs` (rows of admin-ops §10.4) via `app.request()` and temp directories; `npm test` now also runs `"admin/test/**/*.test.mjs"`.

Acceptance
- `npm test` passes, including: 100 chained parallel `saveDraft` calls lose nothing; a stale lockfile (dead pid, or older than `staleMs`) is taken over; a write that throws between `sync` and `rename`, and a `writeFile` that fails with a simulated `ENOSPC`, leave the old file and no `.tmp`; cookie tamper, 12 h idle and 7 d absolute expiry, epoch bump (injected clock); the dummy scrypt for unknown users; with the service running, after `cli set-password` the old cookie and the old password each get 401 on the next request and a later sliding update does not bring the sessions back; `PUT /draft` with `force: true` leaves a `pre-overwrite` revision holding the replaced draft; doubled and weak forms of `Origin`, `X-Requested-With`, `Sec-Fetch-Site`, `x-sm-edge` and `If-Match` (`W/"<etag>"`, `"<etag>", "<etag>"`) behave as §8.4 says; `restore-backup` rejects a file with a revision id of `../x` and writes nothing; `init` on a data directory without `site.json` but with a build restores from that build.
- `npm run cli -- init` creates `./data` (700) with `site.json` and `draft.json` (600, `rev: 1`); a second run changes nothing (`sha256sum data/*.json` equal before and after).
- Against `npm run dev:server` (headers `X-Requested-With: samsiani-admin`, `Origin: http://localhost:5173`, JSON): login → `Set-Cookie: sm_admin=…; Path=/admin; HttpOnly; SameSite=Strict`; the production config test asserts `__Secure-sm_admin` with `Secure`; `PUT /draft` without `If-Match` → 428, stale → 412; a body with a `ru` key → 400 `draft_rejected`; an empty KA tagline → 200 with the error listed.
- POST without `X-Requested-With` → 403 `csrf`; `Origin: http://localhost:5173, http://localhost:5173` → accepted; `Origin: http://localhost:5173, https://evil.example` → 403 `csrf_origin`; `Sec-Fetch-Site: cross-site` → 403 `csrf_site`; a 300 KB body → 413.
- The 6th wrong password from one client → 429 with `Retry-After`; the right password is refused until the window passes, except from a browser holding a valid `sm_dev` cookie, which also logs in while the global lock (60 failures/hour) is active.
- Production config (test with an injected env): a request without `x-sm-edge`, or with one wrong value in a doubled header, → 403 `edge`; `GET /admin/api/health` → 200 without it; boot without `EDGE_SECRET` exits 1.
- Production config with `getuid() === 0` exits 1 with `refusing to run as root`.

### M6 · Preview and publish pipeline, rollback

Spec: admin-ops.md §5, §7, §10.4. Depends on: M5 (layouts registered so far are all served). Ships: no.

Tasks
1. `admin/server/lib/preview.mjs` (`PreviewStore`, head injection, bridge script written with `jsonForScript()`, token masking in logs) and routes `POST /preview` (brand names from `committedBrand({ namesOnly: true })`, no build needed; `buildSite` in `try/catch` → 422 `preview_render_failed`), `GET /admin/preview/:token/*`; `palettes-all.<md5-8>.css` built once per process.
2. `admin/server/lib/{publish,swap,cloudflare}.mjs`: §8.7 steps (fsync of the staged build, `--if-changed` against the real web root, write-ahead `pending`, hard-link swap, commit that re-reads the draft), `reconcile()` (called by `index.mjs` before `listen` and by every writing CLI command), the immutable guard, auto-rollback, GC, build retention, optional purge; routes `POST /publish`, `GET /builds`, `POST /builds/rollback`; CLI `publish`, `rollback`, `builds`, `restore-build`, `verify --web-root` (files in the web root that differ from the current manifest); `cli verify` fails when `BUILDS_DIR` and `WEB_ROOT` are on different filesystems.
3. `src/shared/sitemap.mjs` `robotsTxt()`: add `Disallow: /admin/` after `Allow: /`.
4. Tests `admin/test/{publish,swap,preview}.test.mjs` and additions to `api.test.mjs`, `test/unit/build-site.test.mjs`: a child process killed with `SIGKILL` between swap and commit leaves `pending`, the next boot (or CLI run) completes the commit, and a later `cli publish --source=published --if-changed` keeps the new `index.html`; a pending record whose files never reached the web root is reverted; `POST /preview` succeeds on a fresh data directory right after `cli init` (`buildId: null`); a document that makes a template throw returns 422 and the previous token still serves.

Acceptance
- `npm test` passes, including: publish from the seed into a temp `SITE_HOME` produces `index.html`, `ka/index.html`, `404.html` and hashed assets; a no-change re-publish with `--if-changed` is a no-op; an immutable name with new bytes aborts before any rename; a forced failure in swap pass 2 re-applies the previous build; GC keeps unknown files, `.well-known/`, fonts and anything younger than 24 h; with `autoUpdateDateOnPublish: true` a palette-only publish keeps `updated` and a text edit sets today in Asia/Tbilisi (injected clock).
- Local loop: `POST /admin/api/preview {}` → `{ token, base }`; `curl -sI http://localhost:3097<base>` → 200, `content-security-policy: sandbox allow-scripts; …`, `cache-control: no-store`; `<base>ka/` → 200; `<base>styles.<h>.css` → 200 with `access-control-allow-origin: *`; an unknown token → 404 HTML "Preview expired, refresh it from the dashboard"; `POST /preview { "layout": "studio" }` → the HTML has `data-layout="studio"`; both languages render in < 100 ms.
- `POST /publish` with the draft ETag and `acknowledgeWarnings: true` → 200; `./dist` now holds the published site and `node serve.mjs` serves it; publishing again → `changedFiles: 0`.
- Publish with `palette: "lime"`, then `POST /builds/rollback` → in < 1 s every path in the previous build's `manifest.json` exists in `./dist` with that sha256, and `./dist/index.html` references that build's `styles.<h>.css` (the newer build's hashed files stay until the 24 h GC); `data/site.json` `rev` is the previous one; the draft is untouched.
- `grep -c 'Disallow: /admin/' dist/robots.txt` prints `1`; warm publish < 800 ms locally.

### M7 · Brand images: OG cards and icons from content

Spec: §8.8 of this plan; admin-ops.md §5.6; palettes.md §7. Depends on: M6. Ships: no.

Tasks
1. `npm install -E satori@0.33.4 @resvg/resvg-wasm@2.6.2`.
2. Fonts (no browser User-Agent, so Google returns static TTF instances; verified):
   ```bash
   mkdir -p src/brand/fonts && cd src/brand/fonts
   urls() { curl -s "https://fonts.googleapis.com/css2?family=$1" | sed -n 's/.*src: url(\(https:[^)]*\.ttf\)).*/\1/p'; }
   set -- $(urls 'Chivo:wght@400;600');              curl -so Chivo-Regular.ttf "$1";              curl -so Chivo-SemiBold.ttf "$2"
   set -- $(urls 'JetBrains+Mono:wght@400;500');     curl -so JetBrainsMono-Regular.ttf "$1";      curl -so JetBrainsMono-Medium.ttf "$2"
   set -- $(urls 'Noto+Sans+Georgian:wght@400;600'); curl -so NotoSansGeorgian-Regular.ttf "$1";   curl -so NotoSansGeorgian-SemiBold.ttf "$2"
   ```
   Add `OFL.txt` and the commands to `scripts/fetch-fonts.sh`.
3. `src/shared/brand.mjs` (pure: `ogInputs`, `iconInputs`, `brandName`, and `brandNames(site, palette, layoutMeta, rendererId)` → `{ files: new Map(), og, icons }`), `src/brand/cards.mjs`, `src/brand/render.mjs` (§8.8), with `renderBrand(site, palette, layoutMeta, { cacheDir, reuseDirs })` → `{ files, og, icons }` and `RENDERER_ID` (computed at import); the WASM is initialised once, lazily.
4. `build.mjs` and `publish()` switch from `committedBrand()` to `renderBrand()`; the preview switches to `brandNames()`, so it shows the names the next publish will produce. Route `POST /og-preview`; CLI `brand --out <dir> [--palette <id>]`. Test: for the same input, `brandNames()` and `renderBrand()` return the same names.
5. Delete `src/brand/{make.mjs,icon.html,og.html,committed.mjs}`, `src/brand/icon-*.png`, `src/og-en.png`, `src/og-ka.png`.
6. Tests `test/unit/brand.test.mjs` / `admin/test/og.test.mjs`.

Acceptance
- Tests: OG PNGs read 1200×630 from the IHDR bytes, icons 32/180/192/512; identical input → identical bytes; the second call is a cache hit (the renderer is not called); changing `hero.facts[0].value` changes both OG names and no icon name; changing a skill changes no name; changing the palette changes OG and icon names; changing the monogram changes icon names and OG names; every TTF has no `fvar` table and its OS/2 weight class matches its file name.
- `npm run cli -- brand --out .cache/brand-review --palette lime`: the KA card shows Mkhedruli (no missing-glyph boxes) and a non-uppercased eyebrow; the lime icon has a dark glyph; the stress monogram `KSM` is not clipped at 32 px (owner looks at the PNGs).
- `git ls-files '*.png' ':!docs'` prints nothing; `grep -rn "og-en.png\|og-ka.png\|favicon-32.png" src build.mjs admin` prints nothing.
- Cold publish < 3 s locally; `npm run check:all` still exits 0.

### M8 · Admin UI

Spec: admin-ops.md §6 (screens, components, draft state, preview frame, publish dialog); palettes.md §8 (picker); §8.2 of this plan. Depends on: M5–M7. Ships: no.

Tasks
1. `npm install -D -E vue@3.5.42 vite@8.3.0 @vitejs/plugin-vue@6.0.9`; `admin/web/` per admin-ops §6.1–§6.2 (`vite.config.mjs` with `base: '/admin/'`, aliases, `assetsInlineLimit: 0`, dev proxy for `/admin/api` and `/admin/preview`); scripts `dev`, `dev:server`, `dev:web`, `build:admin`, `test:e2e`; `scripts/dev.mjs`.
2. The SPA imports `src/schema/validate.mjs` (browser-safe) and `admin/shared/*`; it gets palettes and check rows from `GET /registry` (never imports `src/palettes.mjs`, which needs `node:fs`).
3. Draw `src/admin-thumbs/precision.svg` and `src/admin-thumbs/ledger.svg` in the convention of `studio.svg`: 320×200, `role="img"` with an `aria-label`, rectangles only (no text glyphs), the layout's default look (Precision: `#fafafb` page, a 76 px rail, cobalt `#0056bc` markers; Ledger: white page, a 21 px spine, ink rules, cobalt numbers). Add `thumbnail` to `src/layouts/precision/layout.mjs` and `src/layouts/ledger/layout.mjs` (`layouts.test.mjs` now requires it).
4. `test/e2e/admin.e2e.mjs` (`node:test` + Playwright, against `admin/server/index.mjs` serving the built SPA; the harness runs `cli init` with `DATA_DIR`, `BUILDS_DIR` and `WEB_ROOT` in one temp directory, so the developer's `dist/` is never touched; a test-only `SESSION_IDLE_S` override, ignored when `NODE_ENV=production`).

Acceptance
- `npm run build:admin` succeeds; `admin/web/dist/index.html` has no inline `<script>` and no `style=` attribute; `! grep -rn "v-html" admin/web/src` succeeds.
- `npm run test:e2e` passes these flows: (E1) first login → forced password change → dashboard; (E2) typing in the KA tagline updates the preview's `/ka/` within 1 s of the last keystroke, before the save returns; (E3) moving a skill item down with the keyboard keeps focus on the moved item's button and `GET /draft` shows the new order; (E4) choosing Studio re-renders the preview with `data-layout="studio"`; choosing Amber sets the preview's `data-palette="amber"` and the network log shows **no** `POST /admin/api/preview` for 2 s; switching the frame to KA keeps `data-palette="amber"`; (E5) typing in the KA tagline and clicking Publish at once → `<temp WEB_ROOT>/ka/index.html` contains the last keystroke and the dashboard shows no unsaved changes afterwards; Revisions → roll back restores the previous bytes; (E6) two contexts: the second save shows the conflict dialog; after "Keep mine" the other version is in Revisions as `pre-overwrite`, and after "Load the newer draft" the local text is in Revisions as a checkpoint; (E7) after session expiry the next save opens the login modal and the queued save is sent after login; (E8) export draft → import → banner and preview show the imported text; (E9) inside the preview frame, `document.cookie` is empty and `fetch('/admin/api/draft', { credentials: 'include', headers: { 'X-Requested-With': 'samsiani-admin' } })` fails with 401 or 403; (E10) `dom-checks` on every screen at 1280 and 390 px, light and dark: AA contrast, no uppercase Georgian, no horizontal scroll, a visible and unclipped focus ring on each tab stop, a name on every link and button; (E11) a pending offline copy whose ETag no longer matches the server draft is offered at boot with "Use mine", "Download my copy" and "Discard".
- Manual, in Chrome and Safari, light and dark, keyboard only: log in → change a skill level → move a list item → switch layout and palette → publish; the focus ring is visible throughout; with reduced motion there are no transitions.

### M9 · Operations, CI/CD and the first production deploy

Spec: admin-ops.md §1, §8–§10, §12. Depends on: M1–M8. Ships: this is the cut-over.

Tasks
1. `deploy/ecosystem.config.cjs`, `deploy/ols-admin-context.conf`, `deploy/remote-deploy.sh` (admin-ops §9.1, §8.1, §10.3); the new `.github/workflows/deploy.yml` (§9.5, admin-ops §10.2: jobs `test`, `gates`, `release`, `deploy`, `--ignore-scripts`, pinned action SHAs, no `deploy/` in the artifact); optional `.github/workflows/backup.yml` (admin-ops §10.7).
2. `scripts/check-secrets.mjs`: greps tracked files (`git ls-files`) for every literal in the `DENYLIST` environment variable (CI secret) or `~/.config/samsiani-me/denylist.txt` (local, untracked; one literal per line: server IP, SSH user, unix user, site-home path), and for IPv4 literals other than `127.0.0.1`, `0.0.0.0`, the `203.0.113.0/24` documentation range and Cloudflare's published ranges (embedded in the script). Without a denylist only the IPv4 check runs, and the script says so. Exit 1 on any hit.
3. `git rm scripts/migrate-content.mjs` (data-model §6 step 7; it imports deleted modules). Remove the `migrate` script from `package.json`.
4. `README.md`: Admin section (URL, first login, local dev), deploy flow, runbook index (admin-ops §12 R1–R11), "`src/content/site.json` is only the seed".
5. Cut-over, §9.6 steps 1–9 (the last step deletes `VPS_PATH` and `VPS_SITE_USER`).

Acceptance
- A pull request runs the `test` and `gates` jobs only and both pass (unit, admin, palette gate, v-html grep, `check:secrets`; SPA build, `check:all`, `check:stress`, e2e); `release.tgz` contains no `deploy/` directory; every `uses:` line in the workflow names a 40-hex SHA.
- The `main` run's deploy job passes; on the server `curl -s http://127.0.0.1:3097/admin/api/health` returns the deployed short sha; `ps -o user= -p "$(pm2 pid samsiani-admin)"` prints the site user; `find /opt/samsiani-admin ! -user root` prints nothing; `pm2 ls` lists `pm2-logrotate`.
- At the origin (Cloudflare rewrites the public HTML: Email Obfuscation, a hidden `/cdn-cgi/content` link and a per-request script, so hashes taken through it never match): `curl -sk --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/ | sha256sum` equals `sha256sum "$WEB_ROOT/index.html"`, the same for `/ka/`, and `CLI verify --web-root` (the alias of admin-ops §12) prints nothing (the files equal `builds/<current>/manifest.json`). Through Cloudflare: `node scripts/check-precision-pixels.mjs --baseline dist --candidate https://samsiani.me --widths 390,768,1080,1280,1440,1600,1920`, with `dist` built locally from the merged commit, reports 42/42 identical (screenshots are taken after Cloudflare's decode script runs).
- `curl -sI https://samsiani.me/admin` → 301 with `location: /admin/`; `curl -sI https://samsiani.me/admin/` → 200 with `x-robots-tag: noindex, nofollow, noarchive`, `cache-control: no-store`, the CSP and `x-frame-options: DENY`; for `curl -sI https://samsiani.me/`, `x-content-type-options`, `referrer-policy`, `x-frame-options`, `permissions-policy`, `content-type` and `cf-cache-status` equal their values before the vhost edit; T1.1 and T1.2 pass.
- Edge check: `curl -sk --resolve samsiani.me:443:127.0.0.1 -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/session` and `curl -s -H 'X-Requested-With: samsiani-admin' http://127.0.0.1:3097/admin/api/session` → 403; the same request through Cloudflare → 200.
- Cache: `curl -s -D- -o /dev/null -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/draft`, twice without a cookie → 401 both times, never `cf-cache-status: HIT`.
- Login works, the forced password change works, the boot log no longer warns about `ADMIN_INITIAL_PASSWORD`, and the `/proc/<pid>/environ` check of §9.4 prints nothing; Publish without edits returns `changedFiles: 0`.
- `stat -c '%a %U' "$SITE_HOME/data" "$SITE_HOME/data/site.json"` → `700 <site user>` and `600 <site user>`; `find "$WEB_ROOT" ! -user "$SITE_USER"` prints nothing; `npm run check:secrets` (local denylist) passes; `.github/workflows/deploy.yml` contains no unix user; the secrets `VPS_PATH` and `VPS_SITE_USER` are gone from the repository settings.

### M10 · Production verification and hardening

Spec: admin-ops.md §13 checklist, §8.3–§8.4, §10.7, §12. Depends on: M9. Ships: verification only.

Tasks and acceptance (each on production)
1. `pm2 stop samsiani-admin` → `sha256sum "$WEB_ROOT/index.html" "$WEB_ROOT/ka/index.html"` (or the origin `curl --resolve`) is unchanged; through Cloudflare `/` and `/ka/` return 200 and `grep -c 'data-layout="precision"'` prints 1; `/admin/` returns 503; `pm2 start samsiani-admin`.
2. Edit the KA tagline in the admin → the preview updates within 1 s; Publish → `curl -s https://samsiani.me/ka/` contains the new text within 5 s. The `og:image` name changes only when a card field changes.
3. Layout drill at a quiet time chosen by the owner: publish Studio → `curl -s https://samsiani.me/ | grep -o 'data-layout="[a-z]*"'` prints `data-layout="studio"`; roll back → `precision` in < 1 s; repeat for Ledger. Palette drill likewise with Lime.
4. Two tabs → conflict dialog; after either choice both versions can be recovered from Revisions.
5. Six wrong passwords from a new browser → 429 with `Retry-After`; a browser that has logged in before (device cookie) still logs in; `pm2 restart samsiani-admin` clears the lock for new browsers.
6. `curl` POSTs to `/admin/api/draft` without `X-Requested-With`, from another origin, and with `Origin: https://samsiani.me, https://evil.example` → 403; with `Origin: https://samsiani.me, https://samsiani.me` and a valid session → accepted.
7. `curl -sk --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/robots.txt | grep -c 'Disallow: /admin/'` prints 1 (through Cloudflare, a count ≥ 1 only after a purge: `/robots.txt` is edge-cached and Cloudflare may prepend its managed block); the session cookie is `__Secure-sm_admin; HttpOnly; Secure; SameSite=Strict; Path=/admin`.
8. Restore drill: `cli backup` writes today's file and `gunzip -t` passes; Export live → Import → preview shows it → Discard draft.
9. Lighthouse (`npx lighthouse https://samsiani.me/ --only-categories=accessibility,performance`, default mobile run and `--preset=desktop`) for `/` and `/ka/`: Accessibility 100, CLS ≤ 0.1.
10. Owner decides the optional hardening: Cloudflare Access (then confirm `/admin/` asks for the email code), OLS `accessControl` to Cloudflare ranges (then a direct-to-origin request gets 403 from OLS rather than from the app), WAF login rule, weekly encrypted backup workflow (then a manual run produces an artifact that decrypts and `cli restore-backup` accepts).

---

## 11. Test plan

| Layer | Tool | Where | What it proves | When |
|---|---|---|---|---|
| Unit: content | `node:test` | `test/unit/{validate,stress-fixture}.test.mjs` | 23 mutation rejections (`javascript:`, `java<TAB>script:`, `mailto:?bcc=`, `ru` key, Cyrillic, "KA · EN · RU", `sections.education`, 3 facts, …) plus `GEORGIAN_IN_CAPS` and `LONG_TOKEN`; seed 0/0; stress 0 errors + 10 warnings; canonical round trip; the fixture reaches every limit | every run (CI) |
| Unit: rendering | `node:test` | `test/unit/{render,render-draft,layouts,theme,build-site}.test.mjs` | determinism; escaping of XSS payloads in HTML, attributes, JSON-LD and `settings.updated`; no throw on draft-shaped documents in any layout; manifest fields and font files; theme precedence and `theme-color`; asset base prefix; only the active fonts; preview omissions; hashed names; robots `Disallow: /admin/`; `headExtra` escaping | CI |
| Unit: palettes | `node:test` + `node src/palettes.mjs` | `test/unit/palettes.test.mjs` | 432/432; malformed data throws; a tampered palette fails | CI, and inside every build |
| Unit: brand images | `node:test` | `test/unit/brand.test.mjs`, `admin/test/og.test.mjs` | sizes, determinism, naming rules, cache, static fonts | CI |
| Admin unit + integration | `node:test`, `app.request()`, child processes | `admin/test/*.test.mjs` | draft rules, atomic writes (incl. `ENOSPC`), locks, store (`pre-overwrite`), auth from disk (CLI reset takes effect at once), guards (edge, device cookie, doubled and weak headers), API contract, preview (fresh data dir, 422), publish, reconcile after `SIGKILL`, swap, GC, backup and restore validation | CI |
| Page gates | Playwright 1.59.1 | `scripts/check-all.mjs` | see matrix below | CI, and locally before each layout change |
| Precision identity | Playwright | `scripts/check-precision-pixels.mjs`, run by `check-all.mjs` against a worktree build of `PIXEL_BASE` | 30 screenshots identical on every CI run while the seed content equals `docs/plans/site.example.json`; 42 through Cloudflare at M9 | M2 onward (CI), M9 |
| Admin end to end | `node:test` + Playwright | `test/e2e/admin.e2e.mjs` | flows E1–E11 (M8) | CI |
| Security | tests + greps | `admin/test/{auth,guard,api}.test.mjs`, E9, CI greps, M9/M10 probes | edge check; cookie flags; CSRF layers incl. doubled headers; limits before scrypt; device cookie; body limits; id and path traversal; preview isolation; CSP and headers; no `v-html`; no server details (`check:secrets`); `release.tgz` without `deploy/`; pinned action SHAs | CI, M9, M10 |
| Accessibility | dom-checks, Lighthouse, manual | E10; Lighthouse (mobile and desktop presets) in M2–M4 and M10; keyboard + VoiceOver passes | AA contrast, unclipped focus, accessible names at 390 and 1440 px, reduced motion, screen-reader landmarks and the Ledger table semantics | M2, M3, M4, M8, M10 |

**`scripts/check-all.mjs` matrix** (exit 1 on any failure, printing every failure). It iterates `Object.keys(LAYOUTS)` through a per-layout table and skips ids that are not registered, so it works at M4 with or without Studio: `precision { nav: '.topnav', design: 'cobalt', script: null }`, `studio { nav: '.st-nav', design: 'lime', script: 'scripts/checks/studio.mjs' }`, `ledger { nav: '.lg-nav', design: 'cobalt', script: 'scripts/checks/ledger.mjs' }`.
1. `node src/palettes.mjs`; the three palette grep gates on every `src/layouts/*/styles.css`; a rejected-ideas gate on every stylesheet: `grep -nE '(^|[^-])serif|dotted|radial-gradient' src/layouts/*/styles.css` prints nothing (Ledger additionally runs its A12 gate, which also forbids radii and shadows).
2. Build the seed for every registered layout × palette and the stress fixture for every registered layout into `.cache/matrix/<layout>-<palette|stress>/`.
3. Per layout, on its design palette and on its stress build: `check-pages` overflow sweep 320→1600 px step 10 × EN/KA × light/dark, Georgian casing, focus (incl. clipping), accessible names, reduced motion, print (EN ≤ 5, KA ≤ 6 pages; seed only); `check-layout-stress.mjs` at 320…1920 px with the layout's nav selector (header-row check included).
4. Per layout × palette: `check-pages --only contrast` (EN/KA × light/dark × 1440/390).
5. Each layout's `script`: `studio.mjs` on `studio-lime` and on `studio-stress` with `--skip print`; `ledger.mjs` on `ledger-cobalt`, `ledger-lime`, `ledger-crimson`.
6. Precision identity: if `.cache/base` is absent, `git worktree add --detach .cache/base $PIXEL_BASE && (cd .cache/base && node build.mjs)` (`PIXEL_BASE = '96e784e'`, CI checks out with `fetch-depth: 0`); then `node scripts/check-precision-pixels.mjs --baseline .cache/base/dist --candidate .cache/matrix/precision-cobalt` must print `30/30 identical`. The step runs only while `src/content/site.json` equals `docs/plans/site.example.json` apart from `settings.layout` and `settings.palette` (the matrix build overrides both); otherwise it prints `pixel identity skipped: seed differs from the base content`.

**Manual checks** (recorded in the pull request): keyboard order and focus in each layout and the admin; VoiceOver on the Ledger table at ≥ 720 px and at 390 px; Safari and Firefox at 1440 and 390 px for each layout (Ledger spine baselines, Studio bento); Chrome print dialog with "Background graphics" off (level marks visible in all layouts); a native Georgian reader looks at `/ka/` in each layout.

---

## 12. Risks and mitigations

| Risk | Effect | Mitigation |
|---|---|---|
| CyberPanel regenerates `vhost.conf` and drops the `/admin/` block | admin offline; public site fine | deploy probe warns; snippet in `deploy/`; runbook R4 |
| The site user cannot execute the Node binary (nvm under `/root`) | service does not start | preflight T0.1; official Node 24 tarball under `/opt` with owner approval |
| Cloudflare caches HTML or rewrites admin JS | stale pages; broken SPA; cached `/admin/api` responses served to anyone | T0.6 over five URLs; bypass and configuration rules **last**, `/admin` excluded from every other rule; R11 check after any rule change; optional purge on publish |
| Cloudflare + OLS duplicate request headers (`Origin`, `CF-Connecting-IP`, `X-Requested-With`, `Sec-Fetch-Site`, `x-sm-edge`, `If-Match`); Cloudflare weakens compressed `ETag`s | false CSRF rejections, wrong rate-limit key, a 412 on every save | guards split comma-separated values and require every part to match; `If-Match` strips `W/`; the SPA reads the ETag from the JSON body; tests |
| Seed drift: someone edits `src/content/site.json` expecting it to go live after M9 | edit never appears | CI notice on every push that changes it; README; Export for moving live content into git by hand |
| A template change breaks the live pages on deploy | broken public site | CI page gates; health check with auto-revert; `--if-changed` re-render; runbook R3 (app rollback, then re-render or build rollback) |
| The renderer produces different bytes for an existing brand-image name | publish refused by the immutable guard | names derive from inputs + `RENDERER_ID`; bytes reused from the cache or the current build |
| Admin compromise | content defacement; root on the shared box if root ever ran a file the site user can write | runs as the site user; code, env files, ecosystem and logs in root-owned `/opt/samsiani-admin`; root never sources, runs or chowns anything under `$SITE_HOME` (§9.1); no GitHub credential on the server; CSP, no `v-html`; audit log; runbook R6 with the `DISABLED` flag; optional Cloudflare Access |
| Compromised npm package or moved action tag in CI | code that root's PM2 evaluates, or the root deploy key | `--ignore-scripts` everywhere; gates in a job that uploads nothing; the artifact holds no `deploy/`, and the ecosystem file and deploy script come from the deploy job's own checkout; every action pinned to a commit SHA |
| Brute force or lockout of the login | admin unavailable | edge check (no request bypasses Cloudflare, so the client key is real); per-client and global limits before hashing; device cookie keeps known browsers out of the global lock; optional Cloudflare Access / WAF rule |
| Crash, reboot or OOM restart between swap and commit | the next deploy's re-render silently undoes a publish | write-ahead `pending` record; `reconcile()` at boot and in every writing CLI command; `--if-changed` compares with the real web root; hard-link swap cannot hit a full disk |
| A pre-M9 static workflow run is re-run after the cut-over | stale `dist/` rsynced over the admin's content with `--delete` | `VPS_PATH` and `VPS_SITE_USER` deleted at the cut-over, so old runs skip their deploy |
| A schema migration runs while the old release still autosaves | mixed-version data; the old release restarted on data it cannot read | `cli migrate` only with the service stopped, after a backup; the backup is restored before the previous release starts again |
| Long admin-entered text breaks a layout or uppercases Georgian | visual defects | measured limits in the validator; a stress fixture at every limit, gated in CI for every layout (stress widths and a 320→1600 px sweep); `body` break-word; `LONG_TOKEN` warning; `GEORGIAN_IN_CAPS` error; casing gate; counters in the form |
| Google changes font file URLs | download commands fail | size checks in `fetch-fonts.sh`; css2 fallback with a desktop User-Agent (layout specs §7) |
| Chromium font metrics drift | nav-fit estimates off by a few px | Playwright pinned to 1.59.1; estimates carry 2–6 % margin; stress gate catches wrapping |
| Server details leak into the public repository | exposure | variables only in tracked files; `check:secrets` in CI with a private denylist; M1 removes the last literal (history rewrite is out of scope, so the origin address stays public; the edge check is designed on that assumption) |
| Disk growth on the server | full disk, failed publish; other sites affected | retention caps (§9.7); `pm2-logrotate`; rejected requests logged as per-minute counts; temp files removed on every write error; publish stages to `builds/` and fails cleanly on ENOSPC |
| Lost admin password | locked out | `cli set-password` (runbook R5), effective on the next request |

---

## 13. Out of scope (later, if ever)

- More layouts, per-layout social-card designs (Studio and Ledger fall back to the Precision card), a visitor-facing layout or palette switcher.
- More than one admin account, roles, two-factor login (Cloudflare Access covers the second factor for now).
- Rich text, images, a photo, a project list, new sections, an education or certificates section, Russian or any third language (the validator rejects the last three).
- A CSP for the public site (its inline theme script and JSON-LD would need hashes), analytics.
- Editing anchors, skill levels or the language set from the admin. (The section order, hiding a section and removing single lines are in scope since schema v2: see `content-editing.md`.)
- Rewriting git history to remove older server details; moving `docs/plans/` reference code out of the repository.
- Automatic translation, spell-checking beyond the browser's, scheduled publishing.

---

## Appendix A · Disagreements between the specs, and the resolution this plan applies

| # | Topic | Sources | Resolution |
|---|---|---|---|
| A1 | Who writes `site.json` | data-model §12.1 recommends git commits through the GitHub API; admin-ops §3.2 makes the server's `data/site.json` the writer | Server (D3). The repository copy is the seed and CI fixture. |
| A2 | Theme precedence | data-model §5.4 has no layout default; layout-studio §0.3(b) asks for one | Accepted: `?theme` > stored > setting light/dark > `layout.defaultTheme` > OS; the shell stamps `data-theme` (§5.4). admin-ops §6.5's "Layout default (dark)" label already assumes it. |
| A3 | Where the in-memory build seam lands | admin-ops M1 adds `buildSite()` after all layouts | M2, so `build.mjs` is rewritten once and every later milestone uses one pipeline. |
| A4 | Palette live preview mechanism | palettes.md §8 sets `contentDocument…dataset.palette` (same-origin frame) | `postMessage` bridge (admin-ops §6.7): the preview frame is sandboxed with an opaque origin, so `contentDocument` is unreachable by design. |
| A5 | Per-palette icons | palettes.md §7: 24 PNGs rendered with Playwright on the Mac, "the glyph never depends on content" | The glyph is `person.monogram`, which the admin can edit. Icons are rendered by the satori pipeline with the OG cards (§8.8, M7); no committed PNGs. |
| A6 | Thumbnail path | layout-studio §0: `src/render/admin-thumbs/`; admin-ops and Studio's `layout.mjs`: `admin-thumbs/studio.svg` | `src/admin-thumbs/<id>.svg`, manifest `thumbnail: 'admin-thumbs/<id>.svg'`. |
| A7 | Layout display name | Studio's `layout.mjs` has both `name` and `label` | `label` only; `name` deleted in M3. |
| A8 | Soft limits per layout | admin-ops §3.3 says Ledger declares four `adminLimits`; layout-ledger §5.7 says it adds none | No `adminLimits` field; counters warn at ⌊0.9 × max⌋. |
| A9 | OG names in the preview | admin-ops §5.1 passes `null`; §7 passed the live build's names (which do not exist before the first publish) | The names the next publish will produce, from `brandNames()` (M6: `committedBrand({ namesOnly: true })`); no build needed. `assets.og` is never prefixed with the preview base. |
| A10 | `buildSite()` options | admin-ops: `assetBase`, `og` | `base`, `brand` (one object for icons and OG names and files), because icons are also generated (A5). |
| A11 | Number of facts | Studio accepts 2–6, Ledger 1–4, schema exactly 4 | Exactly 4 for every layout. |
| A12 | Playwright location | three different env variables and an absolute path on the owner's Mac | Pinned devDependency `playwright@1.59.1`, imported normally. |
| A13 | `main.js` edits | data-model §8.4 proposes selector changes for phase 3 | None needed by Studio or Ledger: `main.js` stays unchanged and keeps its hashed name. |
| A14 | Fonts for satori | admin-ops §5.6: fonttools instancing, five files | Static TTFs from the Google css2 API (verified), six files: JetBrains Mono 400 is needed for the fact labels. |
| A15 | Module name for image inputs | data-model §8.1 reserves `src/shared/og.mjs` | `src/shared/brand.mjs`, because it names icons too. |
| A16 | Milestone order | admin-ops §13: M1 seam+OG … M6 SPA; the brief suggests UI before preview/publish/OG | Server-side preview and publish (M6) and brand images (M7) come before the UI (M8), so the UI is built against real, tested endpoints with nothing stubbed. |
| A17 | Stress-gate coverage in CI | admin-ops §10.2 runs it for the default layout only | Every layout × both fixtures (`check:all`). |
| A18 | Test globs | admin-ops `shared/**/*.test.mjs` (no such folder) | `test/unit/**` and `admin/test/**`; e2e separate. |
| A19 | Palette key in `ctx` | Studio's wrapper reads `ctx.palette` | `ctx.paletteId`, the effective id after fallback. |
| A20 | Asset URLs in the head | the data-model reference hard-codes `/favicon-32.png`, `/fonts/…`, `/site.webmanifest` | All from `ctx.assets` (M2), required by the preview and by hashed icon names. |
| A21 | Unix user in `deploy.yml` | current workflow hard-codes it | Read from a secret in M1; the M9 workflow needs none. |

## Appendix B · Reference files to copy

| From `docs/plans/` | To | Milestone | Edit after copying |
|---|---|---|---|
| `data-model-ref/build.mjs` | `build.mjs` | M1 | none (rewritten in M2) |
| `data-model-ref/scripts/migrate-content.mjs` | `scripts/migrate-content.mjs` | M1 | none (deleted in M9) |
| `data-model-ref/scripts/check-layout-stress.mjs` | `scripts/check-layout-stress.mjs` | M1 | M2: `playwright` import, `serve-dir`, HTTP-status and `main#main` checks, header-row check (M2 task 9) |
| `data-model-ref/src/**` (render, schema, shared, layouts/index, layouts/precision/{layout,template}, brand/make) | `src/**` | M1 | E1–E3 below |
| `site.stress.json` (revised in review: every limit reached) | `test/fixtures/site.stress.json` | M1 | none |
| `site.example.json` | — (the migration must reproduce it; `cmp`) | M1 | — |
| `palettes.json` | `src/palettes.json` | M2 | final `layouts.studio` and `layouts.ledger` (§7) |
| `check-palettes.mjs` | `src/palettes.mjs` | M2 | header comment only |
| `layout-studio/{layout.mjs,template.mjs,styles.css,fonts.css}` | `src/layouts/studio/` | M3 | `layout.mjs`: delete `name`; E4, E5 below |
| `layout-studio/admin-thumb-studio.svg` | `src/admin-thumbs/studio.svg` | M3 | none |
| `layout-studio/check-studio.mjs` | `scripts/checks/studio.mjs` | M3 | `playwright` import; directory or URL argument; HTTP-status rule |
| `layout-ledger/src/layouts/ledger/{layout.mjs,template.mjs,styles.css,fonts.css}` | `src/layouts/ledger/` | M4 | E6 below; M8: add `thumbnail` |
| `layout-ledger/verify.mjs` | `scripts/checks/ledger.mjs` | M4 | `playwright` import; HTTP-status rule |

Edits E1–E6 and M2 task 8 were applied to scratch copies of the reference code and verified in review: M1 output byte-identical; Precision 30/30 identical screenshots; with the revised fixture all three layouts pass the stress gate and a full overflow sweep (320→1600 px step 10, EN/KA, light/dark), and `checks/studio.mjs` and `checks/ledger.mjs` fail only their print page counts (skipped for stress builds); the draft-render cases of M1 task 6 pass.

**E1 · `src/layouts/precision/template.mjs`** (M1). Lines 159–163 become (markup inside unchanged):
```js
      ${primary ? `<a class="big-mail" href="${esc(primary.href)}">${esc(primary.value)} ${UI_ICONS.arrow}</a>
      <div class="cta-row">
        <a class="btn" href="${esc(primary.href)}">${esc(s.contact.cta)}</a>
        ${s.contact.buttons.map(ghost).join('\n        ')}
      </div>` : ''}
```
Line 168: `${ctx.updated.slice(0, 4)}` → `${esc(ctx.updated.slice(0, 4))}`, and both `${ctx.updated}` → `${esc(ctx.updated)}`. The same date replacements apply to Studio line 193 (E5) and Ledger line 149 (E6).

**E2 · `src/layouts/precision/layout.mjs`** (M1): add `description: 'The current design: identity rail on the left, content on the right, skills as a ledger table.',` after `label`.

**E3 · `src/schema/validate.mjs`** (M1): `printShort: LS(4)` and `langShort: LS(4)` (lines 60–61); after `MTAVRULI_RE`:
```js
// headings and names rendered at display sizes: a whitespace-free run longer than 24 breaks mid-word
const TOKEN_PATH_RE = /^\$\.(hero|sections)\.(?:.*\.)?(title|name|role|lead)\.(en|ka)$/;
// .en values that layouts render with text-transform (the --caps token is uppercase on / only)
const CAPS_PATHS = new Set(['$.hero.eyebrow', '$.hero.facts[].label', '$.contact.heading', '$.contact.items[].label',
  '$.ui.copy', '$.ui.copied', '$.ui.levels.core', '$.ui.levels.strong', '$.ui.levels.working', '$.ui.present', '$.ui.print',
  '$.ui.printShort', '$.ui.nav', '$.ui.colGroup', '$.ui.colSkill', '$.ui.colDepth', '$.sections.languages.items[].name',
  '$.sections.languages.items[].proficiency', '$.sections.contact.cta'].map((p) => p + '.en'));
```
and in `checkText`, after the `MTAVRULI` line:
```js
if (TOKEN_PATH_RE.test(path)) { const t = s.split(/\s+/).find((w) => len(w) > 24); if (t) warn(path, 'LONG_TOKEN', `"${t}" has no break opportunity for ${len(t)} characters; it will break mid-word`); }
if (lang === 'en' && CAPS_PATHS.has(path.replace(/\[\d+\]/g, '[]')) && GEORGIAN_RE.test(s)) err(path, 'GEORGIAN_IN_CAPS', 'this label is shown in capitals on the English page; Georgian letters would turn into Mtavruli');
```

**E4 · `src/layouts/studio/styles.css`** (M3). Line 36: `--st-mono: "JetBrains Mono", "Noto Sans Georgian", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`. Line 144: in `.st-brand-name`, replace `display: none;` with `position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;`. Line 343: `.st-brand-name { display: inline; }` → `.st-brand-name { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; }`.

**E5 · `src/layouts/studio/template.mjs`** (M3). Lines 180–186: the same guard as E1 around the whole `<div class="st-contact-body">…</div>` block (`` ${primary ? ` `` before it, `` ` : ''} `` after it); line 193: the date replacements of E1.

**E6 · `src/layouts/ledger/`** (M4). `styles.css`: append `body { overflow-wrap: break-word; }` and `@media (min-width: 401px) { .lg-leg { display: inline-block; max-width: 100%; white-space: normal; } }` (A11 and A12 still pass; `verify.mjs` passes on the seed; seed screenshots unchanged 44/44 at 390–1920 px). `template.mjs` line 149: the date replacements of E1 (Ledger already guards `primary`).

The admin, deploy and brand code has no reference implementation; admin-ops.md contains the exact sketches to build from: atomic write (§3.5), lock rules (§3.6), `createApp` wiring (§4.1), `clientKey`, `edgeOk` and `originAllowed` (§4.4–§4.5), headers (§4.6), `applyBuild` (§5.4), the preview bridge (§7), the vhost block (§8.1), the ecosystem file (§9.1), the workflow (§10.2) and `remote-deploy.sh` (§10.3).

---

## Review log

Review of 2026-09-15: 37 findings (1 blocker, 15 major, 21 minor). **All applied; none rejected.** "F" numbers follow the order of the review. Sections are this plan's unless prefixed (`ops` = admin-ops.md, `dm` = data-model.md, `st` = layout-studio.md, `lg` = layout-ledger.md, `pal` = palettes.md).

| # | Sev. | Finding | What changed (where) |
|---|---|---|---|
| F1 | blocker | root-owned code, env files and logs lived inside the site user's home | Root-owned `/opt/samsiani-admin` (`releases/`, `current`, `shared/`, `logs/`); `$SITE_HOME` keeps only `public_html/`, `data/`, `builds/`; the root rule; T0.8; `remote-deploy.sh <SHA>` sources `/opt/…/deploy.env` and creates `data/`, `builds/` via `runuser`; `find /opt/samsiani-admin ! -user root` (§2, §9.1, §9.4–§9.6, M9; ops §0, §1, §2.2, §9, §10.2–§10.3, §12) |
| F2 | major | root's PM2 evaluated `deploy/` from the CI artifact | No `deploy/` in the tarball; ecosystem written from the deploy job's checkout to `shared/`; `--ignore-scripts`; jobs `test`, `gates`, `release`, `deploy`; actions pinned to SHAs looked up on 2026-09-15; threat #14 (§9.5, §12; ops §9.1, §10.2, §11) |
| F3 | major | spoofable client key; global lock usable to lock the owner out | Required Transform Rule `x-sm-edge` + guard 0 (403 `edge`, boot refusal, curl acceptance at M9); device cookie with its own limit; threats #1, #2, #10; R5; ops §13 item 6 (§0 D4, §2, §8.3–§8.4, §9.3–§9.6, M5, M9, M10; ops §4.4–§4.5, §8.3–§8.4, §9, §11–§13) |
| F4 | major | "bypass first" is wrong: the last matching Cache/Configuration Rule wins | Both admin rules last; `and not starts_with(…"/admin")` on every other rule; the draft-401-twice check at M9 and in new runbook R11 (§9.3, §9.6, M9; ops §1, §8.4, §12) |
| F5 | major | a crash between swap and commit let the next deploy undo a publish | Write-ahead `pending`; `reconcile()` at boot and in writing CLI commands; `--if-changed` against the real web root; hard-link swap; fsync of staged builds; rollback uses the same record; tests (§8.7, M6; ops §3.4, §5.2, §5.4, §5.7, §5.10, §10.4) |
| F6 | major | CLI password reset did not reach the running service | Files are the only authority: stat per request, read-modify-write under the `write` lock, CLI takes the lock; R5 ends with a restart; tests (§8.4, M5; ops §4.2–§4.3, §10.4, §12) |
| F7 | major | PM2 keeps env vars removed from the ecosystem | Explicit key list with `''` for absent optional keys, `filter_env: true`, empty = unset, `/proc/<pid>/environ` check; initial password only on a true first boot (§8.4, §9.4, §9.6; ops §4.2, §9.1–§9.3, §10.5, §12 R9) |
| F8 | major | "Keep mine" and "Load the newer draft" could each lose a version | `pre-overwrite` snapshot on every forced save; `POST /draft/checkpoint { site }`; dialog texts; E6 and M10 task 4 check both versions in Revisions (§8.2–§8.5, M8, M10; ops §3.4, §3.7, §4.7, §6.6, §13) |
| F9 | major | pre-M9 workflow re-runs could overwrite admin content; R8 could never deploy | New workflow reads no `VPS_PATH`; cut-over step 9 deletes `VPS_PATH`, `VPS_SITE_USER`; M1 keeps the skip test first; R2 names the workflow; R8 rewritten (§0, §9.5–§9.6, M1, M9, §12; ops §10.2, §10.5, §11 #26, §12) |
| F10 | major | `cli init` migrated while the old release still autosaved | `cli migrate [--dry-run]` (exit 10, refuses while healthy); deploy stops, backs up, migrates, restores on a failed health check (§4, §9.5, M5; ops §5.2, §10.3) |
| F11 | minor | publish could overwrite an in-flight autosave | Commit re-reads the draft; SPA settles the queue, stays inert, copies `draft.updated`; queued saves cancelled after discard/restore/import (§8.7; ops §5.2, §6.6, §6.8) |
| F12 | minor | Cloudflare weakens compressed ETags; other headers can be doubled | ETag from the JSON body; lenient `If-Match`; every-value rule for `X-Requested-With`, `Sec-Fetch-Site`; tests (§8.2–§8.4; ops §4.5, §4.7, §6.6, §10.4) |
| F13 | minor | offline copy silently dropped when the draft moved on | Always offered; three-choice dialog; key removed only after save or Discard; E11 (§8.2, M8; ops §6.6) |
| F14 | minor | `settings.updated`/`siteUrl` reached markup unescaped/unenforced | `$.settings.` errors block drafts; server overwrites `siteUrl`; `esc(ctx.updated)` in all templates (E1, E5, E6); render test (§4, §5.2, M1; ops §3.1, §3.3, §7; dm §12.5) |
| F15 | minor | temp files left on ENOSPC; unbounded logs | One try block with cleanup; recursive boot cleanup; ENOSPC test; rejected requests logged as per-minute counts; `pm2-logrotate` required (§8.5, §9.4, §9.6; ops §3.5, §9.4) |
| F16 | minor | a lost `data/` re-seeded stale content | `init` restores from the newest build when builds exist (M5; ops §10.3) |
| F17 | minor | `restore-backup` wrote unchecked documents | Whole-file validation, staging dir, then rename; id regex for `restore-build`/`rollback` (§8.3, §8.5; ops §3.8, §10.7) |
| F18 | minor | `pm2 stop` undone by the next deploy | `shared/DISABLED` flag in R4, R6 and `remote-deploy.sh` (§9.1, §9.5; ops §2.2, §10.3, §12) |
| F19 | major | Precision and Studio threw on a deleted primary email or an empty contact list | §5.2 rule 10; guards E1/E5; `$.settings.` blocking; `render-draft.test.mjs`; 422 `preview_render_failed`. Verified: originals throw, edited templates pass all seven cases (§5.2, §8.3, §8.6, M1, M3, M6; ops §3.3, §4.7, §6.7, §7; st §3.9) |
| F20 | major | brand link had no accessible name below 600 px | Visually hidden name in Precision (M2) and Studio (E4); Lighthouse 100 required, mobile and desktop presets; accessible-name check. Verified with CDP (§5.2, §6, M2–M4, M10; st §1.4; lg A14) |
| F21 | major | stress fixture was below its limits; limits 5/5 overflowed | `langShort`/`printShort` ≤ 4; **`site.stress.json` regenerated** with every limit reached; Precision `< 380 px` block; `stress-fixture.test.mjs` (exempts `settings.siteUrl`, which `SITE_URL` fixes and Ledger shows as its brand, and the nav labels); header-row check. Verified in all three layouts (§4, §6, M1, M2; dm §3.4, §7, §9) |
| F22 | major | long unbreakable tokens widened pages | `body { overflow-wrap: break-word; }` in Precision and Ledger; rule 7a; tokens in the fixture; `LONG_TOKEN` warning (E3). Verified (§4, §5.2, §6, M2, M4; dm §4.4, §12.5; lg §9.1) |
| F23 | major | preview needed a build that does not exist after `cli init` | `committedBrand({ namesOnly })` (M6), pure `brandNames()` (M7); API test on a fresh data dir; e2e temp dirs; A9 (§8.6, §8.8, M6–M8; ops §7) |
| F24 | major | Cloudflare rewrites public HTML, so hashes through it never match | Origin comparison, M10 task 1 on disk/origin, header subset (M9, M10; ops §8.1, §8.4, §10.5, §13) |
| F25 | minor | M4 depended on M3's check script | `check-all.mjs` iterates registered layouts through a per-layout table (M4, §11) |
| F26 | minor | `.lang` clipped the focus ring | `outline-offset: -3px`; focus-clip check. Verified (§5.2, §6, M2) |
| F27 | minor | gates passed on 404s | HTTP-status, missing-file and `main#main` rules in every served gate (M2, Appendix B) |
| F28 | minor | pixel baseline not reproducible, not permanent | Worktree of `PIXEL_BASE`, step 6 of `check-all`, `fetch-depth: 0` (M1, M2, §11, §9.5) |
| F29 | minor | `/robots.txt` cached at the edge | T0.6 over five URLs; bypass rule or purge; origin check in M10 (§9.3, §9.6, M10; ops §1) |
| F30 | minor | palette changes triggered a re-render; KA lost the bridge state | Re-render key without palette/theme; re-post on `load`; E4 network assertion (§8.6, M8; ops §6.7) |
| F31 | minor | wrong browser-bar colour for forced themes | Single `theme-color` for `light`/`dark` (§5.4, M2) |
| F32 | minor | Studio mono stack lacked Noto | E4 line 36; Precision exemption recorded (§6; st §1.4) |
| F33 | minor | Georgian in caps-rendered EN fields | `GEORGIAN_IN_CAPS` error (E3), mutation test (§4, M1; dm §4.2) |
| F34 | minor | picker could not produce hex values | `paletteHex`, `paletteMin` in `GET /registry` (§7, §8.3; ops §4.7, §6.5; pal §8) |
| F35 | minor | manifests broke the contract before M8 | Precision `description` in M1 (E2); `thumbnail` required from M8; `layouts.test.mjs` (§5.2, M1, M8) |
| F36 | minor | five broken acceptance commands | (a) `bash -c … \|\| exit 1`; (b) A10 on `.cache/lg`; (c) `headExtra` test without validation; (d) rollback criterion; (e) script definitions (§3, M2, M4, M6; ops §10.1) |
| F37 | minor | M2–M4 could ship non-cobalt with cobalt icons | Ship with `cobalt` until M7; `BRAND_STALE` warning (§5.5, M2–M4) |

**Adjusted while applying** (the finding stands; the fix differs in detail): F24 compares the origin with the file on disk and runs `CLI verify --web-root` instead of `node -p "require('<SITE_HOME>/…/manifest.json')…"` as root, because `require()` follows a planted symlink to a `.js` file and would execute it as root, against F1's rule. F7 uses `tr '\0' '\n'` in place of `xargs -0 -L1` (same output). F28 runs the pixel step only while the seed content equals `site.example.json` (apart from layout and palette), so a later seed edit does not fail CI. F2 pins the v4 line the plan already used (checkout 4.4.0, setup-node 4.4.0, upload-artifact 4.6.2, download-artifact 4.3.0) rather than moving to new majors. F3 leaves `ADMIN_USERNAME` optional (`''` → `admin`).

**Found while verifying the fixes** (not in the review): the full 320→1600 px sweep of the regenerated fixture overflowed Precision KA at 610–640 px (+34 px; +6 px already with the old fixture, which the plan's own `check-all` sweep would have caught) and Ledger KA at 410–450 px (+41 px, legend items at their limits). Fixed by Precision deliberate difference 9 (`.brand { flex: 0 1 auto; min-width: 0; }`) and Ledger's legend rule (E6); both keep the seed pixel-identical (Precision 30/30, Ledger 44/44). Also: rollback writes the same `pending` record as publish; `VPS_KNOWN_HOSTS` is required; `check-precision-pixels` covers light, OS dark and `?theme=dark`; `og-cache` is `brand-cache` in admin-ops; admin-ops §3.3 no longer mentions per-layout soft limits (A8); palettes.md §8 points to the preview bridge (A4).
