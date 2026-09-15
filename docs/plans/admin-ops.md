# samsiani.me: admin application, operations and security plan

Status: plan, ready to build · Owner of this document: admin/ops track · Date: 2026-09-14
Revised 2026-09-15 after review; where this file and `admin-layouts-palettes.md` differ, the master plan wins.
Scope: the admin service, its storage, auth, API, publish pipeline, admin UI, OLS/Cloudflare/PM2
wiring, CI/CD, threat model and runbooks. This is **phase 4 of `data-model.md`**: the content
schema, validator, `localize()`, `renderSite()` and the migration belong to `data-model.md`; the
palettes to `palettes.md`; the Studio and Ledger layouts to their own plans. This plan uses those
contracts as they are, adds the in-memory build seam `buildSite()` (§5.1) that preview and publish
share with `build.mjs`, and answers the one open question data-model §12.1 hands to it: who writes
`site.json` (§3.2).

This file is committed to a public repository. It contains **no server IP, no SSH user, no unix
user name and no host-identifying path**. Server-specific values are referred to as variables
(`$SITE_HOME`, `$WEB_ROOT`, `$SITE_USER`, `$NODE_BIN`) and live only in GitHub secrets or in
root-only files under `/opt/samsiani-admin/shared/` (§9.2), a fixed path that identifies no server.

---

## 0. Decisions at a glance

| # | Area | Decision | Why (one line) |
|---|------|----------|----------------|
| D1 | Public site | Stays static HTML served by OLS from `$WEB_ROOT` | Fast, cached, survives any admin outage |
| D2 | Admin runtime | One Node 24 process, **Hono 4.13.7 + @hono/node-server 2.1.1**, `127.0.0.1:3097`, PM2 fork mode, 1 instance | Two pure-JS packages, zero transitive deps, in-process testing via `app.request()` |
| D3 | URL space | Everything under **`/admin/`**: SPA `/admin/`, API **`/admin/api/*`**, preview `/admin/preview/<token>/*` | A cookie with `Path=/admin` is never sent to `/api/admin/*`; one prefix = one OLS context, one cookie path, one robots rule. (Deviation from the brief's `/api/admin`, deliberate.) |
| D4 | Storage | JSON files in `$SITE_HOME/data` (outside web root): `draft.json`, `site.json`, `revisions/` (last 30), atomic write = temp + fsync + rename + dir fsync, in-process mutex + O_EXCL lockfile | No database, no native modules, human-readable, trivially backed up |
| D5 | Auth | Single admin, scrypt `N=65536, r=8, p=2, dkLen=64, maxmem=128 MiB` (measured ~340 ms locally on Node 24), HMAC-SHA256 signed session cookie `__Secure-sm_admin`, `HttpOnly; Secure; SameSite=Strict; Path=/admin`, 12 h idle / 7 d absolute, server-side session allowlist | OWASP-equivalent cost to N=2^17,p=1 at half the memory; revocable sessions |
| D6 | CSRF | SameSite=Strict + required header `X-Requested-With: samsiani-admin` + Origin allowlist that splits the doubled `"a, a"` value + `Sec-Fetch-Site` check | Three independent layers; tolerant of the Cloudflare+OLS duplicated Origin |
| D7 | Preview | Server renders the (unsaved) draft into an in-memory file set behind a 256-bit capability URL; iframe `sandbox="allow-scripts"` + response header `Content-Security-Policy: sandbox allow-scripts` | Real document URL (assets, fonts, `?theme=` work) and an opaque origin that cannot touch the admin session |
| D8 | Publish swap | Render → stage in `$SITE_HOME/builds/<buildId>/` → **per-file atomic `rename(2)` into the existing real `$WEB_ROOT` directory, immutable assets first, HTML last** → keep last 10 builds for instant rollback | Works with any OLS config; no docRoot or symlink change; each file flips atomically |
| D9 | OG images | Rendered on the server at publish with **satori 0.33.4 + @resvg/resvg-wasm 2.6.2** (pure JS + WASM), content-hashed names `og-<lang>.<md5-8>.png` from `ogInputs` (data-model §12.2), cached | Admin edits to name/role/facts must update the social card; zero native code |
| D10 | Admin UI | **Vue 3.5 + Vite 8**, no UI kit, no router package (40-line hash router); the form is generated from data-model's `buildSchema()` and checked by the same `validate()` the server runs | Owner already maintains a Vue 3 CRM; `v-model` fits a dense bilingual form |
| D11 | Process identity | PM2 (running as root) starts the app with `uid`/`gid` = `$SITE_USER`; the app refuses to run as root in production. Everything root runs, sources or lets PM2 open lives in root-owned `/opt/samsiani-admin`; root never writes, runs or sources anything under `$SITE_HOME` (§2.2) | A compromised admin process gets the site user's rights, and cannot turn them into root at the next deploy |
| D12 | Deploy | CI builds a self-contained release (code + production `node_modules` + built SPA, no `deploy/`) with `--ignore-scripts`, rsyncs it to `/opt/samsiani-admin/releases/<sha>/`, writes the ecosystem file from the deploy job's own checkout, flips `current`, `pm2 startOrReload`, health-checks (auto-revert on failure), then re-renders the public site from the server's `site.json` | Server never runs npm; root never evaluates a file from the artifact; app rollback is a symlink flip; content never comes from git after the first seed |
| D13 | Content writer | **The server's `data/site.json` is the only writer** (draft → publish); the repository copy is the seed; CI re-renders the server's document and never ships content | Answers data-model §12.1: a repo-write token on the server would let an admin compromise reach CI and its root deploy key (§3.2) |

Where each item of the brief is answered:

| Brief item | Sections |
|---|---|
| 1 Server framework | §4.1 |
| 2 Storage, atomic write, revisions, draft/published, locking, backups | §3 |
| 3 Auth, sessions, rate limiting, CSRF | §4.2–§4.6 |
| 4 API endpoint table | §4.7 |
| 5 Publish pipeline, swap, rollback, OG images | §5, §7 |
| 6 Admin UI | §6 |
| 7 OLS vhost, robots, Cloudflare | §8 |
| 8 PM2 | §9 |
| 9 CI/CD, first-boot seed, local dev | §10 |
| 10 Threat model, rollback runbook | §11, §12 |
| Who writes `site.json` (asked by data-model §12.1) | §3.2 |
| Order of work and "done" | §1 (preflight), §13 |

---

## 1. Preflight checks on the server (T0, run once before building the deploy)

The builder runs these over SSH as root and records the answers in
`/opt/samsiani-admin/shared/deploy.env` (§9.2). Nothing here is committed.

| ID | Check | Command | Pass condition | If it fails |
|----|-------|---------|----------------|-------------|
| T0.1 | Node 24 binary is usable by the site user | `runuser -u "$SITE_USER" -- "$(readlink -f "$(command -v node)")" -v` | prints `v24.x` | Node lives under `/root` (nvm). Install the official Linux x64 tarball of the same version into `/opt/node-v24.14.1-linux-x64/` (official Node 18+ Linux binaries need glibc >= 2.28; AlmaLinux 8 has 2.28) and use `NODE_BIN=/opt/node-v24.14.1-linux-x64/bin/node`. Owner approves this system change. |
| T0.2 | Port 3097 is free | `ss -ltn 'sport = :3097'` | only the header line | pick another free port, change `PORT` in `deploy.env` and the vhost `extprocessor` |
| T0.3 | PM2 can drop privileges | `pm2 -v` (>= 4) and `pm2 ls` | PM2 runs as root | if PM2 is not root, remove `uid/gid` from the ecosystem and run the app under the site user's own PM2 |
| T0.4 | Web root owner | `stat -c '%U:%G %a' "$WEB_ROOT"` | `$SITE_USER:$SITE_USER 755` | stop and investigate: the static workflow chowns it to the site user on every deploy. Fix once by hand before the first admin deploy (no admin code has run yet): `[ -L "$WEB_ROOT" ] \|\| chown "$SITE_USER:$SITE_USER" "$WEB_ROOT"` |
| T0.5 | OLS client-IP mode (decides §8.3 option) | `grep -n useIpInProxyHeader /usr/local/lsws/conf/httpd_config.conf` | absent or `0` | skip the optional `accessControl` block in §8.3 |
| T0.6 | Cloudflare does not cache the fixed-name files | `for u in / /ka/ /404.html /sitemap.xml /robots.txt; do curl -sI https://samsiani.me$u \| grep -i cf-cache-status; done` | `DYNAMIC` for each | any `HIT`, `MISS`, `EXPIRED` or `REVALIDATED` (today `/robots.txt` is a `HIT`, `max-age=14400`): add a "bypass" Cache Rule for `/robots.txt` and `/sitemap.xml` (after any Cache Everything rule), or set `CF_API_TOKEN` + `CF_ZONE_ID` so publish purges (§5.8); a Cache Everything rule also gets `and not starts_with(http.request.uri.path, "/admin")` (§8.4) |
| T0.7 | runuser available | `runuser --help \| head -1` | usage text | use `su -s /bin/bash "$SITE_USER" -c` equivalents |
| T0.8 | Who owns the site home | `stat -c '%U %a' "$SITE_HOME"` | `<site user> 711` (CyberPanel's default) | nothing to fix: this answer is why every root-owned file lives in `/opt/samsiani-admin` and why root never writes under `$SITE_HOME` (§2.2) |

After the first deploy (§10.5) two more checks confirm OLS behaviour:

| ID | Check | Pass condition |
|----|-------|----------------|
| T1.1 | OLS forwards the full URI to the proxy | `curl -sk --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/admin/api/health` returns the JSON health body (the app only answers under `/admin/`) |
| T1.2 | OLS serves a renamed file immediately | publish twice with a changed tagline; `curl -sk --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/ \| sha256sum` equals the `index.html` hash in `builds/<current>/manifest.json` within 1 s |

---

## 2. Repository and server layout

### 2.1 Repository (after this work)

The admin is **phase 4** of `data-model.md` §11. It starts from the tree that data-model phases
1–3 produce (content migrated to `src/content/site.json`, `src/schema/validate.mjs`,
`src/shared/*`, `src/render.mjs`, `src/layouts/{precision,studio,ledger}/`, `src/palettes.{json,mjs}`)
and adds only the files below.

```
package.json                  root: scripts + deps (§10.1)
package-lock.json
build.mjs                     data-model's build CLI, reduced to a wrapper: buildSite() → write the Map to OUT_DIR (§5.1)
serve.mjs                     unchanged local static server for dist/ (port 4173)
src/
  content/site.json           (data-model) now the SEED and dev content, not production content (§3.2)
  build-site.mjs              NEW buildSite(site, opts) → Map<path, { body, type, immutable }>; the one pipeline for build.mjs, preview and publish (§5.1)
  shared/og.mjs               NEW (slot reserved by data-model §8.1): ogInputs(site, lang, palette), ogName(lang, inputs)
  og/render.mjs               NEW renderOgPng() with satori + @resvg/resvg-wasm (§5.6)
  og/fonts/*.ttf, OFL.txt     NEW static TTF instances for satori
  admin-thumbs/<id>.svg       picker thumbnails, 320×200 (Studio already ships studio.svg; §5.1)
admin/
  shared/
    draft-rules.mjs           DRAFT_BLOCKING codes and counter thresholds (§3.3); imported by server and SPA
    diff.mjs                  diffPaths(a, b) → [{ path, before, after }] for "Changes" and "N fields differ"
  server/
    index.mjs                 boot: config, refuse root, init data dirs, listen, graceful shutdown
    app.mjs                   createApp(config, deps) → Hono app (pure; used by tests)
    config.mjs                env → frozen config object (§9.3)
    cli.mjs                   init | verify [--web-root] | publish | rollback | builds | restore-build | set-password | backup | restore-backup | export | import
    routes/
      auth.mjs  draft.mjs  preview.mjs  publish.mjs  revisions.mjs  account.mjs  io.mjs  health.mjs
    lib/
      fsx.mjs                 writeFileAtomic, fsyncDir, readJson, ensureDir(mode)
      lock.mjs                Mutex + withFileLock(name, fn, { timeoutMs, staleMs })
      store.mjs               draft/site/revisions/publish-state API (§3.4)
      auth.mjs                scrypt hash/verify, session cookie sign/verify, session registry
      guard.mjs               requireApiGuards, originAllowed, clientKey, RateLimiter
      headers.mjs             headersFor(kind): spa | api | preview | asset
      preview.mjs             PreviewStore (token → file map, TTL 15 min, max 20) + head injection (§7)
      publish.mjs             publish(), rollback(), listBuilds()
      swap.mjs                applyBuild(buildDir, webRoot, manifest), gcWebRoot()
      backup.mjs              daily gz snapshot, retention 30 days
      audit.mjs               JSONL audit log with 1 MiB rotation
      cloudflare.mjs          optional purge (fetch, no deps)
  web/                        Vite + Vue SPA (§6)
    index.html  vite.config.mjs  src/...  dist/ (build output, gitignored)
  test/                       node:test suites (§10.4)
deploy/
  ecosystem.config.cjs        PM2 app definition, reads the env files next to it (§9.1); the deploy job copies it to /opt/samsiani-admin/shared/
  ols-admin-context.conf      vhost snippet to paste (§8.1); contains no server paths
  admin.env.example           documented keys, no values
  deploy.env.example          documented keys, no values
  remote-deploy.sh            the server half of the deploy, sent over SSH from the deploy job's checkout (§10.3); deploy/ is never in the release
.github/workflows/deploy.yml  test + gates → release → deploy (§10.2)
.gitignore                    + data/ .builds/ admin/web/dist/ .env* release/ release.tgz
```

### 2.2 Server

`$SITE_HOME` is the CyberPanel home of the domain and `$WEB_ROOT` its docRoot; both come from
`/opt/samsiani-admin/shared/deploy.env`.

```
/opt/samsiani-admin/   root:root 755 (APP_HOME): everything root executes, sources or lets PM2 open
  releases/<sha>/      code + node_modules + admin/web/dist, root-owned, read-only for others (5 kept)
  current -> releases/<sha>
  shared/              root 700
    deploy.env         server facts (SITE_USER, NODE_BIN, SITE_HOME, WEB_ROOT, PORT)     600
    admin.env          secrets (§9.2)                                                    600
    ecosystem.config.cjs  written by the deploy job from its own checkout (§10.2)        600
    DISABLED           optional flag: the deploy installs releases but does not start them (R4, R6)
  logs/                root 700: samsiani-admin.{out,err}.log, written by the PM2 daemon, rotated by pm2-logrotate
$SITE_HOME/            owner $SITE_USER, 711 (T0.8): root never writes, runs or sources anything below it
  public_html/         = $WEB_ROOT, OLS docRoot, real directory, owner $SITE_USER, 755 (unchanged)
  data/                owner $SITE_USER, 700   (never inside the web root, never in git)
    site.json          published document                         600
    draft.json         working document                           600
    auth.json          admin credential                           600
    sessions.json      active session allowlist                   600
    publish-state.json current build + history (+ pending, §5.2)  600
    revisions/         r-snapshots, newest 30 kept                700 / files 600
    backups/           YYYY-MM-DD.json.gz, 30 kept                700 / files 600
    brand-cache/       <name>.png                                 700 / files 600
    locks/             write.lock, publish.lock                   700
    audit.log          JSONL, rotates to audit.1.log at 1 MiB     600
  builds/              owner $SITE_USER, 755; same filesystem as public_html (the swap hard-links, §5.4)
    <buildId>/         full rendered site + manifest.json + .site.json (10 kept)
  logs/                the vhost's own OLS logs (exists); not used by the admin
```

**Why the code is not under `$SITE_HOME`.** The site user owns `$SITE_HOME` and may rename any entry
in it. A root-owned `app/`, `logs/` or `data/` there could be moved aside and replaced by the site
user's own: the deploy would then source a site-user `deploy.env` as root, PM2 would `require()` a
site-user ecosystem file as root and open log files through planted symlinks, and a root
`install -d -o … data` would follow `data -> /etc`. Any code execution in the admin process would
become root at the next deploy. Rule: **root never sources, executes, chowns, chmods or rsyncs a path
under `$SITE_HOME`**; every command that writes there runs through `runuser -u "$SITE_USER"`. Reading
(`stat`, `find`, `sha256sum`, `curl`) is fine; `node -e "require('<file under $SITE_HOME>')"` is not, because
`require()` follows a symlink to a `.js` file and runs it. Acceptance: `find /opt/samsiani-admin ! -user root`
prints nothing.

---

## 3. Content document and storage

### 3.1 The content document (owned by `data-model.md`)

The site document, its validator, its serializer and the renderer are defined, and already proven
byte-identical against the live build, by `docs/plans/data-model.md` (schema v1,
`src/schema/validate.mjs`, `src/shared/localize.mjs`, `src/render.mjs`; reference code in
`docs/plans/data-model-ref/`). This plan uses them unchanged and adds nothing to the schema.
What the admin relies on:

| Property (data-model section) | Consequence for the admin |
|---|---|
| Localized strings are `{ "en", "ka" }` leaves; each list item exists once and has a stable `id` (§1, §3.8) | EN and KA cannot drift apart; add, remove and reorder act on one item; new ids are 8 random base36 characters from `crypto.getRandomValues`, retried on collision |
| Non-translatable values are stored once (§1) | one input each for `href`, `value`, `level`, years, `icon`, `copy` |
| `validate(site, { paletteIds, layoutIds, mode, today })` → `{ errors, warnings }`, each `{ path: "$.sections.skills.groups[2].items[0].name.ka", code, msg }` (§4) | the server and the SPA run the same function; every message lands next to its input |
| `canonicalize(site)` (§4.6) | every stored document (draft, live, revision) is written through it; `sha256(canonicalize(site))` is the document's ETag |
| `limitsTable()` → 91 × `{ path, max, localized }` (§7) | character counters |
| `buildSchema()` (§4) | the content editor is generated from it |
| `settings = { layout, palette, defaultTheme, updated, autoUpdateDateOnPublish, siteUrl }` (§3.1) | the dashboard edits the first five; `siteUrl` is shown read-only, and `saveDraft`, import, preview and publish overwrite it with `cfg.SITE_URL` before validating (so an import cannot move canonical, hreflang, `og:url`, JSON-LD and the sitemap to another origin); `diff.mjs` ignores it |
| Plain text only, escaped by `esc()` (every template also escapes `ctx.updated`, master plan Appendix B E1); JSON-LD through `jsonForScript()`; hrefs limited to `https:`, `mailto:`, `tel:` (§4.3, §12.4) | nothing the admin stores can become HTML, CSS or script; the admin adds no rich-text field |

`today` is always the current date in Asia/Tbilisi
(`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date())`), the same
clock data-model §12.3 uses for `autoUpdateDateOnPublish`.

### 3.2 One writer: the server's `data/site.json` (the decision data-model §12.1 asks for)

data-model §12.1 requires exactly one writer and recommends git (the admin commits
`src/content/site.json` through the GitHub contents API and CI deploys it). This plan keeps the
brief's direction and makes **the server's `data/site.json`** the only writer, for three concrete
reasons:

1. **Blast radius.** A token that can write repository contents can change `build.mjs` or any
   module CI executes with the deploy key, and that key logs in as root. An admin compromise would
   become root on a server shared with other client sites. With the server as the writer, the same
   compromise stays inside the site user (§9.1).
2. **Speed and stability.** Publish takes seconds and touches only static files. A git publish
   waits for a full CI run and restarts the admin process on every content change.
3. **Independence.** Publishing and the live site keep working while GitHub or the runners are down.

What makes it one writer in practice:

- `src/content/site.json` in the repository is the **seed** (first boot), the local development
  content and the CI fixture. It is never deployed as content and is expected to drift from
  production after the cut-over. A CI step prints
  `::notice::src/content/site.json is only the seed; production content is edited in the admin`
  whenever a push changes it.
- CI never uploads `dist/` or `site.json` to the server. After a code deploy it re-renders the
  server's own `data/site.json` with the new templates (§10.3).
- History lives in `data/revisions/` (30 newest) and `data/backups/` (30 days), plus Export. To put
  production content back into git (a fresh machine, the Georgian copy workflow), the owner exports
  it and commits it by hand. Import only ever replaces the draft.

### 3.3 Draft rules: what may be saved and what may be published

Autosave must never lose typing, yet half-written content is invalid (an empty `ka` in a new item,
a URL typed halfway). Both stores use the same validator with different acceptance:

| Store | Call | Refused when |
|---|---|---|
| `draft.json` (autosave, import, restore) | `validate(site, { mode: 'save', paletteIds, layoutIds, today })` | an error with a **structural** code: `TYPE`, `MISSING`, `MISSING_LANG`, `UNKNOWN_KEY`, `LANG_KEY`, `RUSSIAN` whose path ends in `.ru` (a key, not text), `ID`, `DUPLICATE_ID`, `ENUM`, `INT`, `CONTROL_CHAR`, and **any error whose path starts with `$.settings.`** (`PATTERN`, `DATE`, `TOO_LONG` there would reach `siteContext()`'s `new URL()` or the footer markup). The set is the constant `DRAFT_BLOCKING` in `admin/shared/draft-rules.mjs`; a code the admin does not know is treated as blocking. Every other error (`EMPTY`, `TOO_LONG`, `COUNT`, `HREF_*`, `NAV_LABEL`, `NAV_BUDGET`, `REF`, `REF_PRIMARY`, `PERIOD_ORDER`, `WHITESPACE`, `CYRILLIC`, `RUSSIAN` in text, `GEORGIAN_IN_CAPS`, and `DATE`/`PATTERN` outside `settings`) is stored with the draft and returned, so the UI can mark it. Every layout renders such a draft without throwing (master plan §5.2 rule 10). |
| `site.json` (publish) | the same call | **any** error (HTTP 400 with the full list, data-model §4.1). Warnings (`LONG`, `DOUBLE_SPACE`, `MTAVRULI`, `UNTRANSLATED`, `WRONG_LANGUAGE`, `FUTURE_*`, `EYEBROW_YEAR`, `LONG_WORD`, `LONG_TOKEN`, `VALUE_HREF`, `REDUNDANT`) need an explicit acknowledgement in the publish dialog. |

This refines data-model §4.1 ("errors → HTTP 400, nothing stored"): that rule governs
`site.json` exactly as written. The draft is a working copy that is never rendered to the public
site, so it may hold content errors; it may never hold a structurally broken document.
The SPA trims on blur and never submits line breaks (data-model §12.1), so `WHITESPACE` and
`CONTROL_CHAR` only reach the server through an import.

**Counters.** Each input shows `n / max` from `limitsTable()` for its path and language, counted
in code points like the validator: neutral below the soft threshold, warning at or above it, error
above `max` (`TOO_LONG`, blocks publish). Soft threshold = `floor(max × 0.9)` for every layout
(no per-layout `adminLimits`; master plan Appendix A8). Two budget meters sit above the section list: the 100-character nav
budget per language (`NAV_BUDGET`) and the 28-character nav label rule (`NAV_LABEL`).

### 3.4 File envelopes and the store API (`admin/server/lib/store.mjs`)

```jsonc
// data/draft.json
{ "kind": "draft", "rev": 57, "etag": "<sha256 hex of canonicalize(site)>",
  "savedAt": "2026-09-14T10:15:00.123Z", "issues": { "errors": 2, "warnings": 1 },
  "site": { /* schema v1, in canonical key order */ } }

// data/site.json  (what is live)
{ "kind": "published", "rev": 57, "etag": "…", "publishedAt": "2026-09-14T10:15:02.004Z",
  "buildId": "20260914T101502Z-r57", "site": { /* schema v1 */ } }

// data/revisions/20260914T101502004Z-publish-r57.json
{ "kind": "revision", "id": "20260914T101502004Z-publish-r57", "rev": 57, "etag": "…",
  "reason": "publish",            // publish | autosave | checkpoint | pre-restore | pre-import | pre-discard | pre-rollback | pre-overwrite | pre-migrate
  "actor": "admin",               // admin | cli | deploy
  "createdAt": "2026-09-14T10:15:02.004Z", "note": "", "site": { /* schema v1 */ } }

// data/publish-state.json
{ "current": "20260914T101502Z-r57",
  "history": ["20260914T101502Z-r57", "20260910T081100Z-r41"],   // newest first, max 10 (= builds kept)
  "publishedRev": 57, "publishedEtag": "…", "publishedAt": "2026-09-14T10:15:02.004Z",
  "pending": null }   // during a swap: { "buildId", "rev", "source", "draftEtag", "startedAt" } (§5.2 step 10)
```

- The envelope is written as `JSON.stringify({ …meta, site: JSON.parse(canonicalize(site)) }, null, 2) + '\n'`.
  `JSON.parse` keeps the canonical key order, so the embedded site stays canonical.
- `etag` is always `sha256(canonicalize(site))` in hex, computed over the canonical string, never
  over the envelope. HTTP `ETag` headers carry it in quotes.
- `rev` is a counter for people ("r57" in the UI and in build ids). It increases by one on every
  successful draft write (save, discard, restore, import). `site.json.rev` is the draft `rev`
  that was published.

Store functions (all async; every write goes through §3.6 locking):

| Function | Behaviour |
|---|---|
| `getDraft()` | read `draft.json`; unreadable → recover from the newest revision, write it back, audit `draft_recovered` |
| `saveDraft(site, { ifMatch, force = false, actor })` | `settings.siteUrl = cfg.SITE_URL`; `validate` + `DRAFT_BLOCKING` (§3.3) → `DraftRejectedError(errors)`; `ifMatch !== draft.etag && !force` → `PreconditionError(current)`; with `force`, **always** snapshot the current server draft as `pre-overwrite` first (skipped only when identical to the newest revision), so the other device's edits stay in Revisions; otherwise the autosave snapshot rule (§3.7); write `{ rev: rev + 1, etag, savedAt, issues, site }`; a save whose etag equals the current one is a no-op returning the current envelope |
| `discardDraft({ ifMatch, actor })` | snapshot `pre-discard`; draft = the published site, `rev + 1` |
| `getPublished()` | read `site.json`; unreadable → `DegradedError` (publish refused, health `degraded`) |
| `isDirty()` | `draft.etag !== published.etag` |
| `listRevisions()` | newest first, metadata only (parses each file; 30 files of ~65 KB) |
| `getRevision(id)` | full document; `id` must match `/^\d{8}T\d{9}Z-[a-z-]+-r\d+$/` (no request text reaches a path otherwise) |
| `restoreRevision(id, { actor })` | snapshot `pre-restore`; draft = revision site, `rev + 1`; live untouched |
| `snapshot(reason, site, { note, actor })` | skip when `etag` equals the newest revision's; write; prune (§3.7). `POST /draft/checkpoint` calls it with the draft, or with a posted `site` after the draft rules (the SPA stores its local copy this way before loading a newer draft, §6.6) |
| `commitPublished({ rev, site, buildId })` | write `site.json`, the `publish` revision and `publish-state.json` |

### 3.5 Atomic write (`admin/server/lib/fsx.mjs`)

```js
import { open, rename, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function writeFileAtomic(file, data, { mode = 0o600 } = {}) {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fh;
  try {
    fh = await open(tmp, 'wx', mode);               // O_CREAT|O_EXCL: never follows an existing path
    await fh.writeFile(data); await fh.sync();       // data on disk before the name flips
    await fh.close(); fh = null;
    await rename(tmp, file);                         // atomic replace on the same filesystem
  } catch (e) {                                      // ENOSPC in writeFile or sync included
    await fh?.close().catch(() => {});
    await rm(tmp, { force: true });
    throw e;
  }
  await fsyncDir(dir);                              // the rename itself is durable
}

export async function fsyncDir(dir) {
  let fh;
  try { fh = await open(dir, 'r'); await fh.sync(); }
  catch (e) { if (!['EISDIR', 'EINVAL', 'EPERM', 'EBADF'].includes(e.code)) throw e; } // macOS dev
  finally { await fh?.close(); }
}
```

JSON is written as `JSON.stringify(doc, null, 2) + '\n'`. At boot, `.*.tmp` files older than
1 hour anywhere under `data/` (walked recursively) and every `builds/.tmp-*` directory are deleted.
Test (`fsx.test.mjs`): a `writeFile` that fails with a simulated `ENOSPC` leaves no `.tmp` file. Reads use `JSON.parse(await readFile(f, 'utf8'))`; a parse error
is surfaced as `CorruptFileError(path)`.

### 3.6 Serialising writes (`admin/server/lib/lock.mjs`)

Two writers can exist: the admin service and the CLI that CI runs after a deploy. So every write
takes an in-process mutex **and** a cross-process lockfile.

- `Mutex`: promise chain per lock name (`write`, `publish`).
- `withFileLock(name, fn, { timeoutMs, staleMs })`: `open(data/locks/<name>.lock, 'wx', 0o600)`,
  write `{"pid":123,"since":"ISO","op":"saveDraft"}`, run `fn`, `unlink` in `finally`.
  On `EEXIST`: read the file; it is stale when `Date.now() - since > staleMs` or
  `process.kill(pid, 0)` throws `ESRCH`; a stale lock is removed and acquisition retried.
  Otherwise retry every 100 ms until `timeoutMs`, then throw `LockTimeoutError`.
- `write` lock: `timeoutMs 5000`, `staleMs 30000`; held only around a single store operation.
- `publish` lock: HTTP `timeoutMs 3000` (then 423), CLI `timeoutMs 120000`; `staleMs 300000`.
- Lock order is always `publish` then `write`, never the reverse, so they cannot deadlock.
- PM2 runs exactly one instance in fork mode (§9.1); cluster mode is forbidden by config check at boot (`process.env.NODE_APP_INSTANCE` present and not `0` → exit 1).

### 3.7 Revisions

Snapshots are written for: `publish` (the published doc), `pre-restore`, `pre-import`,
`pre-discard`, `pre-rollback` (the live doc before a rollback), `pre-overwrite` (the server draft
before a forced save replaces it; not subject to the 20-minute rule), `pre-migrate` (`cli migrate`),
`checkpoint` (manual button or the SPA's copy of local edits, with a note, max 200 chars), and
`autosave`: on `saveDraft`, if the newest revision is older than 20 minutes, the **previous** draft
is snapshotted first. Identical content (same sha256 as the newest revision) is never snapshotted twice.

Retention after every snapshot: keep the newest 30 by `createdAt`; the revision whose `rev`
equals `publish-state.publishedRev` with reason `publish` is never pruned (so the list can hold
31). Restore always goes **into the draft**; going live is a separate publish.

### 3.8 Backups

- `lib/backup.mjs` runs at boot and then hourly; if `data/backups/<UTC YYYY-MM-DD>.json.gz` does
  not exist it writes one (atomic write, gzip level 9 via `node:zlib`):
  `{ createdAt, release, published: <site.json>, draft: <draft.json>, publishState, revisions: [<all revision docs>] }`.
  Expected size under 1 MB (30 revisions of ~65 KB compress well). `auth.json`, `sessions.json` and `audit.log` are never included.
- Keep the newest 30 files.
- CLI: `backup [--name=<name>]` (force now; `--name` writes `data/backups/<name>.json.gz`, used by the
  deploy as `pre-migrate-<sha>`), `restore-backup (--date=YYYY-MM-DD | --file=<path.json.gz>) --part=draft|published|all`
  (snapshots current state as `pre-restore` first; `published` restore also re-publishes).
  `restore-backup` parses the whole file into memory first, requires every revision `id` to match
  the §4.7 revision regex (ids become file names), runs the draft rules on the draft and the
  revisions and full `validate()` on the published document, canonicalizes each, writes them into
  `data/.restore-<ts>/` and only then renames them into place. If any check fails, the whole file is
  rejected and nothing is written. The off-box copy (§10.7) is AES-CBC without an integrity check,
  so these checks are what catch a damaged or altered file. `restore-build --from` and
  `rollback --to` check the build-id regex.
  The service and CLI hold the `write` lock while reading the files for a backup, so a backup is
  a consistent set.
- Off-box: the Export button (§4.7) and the optional encrypted weekly workflow (§10.7). Confirm
  whether CyberPanel's scheduled backups include the site home; if they do, `data/` is covered.

---

## 4. Admin service: framework, auth, security, API

### 4.1 Framework: Hono on @hono/node-server vs bare `node:http`

| Criterion | Hono 4.13.7 + @hono/node-server 2.1.1 | `node:http`, zero deps |
|---|---|---|
| Dependencies | 2 packages, **no transitive deps**, pure JS (`hono` has no `dependencies`; node-server only peers `hono ^4`, `engines.node >=20`) | none |
| Native code | none | none |
| Routing, params, 404/405 | built in | hand-written |
| Body size limit | `hono/body-limit` | hand-written stream counting |
| Cookies | `hono/cookie` (serialize with `__Secure-` prefix validation) | hand-written RFC 6265 serializer |
| Static SPA files | `@hono/node-server/serve-static` (path normalisation, no `..` escape) | hand-written; traversal risk |
| Client socket address | `getConnInfo` from `@hono/node-server/conninfo` | `req.socket.remoteAddress` |
| Tests | `app.request('/admin/api/...')` in-process, no sockets | must bind a port per test |
| Familiarity | owner ships Hono already (listed in the CV; SEO checkup API) | – |

**Pick: Hono.** The zero-native requirement is met either way; Hono removes the hand-written
parsing and path handling where security bugs live, and gives socket-free tests. Versions are
pinned exactly in `package.json` (no `^`), and Dependabot security alerts are enabled.
Hono's own `csrf` middleware is **not** used: it only inspects form content types and compares
the Origin as a single value, so it would reject the doubled Origin; §4.5 replaces it.

Wiring (`admin/server/app.mjs`, sketch the builder completes):

```js
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';

export function createApp(cfg, deps /* { store, auth, previews, publisher, limiter, audit, clock } */) {
  const app = new Hono();
  app.use('/admin/*', headersFor(cfg));                 // §4.6, picks spa|api|preview|asset by path
  app.get('/admin/api/health', health(cfg, deps));      // no auth, no custom header, no edge header
  app.use('/admin/*', edgeGuard(cfg));                  // §4.5 guard 0: x-sm-edge from Cloudflare (production)
  app.use('/admin/api/*', requireApiGuards(cfg));       // §4.5 (header, Origin, Sec-Fetch-Site, JSON)
  const small = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) });
  const large = bodyLimit({ maxSize: 320 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) });
  app.use('/admin/api/*', (c, next) => (c.req.path === '/admin/api/import' ? large : small)(c, next));
  app.get('/admin/api/session', sessionInfo(cfg, deps)); // works with or without a session
  app.route('/admin/api/auth', authRoutes(cfg, deps));  // login (no session); logout + password check the session themselves
  app.use('/admin/api/*', requireSession(cfg, deps));   // everything below needs a session
  app.use('/admin/api/*', requirePasswordFresh());      // mustChangePassword → 403 password_change_required
  app.route('/admin/api', apiRoutes(cfg, deps));        // draft, preview, publish, revisions, builds, io, account
  app.get('/admin/preview/:token/*', previewFiles(deps));
  app.use('/admin/assets/*', serveStatic({ root: cfg.webDist, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }));
  app.get('/admin/', spaIndex(cfg));                    // index.html, no-store (fonts + thumbnails are Vite assets)
  app.get('/admin', (c) => c.redirect('/admin/', 301)); // reached only in local dev (OLS rewrites in prod, §8.1)
  app.all('*', (c) => c.json({ error: 'not_found' }, 404));
  app.onError(errorHandler(deps));                      // maps typed errors to §4.7 codes; never leaks stacks
  return app;
}
```

`admin/server/index.mjs` runs `reconcile()` (§5.2) under the `publish` lock, then calls
`serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port })`,
sends `process.send?.('ready')` after listening (PM2 `wait_ready`), and on `SIGINT`/`SIGTERM`
stops accepting, waits up to 8 s for the `publish` lock to be free, then exits 0.
In production it exits 1 with a clear message if `process.getuid() === 0` (unless `ALLOW_ROOT=1`).

### 4.2 Password storage (`lib/auth.mjs`)

- Hash format: `scrypt$1$<N>$<r>$<p>$<salt b64url, 16 bytes>$<key b64url, 64 bytes>`.
- Current params: `N=65536 (2^16), r=8, p=2, keylen=64, maxmem=134217728` (128 MiB). Measured
  ~340 ms on the author's Mac with Node 24; expect 0.4–0.8 s on the VPS (measure once there;
  above 1 s, use `N=32768, r=8, p=3`, OWASP's equivalent minimum: ~25% less CPU, 32 MiB; stored
  hashes upgrade or downgrade automatically on the next login because params live in the hash). Node's default
  `maxmem` (32 MiB) rejects even `N=2^15, r=8` (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`, verified),
  so `maxmem` must be passed explicitly. Cost equals OWASP's `N=2^17, r=8, p=1` at half the RAM.
- Use async `crypto.scrypt` (libuv pool) behind a semaphore: 1 concurrent derivation, queue of
  3; a 4th waiting login gets 429 `busy`. Rate limits (§4.4) are checked **before** hashing.
- Input: `password.normalize('NFKC')`; length 12–128 code points; must differ from the username
  and the current password; no composition rules (NIST SP 800-63B).
- Verify: parse stored params, derive, `crypto.timingSafeEqual`. If params differ from current,
  re-hash after a successful login (upgrade path) as a read-modify-write under the `write` lock that
  replaces the hash only if `auth.json` still holds the hash just verified (a password the CLI set
  meanwhile is never overwritten).
- `data/auth.json` (600):
  ```json
  { "v": 1, "username": "admin", "hash": "scrypt$1$65536$8$2$...$...", "mustChangePassword": true,
    "epoch": 1, "updatedAt": "2026-09-14T10:00:00.000Z" }
  ```
- First boot: `auth.json` missing, `publish-state.json` missing (a true first boot) and
  `ADMIN_INITIAL_PASSWORD` set (>= 12 chars) → create it with
  `username = ADMIN_USERNAME || "admin"`, `mustChangePassword: true`; log
  `initial admin credential created; remove ADMIN_INITIAL_PASSWORD from admin.env`. If the env
  var is still present on a later boot, log a warning every boot. If `auth.json` is missing on any
  other boot, the env var is ignored: the service runs, login answers 503 `not_initialised`, health
  reports it, and the log says `cli set-password` is required (it creates `auth.json`). A lost
  `auth.json` therefore never brings back the initial password.
- Username check: `timingSafeEqual(sha256(input), sha256(stored))`. A dummy hash is computed at
  boot; a wrong username still runs one full scrypt against it, so timing does not reveal it.
- While `mustChangePassword` is true, every API route except `GET /session`,
  `POST /auth/password` and `POST /auth/logout` returns 403 `password_change_required`.

### 4.3 Sessions

- Secret: `SESSION_SECRET`, base64, >= 32 bytes after decoding (boot fails otherwise).
  Optional `SESSION_SECRET_PREV` is accepted for verification only, for rotation.
- Cookie name: production `__Secure-sm_admin`; local dev `sm_admin` (no `Secure`, since Safari
  refuses Secure cookies on `http://localhost`).
- Attributes: `HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=<iat + 7 d − now>`,
  no `Domain`. (`__Host-` is impossible because it requires `Path=/`.)
- Value: `v1.<payloadB64url>.<macB64url>` where payload is
  `{"sid":"<16 random bytes, b64url>","iat":<unix s>,"lat":<unix s>,"ep":<auth.epoch>}` and
  `mac = HMAC-SHA256(secret, "v1." + payloadB64url)` (32 bytes).
- Verify order: split into exactly 3 parts; decoded mac length 32; recompute with current then
  previous secret; `timingSafeEqual`; parse payload; `now − lat <= 43200` (12 h idle);
  `now − iat <= 604800` (7 d absolute); `ep === auth.epoch`; `sid` present in the registry.
  Any failure → 401 `unauthenticated` and a clearing `Set-Cookie`.
- Sliding: when `now − lat > 300`, the response re-issues the cookie with `lat = now` and
  updates the registry's `lastSeenAt` (at most one registry write per session per 5 min).
- **Disk is the only authority.** The service keeps no authoritative in-memory copy of `auth.json`
  or `sessions.json`. Every change to them (login, logout, sliding `lastSeenAt`, revoke, prune,
  password change, parameter re-hash) is a read-modify-write from disk inside
  `withFileLock('write')`. `requireSession` and login `stat` both files on every request and
  re-parse them when `mtimeMs` or `ino` changed. So a `cli set-password` run while the service is
  up takes effect on the next request, and a later sliding update cannot write revoked sessions back.
- Registry `data/sessions.json` (600), max 10 sessions (oldest `lastSeenAt` evicted):
  ```json
  { "v": 1, "sessions": [ { "sid": "q0Lx...", "createdAt": "…", "lastSeenAt": "…",
      "ip": "203.0.113.9", "ua": "Mozilla/5.0 (Macintosh; …)" } ] }
  ```
  `ua` is truncated to 160 chars. Expired entries are pruned at boot and hourly.
- Login always creates a new `sid` (no fixation). Logout deletes the `sid` and sends
  `Max-Age=0`. Password change: `epoch + 1`, registry reduced to the current session, cookie
  re-issued. "Sign out other sessions": registry reduced to the current session.
  `cli.mjs set-password` (same `write` lock): `epoch + 1`, registry emptied; creates `auth.json`
  when it is missing (`--username`, else `ADMIN_USERNAME`, else `admin`).

### 4.4 Client identity and rate limiting (`lib/guard.mjs`)

The app listens on `127.0.0.1` only, so in production every request arrives with a loopback peer:
through OLS, or straight from another tenant on the box. Loopback therefore proves nothing. The edge
guard (§4.5, guard 0) runs first and admits only requests that carry Cloudflare's `x-sm-edge`
secret; `CF-Connecting-IP` is read only after it passed. Cloudflare sends the visitor address in
`CF-Connecting-IP`; the doubled-header behaviour of the Cloudflare + OLS chain can make it `"a, a"`,
so only the first value is used.

```js
import { isIP } from 'node:net';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientKey(remoteAddress, headers) {        // called only after edgeGuard passed
  let ip = remoteAddress || 'unknown';
  if (LOOPBACK.has(ip)) {                                  // came through the local proxy
    const cf = (headers.get('cf-connecting-ip') || '').split(',')[0].trim();
    if (isIP(cf)) ip = cf;
  }
  if (isIP(ip) === 6) return ip.split(':').slice(0, 4).join(':') + '::/64'; // one key per /64
  return ip;
}
```

**Device cookie** (OWASP's "device cookie" pattern against lockout). A successful login sets
`__Secure-sm_dev=v1.<id>.<mac>` (local dev `sm_dev`, no `Secure`): `id` = 16 random bytes b64url,
`mac` = b64url `HMAC-SHA256(SESSION_SECRET, 'dev.' + id)` (verified with the current, then the
previous secret, `timingSafeEqual`); `HttpOnly; Secure; SameSite=Strict; Path=/admin/api/auth;
Max-Age=34560000` (400 days); a valid cookie keeps its `id` and is re-issued. The cookie grants
nothing by itself; it only changes which limiter a login attempt counts against.

| Limiter | Key | Rule | Response |
|---|---|---|---|
| Login failures, known device | `dev:<id>` of a valid device cookie | 5 failures in 15 min → that device id locked for 15 min; success clears it. Such a login skips the two rows below | 429 `{error:"rate_limited", retryAfterS}` + `Retry-After` |
| Login failures, per client | `clientKey` (logins without a valid device cookie) | 5 failures in a sliding 15 min → locked until the oldest of those + 15 min; success clears the key | 429 as above |
| Login failures, global | all logins without a valid device cookie | 60 failures in a rolling hour → every such login refused until the window drains; audit `login_global_lock` | 429 |
| scrypt queue | process | 1 running + 3 queued | 429 `busy` |
| Preview renders | session | 60 / min | 429 |
| Publish / rollback | session | 10 / min | 429 |
| Import | session | 10 / hour | 429 |
| Any API call | session | 600 / min (stops a runaway autosave loop) | 429 |

State is in memory (Maps, swept every 10 min, capped at 10,000 keys). A restart clears it. With the
edge guard no request can choose its own client key, and an attacker who keeps the global lock
closed only blocks new browsers: the owner's known browser logs in through its device limiter.
`pm2 restart` remains the escape for a new browser (§12 R5). OLS `accessControl` (§8.3) is an
optional extra; it cannot stop local tenants.

### 4.5 Request guards: edge check and CSRF (all `/admin/*` except `GET /admin/api/health`)

Values that pass through the Cloudflare + OLS chain can arrive doubled (`"a, a"`). Every header
guard below therefore splits on commas, trims, accepts 1–4 values and requires **every** value to
pass; a mixed pair always fails.

0. **Edge secret** (production; off when `EDGE_SECRET` is unset in development), every `/admin/*`
   path including the SPA, assets and preview files: every value of `x-sm-edge` must equal
   `EDGE_SECRET`, else 403 `edge`. A Cloudflare Transform Rule sets the header on `/admin*` and
   overwrites anything a client sends (§8.4); nobody else knows the value.
   ```js
   import { createHash, timingSafeEqual } from 'node:crypto';
   const digest = (v) => createHash('sha256').update(v).digest();
   export function edgeOk(header, secretDigest /* digest(EDGE_SECRET), computed at boot */) {
     if (!header) return false;
     const values = header.split(',').map((s) => s.trim());
     return values.length <= 4 && values.every((v) => v !== '' && timingSafeEqual(digest(v), secretDigest));
   }
   ```
1. **Custom header** on `/admin/api/*`: every value of `X-Requested-With` equals `samsiani-admin`
   (GET too). A cross-site page cannot set it without a CORS preflight, and the app never answers
   preflights (no CORS headers anywhere). Missing or wrong → 403 `csrf`.
2. **Origin** on every method except GET/HEAD: header must be present and every comma-separated
   value must be an allowed origin. Missing or not allowed → 403 `csrf_origin`.
   ```js
   export function originAllowed(header, allowed /* Set<string> */) {
     if (!header) return false;
     const values = header.split(',').map((s) => s.trim()).filter(Boolean);
     return values.length > 0 && values.length <= 4 && values.every((v) => allowed.has(v));
   }
   // "https://samsiani.me, https://samsiani.me" → true
   // "https://samsiani.me, https://evil.example" → false ; "null" → false
   ```
   `ALLOWED_ORIGINS` = `PUBLIC_ORIGIN` (production `https://samsiani.me`); in development also
   `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3097`.
3. **Fetch metadata**: if `Sec-Fetch-Site` is present, every value must be `same-origin` → else 403 `csrf_site`.
4. **SameSite=Strict** on the session cookie (§4.3).
5. **Content type**: request bodies must be `application/json` → else 415. Body limit 256 KB (data-model §4.1;
   the maximum-size fixture is 207 KB pretty-printed, 168 KB as a request), `POST /import` 320 KB.
6. **`If-Match`** (`PUT /draft`, `POST /draft/discard`, `POST /publish`): `parseIfMatch` strips an
   optional `W/` and the quotes from each comma-separated value and requires every value to equal
   the draft ETag. Cloudflare turns a strong `ETag` response header into `W/"…"` when it compresses
   the response, so the SPA never reads the header: it takes the ETag from the JSON body (§6.6).

Tests (`guard.test.mjs`, `api.test.mjs`): doubled and weak forms of each header (`Origin`,
`X-Requested-With`, `Sec-Fetch-Site`, `x-sm-edge`, `If-Match`) are accepted when every part is
valid and refused when one part is not; `GET /admin/api/health` needs no `x-sm-edge`.

### 4.6 Response headers (`lib/headers.mjs`)

Every response under `/admin/` gets: `X-Robots-Tag: noindex, nofollow, noarchive`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`,
`X-LiteSpeed-Cache-Control: no-cache` (keeps OLS's cache module out even if enabled), and in
production `Strict-Transport-Security: max-age=31536000`.

| Kind | Paths | `Cache-Control` | Extra |
|---|---|---|---|
| spa | `/admin/` (index.html) | `no-store` | `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; manifest-src 'self'`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` |
| asset | `/admin/assets/*` (Vite hashed names, including fonts and layout thumbnails) | `public, max-age=31536000, immutable` | `Cross-Origin-Resource-Policy: same-origin` |
| api | `/admin/api/*` | `no-store` | `Content-Type: application/json; charset=utf-8`, `X-Frame-Options: DENY` |
| preview HTML | `/admin/preview/<token>/**.html` | `no-store` | `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src <PUBLIC_ORIGIN> 'unsafe-inline'; style-src <PUBLIC_ORIGIN> 'unsafe-inline'; font-src <PUBLIC_ORIGIN>; img-src <PUBLIC_ORIGIN> data:; frame-ancestors <PUBLIC_ORIGIN>; base-uri 'none'; form-action 'none'`, `Referrer-Policy: no-referrer`; no `X-Frame-Options` (its SAMEORIGIN test is ambiguous for an opaque-origin document; `frame-ancestors` governs) |
| preview files | other files under the token | `no-store` | `Access-Control-Allow-Origin: *` (fonts are CORS requests and the sandboxed document's origin is `null`; the files are public anyway) |

Explicit origins are used in the preview CSP instead of `'self'` because the sandboxed document
has an opaque origin. `'unsafe-inline'` there covers the public site's theme bootstrap and
JSON-LD; it is safe because the document is sandboxed and cannot reach the admin session.
The SPA build must not use inline scripts or inline `style` attributes (Vue's `:style` uses
CSSOM, which CSP allows); `vite.config.mjs` sets `build.assetsInlineLimit: 0`.

### 4.7 API endpoints (base `/admin/api`)

Conventions: JSON in and out; timestamps are ISO 8601 UTC; every request carries
`X-Requested-With: samsiani-admin` and, in production, Cloudflare's `x-sm-edge` (except
`GET /health`); unsafe methods carry a valid Origin (§4.5). Every response that returns a draft
carries its `etag` in the JSON body; clients use that value, not the `ETag` header. "session" = valid cookie; "fresh" = session and `mustChangePassword === false`.
Error body: `{ "error": "<code>", "message": "<English sentence>", ...details }`.
`Site` = the §3.1 document. Ids are validated by regex before any filesystem access:
revision `/^\d{8}T\d{9}Z-[a-z-]+-r\d+$/`, build `/^\d{8}T\d{6}Z-r\d+$/`, preview token
`/^[A-Za-z0-9_-]{43}$/`.

| # | Method & path | Auth | Request body | 2xx response | Other responses |
|---|---|---|---|---|---|
| 1 | `GET /health` | none | – | 200 `{ ok: true, release: "<git sha>", startedAt, auth: "ok"\|"missing", data: "ok"\|"degraded" }` | – |
| 2 | `GET /session` | header only | – | 200 `{ authenticated: false }` or `{ authenticated: true, username, mustChangePassword, idleExpiresAt, absoluteExpiresAt }` | – |
| 3 | `POST /auth/login` | none | `{ username, password }` (<= 128 / <= 1024 chars) | 200 `{ ok: true, mustChangePassword }` + `Set-Cookie` | 400 `bad_request`, 401 `invalid_credentials`, 429 `rate_limited`/`busy`, 503 `not_initialised` |
| 4 | `POST /auth/logout` | session | `{}` | 204 + clearing `Set-Cookie` | 401 |
| 5 | `POST /auth/password` | session | `{ currentPassword, newPassword }` | 204 + re-issued `Set-Cookie` | 400 `weak_password` `{ rules: { min: 12, max: 128 } }`, 401 `invalid_current_password`, 429 |
| 6 | `GET /account/sessions` | fresh | – | 200 `{ items: [{ id: "<first 6 chars of sid>", current, createdAt, lastSeenAt, ip, ua }] }` | 401 |
| 7 | `POST /account/sessions/revoke-others` | fresh | `{}` | 204 | 401 |
| 8 | `GET /account/audit?limit=50` | fresh | – | 200 `{ items: [{ t, event, ip, detail }] }` (limit <= 200) | 401 |
| 9 | `GET /registry` | fresh | – | 200 `{ schemaVersion: 1, layouts: [{ id, label, description, thumbnail, defaultTheme }], palettes: <src/palettes.json>, paletteChecks: <checkPalettes() rows>, paletteHex: { <id>: { light: { <token>: '#rrggbb' }, dark: {…} } } (parseColor(v).hex), paletteMin: { <id>: { <layoutId>: lowest accent-ink/bg or accent-ink/surface ratio over both themes } }, limits: limitsTable(), schema: buildSchema() }` (static per release; `Cache-Control: no-store` like all API responses; the picker reads `paletteHex` and `paletteMin`, the SPA never converts colours) | 401 |
| 10 | `GET /draft` | fresh | – | 200 `{ rev, etag, savedAt, site, issues: { errors, warnings }, published: { rev, etag, publishedAt, buildId }, dirty }`, header `ETag: "<etag>"` | 401 |
| 11 | `PUT /draft` | fresh | header `If-Match: "<etag>"` (parsed per §4.5 item 6); body `{ site, force?: false }` (`force` snapshots the server draft as `pre-overwrite` first) | 200 `{ rev, etag, savedAt, dirty, validation: { errors, warnings } }` + `ETag` | 400 `draft_rejected` `{ errors }` (structural codes only, §3.3), 412 `precondition_failed` `{ current: { rev, etag, savedAt } }`, 428 `precondition_required` (no `If-Match` and no `force`) |
| 12 | `POST /draft/discard` | fresh | header `If-Match`; body `{}` | 200 `{ rev, etag, savedAt, site }` | 412 |
| 13 | `POST /draft/checkpoint` | fresh | `{ note, site? }` (note <= 200 chars; `site` optional, draft rules apply, stores a document that is not the current draft) | 201 `{ id }` | 400 `draft_rejected` |
| 14 | `POST /validate` | fresh | `{ site? }` (default: draft) | 200 `{ errors, warnings }` (full `save`-mode rules, as publish applies them) | 400 `bad_request` if the body is not an object |
| 15 | `POST /preview` | fresh | `{ site?, revisionId?, layout?, palette? }` (default: stored draft) | 201 `{ token, base: "/admin/preview/<token>/", expiresAt, bundle: "palettes-all.<md5-8>.css" }` | 400 `draft_rejected` (structural), 422 `preview_render_failed` `{ message }` (the previous token stays valid), 429 |
| 16 | `GET /admin/preview/:token/*` (not under `/api`) | capability token | – | the rendered file; `…/` serves `index.html` | 404 small HTML "Preview expired, refresh it from the dashboard" |
| 17 | `POST /og-preview` | fresh | `{ lang: "en"\|"ka", site? }` | 200 `image/png` (uses the OG cache) | 400 `draft_rejected`, 429 (20/min) |
| 18 | `POST /publish` | fresh | header `If-Match: "<draft etag>"`; body `{ acknowledgeWarnings: boolean, note? }` | 200 `{ publishedRev, buildId, publishedAt, durationMs, changedFiles, og: { en, ka }, updated, draft: { rev, etag, updated }, warnings }` | 400 `invalid` `{ errors }`, 409 `warnings_unacknowledged` `{ warnings }`, 412 `precondition_failed`, 423 `locked`, 500 `publish_failed` `{ stage }` |
| 19 | `GET /builds` | fresh | – | 200 `{ items: [{ buildId, rev, createdAt, layout, palette, current, files, bytes }] }` | – |
| 20 | `POST /builds/rollback` | fresh | `{ buildId? }` (default: previous) | 200 `{ current: buildId, rev }` | 404 `unknown_build`, 423 `locked` |
| 21 | `GET /revisions` | fresh | – | 200 `{ items: [{ id, rev, etag, reason, actor, createdAt, note, layout, palette, live }], keep: 30 }` | – |
| 22 | `GET /revisions/:id` | fresh | – | 200 `{ id, rev, reason, createdAt, note, site, changes: [{ path, before, after }] }` (`changes` vs current draft, from `admin/shared/diff.mjs`) | 404 |
| 23 | `POST /revisions/:id/restore` | fresh | `{}` | 200 `{ rev, etag, savedAt }` (draft replaced; live untouched) | 404, 423 |
| 24 | `GET /export?source=draft\|published` | fresh | – | 200 `{ format: "samsiani.me/site", schemaVersion: 1, source, rev, exportedAt, site }` with `Content-Disposition: attachment; filename="samsiani-site-<source>-r<rev>-<YYYY-MM-DD>.json"` | 400 |
| 25 | `POST /import` | fresh | the export envelope, or a bare `Site` (<= 320 KB) | 200 `{ rev, etag, validation: { errors, warnings } }` (becomes the draft through `canonicalize()`, `pre-import` snapshot first) | 400 `draft_rejected`, 413 |

Error codes used: `edge, bad_request, unauthenticated, invalid_credentials, rate_limited, busy,
not_initialised, password_change_required, weak_password, invalid_current_password, csrf,
csrf_origin, csrf_site, unsupported_media_type, too_large, draft_rejected, invalid,
precondition_failed, precondition_required, warnings_unacknowledged, locked, unknown_build, not_found, publish_failed, preview_render_failed, degraded, internal`.
`errorHandler` logs the stack to stderr with a request id and returns only `{error, message, requestId}`.

Audit events (`data/audit.log`, one JSON object per line
`{ t, event, ip, ua?, rev?, buildId?, detail? }`): `login, login_failed, login_global_lock,
logout, password_changed, sessions_revoked, draft_discarded, checkpoint, revision_restored,
import, publish, publish_failed, publish_recovered, publish_reverted, rollback, draft_recovered, migrate, boot`. Draft saves are not audited
(too frequent). Passwords, cookies, tokens and request bodies are never logged anywhere.

---

## 5. Publish pipeline

### 5.1 The build seam (`src/build-site.mjs`)

data-model's `renderSite(site, { layout, palette, assets })` returns the text files
(`index.html`, `ka/index.html`, `404.html`, `sitemap.xml`, `robots.txt`, `site.webmanifest`);
its `build.mjs` does the rest (validation, CSS assembly and hashing, fonts, icons, `.htaccess`).
The admin needs that whole pipeline in memory, so this plan moves the body of `build.mjs` into one
importable function. There is still exactly one renderer (data-model decision 8).

```js
// src/build-site.mjs
/** @returns {Promise<Map<string, { body: Buffer|string, type: string, immutable: boolean }>>} */
export async function buildSite(site, opts);
// opts = {
//   mode: 'publish' | 'preview',
//   layout?: string, palette?: string,   // preview-only overrides of site.settings (validated ids)
//   assetBase: '/',                       // preview: '/admin/preview/<token>/'; prefixes every name placed in ctx.assets
//   og: { en: 'og-en.<md5-8>.png', ka: 'og-ka.<md5-8>.png' } | null,   // → assets.og; null omits og:image (preview)
//   today: 'YYYY-MM-DD',                  // Asia/Tbilisi date, for validate()
// }
```

Inside, in data-model §10 order:
1. Publish mode: `validate(site, { mode: 'build', layoutIds, paletteIds, today })`; any error →
   throw `BuildValidationError(errors)` (publish has already validated in `save` mode; this is the
   build's own guard). Preview mode: the admin has already applied the draft rules (§3.3), so
   content errors are tolerated, except links: every href that fails `hrefError()` is replaced by
   `#invalid-link` in a copy of the document before rendering, so a half-typed `javascript:` never
   reaches even the sandboxed preview.
2. Resolve layout and palette (unknown palette → default with a warning, palettes.md §5).
   CSS = the layout's `css[]` joined with `"\n"` + `paletteCss(pal)` → `styles.<md5-8>.css`;
   `src/main.js` → `main.<md5-8>.js`.
3. Fonts: `layout.meta.fonts` → `fonts/<name>.woff2`.
4. Icons and manifest: the palette's icon set with hashed names and the hashed manifest
   (palettes.md §7).
5. `renderSite(site, { layout, palette, assets })` → the text files.
6. Publish mode only: `.htaccess` and `_headers` verbatim.
7. Return the Map. `immutable: true` for every content-hashed file and for `fonts/*`; `false` for
   HTML, XML, TXT and `.htaccess`/`_headers`.

`build.mjs` keeps its CLI and env overrides (`SITE_JSON`, `OUT_DIR`, `LAYOUT`, `PALETTE`,
`SITE_URL`, `BUILD_DATE`) and becomes: read → `buildSite()` → write every entry under `OUT_DIR`.
Acceptance (once, at M1): for every layout × palette the files are byte-identical to outputs
captured from the phase-3 `build.mjs` before it is replaced, except `robots.txt` (the new
`Disallow` line). After that, `build-site.test.mjs` guards determinism (§10.4).

Phase-4 edits to modules owned by the other plans (small, listed so nobody is surprised):

| Module | Edit | Reason |
|---|---|---|
| `src/shared/sitemap.mjs` → `robotsTxt(site)` | add `Disallow: /admin/` after `Allow: /` | §8.2 |
| `src/shared/og.mjs` (slot reserved by data-model §8.1) | new: `ogInputs`, `ogName` | §5.6 |
| `src/layouts/<id>/layout.mjs` | admin fields: `description` (one line, required), `thumbnail` (path under `src/`, convention `admin-thumbs/<id>.svg`, required from M8), optional `defaultTheme` (what `system` resolves to, as Studio declares `dark`) and `og` (an OG card builder, §5.6); no `adminLimits` (master plan A8) | pickers, the theme radio label, the social card |

What the admin needs from every layout, on top of data-model §8.2 and §9:

| # | Requirement |
|---|---|
| A1 | Pure render: no filesystem, clock or randomness; identical input gives identical bytes, so preview equals publish and a no-change publish swaps nothing. |
| A2 | Every asset URL comes from `ctx.assets`, so the preview can prefix it. Page links stay `/` and `/ka/`; the preview bridge rewrites them (§7). |
| A3 | Honour `?theme=light\|dark` through the shared theme-init script (data-model §5.4) and the `html[data-palette]` hook of the admin-preview bundle (palettes.md §5). |
| A4 | Every `localStorage` access in `try/catch` (the sandboxed preview throws on access). |
| A5 | Both languages render in under 100 ms on the VPS. |

Registry used by the admin: `LAYOUTS` from `src/layouts/index.mjs`, reading each entry's `meta`
(the `layout.mjs` default export: `{ id, label, description, thumbnail (from M8), defaultTheme?, og? }`; no `adminLimits`, master plan A8)
and `src/palettes.json`.
The admin never hard-codes a layout or palette id.

### 5.2 Steps (`admin/server/lib/publish.mjs`)

`publish({ source: 'draft'|'published', reason: 'admin'|'deploy'|'cli', ifMatch?, acknowledgeWarnings, note?, ifChanged? })`

1. Acquire the `publish` lock (§3.6). HTTP gives up after 3 s → 423.
2. Load the source document and set `settings.siteUrl = cfg.SITE_URL`. `source=draft` requires
   `ifMatch === draft.etag` (parsed per §4.5 item 6) → else 412.
3. `validate(site, { mode: 'save', layoutIds, paletteIds, today })`: any error → 400 with the list,
   stop. Warnings present and `acknowledgeWarnings !== true` → 409 `warnings_unacknowledged`,
   stop. For `source=published` (deploy re-render) warnings never block; an error there means the
   new release is stricter than the live content, so the CLI exits 1, CI shows the list, and the
   live build stays as it was. Schema migrations never happen here or in `cli init`: they are
   `cli migrate`, run by the deploy with the service stopped (§10.3).
4. Date rule (data-model §12.3): when `settings.autoUpdateDateOnPublish` is `true` and the
   canonical JSON of `person`, `meta`, `ui`, `hero`, `contact` or `sections` differs from the live
   document, set `settings.updated` to today in Asia/Tbilisi. Layout, palette or theme changes
   alone keep the date. The adjusted document is what gets published and stored.
5. Brand images (§5.6, master plan §8.8): name → cache hit or render, giving the OG and icon names
   and bytes. If rendering throws, reuse the current build's files and add the warning `og_stale`.
6. `files = await buildSite(site, { mode: 'publish', base: '/', brand, today })`.
7. `buildId = <UTC YYYYMMDDTHHMMSSZ>-r<rev>`; write everything into `builds/.tmp-<buildId>/`,
   plus `manifest.json` (§5.3) and `.site.json` (the exact document being published), every file
   with mode `0644` and `fsync`ed; `fsync` the directory; then `rename` `.tmp-<buildId>` →
   `<buildId>` and `fsync` `builds/`. If the target exists, wait for the next second.
8. Verify the staged build: `index.html` contains `<html lang="en"`, `ka/index.html` contains
   `<html lang="ka"`, `404.html` exists, every local `href="/…"`, `src="/…"` and CSS `url(…)`
   resolves to a staged file (fragment and page links `/`, `/ka/` excepted), OG files exist,
   < 200 files, < 10 MB. Failure → stage `verify`, the staged dir is deleted.
9. `ifChanged` (deploy re-render): run `applyBuild` pass 1 (§5.4) against the **real** `$WEB_ROOT`.
   The build counts as unchanged only when the plan is empty; then delete the staged dir, release,
   return `{ unchanged: true }`. Comparing with the web root instead of the last manifest also
   repairs a half-swapped or edited web root.
10. **Write-ahead** (under the `write` lock): `publish-state.json.pending =
    { buildId, rev, source, draftEtag: ifMatch ?? null, startedAt }`.
11. Swap into `$WEB_ROOT` (§5.4).
12. Commit (under the `write` lock): `source=draft` → `site.json`, the `publish` revision,
    `publish-state.json` (`current`, `history`, `pending: null`); `source=published` → only
    `site.json.buildId` and `publish-state.json`. Then, for `source=draft`, re-read `draft.json`:
    if its ETag equals the publish `If-Match` and step 4 changed the date, write the published
    document as the draft (new `rev` and `etag`); if the ETag differs (an autosave landed during the
    publish) and step 4 changed the date, set only `settings.updated` on the current draft
    (read-modify-write). Return `draft: { rev, etag, updated }` either way; the SPA copies
    `updated` into its document before adopting the ETag (§6.8).
    Audit `publish` with `rev`, `buildId`, `changedFiles`, `durationMs`.
13. Optional Cloudflare purge (§5.8). Prune builds (keep newest 10 plus current), GC the web root
    (§5.5), prune `brand-cache` (keep files referenced by kept builds plus the newest 20).
14. Release the lock; return the summary (§4.7 #18).

**`reconcile()`** runs under the `publish` lock at service boot (before `listen`) and at the start of
every `cli.mjs` command that writes. If `publish-state.pending` is set, it hashes the web root's
`index.html` and `ka/index.html`. If both match `builds/<pending.buildId>/manifest.json`, it completes
step 12 from `builds/<pending.buildId>/.site.json` (using `pending.draftEtag` for the draft rule;
audit `publish_recovered`). Otherwise it runs `applyBuild(builds/<current>)` when there is a current
build, and clears `pending` (audit `publish_reverted`); with no current build it only clears
`pending`, and the next publish repairs the web root through step 9. A crash, reboot, OOM restart
(`max_memory_restart`), `SIGKILL` after `kill_timeout`, or `ENOSPC` at commit therefore can never
leave the new build live while `site.json` holds the previous document. Rollback (§5.7) writes the
same record (`source: 'rollback'`).

Tests (`publish.test.mjs`): a child process killed with `SIGKILL` between swap and commit leaves
`pending`; the next boot finishes the commit; a later `cli publish --source=published --if-changed`
keeps the new `index.html`. A `pending` whose files never reached the web root is reverted.

Budget: p95 under 3 s with an OG cache miss, under 800 ms with a hit.

### 5.3 Build manifest (`builds/<buildId>/manifest.json`)

```json
{
  "buildId": "20260914T101502Z-r57", "rev": 57, "createdAt": "2026-09-14T10:15:02.004Z",
  "reason": "admin", "release": "3f2c1ab", "layout": "precision", "palette": "cobalt", "updated": "2026-06-07",
  "files": {
    "index.html":              { "sha256": "…", "bytes": 38211, "immutable": false, "type": "text/html; charset=utf-8" },
    "styles.1a2b3c4d.css":     { "sha256": "…", "bytes": 24410, "immutable": true,  "type": "text/css; charset=utf-8" },
    "og-en.9f8e7d6c.png":      { "sha256": "…", "bytes": 51022, "immutable": true,  "type": "image/png" }
  }
}
```

`builds/` sits outside the web root and is never served.

### 5.4 Swap into the web root (`admin/server/lib/swap.mjs`)

**Strategy: per-file atomic rename into the existing real `public_html` directory.**
Rejected alternative: turning `public_html` into a symlink to `builds/<id>` and flipping it.
That needs a one-time docRoot conversion, depends on OLS `followSymbolLink`/`restrained`
settings, and it is unverified whether OLS re-resolves a retargeted docRoot symlink without a
restart. Per-file rename needs none of that, keeps the vhost `docRoot` untouched, and each file
still flips atomically. Rollback stays instant because every kept build is complete on disk.

```js
export async function applyBuild(buildDir, webRoot, manifest, { dryRun = false } = {}) {
  const entries = Object.entries(manifest.files);
  const rank = ([p, f]) => (f.immutable ? 0 : p === 'index.html' ? 4 : p === '404.html' ? 2 : p.endsWith('.html') ? 3 : 1);
  const order = entries.sort((a, b) => rank(a) - rank(b));   // assets → xml/txt/manifest → 404 → ka → en
  const plan = [];
  for (const [rel, f] of order) {                             // pass 1: decide, touch nothing
    const dst = safeJoin(webRoot, rel);                       // throws if outside webRoot
    const cur = await sha256File(dst).catch(() => null);
    if (cur === f.sha256) continue;
    if (f.immutable && cur !== null) throw new ImmutableChangedError(rel); // same name, new bytes: CDN would serve stale
    plan.push([rel, dst]);
  }
  if (dryRun) return { changed: plan.length, plan };          // publish step 9 (--if-changed)
  const done = [];
  try {
    for (const [rel, dst] of plan) {                          // pass 2: hard-link + rename, one file at a time
      await mkdir(dirname(dst), { recursive: true, mode: 0o755 });
      const tmp = join(dirname(dst), `.${basename(dst)}.${manifest.buildId}.tmp`);
      await rm(tmp, { force: true });
      await link(join(buildDir, rel), tmp);                   // no bytes copied: cannot fail on a full disk
      await rename(tmp, dst);                                 // files were staged 0644 (step 7)
      done.push(rel);
    }
  } catch (e) { e.partial = done; throw e; }                  // caller re-applies the previous build
  return { changed: plan.length };
}
```

- Assets first means any HTML a visitor receives only references files that already exist.
- `rename(2)` within one filesystem is atomic: a request sees the old file or the new one.
- `link(2)` needs `builds/` and `$WEB_ROOT` on one filesystem (both are under `$SITE_HOME`);
  `cli verify` fails when their `st_dev` differ. The web-root file and the build file share an
  inode; nothing ever writes a file in place, and pruning a build only drops one of the two names.
- If pass 2 fails midway, `publish()` immediately calls `applyBuild` with the previous build's
  manifest (auto-rollback; it links too, so it cannot hit `ENOSPC`), audits `publish_failed` with
  `stage: 'swap'`, and returns 500.

### 5.5 Web-root garbage collection

After a successful swap, walk `$WEB_ROOT`, skipping `.well-known/` and every dotfile except
our own `.*.tmp`. A file is deleted only if **all** hold:
its name matches `^[a-z0-9-]+\.[0-9a-f]{8,}\.(css|js|png|webmanifest)$` (a hashed file this
pipeline generates: styles, scripts, OG cards, per-palette icons, the manifest); it is not listed
in the manifests of the current and the two previous builds; its mtime is older than 24 hours.
`.*.tmp` files older than 1 hour are deleted. Fonts, HTML and every unknown file (verification
files, anything placed by the panel, the old fixed-name icons) are never touched.
The 24-hour rule also protects the first cut-over, when the old rsync-deployed hashed CSS/JS are
in no manifest.

### 5.6 OG images

**Evaluation.**

| Option | Facts | Verdict |
|---|---|---|
| `satori` + `@resvg/resvg-js` (native) | `npm view @resvg/resvg-js optionalDependencies` lists 12 platform packages, including `@resvg/resvg-js-linux-x64-gnu: 2.6.2` (latest stable, 2024-03-26; `next` = 2.7.0-alpha.2). `npm view @resvg/resvg-js-linux-x64-gnu@2.6.2` gives `os: [linux]`, `cpu: [x64]`, `libc: [glibc]`, `main: resvgjs.linux-x64-gnu.node`, 4.38 MB, and **no minimum glibc version in the metadata**. The v2.6.2 CI built that target in `ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-debian`, whose Dockerfile is `FROM messense/manylinux2014-cross:x86_64`, a glibc 2.17 sysroot (current main uses napi-rs v3 `--use-napi-cross`, also glibc 2.17). So the prebuilt binary should load on glibc 2.28 (inferred from the build image, not from the binary's symbol table). | Would work, but it is a native addon delivered through platform-specific optional dependencies, the mechanism that already bit this owner with a macOS lockfile. Rejected. |
| `satori` + **`@resvg/resvg-wasm` 2.6.2** | Same resvg engine compiled to WASM (`exports['./index_bg.wasm']`), no platform packages, 2.5 MB. Satori 0.33.4 bundles yoga and HarfBuzz as base64 WASM, `engines.node >= 16`; HarfBuzz shaping handles Mkhedruli. Satori accepts TTF, OTF and WOFF, **not WOFF2**. | **Chosen.** Zero native code; ~2–3× slower than native, irrelevant for 2 images per changed publish. |
| Keep Playwright OG generation locally/in CI | Content lives on the server after the seed; CI never sees admin edits, so cards would go stale after the first edit to name, role or facts. | Rejected. `src/brand/make.mjs` stays only for the per-palette icon PNGs (palettes.md §7). |

**Modules.** `src/shared/og.mjs` (pure) and `src/og/render.mjs` (satori + WASM, loaded lazily with
`await import()` on the first publish; safe because a release directory never changes under a
running process). `build.mjs` uses the same two modules locally, so a laptop build and a server
publish produce the same cards.

```js
// src/shared/og.mjs  (data-model §12.2)
export const OG_TEMPLATE_VERSION = 1;
export function ogInputs(site, lang, palette) {          // exactly the fields the card shows
  const c = localize(site, lang);
  const own = LAYOUTS[site.settings.layout].meta.og;                  // a layout with its own card
  return { v: OG_TEMPLATE_VERSION, lang, card: own ? site.settings.layout : 'default',
    monogram: site.person.monogram, eyebrow: c.hero.eyebrow, name: c.hero.name, role: c.hero.role, subrole: c.hero.subrole,
    facts: c.hero.facts.map((f) => [f.value, f.label]), host: new URL(site.settings.siteUrl).host,
    accent: palette.dark['--accent'], accentInk: palette.dark['--accent-ink'] };   // palettes.md §7
}
export const ogName = (lang, inputs, rendererId) =>                 // rendererId = satori+resvg versions + fonts sha
  `og-${lang}.${md5(JSON.stringify({ inputs, rendererId })).slice(0, 8)}.png`;

// src/og/render.mjs
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
let ready;
const init = () => (ready ??= readFile(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))).then(initWasm));
export async function renderOgPng(inputs, { layoutMeta, fonts }) {
  await init();
  const tree = (layoutMeta.og ?? precisionOg)(inputs);             // plain satori element objects
  const svg = await satori(tree, { width: 1200, height: 630, fonts }); // text becomes paths
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}
```

- **Template**: `precisionOg` ports `src/brand/og.html` to a satori element tree (flexbox only;
  satori has no CSS grid): 1200×630; 6 px bar at the left edge in `accent`; 86 px rail with a
  52×52 monogram mark (`person.monogram`); main block padding 64/72/56/56 px; eyebrow 15 px
  JetBrains Mono 500, letter-spacing .18em, uppercase (KA: Noto Sans Georgian 16 px, **no
  uppercase**); name on two lines 82 px/0.98 Chivo 600 (KA 64 px/1.06); role 32 px (KA 27 px);
  subrole 21 px; the four facts in a row under a 1 px rule; `host` top right in `accentInk`. A
  layout plan may supply its own `og` builder and fonts in its manifest (Ledger describes one as
  optional, layout-ledger P2); otherwise this one is used for every layout.
- **Colours**: satori and resvg do not parse `oklch()`. Convert to `#rrggbb` with the palette
  module's `parseColor(…).hex` (gamut-clipped sRGB). Card neutrals (fixed, dark):
  bg `oklch(18.5% .012 258)`, ink `oklch(96% .004 250)`, muted `oklch(75.5% .008 250)`, rules
  `oklch(29.5% .01 258)` and `oklch(52% .012 258)`.
- **Fonts** (`src/og/fonts/`, with `OFL.txt`): `Chivo-Regular.ttf`, `Chivo-SemiBold.ttf`,
  `JetBrainsMono-Medium.ttf`, `NotoSansGeorgian-Regular.ttf`, `NotoSansGeorgian-SemiBold.ttf`
  (plus Archivo / IBM Plex instances if a layout adds an OG builder). Satori does not read variable
  axes, so use static instances: take the upstream OFL variable TTF and run
  `fonttools varLib.instancer "Chivo[wght].ttf" wght=600 -o Chivo-SemiBold.ttf` once, locally;
  commit the outputs. Order the `fonts` array Latin first, then Georgian; satori falls back per glyph.
- **Name and cache**: `ogName(lang, inputs, rendererId)` gives `og-<lang>.<md5-8>.png` (the
  pattern data-model §12.2 asks for). `rendererId` joins the satori and resvg-wasm versions, the
  template version and the sha256 of the font files, so a renderer or font change produces new
  names instead of new bytes under an old name (the §5.4 immutable guard would refuse that anyway).
  The PNG is cached as `data/brand-cache/<name>`; a cache hit skips rendering. `og:image` and
  `twitter:image` receive the name through `assets.og[lang]`, which `src/shared/document.mjs` already
  reads.

### 5.7 Rollback of the live site

`rollback({ buildId = the newest kept build older than current })`, under the `publish` lock:
read `builds/<id>/manifest.json` and `.site.json` (`id` checked against the build regex); snapshot
the current live doc as `pre-rollback`; write `pending = { buildId: id, source: 'rollback', … }`;
`applyBuild(builds/<id>, $WEB_ROOT, manifest)` (files GC'd from the web root are linked back from
the build dir); set `site.json` = `.site.json` with the manifest's `rev`;
`publish-state.current = id`, `pending: null`. The draft is not touched; the dashboard then shows
"Live is older than the draft". Duration: one pass over ~25 files, well under 1 s.

### 5.8 Optional Cloudflare purge

Only if T0.6 shows HTML is cached at the edge. With `CF_API_TOKEN` (Zone.Cache Purge only) and
`CF_ZONE_ID` in `admin.env`, step 12 calls
`POST https://api.cloudflare.com/client/v4/zones/<zone>/purge_cache` with
`{"files": ["<origin>/", "<origin>/ka/", "<origin>/404.html", "<origin>/sitemap.xml", "<origin>/robots.txt", "<origin>/site.webmanifest"]}`
via global `fetch`, 5 s timeout; a failure is a publish warning, not an error. Hashed files
never need purging.

### 5.9 Ownership and permissions

The service and the CLI both run as `$SITE_USER` (§9.1, §10.3), set `process.umask(0o022)` at
start, create data files with explicit `0o600` and data dirs with `0o700`. Web-root files are
`0644`, dirs `0755`, owned by `$SITE_USER` because that user wrote them. No `chown` runs at
publish time.

### 5.10 Failure matrix

| Stage | Example failure | Live site | API result |
|---|---|---|---|
| validate | a required KA string empty | unchanged | 400 `invalid` `{ errors }` |
| og | satori throws on a font | unchanged; publish continues with the current OG files | 200 with warning `og_stale` |
| render | template exception | unchanged | 500 `publish_failed` `{stage:"render"}` |
| stage | disk full | unchanged; `.tmp-<id>` removed | 500 `{stage:"stage"}` |
| verify | CSS references a missing font | unchanged | 500 `{stage:"verify", missing:[…]}` |
| swap pass 1 | immutable name with new bytes | unchanged | 500 `{stage:"swap", code:"immutable_changed", path}` |
| swap pass 2 | I/O error after 3 files | auto re-applied previous build (hard links, so a full disk cannot stop it) | 500 `{stage:"swap"}`, audit |
| commit | `site.json` write fails, or the process dies after the swap | new build live; `pending` records it | 500 `{stage:"commit"}` when alive; reconciled at the next boot or CLI run (§5.2), audit `publish_recovered` |

---

## 6. Admin UI (`admin/web/`)

### 6.1 Vue 3 or Preact

| Criterion | Vue 3.5.42 + Vite 8.3.0 + @vitejs/plugin-vue 6.0.9 | Preact 10.29.8 + Vite 8 |
|---|---|---|
| Owner familiarity | maintains a Vue 3 CRM today | none in this codebase |
| The main job: a dense, nested, bilingual form | `v-model="draft.site.hero.tagline.ka"` straight on a reactive document | controlled inputs plus immutable updates or signals for every nested path |
| Runtime size | ~45 KB gzip | ~5 KB gzip |
| Does size matter here | no: one user, loaded once, cached immutable | – |

**Pick: Vue 3 + Vite.** No UI kit, no state library, **no vue-router**: six fixed screens and a
single auth check fit a 40-line hash router (`#/content/skills`), and hash routes need no
server fallback. `vue`, `vite` and `@vitejs/plugin-vue` are **devDependencies**: the SPA is
compiled in CI and the server only serves static files from `admin/web/dist/`.

`admin/web/vite.config.mjs`:

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [vue()],
  resolve: { alias: { '@admin-shared': repo + 'admin/shared', '@schema': repo + 'src/schema',
                      '@src': repo + 'src', '@thumbs': repo + 'src/admin-thumbs' } },
  server: { port: 5173, strictPort: true, fs: { allow: [repo] },
    proxy: { '/admin/api': 'http://127.0.0.1:3097', '/admin/preview': 'http://127.0.0.1:3097' } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, target: 'es2022' },
});
```

The admin stylesheet pulls Noto Sans Georgian from `src/fonts/` by relative `url()`, so Vite
emits it as a hashed file under `/admin/assets/`. Layout thumbnails come from
`src/admin-thumbs/<id>.svg` through `import.meta.glob` and are emitted as hashed assets too. Studio
ships `studio.svg`; this plan draws `precision.svg` and `ledger.svg` (320×200, schematic, from
the layouts' reference screenshots) if their plans do not supply one. So the server needs only
`/admin/`, `/admin/assets/*`, the API and the preview routes.

### 6.2 Source files

```
admin/web/index.html                 <div id="app">, <script type="module" src="/src/main.js">, no inline code
admin/web/src/main.js                createApp(App).mount('#app')
admin/web/src/router.js              hash router: routes, guard (session → login / forced password change)
admin/web/src/api.js                 fetch wrapper: base '/admin/api', X-Requested-With, JSON, If-Match, typed ApiError; 401 → session state
admin/web/src/ids.js                 newId(list): 8 random base36 chars (crypto.getRandomValues), retried on collision (data-model §3.8)
admin/web/src/state/session.js       reactive { authenticated, username, mustChangePassword }
admin/web/src/state/registry.js      layouts, palettes, palette check rows, limitsTable, schema (GET /registry once)
admin/web/src/state/draft.js         the working document, autosave queue, ETag, conflict handling, issues by $.path
admin/web/src/views/LoginView.vue  DashboardView.vue  ContentView.vue  SeoView.vue  RevisionsView.vue  AccountView.vue
admin/web/src/components/
  AppShell.vue        top bar + nav + draft status + Publish button
  PublishDialog.vue   validation summary, warnings acknowledgement, note, progress, result
  PreviewFrame.vue    sandboxed iframe, width modes, scaling, EN/KA, light/dark, postMessage bridge client
  LayoutPicker.vue    radio group of the registered layouts
  PalettePicker.vue   palettes.md §8 markup, CSS and behaviour, verbatim
  LField.vue          one localized field {en, ka}: two inputs, counters, "Copy EN → KA", issues
  SField.vue          one non-localized field (href, value, monogram, years, level, icon)
  Counter.vue         "n / max" with soft/hard states (§3.3)
  ListEditor.vue      add / remove (undo) / move up / move down for any id-keyed list
  SkillGroup.vue      group title + lead and its item rows with the level select
  NavBudget.vue       the 100-character nav budget per language and the 28-character label rule
  IssueList.vue       errors/warnings with links that focus the input named by $.path
  ConfirmDialog.vue   <dialog> based; Toast.vue (undo); SerpPreview.vue
admin/web/src/styles/admin.css       --adm-* tokens + layout; no framework
```

### 6.3 Visual rules for the admin

- Tokens, named `--adm-*` because palettes.md §8 already styles the palette picker with them
  (ratios measured on `--adm-bg` with the palette module's `contrast()`):

  | Token | Light | Dark | Ratio light / dark |
  |---|---|---|---|
  | `--adm-bg` | `oklch(98.5% .003 258)` | `oklch(18.5% .012 258)` | – |
  | `--adm-ink` | `oklch(20% .012 258)` | `oklch(96% .004 250)` | 17.35 / 16.61 |
  | `--adm-muted` (labels, counters) | `oklch(44% .012 258)` | `oklch(75.5% .008 250)` | 7.43 / 8.54 |
  | `--adm-accent` (links, primary button) and `--adm-focus` (focus ring) | `oklch(47% .18 255)` | `oklch(80% .15 255)` | 6.58 / 9.57 |
  | `--adm-warn` (text) | `oklch(48% .12 70)` | `oklch(82% .12 80)` | 6.44 / 10.56 |
  | `--adm-error` (text) | `oklch(50% .19 27)` | `oklch(76% .14 25)` | 6.34 / 8.20 |
  | `--adm-control` (input, select and checkbox borders) | `oklch(62% .012 258)` | `oklch(52% .012 258)` | 3.50 / 3.38 |
  | `--adm-line` (decorative separators only) | `oklch(91.5% .006 258)` | `oklch(29.5% .01 258)` | decorative |
  | `--adm-hover` | `oklch(94.5% .005 258)` | `oklch(24% .012 258)` | background only |
  | `--adm-sans` / `--adm-mono` | `system-ui, -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif` / `ui-monospace, SFMono-Regular, Menlo, monospace` | same | – |

  Dark values apply under `@media (prefers-color-scheme: dark)`. Every state also carries an icon
  and words, never colour alone.
- Georgian inputs and labels carry `lang="ka"` so the Noto Sans Georgian face (self-hosted, §6.1)
  and the right spell-checker apply. No `text-transform: uppercase` anywhere near Georgian text;
  English section labels may use it.
- Corners 2 px (swatch frames, thumbnails) to 4 px (inputs, buttons) at most, 1 px hairlines, no
  pill shapes, no drop shadows.
- Focus: `outline: 2px solid var(--adm-focus); outline-offset: 2px` on every interactive element,
  never removed. Hit targets >= 32×32 px.
- `@media (prefers-reduced-motion: reduce)`: no transitions; preview scale changes are instant.
- Admin UI copy is English. Georgian appears only as content (and as the palette names' `label.ka`).

### 6.4 Shell

Top bar 56 px: "samsiani.me admin" · nav (Dashboard, Content, SEO, Revisions, Account) ·
draft status ("Saved · r57", "Saving…", "Unsaved changes, retrying", "Offline, kept on this
device", "2 errors block publishing") · live status ("Live r57 · 14 Sep 10:15") · **Publish**
button (disabled when the draft equals live). Width >= 1024: nav inline; below: nav collapses
into a `<details>` menu. The admin works at 390 px wide, but the preview and side-by-side editing
target >= 1280 px.

### 6.5 Screens

**Login** (`#/login`). Username (`autocomplete="username"`), password
(`autocomplete="current-password"`), submit. Errors: "Wrong username or password." (never which
one), "Too many attempts. Try again in N minutes." (429 `retryAfterS`), "The admin account is not
set up yet." (503). After success with `mustChangePassword` → `#/account?force=1`, where only the
password form is available.

**Dashboard** (`#/`).
- Status strip: live `rev`, publish time, layout, palette; "Draft differs from live in N fields"
  (`admin/shared/diff.mjs`) with **Publish** and **Discard draft** (confirm dialog).
- **Layout**: a native radio group, one option per entry of `LAYOUTS`, each a `<label>` holding
  the radio, the 320×200 thumbnail (2 px corners, hairline border, no shadow), the `label`
  ("A · Precision", "B · Studio", "C · Ledger") and the one-line `description`. Three columns at
  >= 1280 px, one below. Selecting writes `settings.layout` to the draft and re-renders the preview.
- **Palette**: `PalettePicker` implements palettes.md §8 exactly (list-style radio group, 128×48
  two-half swatches over the selected layout's light and dark `bg`, `pal-meta` with the light
  `--accent-ink` hex and the minimum ratio, read from `GET /registry` as
  `paletteHex[id].light['--accent-ink']` and `paletteMin[id][layout]`). The swatch
  custom properties are set with Vue `:style` bindings, which go through CSSOM and are allowed by
  the CSP; no `style` attributes are written into markup. Selecting writes `settings.palette` and
  switches the preview instantly through the bridge (§6.7), not through `contentDocument`, because
  the preview frame is sandboxed.
- **Default theme**: radios "Follow the visitor's system", "Light", "Dark" →
  `settings.defaultTheme`. When the selected layout declares its own `defaultTheme` (Studio:
  `dark`), the first label reads "Layout default (dark)".
- **Last updated**: date input → `settings.updated` (live value 2026-06-07), and a checkbox
  "Set to today when content changes on publish" → `settings.autoUpdateDateOnPublish`
  (rule: data-model §12.3). `FUTURE_DATE` and `EYEBROW_YEAR` warnings show inline.
- **Live preview** (right column >= 1280 px, below the controls otherwise): toolbar with
  EN | KA, Desktop 1440 | Mobile 390, Light | Dark, Reload, Open in new tab. It always shows
  the in-memory draft, including unsaved keystrokes.

**Content** (`#/content/<tab>`). The form is generated from `buildSchema()`; this plan adds only
labels and help texts (an English label map keyed by schema path). Left tab list (220 px) with an
issue count per tab: Person & hero, Contact rail, Profile, Stack & skills, Abilities, How I work,
Principles, Experience, Languages, Let's talk, Interface strings. `NavBudget` sits above the list.
- `LField` (every `{en, ka}` field): the field label, then EN and KA inputs side by side
  (>= 1100 px) or stacked with "EN"/"KA" tags, each with its `Counter`. `textarea` fields
  auto-grow. Inputs trim on blur; Enter never inserts a line break (paragraphs are list items).
  A "Copy EN → KA" button fills the KA input with the EN value (tool names such as "Next.js 16").
  Optional fields (`nav`, `lead`, `detail`) have an "Add"/"Remove" toggle between `null` and a
  full `{en, ka}` pair.
- `SField` (non-localized values): one input each, with the scheme hint for hrefs
  ("https://, mailto: or tel:").
- `ListEditor` (profile paragraphs, facts, contact items, skill groups and items, abilities,
  work style, principles, experience, languages, `sameAs`): per item "Move up", "Move down",
  "Remove" buttons with `aria-label`s naming the item ("Move 'PHP 8' up"); "Add …" at the end.
  Items are single objects holding both languages, so every action is one array operation; a new
  item gets `newId()` and empty strings (stored in the draft, flagged `EMPTY` until filled).
  Remove shows a 10 s "Removed 'X'. Undo" toast instead of a confirm dialog. Focus after move: the
  same button on the moved item; after remove: the next item's first input (or Add); after add:
  the new item's EN input. Buttons disable at the list's count bounds (data-model §7), with the
  bound named in the button's description.
- Skills: each group is a `<details>` (open by default) with title and lead, then item rows
  `name EN | detail EN | name KA | detail KA | level | actions` (stacked below 1100 px). `level`
  is one `<select>`: "Core (daily, production) / Strong (regular) / Working (as needed)".
- Experience: `from` (number input, 1970–2100), `to` (number input) with a "present" checkbox
  that stores `null`; role, org, text as `LField`; `orgHref` as `SField` (`https:` only).
- Contact rail: per item label (`LField`), value, href, icon select (`mail`, `phone`, `github`,
  `globe`), "Show copy button". Let's talk: title, lead, CTA text, "Primary email" select (contact
  items with a `mailto:` href) and up to three "Buttons" chosen and ordered from the contact items.
- Interface strings: one row per `ui.*` key with a plain-English note on where it shows.
- `validate()` runs in the browser on every change (debounced 250 ms, same module as the
  server); issues appear under the input named by their `$.path` and in the tab badge.

**SEO** (`#/seo`). Page title and description per language with a search-result preview
(`SerpPreview`: title cut at 60 characters, description at 160, both labelled approximate), OG
card previews for EN and KA (`POST /og-preview`, refreshed on demand; "Card changes on publish"
when its name differs from the live one), `person.alternateName`, `person.address`,
`person.sameAs`, and `settings.siteUrl` read-only.

**Revisions** (`#/revisions`). Two tables. "Live builds": date, rev, layout, palette, current
marker, "Roll back to this build" (confirm dialog naming the date). "Revisions": date, reason,
rev, note, layout/palette, actions "Preview" (opens the preview panel in a dialog with that
revision), "Changes" (expands `changes` from `GET /revisions/:id`: path, before, after, text cut
at 200 characters), "Restore to draft" (confirm). A "Save checkpoint" button with a note field
sits above.

**Account** (`#/account`). Change password (current, new, repeat; rule shown: 12–128
characters); active sessions with "Sign out other sessions"; last 50 audit events;
Data: "Export draft", "Export live" (fetch → Blob → temporary `<a download>`), "Import JSON"
(file input `accept="application/json,.json"` → `POST /import` → validation summary → banner
"Imported into the draft. Preview it, then publish.").

### 6.6 Draft state, autosave, conflicts (`state/draft.js`)

- Boot: `GET /draft` → `{ rev, etag, site, issues }`; `site` becomes a deep `reactive` object.
- ETag: always the `etag` field of the JSON body, sent as `If-Match: "<etag>"`. The `ETag` header is
  never read (Cloudflare turns a compressed response's strong `ETag` into `W/"…"`, which would fail
  every `If-Match`).
- Autosave: `watch(site, …, { deep: true })` → debounce 1500 ms, and at most 10 s between saves
  while typing continues; one request in flight, the newest state queued.
  `PUT /draft` with `If-Match: "<etag>"` and `{ site }` → store the new `rev` and `etag`.
  Changes applied from a server response do not trigger the watcher.
- 412 → dialog "This draft was changed in another tab or device (r60, 10:42)." with two choices,
  neither of which loses a version:
  - "Load the newer draft": first `POST /draft/checkpoint { note: 'Local edits replaced by r60 (10:42)', site: <local> }`, then load the server draft.
  - "Keep mine and overwrite (the other version stays in Revisions)": `PUT` with `force: true`; the
    server snapshots its draft as `pre-overwrite` first (§3.4).
- 400 `draft_rejected` (structural, should never happen from the form) → keep the local copy,
  show the errors, stop autosaving until the next edit.
- Network error or 5xx → keep the pending document in `localStorage['sm-admin:pending']`
  (`{ etag, rev, site, at }`, wrapped in try/catch), retry at 2, 4, 8, 16, 30 s. On boot a pending
  copy is **always** offered: same `etag` as the server draft → "Restore unsaved changes from this
  device"; a different `etag` → dialog "Unsaved changes from this device, based on r<N>; the server
  now has r<M>" with "Use mine" (`PUT` with `force: true`, so the server draft is kept as
  `pre-overwrite`), "Download my copy" (JSON Blob) and "Discard". The key is deleted only after
  that copy was saved successfully or the owner clicked Discard.
- 401 → the login form opens as a modal over the current screen; after login the queued save is
  sent. Nothing typed is lost.
- After discard, restore, import, or a publish that returns `draft`, cancel queued saves and replace
  `site` from the response (or `GET /draft`) before autosave resumes, so no stale save can land with
  the new ETag.
- `beforeunload` warns while a save is pending. `Ctrl/Cmd+S` saves immediately.

### 6.7 Preview frame (`components/PreviewFrame.vue`)

- Content or layout change: debounce 600 ms; the re-render key is
  `JSON.stringify({ ...site, settings: { ...site.settings, palette: null, defaultTheme: null } })`,
  skipped when it equals the last request's; `POST /preview { site }` → `{ base }`; set
  `iframe.src = base + (lang === 'ka' ? 'ka/' : '') + '?theme=' + theme`. A 422
  `preview_render_failed` keeps the last good frame and shows "Preview cannot render this draft:
  <message>" above it.
- Palette and theme changes need no render: the parent posts
  `iframe.contentWindow.postMessage({ type: 'sm-preview', palette, theme }, '*')` (the target
  origin must be `'*'` because a sandboxed frame's origin is `"null"`). The bridge script inside
  the preview (§7) accepts only messages whose `event.origin` equals `PUBLIC_ORIGIN` and whose
  values are in its embedded allowlists, then sets `documentElement.dataset.palette` /
  `dataset.theme`. The preview page carries the all-palettes bundle, so the switch is instant.
  Each page is rendered with the stored palette and the EN ↔ KA links drop `?theme=`, so the parent
  re-posts `{ type: 'sm-preview', palette, theme }` on every iframe `load` event.
- `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Site preview">`: no
  `allow-same-origin`, no `allow-top-navigation`, no `allow-forms`.
- Desktop: iframe 1440×900 inside a wrapper scaled with `transform: scale(s)`,
  `s = min(1, wrapperWidth / 1440)`, `transform-origin: 0 0`, the wrapper sized to
  `1440·s × 900·s`. Mobile: 390×844, centred, scale 1 when it fits. Media queries inside the
  frame see the real iframe width.
- The parent cannot read the status of an opaque-origin frame, so token expiry is handled by
  time: a fresh token every 14 minutes while the page is visible (`document.visibilityState`),
  and on "Reload".
- "Open in new tab" opens the token URL; the response's `Content-Security-Policy: sandbox`
  keeps it isolated there too.

### 6.8 Publish dialog (`components/PublishDialog.vue`)

Click **Publish** → settle the autosave queue (wait for the PUT in flight, send the pending one) →
`POST /validate` → modal: layout, palette, number of changed fields vs live,
the date that will be published (after the §5.2 step-4 rule); blocking errors (each links to its
input and closes the dialog) or warnings with a checkbox "I have reviewed these warnings";
optional note (200 characters); **Publish to samsiani.me** → `POST /publish` with
`If-Match: "<draft etag>"` (the ETag after the queue settled) and `{ acknowledgeWarnings, note }`;
the form stays inert until the response arrives; the SPA copies `draft.updated` into
`site.settings.updated` and adopts `draft.etag` → "Publishing…" → success
"Live · r58 · published in 1.2 s" with links to `/` and `/ka/`, or the error with its stage.
A 412 reloads the draft state first.

---

## 7. Preview rendering on the server (`admin/server/lib/preview.mjs`)

- `PreviewStore`: `Map<token, { files: Map<path, { body, type }>, exp }>`, TTL 15 min, at most
  20 entries (oldest evicted). Token = `randomBytes(32).toString('base64url')` (43 chars, 256 bits).
- `POST /preview` sets `settings.siteUrl = cfg.SITE_URL`, applies the draft rules to the posted
  site (§3.3; structural errors and any `$.settings.` error → 400, the renderer never sees a
  malformed tree), then calls
  `buildSite(site, { mode: 'preview', base: '/admin/preview/<token>/', brand, today })` inside
  `try/catch`. `brand` needs no build on disk (so the preview works right after `cli init`, when
  `buildId` is `null`): M6 `committedBrand({ namesOnly: true })`, from M7
  `brandNames(site, palette, layoutMeta, RENDERER_ID)` (names only, `files = new Map()`, the names the
  next publish will produce). A throw returns 422 `{ error: 'preview_render_failed', message }` and
  keeps the previous token. Both languages render at once, so EN/KA switching needs no new request.
  Content errors do not block a preview; an over-long string simply shows what it would break.
- Head injection, preview mode only: before `</head>` of every HTML file the store inserts
  `<meta name="robots" content="noindex">`, `<link rel="stylesheet" href="<base>palettes-all.<md5-8>.css">`
  (`allPalettesCss()`, palettes.md §5 step 5, served only here) and the bridge `<script>`
  (inline; allowed by the preview CSP only):
  ```js
  (() => {
    const O = '<PUBLIC_ORIGIN>', B = '/admin/preview/<token>';
    const PAL = [/* palette ids */], TH = ['light', 'dark'];
    addEventListener('message', (e) => {
      if (e.origin !== O || !e.data || e.data.type !== 'sm-preview') return;
      const r = document.documentElement;
      if (PAL.includes(e.data.palette)) r.dataset.palette = e.data.palette;
      if (TH.includes(e.data.theme)) r.dataset.theme = e.data.theme;
    });
    addEventListener('DOMContentLoaded', () => {                    // keep language links inside the preview
      document.querySelectorAll('a[href="/"], a[href="/ka/"]').forEach((a) => { a.href = B + a.getAttribute('href'); });
    });
  })();
  ```
  `<PUBLIC_ORIGIN>`, `<token>` and the ids are written with `jsonForScript()`.
- Immutable files (fonts, icons, the bundle) are shared `Buffer`s from a module-level cache keyed
  by sha256, so one token costs ~150 KB (two HTML pages, CSS, JS).
- `GET /admin/preview/:token/*`: decode, reject `..`, `//`, `\0`; empty path or trailing `/` →
  `index.html`; look up **only** in the token's map (no filesystem access); headers per §4.6.
- The request logger rewrites `/admin/preview/<token>/…` to `/admin/preview/…/…`; tokens never
  reach a log file.

Why not `srcdoc` or a blob URL (the two options named in the brief): a `srcdoc` document
inherits the admin page's CSP, which blocks the public site's inline theme bootstrap, and its
relative asset URLs resolve against `/admin/`; a `blob:` URL inherits the admin origin, so any
script in the rendered page would run with the admin session's privileges. The token URL gives
the page its own CSP, working asset paths and `?theme=`, and an opaque origin. The price is that
the parent cannot touch the frame's DOM, which is why palette switching uses `postMessage`
instead of the `contentDocument` approach sketched in palettes.md §8.

---

## 8. OpenLiteSpeed and Cloudflare

### 8.1 vhost changes (`deploy/ols-admin-context.conf`)

Applied by hand once, as root, to `/usr/local/lsws/conf/vhosts/<domain>/vhost.conf`. The
existing static `context /` (with its `location`, `extraHeaders`, `rewrite`), `errorpage 404`
and `expires` blocks stay exactly as they are.

```
# ---- samsiani.me admin: Node service on 127.0.0.1:3097 ----------------------
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
# ------------------------------------------------------------------------------
```

A plain context URI ending in `/` covers every sub-URI; OLS picks the longest matching context,
so `/admin/…` goes to Node and everything else stays static. OLS forwards the original URI
(`/admin/api/draft` arrives as `/admin/api/draft`), which is why the app mounts everything under
`/admin/` (verified by T1.1). The bare `/admin` is not under `/admin/`, so add this as the
**first** rule inside the existing `rules <<<END_rules … END_rules` block of `context /`:

```
RewriteRule ^/?admin$ /admin/ [R=301,L]
```

Procedure:
1. `cp -a vhost.conf vhost.conf.bak.pre-admin-$(date +%F)`
2. Paste the `extprocessor` block after the vhost-level settings and before the first `context`;
   paste `context /admin/` above `context /`; add the rewrite rule.
3. `/usr/local/lsws/bin/lswsctrl restart` (graceful).
4. Verify: `curl -sI https://samsiani.me/admin` → `301`, `location: /admin/`;
   `curl -sI https://samsiani.me/admin/` → `200`, `x-robots-tag: noindex, nofollow, noarchive`,
   `cache-control: no-store`; for `curl -sI https://samsiani.me/`, `x-content-type-options`,
   `referrer-policy`, `x-frame-options`, `permissions-policy`, `content-type` and `cf-cache-status`
   equal their values before the edit (other headers vary per request through Cloudflare); T1.1 and T1.2.

CyberPanel can regenerate `vhost.conf` (PHP version change, SSL re-issue from the panel, panel
rewrite edits). If that drops the block, the admin disappears while the public site keeps
working; re-apply from `deploy/ols-admin-context.conf`. The deploy's vhost probe (§10.3) warns
when this happens.

### 8.2 Headers, robots, indexing

- The app sets all admin headers itself (§4.6); no `extraHeaders` in the proxy context, so no
  duplicate `X-Frame-Options`.
- `robots.txt` gets `Disallow: /admin/` (the `robotsTxt` edit in §5.1). This names the path publicly; accepted,
  because the path is guessable anyway and protected by auth; `X-Robots-Tag` is what keeps it out
  of indexes.

### 8.3 Optional extra: accept `/admin/` only from Cloudflare addresses

The mandatory control is the app's edge check (§4.5 guard 0), which also stops other tenants on the
box. This OLS rule is an optional second layer, only if T0.5 shows `useIpInProxyHeader` absent or
`0` (with it set, OLS evaluates the visitor address and the rule would block everyone). Add inside
`context /admin/`:

```
  accessControl  {
    allow                 173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22, 141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22, 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32, 127.0.0.1
    deny                  ALL
  }
```

(List from `https://www.cloudflare.com/ips-v4/` and `/ips-v6/` on 2026-09-14; re-check yearly.)
Effect: a request that reaches the origin from outside gets 403 from OLS before it reaches the app.
It does not stop a local tenant connecting to `127.0.0.1:3097`. Test from a laptop with the origin address resolved by
hand → 403; through Cloudflare → 200. If the through-Cloudflare request is 403, OLS is
evaluating the visitor address; remove the block.

### 8.4 Cloudflare

- **Transform Rule (required from the first deploy):** Rules → Transform Rules → Modify Request
  Header, name "admin edge", expression `(starts_with(http.request.uri.path, "/admin"))`, action
  **Set static** `x-sm-edge` = the value of `EDGE_SECRET` (`openssl rand -base64 32`). Cloudflare
  overwrites any value a client sends. The Free plan allows 10 Transform Rules. The value lives only
  in this rule and in `admin.env`. Rotation: change the rule, then `admin.env`, then
  `pm2 startOrReload … --update-env`; `/admin/` answers 403 `edge` for the seconds in between.
- By default Cloudflare caches by file extension only: `/admin/` and `/admin/api/*` (no
  extension) are not cached. Preview files with `.css/.js/.woff2` extensions would be eligible,
  but the app sends `Cache-Control: no-store`, which Cloudflare's origin cache control honours.
- **Rule order.** Cloudflare applies every matching Cache Rule (and every matching Configuration
  Rule) in order, and for a conflicting setting the value of the **last** matching rule wins. So:
  - **Cache Rule** "admin bypass", `(starts_with(http.request.uri.path, "/admin"))` → Bypass cache,
    is the **last** Cache Rule;
  - **Configuration Rule**, same expression → Rocket Loader Off, Email Obfuscation Off (both rewrite
    HTML/JS and would break the CSP-strict SPA), is the **last** Configuration Rule;
  - every other Cache Rule and Configuration Rule on the zone gets
    `and not starts_with(http.request.uri.path, "/admin")` in its expression, including any Cache
    Everything rule T0.6 finds and any rule added later to cache HTML. Without it, such a rule with an
    Edge TTL that ignores origin headers would serve cached `GET /admin/api/draft`,
    `/account/sessions` (IPs, user agents), `/account/audit` and `/export` to requests without a cookie.
- **Check, at the cut-over and after any Cloudflare rule change (R11):** run
  `curl -s -D- -o /dev/null -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/draft`
  twice without a cookie: both return 401, and neither shows `cf-cache-status: HIT`. And the edge
  check: `curl -sk --resolve samsiani.me:443:127.0.0.1 -H 'X-Requested-With: samsiani-admin' https://samsiani.me/admin/api/session`
  and `curl -s -H 'X-Requested-With: samsiani-admin' http://127.0.0.1:3097/admin/api/session` both
  return 403, and the same request through Cloudflare returns 200.
- Optional, owner decides:
  - Cloudflare Access (Zero Trust free tier) application for `samsiani.me/admin*`, policy
    One-time PIN to the owner's address: nobody reaches the login form without the email code. The
    edge check is what makes Access impossible to route around.
  - WAF rate-limiting rule (free plan allows one):
    `(http.request.uri.path eq "/admin/api/auth/login" and http.request.method eq "POST")`,
    5 requests per 10 s per IP → block 10 s.
- The public site's caching is unchanged: hashed assets immutable, HTML not cached (T0.6 over the
  five fixed-name URLs; `/robots.txt` and `/sitemap.xml` get a bypass rule or are purged, §5.8).
  Cloudflare rewrites the public HTML (Email Obfuscation, a hidden `/cdn-cgi/content` link, a
  per-request script), so byte comparisons of public pages are always made at the origin with
  `curl -sk --resolve samsiani.me:443:127.0.0.1`.

---

## 9. PM2 and configuration

### 9.1 Ecosystem file (`deploy/ecosystem.config.cjs`, committed; contains no server facts)

Root's PM2 evaluates this file, so it never travels in the release artifact: the deploy job writes
its own checkout's copy to `/opt/samsiani-admin/shared/ecosystem.config.cjs` (§10.2), and every
command uses that path.

```js
// Evaluated by the PM2 CLI (root) as /opt/samsiani-admin/shared/ecosystem.config.cjs. Server facts
// and secrets come from the root-only env files next to it; nothing server-specific is in git.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { resolve } = require('node:path');

const APP_HOME = resolve(__dirname, '..');                  // /opt/samsiani-admin
const read = (f) => parseEnv(readFileSync(resolve(__dirname, f), 'utf8'));
const d = read('deploy.env');
const s = read('admin.env');
for (const k of ['SITE_USER', 'NODE_BIN', 'SITE_HOME', 'WEB_ROOT']) if (!d[k]) throw new Error(`deploy.env: ${k} is missing`);
for (const k of ['SESSION_SECRET', 'EDGE_SECRET']) if (!s[k]) throw new Error(`admin.env: ${k} is missing`);

const env = {
  NODE_ENV: 'production', HOST: '127.0.0.1', PORT: d.PORT || '3097',
  PUBLIC_ORIGIN: 'https://samsiani.me', SITE_URL: 'https://samsiani.me',
  SITE_HOME: d.SITE_HOME, WEB_ROOT: d.WEB_ROOT,
  SESSION_SECRET: s.SESSION_SECRET, EDGE_SECRET: s.EDGE_SECRET,
};
// Optional keys are always present, '' when unset: PM2 keeps a variable that disappears from the
// file on reload (PM2 issue #3486), so a removed secret must be overwritten, not dropped.
for (const k of ['SESSION_SECRET_PREV', 'ADMIN_INITIAL_PASSWORD', 'ADMIN_USERNAME', 'CF_API_TOKEN', 'CF_ZONE_ID']) env[k] = s[k] ?? '';

module.exports = {
  apps: [{
    name: 'samsiani-admin',
    cwd: resolve(APP_HOME, 'current'),
    script: 'admin/server/index.mjs',
    interpreter: d.NODE_BIN,
    exec_mode: 'fork',
    instances: 1,
    uid: d.SITE_USER,
    gid: d.SITE_USER,
    filter_env: true,          // inherit nothing from the root shell that runs pm2
    env,
    wait_ready: true,          // index.mjs calls process.send('ready') after listen
    listen_timeout: 10000,
    kill_timeout: 10000,       // lets an in-flight publish finish (index.mjs waits up to 8 s)
    max_memory_restart: '400M',
    exp_backoff_restart_delay: 200,
    max_restarts: 20,
    min_uptime: 5000,
    autorestart: true,
    watch: false,
    time: true,
    merge_logs: true,
    out_file: resolve(APP_HOME, 'logs', 'samsiani-admin.out.log'),
    error_file: resolve(APP_HOME, 'logs', 'samsiani-admin.err.log'),
  }],
};
```

`util.parseEnv` exists in the Node 24 that runs PM2. `cwd` is the `current` symlink; every
(re)start resolves it again, so a reload after a symlink flip runs the new release. Changes to
`uid`, `gid` or `interpreter` need `pm2 delete samsiani-admin` followed by a start;
`startOrReload` does not apply them to a running process. The PM2 daemon (root) opens the log files
in root-only `/opt/samsiani-admin/logs/`, where no site-user symlink can exist.

### 9.2 Server-side env files (root:root, 600, never in git; `*.example` committed)

`/opt/samsiani-admin/shared/deploy.env` (server facts, from T0):
```
SITE_USER=<unix user that owns the web root>
NODE_BIN=<absolute path of a Node 24 binary the site user can execute>
SITE_HOME=<CyberPanel home of the domain>
WEB_ROOT=<docRoot>
PORT=3097
```

`/opt/samsiani-admin/shared/admin.env` (secrets):
```
SESSION_SECRET=<openssl rand -base64 48>
EDGE_SECRET=<openssl rand -base64 32>              # same value as the Cloudflare Transform Rule (§8.4)
ADMIN_USERNAME=<chosen login name>
ADMIN_INITIAL_PASSWORD=<openssl rand -base64 24>   # first boot only; delete after the first login
# SESSION_SECRET_PREV=<old secret during a rotation>
# CF_API_TOKEN=<token with Zone.Cache Purge only>   # only if T0.6 needs purging
# CF_ZONE_ID=<zone id>
```

Create once: `install -d -m 755 -o root -g root /opt/samsiani-admin /opt/samsiani-admin/releases`,
`install -d -m 700 -o root -g root /opt/samsiani-admin/shared /opt/samsiani-admin/logs`, write the
two files, `chmod 600` both. After editing `admin.env`:
`pm2 startOrReload /opt/samsiani-admin/shared/ecosystem.config.cjs --update-env`, then check that a
removed key is really gone: `tr '\0' '\n' < /proc/$(pm2 pid samsiani-admin)/environ | grep -E '^(ADMIN_INITIAL_PASSWORD|SESSION_SECRET_PREV)=.'`
prints nothing.

### 9.3 Configuration object (`admin/server/config.mjs`)

| Env var | Production | Local dev default | Use |
|---|---|---|---|
| `NODE_ENV` | `production` | `development` | switches the defaults below |
| `HOST` / `PORT` | `127.0.0.1` / `3097` | same | bind address |
| `PUBLIC_ORIGIN` | `https://samsiani.me` | `http://localhost:5173` | Origin allowlist, preview CSP |
| `SITE_URL` | `https://samsiani.me` | same | canonical, hreflang, OG URLs in rendered pages |
| `SITE_HOME` | from `deploy.env` | unset | base of the three paths below |
| `DATA_DIR` | `$SITE_HOME/data` | `./data` | §2.2 |
| `WEB_ROOT` | from `deploy.env` | `./dist` | publish target |
| `BUILDS_DIR` | `$SITE_HOME/builds` | `./.builds` | staged builds |
| `WEB_DIST` | `<release>/admin/web/dist` | `./admin/web/dist` | SPA files |
| `SEED_FILE` | `<release>/src/content/site.json` | `./src/content/site.json` | first-boot content (§3.2) |
| `RELEASE` | contents of `<release>/RELEASE` | `dev` | health + manifest |
| `SESSION_SECRET`, `SESSION_SECRET_PREV` | `admin.env` | `.env.development` | §4.3, device cookie §4.4 |
| `EDGE_SECRET` | `admin.env`, required | unset (edge check off) | §4.5 guard 0 |
| `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD` | `admin.env` | `.env.development` | §4.2 |
| `COOKIE_SECURE` | forced `true` | `false` | cookie name + `Secure` |
| `CF_API_TOKEN`, `CF_ZONE_ID` | optional | unset | §5.8 |
| `ALLOW_ROOT` | unset | unset | emergency override of the root refusal |

An empty string counts as unset (the ecosystem passes every optional key, `''` when absent).
Boot refuses to start (exit 1, one-line reason) in production when: running as root without
`ALLOW_ROOT=1`; `SESSION_SECRET` shorter than 32 bytes; `EDGE_SECRET` missing or shorter than
32 bytes after base64 decoding; `PUBLIC_ORIGIN` not `https:`; `DATA_DIR` or `WEB_ROOT` not
writable; `NODE_APP_INSTANCE` present and not `0`. The CLI loads the
same config module but never requires `SESSION_SECRET` (none of its commands issue cookies;
`set-password` revokes sessions through the epoch).

### 9.4 Operating commands (root on the server)

```bash
set -a; . /opt/samsiani-admin/shared/deploy.env; set +a     # SITE_USER NODE_BIN SITE_HOME WEB_ROOT PORT
ECO=/opt/samsiani-admin/shared/ecosystem.config.cjs
pm2 status samsiani-admin
pm2 logs samsiani-admin --lines 200
pm2 startOrReload "$ECO" --update-env && pm2 save
pm2 restart samsiani-admin     # same release, same env; also clears in-memory rate limits
pm2 stop samsiani-admin        # admin offline; the public site is unaffected (add the DISABLED flag to keep it off, R4)
runuser -u "$SITE_USER" -- env NODE_ENV=production SITE_HOME="$SITE_HOME" WEB_ROOT="$WEB_ROOT" PORT="$PORT" "$NODE_BIN" /opt/samsiani-admin/current/admin/server/cli.mjs <command>
```

Logs: `/opt/samsiani-admin/logs/samsiani-admin.out.log` / `.err.log` (the PM2 daemon writes them as
root). The app logs boot, errors, and one line per mutating API call (`method path status ms
requestId`), never bodies. 401, 403, 413 and 429 responses are not logged one per request: the app
writes one line per minute with their counts by status (`rejected 401=3 403=0 413=0 429=41`), so an
unauthenticated flood cannot fill the disk shared with the other sites. `pm2-logrotate` is a
**required** M9 step (it applies to every PM2 app on the box; the owner approves it at M9):
`pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 10 && pm2 set pm2-logrotate:compress true`.
Reboot survival relies on the existing root PM2 startup unit (`systemctl status pm2-root`) and the
`pm2 save` that every deploy runs.

---

## 10. CI/CD and local development

### 10.1 `package.json`

```json
{
  "name": "samsiani-me",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "dev:server": "node --watch --env-file-if-exists=.env.development admin/server/index.mjs",
    "dev:web": "vite --config admin/web/vite.config.mjs",
    "build": "node build.mjs",
    "build:admin": "vite build --config admin/web/vite.config.mjs",
    "preview:site": "node build.mjs && node serve.mjs",
    "cli": "node --env-file-if-exists=.env.development admin/server/cli.mjs",
    "check:stress": "SITE_JSON=test/fixtures/site.stress.json OUT_DIR=/tmp/dist-stress node build.mjs && node scripts/check-layout-stress.mjs --dist /tmp/dist-stress",
    "check:all": "node scripts/check-all.mjs",
    "check:secrets": "node scripts/check-secrets.mjs",
    "test": "node --test \"test/unit/**/*.test.mjs\" \"admin/test/**/*.test.mjs\"",
    "test:e2e": "node --test test/e2e/admin.e2e.mjs"
  },
  "dependencies": {
    "hono": "4.13.7",
    "@hono/node-server": "2.1.1",
    "satori": "0.33.4",
    "@resvg/resvg-wasm": "2.6.2"
  },
  "devDependencies": {
    "playwright": "1.59.1",
    "vue": "3.5.42",
    "vite": "8.3.0",
    "@vitejs/plugin-vue": "6.0.9"
  }
}
```

Exact pins; the lockfile is committed. Runtime dependencies are pure JS/WASM (satori's 13 direct
dependencies and their small transitive set included), so production `node_modules` built on the Ubuntu runner run unchanged on
AlmaLinux 8. `build.mjs` keeps data-model's env overrides (`SITE_JSON`, `OUT_DIR`, `LAYOUT`,
`PALETTE`, `SITE_URL`, `BUILD_DATE`); it also accepts a server envelope (`{ kind, …, site }`) as
`SITE_JSON`, so `SITE_JSON=data/site.json` renders the local admin's live document. It calls the
same `buildSite()` and `renderOgPng()` as the server. (The `migrate` script of data-model phase 1
is deleted when this phase ships, data-model §6 step 7.)

### 10.2 `.github/workflows/deploy.yml` (replaces the current file)

Four jobs. `test` and `gates` run on every trigger; `release` and `deploy` only on `main`. No
dependency install script ever runs (`--ignore-scripts`); Playwright and the page gates run in a job
that uploads nothing; the artifact is built in a fresh workspace and contains no `deploy/`; the
deploy job sends its own checkout's `deploy/` files. Every `uses:` is pinned to a full commit SHA
(tags looked up 2026-09-15; update pins deliberately, for example from Dependabot's
`github-actions` updates).

```yaml
name: test, build & deploy
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
concurrency:
  group: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.ref) || 'production-deploy' }}
  cancel-in-progress: false
permissions:
  contents: read
env:
  NPM_FLAGS: --ignore-scripts --no-audit --no-fund   # not npm ci: a macOS lockfile omits Linux optional packages

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with: { fetch-depth: 2, persist-credentials: false }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with: { node-version: '24' }
      - name: Seed notice
        if: github.event_name == 'push'
        run: |
          if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qx 'src/content/site.json'; then
            echo "::notice::src/content/site.json is only the seed; production content is edited in the admin"
          fi
      - run: npm install $NPM_FLAGS
      - run: npm test
      - name: No v-html in the admin SPA
        run: '! grep -rn "v-html" admin/web/src'
      - run: node src/palettes.mjs
      - run: npm run check:secrets
        env: { DENYLIST: '${{ secrets.DENYLIST }}' }

  gates:                                   # Playwright + page gates; uploads nothing
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with: { fetch-depth: 0, persist-credentials: false }        # check-all's pixel baseline needs PIXEL_BASE
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with: { node-version: '24' }
      - run: npm install $NPM_FLAGS                                   # playwright@1.59.1 is an exact devDependency
      - run: npx playwright install --with-deps chromium
      - run: npm run build:admin
      - run: npm run check:all
      - run: npm run check:stress
      - run: npm run test:e2e

  release:                                 # clean workspace: install, build the SPA, prune, pack
    needs: [test, gates]
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with: { persist-credentials: false }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with: { node-version: '24' }
      - run: npm install $NPM_FLAGS
      - run: npm run build:admin
      - run: npm prune --omit=dev $NPM_FLAGS
      - name: Assemble release (no deploy/ - root never evaluates a file from the artifact)
        run: |
          set -euo pipefail
          rm -rf release && mkdir -p release/admin/web
          cp -R package.json package-lock.json node_modules src release/
          cp -R admin/server admin/shared release/admin/
          cp -R admin/web/dist release/admin/web/
          printf '%s\n' "${GITHUB_SHA::7}" > release/RELEASE
          tar -czf release.tgz -C release .
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with: { name: release, path: release.tgz, retention-days: 7 }

  deploy:
    needs: release
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with: { persist-credentials: false }                          # this job's own deploy/ files
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with: { name: release }
      - name: Deploy
        env:
          KEY: ${{ secrets.VPS_SSH_KEY }}
          HOST: ${{ secrets.VPS_HOST }}
          USER: ${{ secrets.VPS_USER }}
          KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}
        run: |
          set -euo pipefail
          if [ -z "$KEY" ] || [ -z "$HOST" ] || [ -z "$USER" ]; then
            echo "Deploy secrets are not set - skipping deploy"; exit 0
          fi
          [ -n "$KNOWN_HOSTS" ] || { echo "VPS_KNOWN_HOSTS is not set" >&2; exit 1; }
          SHA="${GITHUB_SHA::7}"; APP=/opt/samsiani-admin
          install -d -m 700 ~/.ssh
          printf '%s\n' "$KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          remote() { ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=yes "$USER@$HOST" "$@"; }
          mkdir release && tar -xzf release.tgz -C release
          remote "install -d -m 755 '$APP/releases/$SHA'"
          rsync -az --delete -e "ssh -i $HOME/.ssh/id_ed25519 -o StrictHostKeyChecking=yes" \
            release/ "$USER@$HOST:$APP/releases/$SHA/"
          remote "umask 077; cat > '$APP/shared/.eco.tmp' && mv -f '$APP/shared/.eco.tmp' '$APP/shared/ecosystem.config.cjs'" < deploy/ecosystem.config.cjs
          remote "bash -s -- '$SHA'" < deploy/remote-deploy.sh
```

Deliberate deviation from the brief's "`npm install --omit=dev` on the server": production
dependencies are installed on the CI runner (`npm prune --omit=dev`) and shipped inside the
release. The server then never runs npm, so no package lifecycle script ever runs as root on the
shared box, a registry outage cannot break a deploy, and the exact tree that passed the tests is
the one that runs. `data/` is never part of a release (it lives under `$SITE_HOME`), so no rsync
exclude is needed to protect it. A package that turned malicious can still change code that runs
as the site user (the same exposure as a runtime dependency), but no file root evaluates: the
ecosystem file and `remote-deploy.sh` come from the deploy job's checkout of the pushed commit.

Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (required: the server's host key
line; `StrictHostKeyChecking=yes`) and the optional `DENYLIST`. `VPS_PATH` is no longer read: every
server path comes from `/opt/samsiani-admin/shared/deploy.env`. The deploy user must be root, as
today, because the remote half uses `runuser` and root's PM2. The new workflow **never writes to
the web root** and no longer hard-codes the unix user. Pull requests run `test` and `gates` only.
After the cut-over the owner deletes `VPS_PATH` and `VPS_SITE_USER` (§10.5 step 9), so a re-run of
any pre-M9 run skips its deploy.

### 10.3 `deploy/remote-deploy.sh` (server half, runs as root)

```bash
#!/usr/bin/env bash
# Usage: bash -s -- <SHA>   (stdin from the workflow's own checkout; runs as root)
# Root never sources, executes, chowns, chmods or rsyncs anything under $SITE_HOME; every command
# that writes there runs as the site user (§2.2).
set -euo pipefail
SHA="$1"
APP=/opt/samsiani-admin; R="$APP/releases/$SHA"; ECO="$APP/shared/ecosystem.config.cjs"
for f in deploy.env admin.env ecosystem.config.cjs; do [ -s "$APP/shared/$f" ] || { echo "$APP/shared/$f missing" >&2; exit 1; }; done
set -a; . "$APP/shared/deploy.env"; set +a        # SITE_USER NODE_BIN SITE_HOME WEB_ROOT PORT (root-owned file)
PORT="${PORT:-3097}"
as_site() { runuser -u "$SITE_USER" -- env NODE_ENV=production SITE_HOME="$SITE_HOME" WEB_ROOT="$WEB_ROOT" PORT="$PORT" "$NODE_BIN" "$@"; }
healthy() { curl -fsS "http://127.0.0.1:$PORT/admin/api/health" | grep -q "\"release\":\"$1\""; }

# 1. code: root-owned, readable by everyone, writable by nobody else
chown -R root:root "$R"; chmod -R u=rwX,go=rX "$R"

# 2. an operator disabled the admin (R4, R6): install only
if [ -e "$APP/shared/DISABLED" ]; then
  echo "::warning::admin disabled; release $SHA installed but not started"; exit 0
fi

# 3. data directories: created by the site user in its own home, never by root
runuser -u "$SITE_USER" -- install -d -m 700 "$SITE_HOME/data"
runuser -u "$SITE_USER" -- install -d -m 755 "$SITE_HOME/builds"

# 4. preflight with the new code; schema migration only with the service stopped
as_site "$R/admin/server/cli.mjs" verify
MIGRATED=0; rc=0
as_site "$R/admin/server/cli.mjs" migrate --dry-run || rc=$?
case "$rc" in
  0) ;;
  10) pm2 stop samsiani-admin || true
      as_site "$R/admin/server/cli.mjs" backup --name="pre-migrate-$SHA"
      as_site "$R/admin/server/cli.mjs" migrate
      MIGRATED=1 ;;
  *) echo "migrate --dry-run failed ($rc)" >&2; exit 1 ;;
esac
as_site "$R/admin/server/cli.mjs" init             # first boot seeds data/; never overwrites; never migrates

# 5. flip the release and (re)start from the root-owned ecosystem file
PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$R" "$APP/current.tmp" && mv -Tf "$APP/current.tmp" "$APP/current"
pm2 startOrReload "$ECO" --update-env

# 6. the new release must report its own sha within 20 s, else revert
ok=0
for _ in $(seq 1 20); do healthy "$SHA" && { ok=1; break; }; sleep 1; done
if [ "$ok" != 1 ]; then
  echo "health check failed for $SHA; reverting" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    pm2 stop samsiani-admin || true
    if [ "$MIGRATED" = 1 ]; then
      as_site "$PREV/admin/server/cli.mjs" restore-backup --file="$SITE_HOME/data/backups/pre-migrate-$SHA.json.gz" --part=all
    fi
    ln -sfn "$PREV" "$APP/current.tmp" && mv -Tf "$APP/current.tmp" "$APP/current"
    pm2 startOrReload "$ECO" --update-env
  fi
  exit 1
fi

# 7. re-render the public site from the server's site.json with the new templates
as_site "$APP/current/admin/server/cli.mjs" publish --source=published --reason=deploy --if-changed

# 8. persist and prune (keep 5 releases; never current or previous)
pm2 save
CUR="$(readlink -f "$APP/current")"
ls -1dt "$APP/releases"/*/ | tail -n +6 | while read -r d; do
  d="${d%/}"; [ "$d" = "$CUR" ] || [ "$d" = "$PREV" ] || rm -rf -- "$d"
done

# 9. vhost probe through the local OLS (warning only; the health endpoint needs no edge header)
code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/admin/api/health || true)"
[ "$code" = 200 ] || echo "::warning::/admin/ is not proxied by OLS (HTTP $code); re-apply deploy/ols-admin-context.conf"
```

`cli.mjs verify` exits non-zero with a list when: Node < 24; not running as the site user; data
dir or web root not writable; `BUILDS_DIR` and `WEB_ROOT` on different filesystems (the swap
hard-links); `src/content/site.json` (the seed) missing or invalid; `buildSite` import fails.

`cli.mjs migrate [--dry-run]` applies `migrate_vN_to_vN+1` to `draft.json`, `site.json` and every
revision (after a `pre-migrate` snapshot of each document). It refuses to run while
`curl -fsS http://127.0.0.1:$PORT/admin/api/health` answers (a running service would keep
autosaving vN documents), and `--dry-run` exits 10 when migrations are pending, 0 when none are.

`cli.mjs init` never migrates. It creates missing data subdirectories with their modes and, only if
`site.json` is absent:
- when `builds/` holds no build: writes `site.json` (`rev: 1`, `buildId: null`) and `draft.json`
  (`rev: 1`) from the seed, both through `canonicalize()`;
- when builds exist (`data/` was deleted or restored without its files while the web root
  survived): writes `site.json` and `draft.json` from the newest `builds/<id>/.site.json` (newest by
  the manifest's `createdAt`), sets `publish-state.current` and `history` to that build, and prints
  `::warning::data/ was missing; restored from build <id>`. If that file is unreadable, `init` exits 1
  and points to runbooks R7 and R10. Re-seeding from the repository would publish stale content at
  the next re-render.

### 10.4 Tests (`node:test`, no test framework dependency)

| Suite | Must prove |
|---|---|
| `admin/test/draft-rules.test.mjs` | the seed saves and publishes with 0 errors; a new item with empty `ka` is stored in the draft but blocks publish; a `ru` key, an unknown key, a duplicate id and a bad enum are refused even for the draft; an unknown future error code is treated as blocking (the validator itself is tested by data-model's 23 mutation cases) |
| `admin/test/fsx.test.mjs` | a thrown write between `sync` and `rename`, and a `writeFile` failing with a simulated `ENOSPC`, leave the old file intact and no `.tmp`; stale `.tmp` cleanup walks `data/` recursively and removes `builds/.tmp-*` |
| `admin/test/lock.test.mjs` | 100 parallel `saveDraft` calls, each sending the ETag returned by the previous one, lose nothing; a lockfile with a dead pid or older than `staleMs` is taken over; two processes (spawned) never hold `publish` together |
| `admin/test/store.test.mjs` | 412 on a stale `If-Match`; `force` overwrites and first leaves a `pre-overwrite` revision with the replaced draft (also when the newest revision is younger than 20 min); `saveDraft` stores `settings.siteUrl = SITE_URL` whatever was posted; stored files are canonical (`canonicalize(parsed.site)` reproduces them); autosave snapshot after 20 min (injected clock); retention 30 keeps the live `publish` revision; identical content not re-snapshotted; corrupt `draft.json` recovers from the newest revision |
| `admin/test/auth.test.mjs` | hash/verify round trip; wrong password and wrong username both take one scrypt; params upgrade re-hashes, but not over a hash the CLI wrote meanwhile; cookie tamper (payload, mac, version) rejected; idle 12 h and absolute 7 d expiry (injected clock); epoch bump invalidates; logout removes the sid; `SESSION_SECRET_PREV` accepted; with the service running, after `cli set-password` the old cookie and the old password each get 401 on the next request, and a later sliding update does not repopulate `sessions.json`; `auth.json` is not re-created from `ADMIN_INITIAL_PASSWORD` when `publish-state.json` exists |
| `admin/test/guard.test.mjs` | production config: no `x-sm-edge`, a wrong one, or a doubled pair with one wrong part → 403 `edge`; `GET /admin/api/health` passes without it; `"https://samsiani.me, https://samsiani.me"` accepted, mixed or `null` refused; missing Origin on POST → 403; missing `X-Requested-With` → 403; `Sec-Fetch-Site: cross-site` → 403; doubled `X-Requested-With`, `Sec-Fetch-Site` and `If-Match`, and `W/"<etag>"`, accepted when every part is valid; CF header used only after the edge check; IPv6 keyed by /64; 5-failure lock and 60/hour global lock; a valid device cookie logs in while the global lock is active and has its own 5-per-15-min lock; a forged device cookie counts as none; limits checked before scrypt |
| `admin/test/publish.test.mjs` | temp `SITE_HOME`: publish from the seed produces `index.html`, `ka/index.html`, `404.html`, hashed OG names; identical re-render with `--if-changed` is a no-op, and a web-root file edited by hand makes it re-apply; rollback restores previous bytes; immutable-name change aborts before any rename; forced failure in pass 2 re-applies the previous build; `SIGKILL` between swap and commit → the next boot completes the commit (`publish_recovered`) and a later `--if-changed` re-render keeps the new `index.html`; a `pending` whose files never reached the web root is reverted; an autosave that lands during a publish keeps its text and gets only the new `settings.updated`; GC keeps unknown files, `.well-known/`, fonts and anything younger than 24 h |
| `admin/test/api.test.mjs` | via `app.request()`: login → cookie attributes (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`) and the device cookie (`Path=/admin/api/auth`, `Max-Age=34560000`); 401 without cookie; `mustChangePassword` gate; draft GET/PUT with `If-Match` and 412; an imported `settings.siteUrl` of another origin is replaced by `SITE_URL`; `settings.updated` or `siteUrl` errors are `draft_rejected`; preview token serves HTML with `Content-Security-Policy: sandbox allow-scripts`; `POST /preview` works on a fresh data dir right after `cli init` (`buildId: null`); a template throw → 422 and the old token still serves; `POST /draft/checkpoint { site }` stores that document; `GET /registry` has `paletteHex` and `paletteMin`; publish 409 without acknowledgement and 400 with errors; every `/admin/*` response has `X-Robots-Tag` and `no-store` where required |
| `admin/test/og.test.mjs` | EN and KA PNGs are 1200×630 (read the IHDR bytes), deterministic for equal input, cache hit on the second call; a changed fact value changes the name |
| `admin/test/backup.test.mjs` | daily file written once per UTC day, 30 kept, never contains `auth.json`, `sessions.json` or the audit log; `backup --name=x` writes `backups/x.json.gz`; `restore-backup` rejects a revision id `../x`, an invalid published document or a truncated gzip and writes nothing; `init` restores from the newest build when `site.json` is gone but builds exist; `migrate` refuses while the health endpoint answers and `--dry-run` exits 10 with a pending migration |
| `admin/test/build-site.test.mjs` | `buildSite(seed)` returns `index.html`, `ka/index.html`, `404.html`, hashed CSS/JS and only the active layout's fonts; preview mode omits `robots.txt`, `sitemap.xml`, `.htaccess`; identical input gives a byte-identical Map; `robots.txt` contains `Disallow: /admin/` |

CI gates, all required before `release` and `deploy`: in `test`, `npm test`, the `v-html` check, the
palette gate and `check:secrets`; in `gates`, `build:admin`, `check:all` (every registered layout ×
palette, the stress fixture, Precision pixel identity), `check:stress` and `test:e2e`.

### 10.5 First deploy and cut-over (one time, in this order)

1. Tag the last static-pipeline commit `pre-admin` (the fallback, §12 R8).
2. Run T0.1–T0.8. Create `/opt/samsiani-admin/{releases,shared,logs}` and write `shared/deploy.env`
   and `shared/admin.env` (§9.2). Install `pm2-logrotate` (§9.4). Back up `vhost.conf` and, as the
   site user, `public_html`: `runuser -u "$SITE_USER" -- cp -a "$WEB_ROOT" "$SITE_HOME/public_html.bak-$(date +%F)"`.
   Add the GitHub secret `VPS_KNOWN_HOSTS`.
3. Merge the admin work to `main`. CI deploys the release; `init` seeds `data/` from
   the seed `src/content/site.json`; the service boots and creates `auth.json` from `ADMIN_INITIAL_PASSWORD`;
   step 7 of §10.3 renders the seed and swaps it into `public_html`. Check at the origin that `/`
   and `/ka/` equal the files on disk (`curl -sk --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/ | sha256sum`
   vs `sha256sum "$WEB_ROOT/index.html"`; the M1 byte-identity test predicted the bytes).
4. Apply the vhost change (§8.1), restart OLS, run T1.1 and T1.2.
5. Add the Cloudflare rules (§8.4): the Transform Rule; the bypass Cache Rule and the Configuration
   Rule as the last rules; the `/admin` exclusion on every other rule. Run both checks of §8.4.
6. Log in at `https://samsiani.me/admin/`, change the password (forced), delete
   `ADMIN_INITIAL_PASSWORD` from `admin.env`, run `pm2 startOrReload /opt/samsiani-admin/shared/ecosystem.config.cjs --update-env`,
   and confirm with the `/proc/<pid>/environ` check of §9.2 that the variable is gone from the process.
7. Publish once from the dashboard without editing anything: the result must show
   `changedFiles: 0` (idempotence check).
8. `find /opt/samsiani-admin ! -user root` prints nothing.
9. Delete the GitHub secrets `VPS_PATH` and `VPS_SITE_USER`. GitHub lets anyone with write access
   re-run a workflow run for 30 days, with today's secrets; without `VPS_PATH`, a re-run of a
   pre-M9 static run ends in its own "Deploy secrets are not set - skipping deploy" branch instead
   of rsyncing its stale `dist/` over the admin's content with `--delete`.

### 10.6 Prerequisites from the other plans (the admin starts after these)

| Prerequisite | Owner | Check before starting M1 (§13) |
|---|---|---|
| Content migrated to `src/content/site.json`, `en.mjs`/`ka.mjs`/`template.mjs` deleted, byte-identical build | data-model phase 1 | `diff -r` against the pre-refactor `dist/` is empty (data-model §11) |
| Palettes live, `defaultTheme` honoured, stress gate passes | data-model phase 2 + palettes.md §10 | `npm run check:stress` green; `node src/palettes.mjs` exits 0 |
| Studio and Ledger registered in `LAYOUTS` | layout plans, data-model phase 3 | both pass the stress gate with both fixtures |
| Per-palette hashed icons and manifest | palettes.md §7 | `buildSite` output contains no PNG without a content hash in its name |

If the owner wants the admin before Studio and Ledger exist, M1–M7 work with `LAYOUTS = { precision }`;
the picker simply lists what is registered.

### 10.7 Optional off-box backup (`.github/workflows/backup.yml`)

Weekly (`cron: '17 3 * * 1'`) and on demand: SSH in, `cat` the newest `data/backups/*.json.gz`,
encrypt on the runner with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE`
(secret `BACKUP_PASSPHRASE`), upload as an artifact with `retention-days: 90`. Encrypted
because artifacts of a public repository are readable by other signed-in users. Restore:
download, `openssl enc -d …`, `cli.mjs restore-backup --file=<path>`. CBC has no integrity check;
`restore-backup` validates the whole file before writing anything (§3.8), so a damaged or altered
file is rejected rather than half-restored.

### 10.8 Local development

```bash
cp deploy/admin.env.example .env.development      # set SESSION_SECRET=$(openssl rand -base64 48)
                                                  # set ADMIN_INITIAL_PASSWORD to a 12+ char dev password
npm install
npm run cli -- init                               # ./data from the seed src/content/site.json
npm run dev                                       # API on :3097 + Vite on :5173
open http://localhost:5173/admin/                 # SPA with hot reload; /admin/api and /admin/preview proxied
node serve.mjs                                    # serves ./dist, which the local admin's Publish writes (http://localhost:4173)
npm run preview:site                              # rebuilds ./dist from the seed instead, then serves it
```

In development `WEB_ROOT` defaults to `./dist`, so Publish in the local admin rebuilds what
`serve.mjs` serves: the full edit → preview → publish loop runs on a laptop.
`scripts/dev.mjs` spawns `npm run dev:server` and `npm run dev:web` with inherited stdio,
prefixes their lines, and forwards `SIGINT` to both. `.gitignore` gains `data/`, `.builds/`,
`admin/web/dist/`, `.env*`, `release/`, `release.tgz` (the committed examples live in
`deploy/` and do not match `.env*`).

---

## 11. Threat model

| # | Threat | Vector | Mitigation (section) | Residual |
|---|---|---|---|---|
| 1 | Password brute force | `POST /admin/api/auth/login` through Cloudflare | 5 failures / 15 min per IP, 60 / hour global, 5 / 15 min per device cookie, scrypt 64 MiB ~0.5 s, 12-char minimum, checks before hashing (§4.2, §4.4); optional CF Access or WAF rule (§8.4) | low |
| 2 | Rate-limit evasion with forged `CF-Connecting-IP` | a request that bypasses Cloudflare: the origin address is in this repository's history, and other tenants reach `127.0.0.1:3097` directly | mandatory edge check: every `/admin/*` request except health needs the `x-sm-edge` secret that only Cloudflare's Transform Rule adds (§4.5 guard 0); `CF-Connecting-IP` read only afterwards; optional OLS `accessControl` (§8.3) | very low |
| 3 | Session theft through XSS in the admin | injected content, compromised dependency | strict CSP without inline script or eval (§4.6), Vue text interpolation only, **no `v-html`** (CI step: `! grep -rn "v-html" admin/web/src`), `HttpOnly` cookie | low |
| 4 | CSRF | third-party page submits to the API | `SameSite=Strict`, required `X-Requested-With`, Origin allowlist tolerant of `"a, a"`, `Sec-Fetch-Site` (§4.5) | very low |
| 5 | Stored XSS on the public site | content fields | plain-text schema, `esc()` in every template, JSON-LD through `jsonForScript()`, hrefs limited to `https:`/`mailto:`/`tel:` with the whitespace and case tricks refused (data-model §4.3, §12.4); no raw-HTML fields | low |
| 6 | Preview document reaching the admin session | script inside the rendered preview | `sandbox="allow-scripts"` iframe + `Content-Security-Policy: sandbox` → opaque origin; 256-bit token, 15 min TTL, never logged (§6.7, §7) | very low |
| 7 | Clickjacking | admin framed elsewhere | `frame-ancestors 'none'`, `X-Frame-Options: DENY`; preview `frame-ancestors` = the site origin only | very low |
| 8 | Path traversal | preview paths, revision/build ids, static files | preview served from an in-memory map; id regexes; `safeJoin` in swap; `serveStatic` normalisation (§4.7, §5.4, §7) | very low |
| 9 | Resource exhaustion | huge bodies, preview floods, scrypt floods | 256 KB / 320 KB body limits, 20 previews max + 60/min, scrypt semaphore with queue 3, PM2 `max_memory_restart 400M` | low |
| 10 | Admin lockout as a denial of service | attacker keeps the global login lock closed (about one failed login per minute) | device cookie: a browser that logged in before skips the per-IP and global locks and has its own limit (§4.4); `pm2 restart` for a new browser (§12 R5); CF Access removes the exposure | low for known devices, medium for a new device; admin only, public site unaffected |
| 11 | Data loss or corruption | crash mid-write, crash between swap and commit, CLI and service writing together, full disk | temp + fsync + rename + dir fsync with temp cleanup on any error, mutex + lockfile, write-ahead `pending` + `reconcile()` (§5.2), hard-link swap, 30 revisions incl. `pre-overwrite`, 30 daily backups, validated restore, export (§3.5–§3.8) | low |
| 12 | Destructive edit by the owner | deleting a section, bad import | draft/live separation, autosave snapshots, restore to draft, one-click live rollback (§3.7, §5.7) | low |
| 13 | Remote code execution in the admin process | dependency or app bug | runs as the site user, never root (§4.1, §9.1); everything root sources, runs or lets PM2 open (code, env files, ecosystem, logs) lives in root-owned `/opt/samsiani-admin`, outside the site user's home; root never sources, executes, chowns, chmods or rsyncs a path under `$SITE_HOME` (§2.2), so the site user cannot plant a file root will run at the next deploy or runbook; writable paths are only `data/`, `builds/`, the web root; `DISABLED` flag keeps a suspect admin off across deploys (R6) | medium, contained to this site |
| 14 | Malicious npm release, or a moved action tag | supply chain: an install script or build tool edits files in the CI workspace; a retagged action reads the deploy key | `npm install --ignore-scripts` everywhere; Playwright only as the exact devDependency and the gates in a job that uploads nothing; the artifact is built in a clean `release` job and contains no `deploy/`; root's PM2 only evaluates the ecosystem file the deploy job writes from its own checkout, and `remote-deploy.sh` comes from the same checkout; every `uses:` pinned to a commit SHA; 4 exact-pinned runtime deps, committed lockfile, the server never runs npm, Dependabot alerts | low: a bad package can still reach code that runs as the site user (#13), never root |
| 15 | Secrets in the public repository | commits | server facts and secrets only in GitHub secrets and root-600 files (§9.2); `.env*` ignored; this plan uses variables only | low |
| 16 | Secrets in logs | request logging | bodies, cookies, passwords and tokens never logged; preview token masked (§4.7, §7) | low |
| 17 | Session fixation, replay after logout | stolen or planted cookie | new `sid` per login, server-side allowlist, epoch bump on password change (§4.3) | low |
| 18 | Username/password timing oracle | response timing | hashed constant-time compare, dummy scrypt for unknown users (§4.2) | very low |
| 19 | Stale or wrong content at the CDN | Cloudflare caching, including a zone-wide rule placed after the admin bypass | every regenerated asset content-hashed, immutable-name guard (§5.4), `no-store` + bypass and configuration rules **last** with `/admin` excluded from every other rule, checked after each rule change (§8.4, R11), optional purge (§5.8) | low |
| 20 | Admin indexed by search engines | crawlers | `X-Robots-Tag: noindex`, `Disallow: /admin/` (§8.2) | very low |
| 21 | Cloudflare rewriting admin JS | Rocket Loader, Email Obfuscation | Configuration Rule turns both off for `/admin*` (§8.4) | low |
| 22 | Panel regenerates `vhost.conf` | CyberPanel action | admin goes offline only; deploy probe warns; snippet kept in `deploy/` (§8.1) | low |
| 23 | Broken release | bad commit | CI gates, health check with automatic revert before any public re-render, `--if-changed` (§10.3) | low |
| 24 | Deploy connection intercepted | `ssh-keyscan` trust on first use | `VPS_KNOWN_HOSTS` required, `StrictHostKeyChecking=yes` (§10.2) | low |
| 25 | Admin compromise pivoting into CI | a repository token on the server | the server holds no GitHub credential at all; content is written locally (§3.2) | none by design |
| 26 | Old static pipeline overwrites the admin's content | re-run of a pre-M9 workflow run (possible for 30 days, with today's secrets) | `VPS_PATH` and `VPS_SITE_USER` deleted at the cut-over, so those runs skip their deploy (§10.5 step 9) | very low |

---

## 12. Runbooks

All server commands run as root. Load the server facts first:
`set -a; . /opt/samsiani-admin/shared/deploy.env; set +a` (a root-owned file; never source anything
under `$SITE_HOME`). `ECO` means `/opt/samsiani-admin/shared/ecosystem.config.cjs`. `CLI` means
`runuser -u "$SITE_USER" -- env NODE_ENV=production SITE_HOME="$SITE_HOME" WEB_ROOT="$WEB_ROOT" PORT="$PORT" "$NODE_BIN" /opt/samsiani-admin/current/admin/server/cli.mjs`.
Every command that writes under `$SITE_HOME` goes through `CLI` or `runuser -u "$SITE_USER"` (§2.2).

**R1 · Wrong content went live.** Admin → Revisions → Live builds → "Roll back to this build"
(under 1 s). Without the admin: `CLI builds`, then `CLI rollback --to=<buildId>` (default: the
previous build). Fix the draft, publish again.

**R2 · A deploy broke the admin app.** The deploy reverts itself when the health check fails.
To roll back by hand:
```bash
cd /opt/samsiani-admin && ls -1dt releases/*/          # pick the previous good sha
ln -sfn "releases/<sha>" current.tmp && mv -Tf current.tmp current
pm2 startOrReload "$ECO" --update-env && pm2 save
```
Or re-run the last good run of the **"test, build & deploy"** workflow in GitHub Actions (its
artifact lives 7 days; never re-run a run of the old "build & deploy" workflow), or revert the
commit on `main`.

**R3 · A deploy broke the public pages (templates), admin healthy.** First roll the app back
(R2), then `CLI publish --source=published --reason=cli` to re-render with the old templates, or
`CLI rollback` to re-apply the previous build. Rolling back only the build is not enough: the next
deploy would re-render with the broken templates.

**R4 · Admin down or misbehaving.** The public site keeps serving. `pm2 logs samsiani-admin --err --lines 200`.
To take it offline and keep it offline across deploys: `touch /opt/samsiani-admin/shared/DISABLED && pm2 stop samsiani-admin`
(OLS then answers 503 on `/admin/`; a deploy installs new releases but does not start them). To
re-enable: `rm /opt/samsiani-admin/shared/DISABLED` and re-run the deploy. To remove the path
entirely, delete the `context /admin/` block and the rewrite rule, restart OLS.

**R5 · Lost password or locked out.** `CLI set-password` (prompts twice without echo; or
`NEW_ADMIN_PASSWORD` in the environment for non-interactive use) → `epoch + 1`, all sessions
revoked, `mustChangePassword: false`, `auth.json` created if missing; then `pm2 restart samsiani-admin`
(the service already reads the new files on the next request; the restart also clears the
in-memory rate limits). Rate-limit lock only: a browser that logged in before (device cookie) can
still log in; from a new browser, `pm2 restart samsiani-admin` clears it.

**R6 · Suspected compromise.**
1. `touch /opt/samsiani-admin/shared/DISABLED && pm2 stop samsiani-admin` (a push to `main` will not restart it).
2. New `SESSION_SECRET` (every cookie and device cookie dies) and new `EDGE_SECRET` (Cloudflare rule
   first, then `admin.env`, §8.4) in `admin.env`; `CLI set-password`.
3. Read `data/audit.log`, the PM2 logs in `/opt/samsiani-admin/logs/`, and the OLS access log for `/admin/`.
4. `CLI verify --web-root` lists web-root files whose sha256 differs from the current build
   manifest and files no manifest knows; investigate each.
5. Restore content from a revision or backup (`CLI restore-backup --date=… --part=published`).
6. Check `find /opt/samsiani-admin ! -user root` prints nothing (the code, env and ecosystem are
   root-owned; a change there means root was compromised, which is outside this plan). Remove
   `DISABLED` and redeploy from CI.
7. Enable Cloudflare Access for `/admin*` (§8.4).

**R7 · Corrupt data file.** `draft.json` recovers from the newest revision automatically.
`site.json`: `CLI restore-backup --date=<last good> --part=published`, or rebuild it from
`builds/<current>/.site.json` with `CLI restore-build --from=<buildId>`, then
`CLI publish --source=published`.

**R8 · Give up the admin, return to the static pipeline.** The static workflow deploys only from
`refs/heads/main` (its deploy step has `if: github.ref == 'refs/heads/main'`), so a
`workflow_dispatch` on the tag would build and silently skip the deploy, and it would ship the tag's
stale `src/content/site.json`. Instead:
1. Account → Export live (the envelope `samsiani-site-published-r<N>-<date>.json`).
2. `git switch -c static-fallback pre-admin` (the tag sits at or after M1, whose `build.mjs` reads `src/content/site.json`; M1–M4 ship through the static pipeline).
3. `jq .site <export>.json > src/content/site.json`; `node build.mjs` must pass.
4. Re-create the GitHub secrets `VPS_PATH` and `VPS_SITE_USER`.
5. Push the branch to `main` with `git push --force-with-lease origin static-fallback:main`; the
   static workflow builds and deploys it.
6. Then `pm2 delete samsiani-admin && pm2 save`, remove the vhost block and rewrite rule, restart
   OLS, delete the Cloudflare rules (Transform, Cache, Configuration). `data/` stays on disk for later.

**R9 · Rotate secrets.** Session secret: move the current value to `SESSION_SECRET_PREV`, set a
new `SESSION_SECRET`, `pm2 startOrReload "$ECO" --update-env`; after 7 days delete
`SESSION_SECRET_PREV`, reload again, and check that
`tr '\0' '\n' < /proc/$(pm2 pid samsiani-admin)/environ | grep -E '^(ADMIN_INITIAL_PASSWORD|SESSION_SECRET_PREV)=.'`
prints nothing (the ecosystem sets removed optional keys to `''`, §9.1). Edge secret: §8.4.
Deploy key: add the new public key to the server, update `VPS_SSH_KEY`, remove the old key.

**R10 · New or rebuilt server.** Re-create `/opt/samsiani-admin/shared/*.env` (T0 again), restore
`data/` from the newest backup as the site user (`CLI restore-backup --file=…`), run the deploy,
apply §8.1 and §8.4.

**R11 · After any Cloudflare rule change.** Run the two checks of §8.4: `GET /admin/api/draft`
twice without a cookie → 401 both times and never `cf-cache-status: HIT`; `/admin/api/session`
without the edge header (origin and loopback) → 403, through Cloudflare → 200.

---

## 13. Build order and acceptance criteria

| Milestone | Deliverables | Done when |
|---|---|---|
| M1 Build seam and OG | `src/build-site.mjs`, `build.mjs` reduced to a wrapper, `src/shared/og.mjs`, `src/og/render.mjs` + fonts, `robotsTxt` `Disallow: /admin/`, `admin/shared/{draft-rules,diff}.mjs` | §10.6 prerequisites met; for every layout × palette the wrapper's output equals the phase-3 build byte for byte, except the one robots line and the new OG names; EN and KA OG PNGs are 1200×630 and deterministic; draft-rules tests green |
| M2 Storage and CLI | `lib/{fsx,lock,store,backup,audit}.mjs`, `cli.mjs` (`init, verify, export, import, backup, restore-backup, restore-build, set-password, builds`) | fsx/lock/store tests green; `npm run cli -- init` creates `./data` with the §2.2 modes |
| M3 Auth and guards | `lib/{auth,guard,headers}.mjs`, auth/session/account routes | auth/guard tests green; cookie attributes exact; doubled Origin accepted, mixed refused |
| M4 Draft, registry, preview | draft/registry/validate/preview routes, `lib/preview.mjs` | api tests green; preview HTML carries the sandbox CSP; both languages render in < 100 ms locally |
| M5 Publish | `lib/{publish,swap,cloudflare}.mjs`, OG cache, the §5.2 date rule, rollback, GC, `CLI publish/rollback` | publish tests green; cold publish < 3 s locally; a no-change publish reports `changedFiles: 0`; with `autoUpdateDateOnPublish: true` a palette-only publish keeps the date and a text edit sets today (Asia/Tbilisi) |
| M6 Admin SPA | all §6 screens and components | the manual checklist below passes, keyboard only, in Chrome and Safari, light and dark |
| M7 Operations | `deploy/*`, new `deploy.yml`, README "Admin" section | CI green on a PR; §10.5 cut-over done; T1.1, T1.2 pass; `cf-cache-status` never `HIT` for `/admin` |
| M8 Optional hardening (owner decides) | OLS `accessControl`, CF Access / WAF rule, backup workflow (`pm2-logrotate` and the edge check are required at the cut-over) | each item's own test in §8 or §10.7 |

Acceptance checklist for the whole feature:

1. `pm2 stop samsiani-admin` → `https://samsiani.me/` and `/ka/` still return 200, and the origin bytes
   (`curl -sk --resolve samsiani.me:443:127.0.0.1`, or `sha256sum` of the web-root files) are unchanged.
2. Typing in the Georgian tagline updates the preview within 1 s of the last keystroke, before
   any save. After Publish, `curl -s https://samsiani.me/ka/` contains the new text within 5 s.
   The `og:image` URL changes only when something on the card changes: monogram, eyebrow, name,
   role, subrole, facts, host, the palette's dark accent colours, or a layout with its own card.
3. Each of the 3 layouts × 6 palettes × 2 languages × 2 themes shows in the preview; publishing a
   layout change makes it live; "Roll back" restores the previous layout in under 1 s.
4. Two tabs: the second save shows the conflict dialog; after either choice, both versions can be
   recovered from Revisions (`pre-overwrite`, or the checkpoint of the local copy).
5. `kill -9` of the service during continuous typing: `data/draft.json` parses and holds either
   the old or the new revision, never a mix.
6. Six wrong passwords from one address → 429 with `Retry-After`; the right password is also
   refused until the lock expires, except from a browser with a valid device cookie, which can
   still log in while the global lock is active; `pm2 restart` clears the locks. A request that
   bypasses Cloudflare (origin or `127.0.0.1:3097`) gets 403 `edge`.
7. A POST to `/admin/api/draft` without `X-Requested-With`, or from another origin, or with
   `Origin: https://samsiani.me, https://evil.example` → 403. With
   `Origin: https://samsiani.me, https://samsiani.me` → accepted.
8. `curl -sI https://samsiani.me/admin/` shows `x-robots-tag: noindex, nofollow, noarchive`,
   `cache-control: no-store`, the CSP, `x-frame-options: DENY`; `robots.txt` has `Disallow: /admin/`.
9. The session cookie is `__Secure-sm_admin; HttpOnly; Secure; SameSite=Strict; Path=/admin`;
   idle 12 h and absolute 7 d expiry are proven by tests with an injected clock.
10. `ps -o user= -p "$(pm2 pid samsiani-admin)"` prints the site user; web-root files belong to
    the site user; `data/` is `700`, its files `600`; `find /opt/samsiani-admin ! -user root`
    prints nothing; no deploy step or runbook runs a root command that writes under `$SITE_HOME`.
11. `git grep` finds no server IP, SSH user, unix user name or site-home path in tracked files.
12. A deploy of a release that cannot boot fails the health check, reverts `current` (restoring
    the pre-migrate backup when it migrated), and leaves the public site untouched. With
    `shared/DISABLED` present a deploy installs the release and starts nothing.
13. Admin accessibility: a keyboard-only run (log in → change a skill level → move a list item →
    publish) with a visible focus ring throughout; all admin text >= 4.5:1; `prefers-reduced-motion`
    removes transitions; no `text-transform: uppercase` reaches Georgian text.
14. Every file that can change between publishes either has a content-hashed name or is served
    uncached (HTML, XML, TXT); the immutable-name guard test passes.
