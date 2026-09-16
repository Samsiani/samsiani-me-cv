# Fonts — build plan (Google Fonts and custom uploads)

| | |
|---|---|
| Owner request | "also add option to choose different google fonts or upload and use custom." |
| Status | Plan, ready to build. Written 2026-09-15 against `main` at `a4d7b57`. |
| Builds on | [admin-layouts-palettes.md](admin-layouts-palettes.md) §5 (rendering), §8 (admin), §8.8 (brand images); [admin-ops.md](admin-ops.md) §3–§7 (store, API, publish, preview); [data-model.md](data-model.md) §3.1, §4 (settings, validation); [palettes.md](palettes.md) (the precedent this plan copies: an admin setting → a generated CSS block appended to the layout CSS → one hashed file). |
| Rules kept | Public-repository rule (no server facts). Never uppercase Georgian. Every regenerated public asset carries a content hash. No new native code. Tests never touch the network. |

---

## 0. Summary and scope

The owner picks, per layout, the **text** face (headings and body), the **label** face (eyebrows, indices, small labels on `/`) and the **Georgian** face (every Mkhedruli glyph, on both pages), from the full Google Fonts catalogue or from uploaded files. The server downloads (Google) or validates (uploads) the files once, stores them content-addressed under `data/fonts/`, and `buildSite()` ships only the chosen faces under hashed names with a generated `@font-face` + variable-override block appended after the layout CSS, exactly as the palette block is. Visitors never talk to Google; the owner's browser never talks to Google either (the admin server does, on the owner's action). Georgian text is guaranteed a Georgian-capable face by construction (§5.2). Nav-fit and the Studio fit rules read real advance widths from the font files instead of the measured constants (§5.4). With no override the output is byte-identical to today (§7.1 golden test).

**Out of scope (later, if ever):** a separate display/heading face (the layouts use one sans for both; see D2); italic faces (no layout uses italics); subsetting uploaded fonts; `latin-ext`/other Google subsets for the text and label roles (the site ships `latin` only today; `→` keeps falling back to the system font as it does now); a visitor-facing font switcher; fonts in the admin UI itself (it keeps system-ui + Noto); OpenType feature controls (`font-feature-settings`); colour/bitmap/SVG fonts (rejected at upload); automatic re-fetch when Google updates a family (the owner re-selects it); replacing the three layouts' default files (they stay committed in `src/fonts/`).

---

## 1. Research findings (2026-09-15)

**1.1 Listing Google Fonts without an API key.** `GET https://fonts.google.com/metadata/fonts` returns JSON (2,700,467 bytes, `Cache-Control: no-store`; the historical `)]}'` anti-JSON prefix is absent today but the parser must strip it if present). Shape: `{ axisRegistry: [...], familyMetadataList: [...1946 families], promotedScript }`. Per family: `family, displayName, category` (Sans Serif · Serif · Display · Handwriting · Monospace), `subsets[]`, `fonts { "100": {…}, "400i": {…} }` (static weights/styles), `axes[] { tag, min, max, defaultValue }` (558 variable families), `popularity, trending, lastModified, dateAdded, isNoto, isBrandFont, isOpenSource, languages[]`. Every family has `isOpenSource: true` (`isBrandFont` marks Google/Noto/Roboto brands, not licensing). **Families with a `georgian` subset: 3** — `Noto Sans Georgian` (wdth 62.5–100, wght 100–900), `Noto Serif Georgian` (same axes), `Google Sans` (wght 400–700 + GRAD/opsz). 1,825 families have `latin`. The endpoint is undocumented but has been stable for years; the plan treats it as "best effort with a cached copy" (§4.2). Trimmed to what the picker needs (family, category, weights, italic flag, axis tags, latin/georgian flags, popularity, lastModified) it is 255,667 bytes, 27 KB gzipped.

**1.2 Downloading self-hostable files: the css2 API** (`https://fonts.googleapis.com/css2?family=<F>:wght@400;600&display=swap`).
- With a modern browser `User-Agent`: one `@font-face` per **subset** with `format('woff2')`, its `unicode-range`, and `font-weight: 100 900` + `font-stretch` for variable families (the same full-range file is returned for any range or single weight of a variable family; verified: Noto Sans Georgian `wght@100..900` → `PlIVFke5…cGyUkcrrR3Zgdw.woff2`, 41,456 bytes, the file already in `src/fonts/`). Static families give one block per weight and subset (IBM Plex Mono `400;500` → two `/* latin */` blocks). The `georgian` block's range is `U+0589, U+10A0-10FF, U+1C90-1CBA, U+1CBD-1CBF, U+205A, U+2D00-2D2F, U+2E31`, the same the layouts declare.
- With **no** `User-Agent`: `format('truetype')` **static** instances, one per requested weight, unsubsetted, no `fvar` (Inter 400: 324,820 bytes) — exactly what satori needs (M7 already uses this).
- Errors: unknown family → HTTP 400; a weight a static family lacks (`IBM+Plex+Mono:wght@450`) → HTTP 400 with an HTML body; a variable family accepts any weight inside its axis. So weights are snapped to the catalogue's list before the request.
- Files come from `https://fonts.gstatic.com/s/<family>/v<N>/<hash>.woff2` with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=31536000`; the `v<N>` segment is the family version. css2 responses are `Cache-Control: private, max-age=86400`.
- Licensing: every catalogue family is SIL OFL 1.1, Apache 2.0 or UFL, all of which permit self-hosting; OFL asks that the licence text stays with the font. The metadata carries no licence field; the per-family licence page is `https://fonts.google.com/specimen/<Family>/license`. The plan stores the licence family (`OFL-1.1` for `ofl/` families is the norm; the record keeps the specimen URL) and the admin links to it.

**1.3 Font parsing in pure JS.** `fontkit 2.0.4` (MIT, 5.6 MB unpacked, 9 dependencies incl. a JS Brotli); `opentype.js 2.0.0` (MIT, 3.6 MB, no WOFF2); `@shuding/opentype.js 1.4.0-beta.0` (already in the tree as satori's dependency; TTF/OTF/WOFF only); `lib-font 3.0.4` (licence file unclear, Brotli via external WASM); `wawoff2 2.0.1` / `woff2-encoder 2.0.0` (Emscripten builds of Google's woff2, ~1.3 MB). **Decision: an own reader, zero dependencies** (`src/typography/sfnt.mjs`, ~300 lines; `node:zlib` provides Brotli for WOFF2 and inflate for WOFF). It reads only the tables this plan needs — `cmap` (formats 4 and 12), `head`, `hhea`, `hmtx`, `maxp`, `name`, `OS/2`, `fvar` — none of which WOFF2 transforms (WOFF2 transforms `glyf`/`loca` by default and may transform `hmtx`; a transformed `hmtx` still carries every advance width). A prototype of this reader was run against the seven fonts in the repository: it parsed all four WOFF2 files (Google's, `glyf`/`loca` transformed, `hmtx` not) and all three TTFs; the Noto Sans Georgian WOFF2 and TTF agree on Mkhedruli coverage (33/33) and mean advance (0.659 em); Chivo WOFF2 (variable, default instance 500) gives 0.598 em, the SemiBold TTF 0.603 em. The WOFF2 uncompressed stream has no padding between tables (verified by slicing at `transformLength`). The same module gets a **null-transform WOFF2 encoder** (~60 lines: header, table directory with `glyf`/`loca` transform version 3, Brotli of the concatenated tables via `node:zlib`, quality 11) so TTF/OTF/WOFF uploads ship as WOFF2 (D5).

**1.4 satori 0.33.4** parses TTF, OTF and WOFF through its bundled `@shuding/opentype.js`; **no WOFF2, no variable axes** (a variable font renders at its default instance). Fonts are passed as `{ name, data, weight, style }`; the family name is only a selector inside satori and never reaches the PNG, so the role aliases of D11 work there too.

---

## 2. Decisions for the owner

| # | Decision | Recommended | Why | Alternatives |
|---|---|---|---|---|
| D1 | Where font files are served from | **Self-hosted**, downloaded once by the admin server, shipped like the current files under hashed names. | The public site keeps its CSP-free, tracker-free, one-origin profile; Cloudflare caches the files; a Google outage never touches visitors. | (a) `<link>` to `fonts.googleapis.com`: a third-party request per visitor, and uploads would still need hosting. (b) Proxy Google through the admin origin: a runtime dependency on the Node service for the public site (violates D1 of the master plan). |
| D2 | Font roles | **Three per layout: `text`, `label`, `georgian`**, mapped onto the variables each layout already has (§5.1). | Every layout sets one sans for headings and body and one mono/label face; the Georgian face is a separate stack entry in all three. No layout CSS changes, so defaults stay byte-identical. | (a) `text` + `georgian` only: no way to change the mono labels. (b) A fourth `display` role for headings: needs per-layout selector lists in an appended block and a second scale of size fixes; deferred. |
| D3 | Override scope | **Per layout** (`settings.fonts.<layoutId>`), each layout resets independently; the dashboard edits the fonts of the selected layout. | Studio depends on Archivo's width axis and Ledger on Plex weights 300–500; a global set would suit at most one layout. Changing layout never changes fonts, like the palette rule. | One global set applied to every layout; "copy this layout's fonts to the others" button (can be added later). |
| D4 | Catalogue | **The full catalogue** (metadata endpoint, cached on the server for 24 h, served trimmed to the SPA) with filters: search, category, "Supports Georgian", "Variable weight", sorted by popularity. | Curated lists go stale and the request says "different google fonts". The georgian role filters itself to the three Georgian families plus Georgian-capable uploads. | A curated list of 30 families in the repository (no network, but stale and arbitrary). |
| D5 | Upload formats | **Accept WOFF2, WOFF, TTF, OTF, ≤ 2 MB each**; validate by magic bytes and a full parse of the tables in §1.3; ship WOFF2 as-is and **re-wrap WOFF/TTF/OTF into WOFF2** with the null-transform encoder. Keep the original TTF/OTF/WOFF bytes for satori (D8). | Owners get fonts as .ttf/.otf from designers; raw TTF is 2–3× the WOFF2 size on a Lighthouse-tuned site. The encoder is ~60 lines and is round-trip tested through the reader and loaded by Playwright in CI. | (a) Serve uploads as uploaded (bigger pages). (b) WOFF2 only (owner must convert). |
| D6 | Georgian guarantee | **The `georgian` role is mandatory and Georgian-only**: it accepts only fonts whose `cmap` covers all 33 Mkhedruli letters U+10D0–U+10F0, its `@font-face` is fenced to the Georgian `unicode-range`, it is first in every stack on `/ka/` and second on `/`, and the text/label faces are fenced to non-Georgian ranges. Publish refuses `FONT_NO_GEORGIAN`. | A Latin-only text font can never swallow Georgian text, and a Georgian font never renders Latin words inside Georgian text. Same mechanism the layouts use today, now enforced by data instead of hand-written CSS. | Trust the owner; or always append Noto Sans Georgian as a fixed fallback (then the georgian role could not be changed at all). |
| D7 | Width estimates (nav-fit, Studio name/fact fit) | **Real advance widths from the chosen files** (`hmtx` + `cmap`, default instance) with a weight factor and headroom (Latin +6 %, Georgian +12 %), used only when a layout's fonts are overridden; the existing constant estimators stay for the default fonts. Emitted as the existing tier classes plus two CSS variables in the fonts block (§5.4). | The constants were measured for Chivo/Archivo/Plex/Noto and are wrong for any other face; the estimates must adapt without touching `main.js`, which never changes. Keeping the constant path for defaults keeps the bytes identical. | (a) Keep the constants and warn (nav can wrap). (b) Measure at runtime in JS (changes `main.js`, flashes). |
| D8 | Social cards | **Cards use the chosen `text`, `label` and `georgian` faces when a satori-readable file exists** (Google: the no-UA static TTFs, fetched at selection; uploads: the original TTF/OTF/WOFF), else the default face for that role with warning `FONT_OG_DEFAULT`. Last milestone (F8); everything else works without it. | A card in Chivo under a site set in Inter looks wrong. Static TTFs cost ~0.3–1 MB per Google family on the server, nothing for visitors. | Cards always in the built-in fonts (simplest; the card is then a fixed brand asset). |
| D9 | Limits | Per family ≤ 8 files, ≤ 2 MB per file, ≤ 6 MB per family; store ≤ 200 MB (upload/fetch refused beyond, 507). Google text/label roles ship the `latin` subset only, the georgian role the `georgian` subset only; uploads ship whole. Warnings: `FONT_HEAVY` above 400 KB of fonts on `/ka/` (today 108–164 KB), `FONT_WIDE` when a role's mean advance is ≥ 12 % above the layout default's. | Bounds the disk and the page weight; warnings, not blocks, because the owner sees the preview. | Hard caps on page weight (would block legitimate choices). |
| D10 | Schema | **`settings.fonts` is an optional key; `schemaVersion` stays 1; no migration.** | The walker already allows absent optional keys and `canonicalize()` omits them, so every existing document, the seed, the stress fixture and every revision remain valid and byte-identical; `cli migrate --dry-run` keeps exiting 0. A v2 bump would force a migration of 30 revisions for a key with a natural absent-means-default meaning. | `schemaVersion: 2` + `migrate_v1_to_v2` adding `fonts: {}` (changes every stored document's ETag and the seed). |
| D11 | Family names in CSS | **Never.** The generated CSS names faces by role alias (`sm-text`, `sm-label`, `sm-georgian`); a font's own name appears only in the admin (Vue text interpolation) and in `data/fonts/index.json`. | CSS injection through a family name is impossible by construction; no sanitiser to get wrong. | Sanitise names to `[A-Za-z0-9 _-]{1,64}` and quote them. |

---

## 3. Data model

### 3.1 `site.json`

```jsonc
"settings": {
  "layout": "precision", "palette": "cobalt", "defaultTheme": "system", "updated": "2026-06-07",
  "autoUpdateDateOnPublish": false, "siteUrl": "https://samsiani.me",
  "fonts": {                                   // OPTIONAL; absent = every layout uses its defaults (today's output)
    "precision": { "text": "3f2a1b9c0d4e5f60", "label": null, "georgian": null },   // role -> font id | null (= layout default)
    "studio":    { "text": null, "label": null, "georgian": "7c1d2e3f4a5b6c7d" }
    // "ledger" absent = defaults
  }
}
```

Validation (`src/schema/validate.mjs`): `fonts: { t: 'obj', shape: Object.fromEntries(layoutIds.map((id) => [id, { t: 'obj', shape: Object.fromEntries(FONT_ROLES.map((r) => [r, S(16, { pattern: FONT_ID_RE, nullable: true })])), optional: true }])), optional: true }` with `FONT_ROLES = ['text', 'label', 'georgian']` and `FONT_ID_RE = /^[0-9a-f]{16}$/` exported by `src/typography/roles.mjs` (pure, browser-safe; `validate.mjs` imports it like `localize.mjs`). Unknown layout or role keys → `UNKNOWN_KEY`; a malformed id → `PATTERN`; both are under `$.settings.` and therefore draft-blocking (the SPA only writes ids the server returned). Whether an id exists in the store is a **server** check (§4.5), never the pure validator's. `limitsTable()` must skip `settings.fonts.*` (the rows are for character counters; add `counter: false` to the spec and filter on it). `buildSchema()` output changes only by this optional key; `GET /registry` `schema` carries it.

Golden rule (tested, §7.1): `canonicalize(seed)` and every rendered byte are unchanged for a document without `fonts`, and for a document whose `fonts` roles are all `null`.

### 3.2 The font store (`$SITE_HOME/data/fonts/`, owner `$SITE_USER`, 700)

```
data/fonts/index.json                 { "v": 1, "fonts": { "<id>": FontRecord } }   atomic write, 600
data/fonts/files/<sha256 hex>.<woff2|ttf|otf|woff>   content-addressed bytes, 600
```

```jsonc
// FontRecord
{ "id": "3f2a1b9c0d4e5f60",                       // 16 hex: sha256 of "google\0<family>\0<version>" or of the uploaded bytes
  "source": "google",                             // google | upload
  "family": "Inter", "displayName": "Inter",      // upload: name table ID 16/1, editable display name ≤ 60 chars (admin only)
  "category": "Sans Serif",                       // catalogue category; upload: "Sans Serif" | "Serif" | "Monospace" from OS/2 panose/isFixedPitch, else "Other"
  "version": "v20",                               // google only, from the gstatic path
  "licence": { "kind": "google", "url": "https://fonts.google.com/specimen/Inter/license" }   // upload: { "kind": "attested", "note": "…≤ 200" }
  "addedAt": "2026-09-15T10:00:00.000Z",
  "coverage": { "latin": true, "georgian": false },          // all of a–z A–Z 0–9 / all 33 Mkhedruli letters
  "variable": true, "axes": { "wght": [100, 900] },          // fvar of the web faces; static: false, {}
  "weights": [100, 200, 300, 400, 500, 600, 700, 800, 900],  // static instances available (catalogue) or the file's weightClass
  "metrics": { "unitsPerEm": 2816, "ascender": 2728, "descender": -680, "xHeight": 1536, "capHeight": 2048,
               "latin": { "mean": 0.553, "adv": { "a": 0.552, "b": 0.617, "…": 0 } },   // em units, default instance, 95 printable ASCII
               "georgian": null },                                                     // or { mean, adv: { "ა": …, all 33 + U+0589 } }
  "faces": [                                     // what ships and what satori gets
    { "kind": "web",    "subset": "latin",    "weight": [100, 900], "style": "normal", "file": "<sha>.woff2", "bytes": 21832,
      "unicodeRange": "U+0000-00FF, U+0131, …" },             // google: the css2 range; upload: computed from cmap minus Georgian blocks
    { "kind": "web",    "subset": "georgian", "weight": [100, 900], "style": "normal", "file": "<sha>.woff2", "bytes": 41456, "unicodeRange": "U+0589, U+10A0-10FF, …" },
    { "kind": "satori", "weight": 400, "style": "normal", "file": "<sha>.ttf", "bytes": 324820 },   // google no-UA statics; upload: the original TTF/OTF/WOFF
    { "kind": "satori", "weight": 600, "style": "normal", "file": "<sha>.ttf", "bytes": 325104 }
  ],
  "origin": { "css2": "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" }   // upload: { "filename": "Inter-Variable.ttf" (sanitised, ≤ 80) }
}
```

Uploads that contain both Latin and Georgian get two `web` faces from the **same** file: one fenced to the non-Georgian ranges, one to the Georgian ranges (§5.2), so a single corporate font can serve `text` and `georgian`. A static upload is one face at its `OS/2` weight; the layout's other weights are then synthesised by the browser (`FONT_WEIGHTS` warning names the missing ones).

### 3.3 Published names and immutability

Every shipped face is `fonts/<slug>.<sha256-8>.woff2`, slug = `<family slug>-<subset>-<style>-<weight or min-max>` (e.g. `fonts/inter-latin-normal-100-900.3f2a1b9c.woff2`), `immutable: true`. The default files keep their descriptive fixed names. GC (`swap.mjs`) extends `HASHED` with `^[a-z0-9-]+\.[0-9a-f]{8}\.woff2$` inside `fonts/`: hashed font files absent from the last three manifests and older than 24 h are deleted; the fixed-name defaults never match. The immutable guard, the verify step ("every CSS `url()` resolves") and the hard-link swap need no change. Build manifests gain `"fonts": { "<role>": "<id>|default" }` next to `layout`/`palette` (shown in Revisions and `cli builds`).

---

## 4. Server

### 4.1 Modules

| File | Role |
|---|---|
| `src/typography/roles.mjs` (pure) | `FONT_ROLES`, `FONT_ID_RE`, `ALIASES = { text: 'sm-text', label: 'sm-label', georgian: 'sm-georgian' }`, `GEORGIAN_RANGE` (the css2 georgian range), `LATIN_RANGE` (the css2 latin range, as in every `fonts.css`), `subtractGeorgian(ranges)` |
| `src/typography/sfnt.mjs` (node) | `parseFont(buf) → { flavor: 'ttf'\|'otf'\|'woff'\|'woff2', tables: Map, names: { family, subfamily, full }, weightClass, italic, fixedPitch, unitsPerEm, ascender, descender, xHeight, capHeight, fvar: { axes } \| null, cmap: Map<codepoint, glyph>, advance(glyph) }`; throws `FontParseError(reason)` on any structural problem (bad magic, table outside the file, missing `cmap`/`head`/`hhea`/`hmtx`/`maxp`/`name`/`OS/2`, no `glyf` and no `CFF `/`CFF2`, `numGlyphs > 65535`, Brotli output larger than `totalSfntSize`, more than 64 tables). WOFF2 reads only untransformed tables and `hmtx` (transformed or not) and never reconstructs `glyf`. `metricsOf(font) → FontRecord.metrics`, `coverageOf(font)`, `rangesOf(font, { excludeGeorgian })` (collapsed `U+xxxx-yyyy` list, ≤ 64 entries, else the whole BMP/SMP spans it touches) |
| `src/typography/woff2.mjs` (node) | `unwrapWoff2(buf) → { flavor, tables: [{ tag, data, transformed }] }` (used by `sfnt.mjs`: 48-byte header, table directory with the 63 known-tag codes and `UIntBase128` lengths, one `brotliDecompressSync` with `maxOutputLength = totalSfntSize`, tables sliced at `transformLength` without padding); `wrapWoff2(sfntBuf) → Buffer` (null transforms: directory flags `0xC0 \| tagIndex` for `glyf`/`loca` (transform version 3) and `tagIndex` for the rest, no `transformLength` fields; data = `brotliCompressSync(concat(tables), { quality: 11, mode: BROTLI_MODE_FONT })`; header `flavor` copied, `numTables`, `totalSfntSize` = 12 + 16·n + Σ pad4(length), `totalCompressedSize`, `majorVersion 1`, `metaOffset/Length/OrigLength 0`, `privOffset/Length 0`). Reference: https://www.w3.org/TR/WOFF2/ §4–§5; the reader must accept its own output |
| `src/typography/resolve.mjs` (node) | `resolveFonts(site, layoutMeta, loader) → ResolvedFonts` (§5.1); `defaultFonts(layoutMeta)` |
| `src/typography/measure.mjs` (pure) | `widthOf(metrics, text, { px, weight = 400, letterSpacingEm = 0, script })` → px, using per-character advances, the mean for unknown characters, the weight factor `1 + 0.035 × (weight − 400) / 100` (clamped 0.9–1.2), and the headroom of D7 |
| `admin/server/lib/fonts/store.mjs` | `createFontStore({ dataDir, clock, audit })`: `list()`, `get(id)`, `has(id)`, `readFace(record, face) → Buffer`, `add(record, files: Map<sha, Buffer>)` (atomic: files first, then `index.json`), `remove(id)`, `usage(docs)` → ids referenced by the draft, the live document and kept builds, `bytes()`; all writes under the existing `write` lock (`store.lock('write', …)`), lock order unchanged (`publish` → `write`) |
| `admin/server/lib/fonts/google.mjs` | `createGoogle({ dataDir, fetchImpl, clock })`: `catalogue({ refresh })` (§4.2), `fetchFamily(family, { weights, subsets, satoriWeights })` (§4.3); every network call through the injected `fetchImpl` |
| `admin/server/lib/fonts/upload.mjs` | `inspectUpload(buf, { filename }) → { record, files }` (§4.4) |
| `admin/server/lib/fonts/check.mjs` | `fontIssues(site, fontStore, { layoutIds, activeOnly }) → { errors, warnings }` (§4.5) and `fontReport(site, fontStore)` (§4.6) |
| `admin/server/routes/fonts.mjs` | the routes of §4.7 |
| `test/fixtures/google-fonts/` | `index.json` mapping catalogue, css2 texts and gstatic URLs to files already in the repository (§7.3) |

### 4.2 Catalogue cache

`data/fonts/catalogue.json` = `{ fetchedAt, etag: null, families: [trimmed] }`. `catalogue()` returns the cached copy when younger than 24 h; otherwise it fetches the metadata endpoint (`AbortSignal.timeout(15000)`, response capped at 8 MB, strip a leading `)]}'`, parse, keep `isOpenSource !== false` families, trim to `{ family, category, weights: [ints], italic: bool, axes: ['wght','wdth'], latin: bool, georgian: bool, popularity, lastModified }`, sort by `popularity`) and writes the cache atomically. On any failure the stale cache is returned with `stale: true` (and a retry is not attempted for 10 min); with no cache at all the route answers 503 `google_unavailable`. `?refresh=1` forces a fetch (rate: 1 per 10 min per process). Nothing is committed to the repository: the seed content has no fonts and the picker is empty offline.

### 4.3 Google download flow (`fetchFamily`)

1. Look the family up in the catalogue (exact `family` string); unknown → 404 `unknown_family`.
2. Weights: variable family (`axes` includes `wght`) → request `wght@<min>..<max>` (one file per subset); static → request every non-italic weight the catalogue lists (`wght@300;400;500;…`), so the same record serves any layout's role (§5.1 picks the nearest weights at build time). Italics are never requested.
3. `GET css2` with the desktop `User-Agent` string of `scripts/fetch-fonts.sh`; parse `@font-face` blocks with one regex per descriptor (`/\/\* (\w[\w-]*) \*\/\s*@font-face\s*{([^}]*)}/g`, then `font-weight`, `font-stretch`, `src: url(...)`, `unicode-range`); keep the `latin` block(s) always and the `georgian` block(s) when present. A block without a `woff2` URL, or a URL not starting with `https://fonts.gstatic.com/`, fails the fetch (`google_unexpected`).
4. Download each file (`AbortSignal.timeout(20000)`, ≤ 2 MB, 2 retries with 1 s/3 s back-off, total ≤ 90 s), then `parseFont()` it and check the subset claim: the georgian file must cover the 33 letters, the latin file a–z/A–Z. Compute metrics from the latin file (and `georgian` from the georgian file).
5. `GET css2` **without** a `User-Agent` for `wght@400;600` (text/georgian) and `500` (label) → static TTFs for satori (D8; F8 turns this on; until then the step is skipped). Missing weights are snapped to the nearest available.
6. `id = sha256("google\0" + family + "\0" + version).slice(0, 16)` where `version` is the `v<N>` segment of the first file URL. An existing id is returned as is (idempotent, no download). Write files then the index (§4.1). Audit `font_added { id, source, family }`.
7. Concurrency: one fetch at a time per process (a promise chain); a second request for the same family joins the first.

### 4.4 Upload validation pipeline (`inspectUpload`)

1. Size 1 KB–2 MB (413 `too_large` beyond; the route's body limit is 3 MB). Magic bytes: `wOF2`, `wOFF`, `\0\1\0\0`, `OTTO`, `true`; anything else → 422 `font_invalid { reason: 'format' }`.
2. `parseFont()`; any `FontParseError` → 422 with its reason (`tables`, `cmap`, `glyphs`, `size`, …). Reject `numGlyphs < 2`, fonts with neither `glyf` nor `CFF `/`CFF2` (bitmap/SVG-only), `unitsPerEm` outside 16–16384, italic-only files (`OS/2 fsSelection` italic bit and no upright in the same upload; italics are unused).
3. Coverage: neither latin nor Georgian complete → 422 `font_invalid { reason: 'coverage' }` (a symbol font). Latin-only or Georgian-only or both are fine.
4. Faces: WOFF2 → the bytes as the web file; WOFF/TTF/OTF → `wrapWoff2()` for the web file, `parseFont(wrapped)` must succeed and report the same table set, coverage and metrics (round-trip check, else 500 `font_convert_failed`); the original bytes are kept as the `satori` face when the flavor is TTF/OTF/WOFF (a variable TTF renders at its default instance in satori; noted in the record as `satoriVariable: true` and shown in the admin). Web faces: latin/other (ranges = `rangesOf(font, { excludeGeorgian: true })`) when latin coverage holds; georgian (the fixed `GEORGIAN_RANGE`) when Georgian coverage holds.
5. `id = sha256(bytes).slice(0, 16)`; the same file uploaded twice returns the existing record. Display name from `name` ID 16 or 1, then the sanitised filename, cut to 60 characters, control characters and `<>` removed; the owner can edit it (PATCH). Licence attestation: the request must carry `X-Font-Licence: attested` (the SPA sends it after the checkbox), else 400 `licence_required`.
6. Never: execute anything, follow names into paths (files are addressed by sha only), trust the declared family for CSS (D11).

### 4.5 Font issues (server-side validation, `check.mjs`)

Errors and warnings carry `$.settings.fonts.<layout>.<role>` paths and merge into the existing lists:

| Code | Level | When |
|---|---|---|
| `FONT_UNKNOWN` | error for the active layout, warning for others | the id is not in the store (deleted, or an import from another machine) |
| `FONT_NO_GEORGIAN` | error | the georgian role's font lacks full Mkhedruli coverage (only reachable through import/tampering) |
| `FONT_WEIGHTS` | warning | a static font lacks a weight the layout uses (the browser synthesises it); names the weights |
| `FONT_HEAVY` | warning | fonts on `/ka/` for the active layout exceed 400 KB |
| `FONT_WIDE` | warning | `metrics.<script>.mean` ≥ 1.12 × the layout default's; says "≈ 15 % wider than Chivo: long names and print may need a look" |
| `FONT_NAV_MENU` | warning | with these fonts the inline nav never fits (EN or KA) and the Sections menu shows at every width |
| `FONT_OG_DEFAULT` | warning (F8) | the card falls back to the default face for a role (WOFF2 upload) |

Where it runs: `POST /validate` (merged into its response), `publish()` step 3 (errors → 400 `invalid`, warnings need acknowledgement like the others), `POST /preview` and `buildSite` (never block: an unknown id renders the default with `FONT_FALLBACK` in `files.warnings`, like `PALETTE_FALLBACK`), `cli verify` (errors listed).

### 4.6 Report (`fontReport`)

`{ layout, roles: { text: { id, family, source, default: bool }, … }, bytes: { en, ka }, navFit: { en: 1280|…|'never', ka }, widthFactor: { text: 1.08, georgian: 1.0 }, issues: { errors, warnings } }` for the active layout of the given document (draft by default). Powers the dashboard panel (§6).

### 4.7 Routes (`/admin/api`, "fresh" session, the standard CSRF guards; ids checked with `FONT_ID_RE` before any I/O)

| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /fonts` | – | 200 `{ items: [FontRecord without metrics.adv], usage: { "<id>": ["draft", "published", "build"] }, bytes, limit }` | – |
| `GET /fonts/catalogue?refresh=0\|1` | – | 200 `{ fetchedAt, stale, families }` | 503 `google_unavailable`, 429 (refresh 1/10 min) |
| `POST /fonts/google` | `{ family }` (≤ 80 chars) | 201 `FontRecord` (or 200 when it existed) | 404 `unknown_family`, 502 `google_unavailable` / `google_unexpected`, 413, 422 `font_invalid`, 507 `store_full`, 429 (10/min) |
| `POST /fonts/upload` | body `application/octet-stream` (≤ 3 MB, `bodyLimit` for this path only; the JSON-only guard exempts exactly this path), headers `X-Font-Filename` (≤ 120 bytes, sanitised), `X-Font-Licence: attested` | 201 `FontRecord` (200 if the bytes were known) | 400 `licence_required`, 413, 415, 422 `font_invalid { reason }`, 500 `font_convert_failed`, 507, 429 (10/min) |
| `PATCH /fonts/:id` | `{ displayName }` | 200 `FontRecord` | 404 |
| `DELETE /fonts/:id` | – | 204 | 404, 409 `font_in_use { usedBy }` (draft, live, or any kept build's manifest) |
| `GET /fonts/:id/files/:face` | `:face` = index into `faces[]` | 200 the bytes, `Content-Type: font/woff2` (or `font/ttf`, `font/otf`, `font/woff`), `Cache-Control: private, max-age=86400, immutable`, `Cross-Origin-Resource-Policy: same-origin` (new header kind `font-file` in `headers.mjs`; the SPA CSP's `font-src 'self'` allows it) | 404 |
| `GET /fonts/default/:layout/:role` | – | 200 the layout's committed default face for that role (`src/fonts/<name>.woff2`, resolved from `fontRoles`/`fonts` of the manifest, never from the path), same headers as above; used only for the dashboard specimens | 404 |
| `POST /fonts/report` | `{ site? }` (draft rules applied, like `/preview`) | 200 the §4.6 report | 400 `draft_rejected` |

Existing routes: `POST /validate` merges `fontIssues()`; `GET /registry` adds `fontRoles: { <layoutId>: { text: { label, help, defaultFamily, weights }, label, georgian } }` (from the manifests, §5.1) and `fontLimits`; `GET /revisions` items and `GET /builds` items add `fonts` (a short summary `"Inter · Noto Sans Georgian"` or `null`). CLI: `fonts ls`, `fonts rm <id>`, `fonts refetch` (re-downloads every Google record after a restore, §4.8). Audit events: `font_added`, `font_removed`, `font_renamed`. Google is contacted only by `POST /fonts/google` and `GET /fonts/catalogue` (and `fonts refetch`), never by the publish or preview paths.

### 4.8 Backup, export, import, GC

`backup.mjs` includes `fonts: <index.json>` (metadata only; font bytes are not in the daily JSON, they can be re-fetched or re-uploaded). `restore-backup` restores the index only for records whose files exist, drops the rest and prints them; `cli fonts refetch` re-downloads Google records, uploads must be re-uploaded (runbook R10 gains this line). Export/import of `site.json` carry ids: an import with unknown ids is stored (the id is well-formed), the dashboard shows `FONT_UNKNOWN`, publish refuses until the fonts exist or the role is reset. Store GC is manual (delete in the admin); `pruneBuilds` keeps the store's `usage()` accurate. Disk: the release tarball, the web root and `data/` are unchanged in shape; `data/fonts/` is the only new directory.

---

## 5. Rendering

### 5.1 Roles per layout and the resolver

Each `layout.mjs` gains:

```js
fontRoles: {
  text:     { var: '--sans',  label: 'Text',     help: 'Headings and body text.',           defaultFamily: 'Chivo',          weights: [400, 600, 700], tail: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  label:    { var: '--mono',  label: 'Labels',   help: 'Eyebrows, indices and small labels on the English page.', defaultFamily: 'JetBrains Mono', weights: [400, 500], tail: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', georgianInStack: false },
  georgian: { var: null,      label: 'Georgian', help: 'Every Georgian letter, on both pages.', defaultFamily: 'Noto Sans Georgian', weights: [400, 600, 700], extraSelectors: ['.lang > [lang="ka"]'] },
},
```

Studio: `--st-sans` [400, 500, 600, 700] (Archivo; `font-stretch` is ignored by faces without a `wdth` axis), `--st-mono` [400, 500] (`georgianInStack: true`), georgian [400, 700], `extraSelectors: ['.st-lang > [lang="ka"]']`. Ledger: `--sans` [300, 400, 500], `--mono` [400, 500] (`georgianInStack: true`), georgian [350, 400] (`extraSelectors: ['.lg-lang [lang="ka"]']`). `layouts.test.mjs` requires `fontRoles` with these keys, `var` names that exist in the layout's `styles.css`, and `defaultFamily` names that appear in its `fonts.css`.

```js
// src/typography/resolve.mjs
export async function resolveFonts(site, layoutMeta, loader /* { get(id) → FontRecord|null, readFace(record, face) → Promise<Buffer> } | null */)
  → { overridden: false }                                                     // no fonts for this layout, or all roles null, or no loader
  | { overridden: true, roles: { text: { id, record, alias } | null, … },   // null = default face kept
      css: string,                             // the block of §5.2, '' when !overridden
      files: Map<'fonts/<name>', Buffer>,      // custom faces only; buildSite still copies layoutMeta.fonts (the defaults stay on disk, unlinked faces are never fetched)
      preload: { en: ['fonts/…'], ka: [...] }, // §5.3
      metrics: { text: Metrics, label: Metrics, georgian: Metrics },  // custom or default-file metrics (defaults parsed once, cached per process)
      warnings: [{ code: 'FONT_FALLBACK', path, msg }] }
```

Resolver steps: (1) `cfg = site.settings.fonts?.[layoutMeta.id]`; no loader, no `cfg`, or every role `null` → `{ overridden: false }`. (2) Per role with an id: `loader.get(id)`; missing → warning `FONT_FALLBACK` at `$.settings.fonts.<layout>.<role>` and the role stays default; for `georgian`, a record without Georgian coverage is treated the same way (never rendered). (3) Pick faces (§5.3), read their bytes, name them `fonts/<slug>.<sha256-8>.woff2`. (4) Emit the block (§5.2) from the role table, then the override-mode variables (§5.4) using `localize(site, lang)` for the name and facts. (5) Metrics: custom records supply theirs; default roles get the default file's metrics, parsed once per process from `src/fonts/` and cached. (6) Preload lists. Pure apart from the loader; identical input gives identical output, so preview equals publish.

`buildSite(site, { fonts })`: `fonts` is a loader (publish/preview: the font store; `build.mjs`: `FONTS_DIR` when set, else `null`). CSS = layout `css[]` joined + `'\n' + fonts.css` (only when overridden) + `'\n' + paletteCss(...)`. `renderSite(site, { layout, palette, assets, fonts })` puts `fonts` into `ctx.fonts` (`{ overridden: false }` by default); `document.mjs` preloads `ctx.fonts.preload?.[c.lang] ?? layout.preload[c.lang]`. With `overridden: false` every module takes exactly its current path: same bytes.

### 5.2 The generated block (appended after the layout CSS, before the palette block)

```css
/* fonts: precision · text=3f2a1b9c0d4e5f60 georgian=7c1d2e3f4a5b6c7d */
@font-face { font-family: "sm-text"; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('fonts/inter-latin-normal-100-900.3f2a1b9c.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, …; }                 /* the face's non-Georgian ranges */
@font-face { font-family: "sm-georgian"; font-style: normal; font-weight: 400; font-display: swap;
  src: url('fonts/bpg-nino-georgian-normal-400.7c1d2e3f.woff2') format('woff2');
  unicode-range: U+0589, U+10A0-10FF, U+1C90-1CBA, U+1CBD-1CBF, U+205A, U+2D00-2D2F, U+2E31; }
:root { --sans: "sm-text", "sm-georgian", system-ui, -apple-system, "Segoe UI", sans-serif; }
html[lang="ka"] { --sans: "sm-georgian", "sm-text", system-ui, sans-serif; }
.lang > [lang="ka"] { font-family: "sm-georgian", sans-serif; }           /* extraSelectors */
```

Rules: a role that keeps its default is written with its default family name in the stack (`Chivo`, `"Noto Sans Georgian"`), so the layout's own `@font-face` keeps serving it; the label stack gets `"sm-georgian"` (or the default Georgian family) second when `georgianInStack` is true; static faces get one `@font-face` per shipped weight; variable faces one with the range; text/label faces are always fenced to non-Georgian ranges and the georgian face to `GEORGIAN_RANGE` (D6); the `html[lang="ka"]` block redefines only `--sans`/`--st-sans` (Ledger and Studio switch labels to the sans in KA through their own CSS, unchanged). No value in this block ever comes from user input: aliases are constants, file names are `<slug>.<hash>` from `/^[a-z0-9-]+$/` slugs, ranges are generated. Dark mode: nothing to do (faces are theme-independent). Print: the same faces print; a warning covers page growth (D9).

### 5.3 Which files ship and are preloaded

For each role with a custom font, the faces the layout needs: variable → the one file per subset; static → the nearest available weight for each `weights` entry (deduplicated). Preload: EN = text face(s) then the label face; KA = the georgian face first, then text, then label; at most 4 preloads (further static weights load on demand). Bytes for the `FONT_HEAVY` warning = the sum of the faces referenced on `/ka/`.

### 5.4 Width estimates in override mode (D7)

`ctx.fonts.width(role, text, px, { weight, letterSpacingEm })` wraps `widthOf(metrics[role], …)` and picks the georgian metrics for Georgian characters. Templates use it only when `ctx.fonts.overridden`:
- **Studio** `navTier`: replace `est(s, latin, georgian)` by width sums at the real sizes: nav labels 13 px/400, brand name 13 px/500, print label 12.5 px/600; the rest of the formula (gaps, controls, 64 + 80) unchanged. The fonts block adds `html[lang="en"] { --st-name-em: <max over name words of width(word,100px,700)/(len·100)> }`, `html[lang="ka"] { --st-name-em: … }` and per-fact `--st-fact-em` through the same block (`html[lang="…"] .st-fact { --st-fact-em: <max over facts> }`), each ×1.08.
- **Ledger** `navFit`: `FIT.nav` and every `CH.*` constant become width sums (nav 12.5 px EN / 12 px KA in `text`/`georgian`, monogram 14 px/500 and host 12.5 px in `label`, language labels 12 px `label` or 12.5 px `georgian`, theme word, print 11.5 px/500 `label` or 12.5 px `georgian`); gaps and fixed paddings unchanged.
- **Precision** (CSS breakpoints today): in override mode the template stamps `data-navfit="1280|1440|1680|never"` on `.topbar` from `need = Σ width(label, 13px) + 22·7 + (31 + 11 + width(name, 13px, 500)) + controls + 2·40 + 2·36`, controls = the measured width of the language switch, theme, print and menu controls (EN ≈ 300 px, KA ≈ 330 px; the builder reads both once in Playwright from the seed build, like the Studio and Ledger constants were), and the fonts block appends `.topbar[data-navfit] .topnav { display: none } @media (min-width: 1280px) { .topbar[data-navfit="1280"] .topnav { display: flex } } @media (min-width: 1440px) { .topbar[data-navfit="1440"] .topnav … } @media (min-width: 1680px) { .topbar[data-navfit="1680"] .topnav … }`. The rail nav and the menu cover navigation below the tier, as today. Nothing is stamped in default mode.
- Headroom: Latin ×1.06, Georgian ×1.12, on top of the weight factor. A unit test proves that for the default fonts the width-based estimator picks the same tier as the constant estimator on the seed and the stress fixture, for all three layouts and both languages (so the two paths agree where the defaults are concerned), and the CI fonts gate (§7.4) proves the override path on real swapped fonts.

### 5.5 Preview

`POST /preview` passes the font store as the loader; the custom faces are in the token's map under `fonts/…` and are served with the existing `preview-file` headers (`Access-Control-Allow-Origin: *`, `no-store`); the CSS's relative `url('fonts/…')` resolves under the token base exactly as the default files do. The preview CSP (`font-src <PUBLIC_ORIGIN>`) already allows them. The re-render key already includes `settings.fonts` (only `palette` and `defaultTheme` are excluded), so a font change re-renders the frame within 600 ms; no bridge change.

### 5.6 Social cards (F8)

`ogInputs()` adds `fonts: { text: <satori face sha8>|'default', label: …, georgian: … }` so names change with the fonts; `renderPng(item, { faces })` builds satori's `fonts` array per render: the default six files registered under the aliases `sm-text` (Chivo), `sm-label` (JetBrains Mono), `sm-georgian` (Noto) and, per overridden role with a satori face, the custom file(s) under the same alias instead; `cards.mjs` uses the aliases only. `RENDERER_ID` is unchanged (default bytes unchanged; custom files enter the name through `ogInputs.fonts`). `POST /og-preview` renders with the same faces.

---

## 6. Admin UI

Lives on the **Dashboard**, as a fieldset "Fonts" between the palette picker and the default theme (the preview stays beside it); the chooser is a modal, following `ConfirmDialog`/`ModalDialog`. New files: `admin/web/src/components/FontPicker.vue`, `FontDialog.vue`, `FontSpecimen.vue`, `admin/web/src/state/fonts.js`; `api.js` gains `apiUpload(path, file, headers)` (octet-stream body, the same CSRF headers and 401 handling); `admin.css` gains `.fp-*` rules in the `--adm-*` tokens (2–4 px corners, hairlines, no shadows, 2 px focus ring, hit targets ≥ 32 px).

**FontPicker** (`<fieldset>` with `<legend class="sec-title">Fonts</legend>` and `<p class="help">` "For the selected layout. Google fonts are downloaded once and served from samsiani.me."): one row per role of `registry.fontRoles[settings.layout]`: role label + help, then `FontSpecimen` (EN "Giorgi Samsiani · Full-stack web developer" and KA "გიორგი სამსიანი · ვებ დეველოპერი", `lang="ka"` on the second line, drawn in the role's face; for the default it uses the layout's default family name loaded from `/admin/api/fonts/default/<layout>/<role>` — the same route serves the committed `src/fonts` files), the family name with a source tag ("Google · Inter", "Uploaded · BPG Nino", "Layout default · Chivo"), and buttons **Change…** and **Reset** (`aria-label="Reset the text font of Precision"`, disabled when default). Under the rows, the report line from `POST /fonts/report` (debounced 600 ms on `settings.fonts` and `settings.layout` changes): "Fonts on /ka/: 142 KB · inline nav from 1440 px (EN), Sections menu (KA)" and its warnings through `IssueList` (linked to the row). Selecting writes `settings.fonts[layout][role] = id` (creating the objects as needed; the SPA never removes keys), Reset writes `null`. Autosave, conflicts and the offline copy work unchanged because the document is the only state.

**FontDialog** (`ModalDialog wide`, `labelledby="font-dlg-title"`, title "Choose the {role} font for {layout label}"): a `role="tablist"` of three buttons (Google Fonts · Upload a file · Already added), arrow keys move between tabs.
- *Google Fonts*: search `<input type="search" aria-label="Search Google Fonts">` (client-side filter over the cached catalogue, 150 ms debounce), `<select>` category, `<label class="check">` "Supports Georgian" (checked and disabled for the georgian role) and "Variable weight"; results as a `<ul>` of `<button aria-pressed>` rows (family, category, "9 weights" / "variable", "Georgian" badge), the first 60 matches plus "Show 60 more"; choosing a row calls `POST /fonts/google`, shows `st st-busy` "Fetching Inter from Google…", then the specimen in the fetched face (`FontFace` loaded from `/fonts/:id/files/:face`, alias `sm-spec-<id>`, `document.fonts.add`), the facts (files and KB on the site, weights, coverage, licence link `https://fonts.google.com/specimen/<Family>/license` with `rel="noopener noreferrer"`, opened by the owner, never fetched by the SPA), and **Use this font**. 503 → "Google Fonts is unreachable from the server (last catalogue: never / 14 Sep). Uploads still work." 
- *Upload a file*: `<input type="file" accept=".woff2,.woff,.ttf,.otf">`, display name `<input class="inp" maxlength="60">` (prefilled from the file after inspection), `<label class="check">` "I hold a licence that allows embedding this font on samsiani.me" (required), **Upload** → `apiUpload('/fonts/upload')` → the same specimen/facts/"Use this font" state; 422 reasons in plain words ("This file is not a TTF, OTF, WOFF or WOFF2 font", "The font has no complete Latin or Georgian alphabet"); a static or variable-in-satori note when relevant.
- *Already added*: the store list (family, source, KB, "Used by: Precision text, Studio georgian" from `usage`), **Use**, **Rename**, **Delete** (confirm; 409 → toast "In use by …").
- The georgian role hides fonts without Georgian coverage in every tab; the text/label roles show everything.
- Keyboard and screen readers: native controls, `aria-pressed` rows, the busy state in a `role="status"` region, errors in `role="alert"`; Escape closes (unless an upload is in flight); focus returns to the "Change…" button. At 390 px the dialog is full-width, tabs wrap, rows stack the meta under the name; no horizontal scroll (E10's dom-checks run on it).
- Specimen fonts are removed from `document.fonts` when the dialog closes; the admin's own UI never changes font.

`state/fonts.js` (shallowReactive, like `registry.js`): `fonts = { loaded, items: [], usage: {}, catalogue: null, catalogueStale, googleAvailable, report: null }`; `loadFonts()` (`GET /fonts`, once per session, refreshed after add/delete), `loadCatalogue({ refresh })`, `addGoogle(family)`, `upload(file, { displayName })`, `rename(id, name)`, `remove(id)`, `loadReport(site)` (600 ms debounce, cancels a stale response by sequence number), `specimenFace(record)` → `{ alias, load() }` (`FontFace` cache keyed by id, released by `releaseSpecimens()`), `byId(id)`, `roleValue(layout, role)` / `setRole(layout, role, id | null)` (creates `settings.fonts[layout]` when needed). Every server call goes through `api()`/`apiUpload()`, so the 401 → login modal → retry path holds.

The **publish dialog** shows the fonts of the active layout in its facts list ("Fonts: Inter · JetBrains Mono · Noto Sans Georgian") and lists font warnings with the others. **Revisions** and **Live builds** tables gain a "Fonts" column (the summary string).

---

## 7. Tests and acceptance criteria

### 7.1 Unit (`node:test`, `npm test`)

- `test/unit/sfnt.test.mjs`: parses all 7 repository fonts with the values verified in §1.3 (Noto WOFF2 and TTF: georgian 33/33, mean 0.659 em, upm 1000; Chivo WOFF2: variable `wght 100–900` default 500, latin 52/52, mean 0.598; Archivo: axes `wght`, `wdth 62–125`; Plex Mono 400: static, mean 0.600); rejects truncated files, a wrong magic, a table past EOF, a Brotli stream larger than `totalSfntSize`, a file without `cmap`; `rangesOf` excludes Georgian; `wrapWoff2(NotoSansGeorgian-Regular.ttf)` parses back with identical coverage and metrics and is smaller than the TTF; `widthOf` matches the constant estimators' tiers on seed and stress for all layouts (§5.4).
- `test/unit/golden.test.mjs` (**byte identity**): for each layout, `buildSite(seed)` yields the recorded CSS name and the recorded sha256 of `index.html` and `ka/index.html` (values recorded by the builder at the start of F2 on the unmodified tree; measured 2026-09-15 at `a4d7b57`: precision `styles.f87eda95.css` / `2c5d8940e0c8d681…` / `c606975674dcb7da…`, studio `styles.f5d43f11.css` / `d3ce59db00a6a380…` / `92bc265d7a24aa0d…`, ledger `styles.6488f641.css` / `a8442d362210e195…` / `1366868cab2180e9…`; the test file states the full hashes and the commit they were taken at); the same document with `fonts: { precision: { text: null, label: null, georgian: null } }` gives the same files; a change to these goldens must be deliberate and in the same commit as the template change.
- `test/unit/fonts-resolve.test.mjs`: with a fake loader holding the Plex files as an "upload" for Precision `text`+`label`: the CSS block contains `sm-text`, the fenced ranges, `--sans` on `:root` and `html[lang="ka"]`, no Georgian block in the text range; files map holds hashed names; preload order (KA: georgian first); an unknown id → `FONT_FALLBACK` and default output; a Georgian-only font assigned to `text` is fenced to nothing Georgian and Georgian still resolves to the georgian role; no user-derived string reaches the CSS (a record with `family: 'x"}; body{display:none}'` produces a block whose only quoted strings are the three aliases and the default families).
- `test/unit/validate.test.mjs` additions: `fonts` absent → 0 errors; well-formed ids → 0; `fonts.nope` → `UNKNOWN_KEY`; `text: "../x"` → `PATTERN`; `canonicalize` keeps a present `fonts` and omits an absent one; `limitsTable()` has no `settings.fonts` row.
- `test/unit/layouts.test.mjs`: `fontRoles` shape per layout (§5.1).

### 7.2 Service (`admin/test/fonts.test.mjs`, `app.request()`, temp dirs, Google mocked by a `fetchImpl` that serves `test/fixtures/google-fonts/`)

Catalogue: fetched once, cached 24 h (injected clock), stale copy on failure, 503 with no cache, the `)]}'` prefix stripped. Google fetch: `Chivo` (fixture) → record with latin faces from `src/fonts/chivo-…woff2`, idempotent second call, `Noto Sans Georgian` → georgian face + coverage, unknown family 404, a fixture file that is not a font → 422 and nothing written, a 2.1 MB response → 413 and nothing written, a css2 URL outside `fonts.gstatic.com` → 502. Upload: each of the three TTFs in `src/brand/fonts/` → 201 with a WOFF2 web face and a satori face; a WOFF2 from `src/fonts/` → 201, one face; a PNG → 422 `format`; without `X-Font-Licence` → 400; > 3 MB → 413; the same bytes twice → 200 same id; `DELETE` in use → 409, unused → 204 and the file is gone; `GET /fonts/:id/files/0` → bytes with `Cache-Control: private, max-age=86400, immutable`. Issues: unknown id in the active layout → `POST /validate` error `FONT_UNKNOWN` and `POST /publish` 400; in an inactive layout → warning; a Georgian-less upload assigned to `georgian` via `PUT /draft` → `FONT_NO_GEORGIAN` error at publish. Publish with Precision `text = Plex Sans (upload)`: the web root has `fonts/ibm-plex-sans-latin-wght-100-700.<hash>.woff2`, the HTML preloads it, `styles.<h>.css` has the block, the manifest has `fonts.text`; a second publish reports `changedFiles: 0`; reset → the default file set again and the custom file survives GC for 24 h, then is removed; rollback restores the previous CSS and fonts. Preview: the token map serves `fonts/…` with `Access-Control-Allow-Origin: *`. Backup: `index.json` inside, files not; `restore-backup` keeps only records whose files exist. Every test asserts the fake `fetchImpl` saw no URL outside the fixture map (no network).

### 7.3 Google mock

`test/fixtures/google-fonts/index.json` = `{ "metadata": { "familyMetadataList": [Chivo, JetBrains Mono, Noto Sans Georgian, Noto Serif Georgian, IBM Plex Sans, IBM Plex Mono, Archivo] trimmed }, "css2": { "<query string>": "<css text with gstatic URLs>" }, "files": { "https://fonts.gstatic.com/s/...": "src/fonts/<file>" } }` (paths relative to the repository; no new binaries). `createGoogle({ fetchImpl })` gets `fetchImpl` from `createDeps(cfg, { fetchImpl })`; the e2e harness and local development may set `GOOGLE_FONTS_FIXTURE=<path>` (honoured only when `NODE_ENV !== 'production'`, like `SESSION_IDLE_S`), which builds the same fake fetch inside the process.

### 7.4 Page gates and CI (`scripts/check-all.mjs`, existing jobs; no workflow change)

New step 7 "fonts fixture": `node scripts/lib/fonts-fixture.mjs .cache/fonts` (also importable as `makeFontsFixture(dir)` for the unit and service tests) creates a real font store by running the upload pipeline on `src/fonts/ibm-plex-sans-latin-wght-100-700.woff2`, `ibm-plex-mono-latin-400.woff2`, `chivo-latin-normal-400-700.woff2`, `archivo-latin-wdth-wght.woff2` and `src/brand/fonts/NotoSansGeorgian-SemiBold.ttf` (a TTF → WOFF2 conversion), and writes `site.json` variants: precision `text`=Plex Sans, `label`=Plex Mono, `georgian`=the converted Noto; studio `text`=Chivo; ledger `text`=Archivo, `label`=null, `georgian`=converted Noto. Then for each layout, seed and stress fixture, `FONTS_DIR=.cache/fonts OUT_DIR=.cache/matrix/<layout>-fonts[-stress] node build.mjs` and: `check-layout-stress.mjs` (no wrapping nav, no overflow at 320–1920 px), `check-pages.mjs --only overflow,casing,focus,names,motion`, plus a new `scripts/check-fonts.mjs --dist <dir|url> [--expect sm-text,sm-georgian]` (serve-dir, HTTP-status and `main#main` rules like every other gate): in Chromium, `document.fonts.check('13px sm-text')` and `document.fonts.check('13px sm-georgian')` are true after `document.fonts.ready` on `/` and `/ka/`, every `@font-face` URL in the stylesheet returned 200, and a Georgian text node's rendered font (`getComputedStyle` + a canvas `measureText` comparison against the system fallback) is the custom face. Adds 6 builds and 18 runs to the 58 of today; the pixel-identity step and every existing run are unchanged. `check:stress` unchanged.

### 7.5 End to end (`test/e2e/admin.e2e.mjs`, harness started with `GOOGLE_FONTS_FIXTURE`)

- **E12**: Dashboard → Fonts → Change… (Precision text) → Google tab → search "Chivo" → choose → specimen renders (the page's `document.fonts.check('16px sm-spec-<id>')` is true) → Use this font → the preview re-renders within 2 s and `document.fonts.check('13px sm-text')` is true inside the frame on `/` and `/ka/`; `GET /draft` has `settings.fonts.precision.text`; the report line shows the nav tier; Reset → the preview has no `sm-text` face and `settings.fonts.precision.text === null`.
- **E13**: Upload tab → `setInputFiles('src/brand/fonts/NotoSansGeorgian-SemiBold.ttf')` → licence checkbox → Upload → Use as the georgian role → Publish (the existing `publishFromDialog`) → `<WEB_ROOT>/fonts/` holds one `noto-sans-georgian-…<hash>.woff2` and `ka/index.html` preloads it first; Revisions shows the fonts column; Live builds → roll back → the file set of the previous build is back.
- **E14**: with the fixture's `google_unavailable` mode (env `GOOGLE_FONTS_FIXTURE_OFFLINE=1`), the Google tab shows the unreachable message, the Upload tab still works; the dialog passes `dom-checks` at 1280 and 390 px, light and dark (added to E10's screen list: dashboard with the dialog open on each tab).

### 7.6 Acceptance (whole feature)

1. `npm test`, `npm run check:all` (58 existing runs + the fonts fixture runs), `npm run check:stress`, `npm run test:e2e` pass; the golden test holds; CI unchanged in shape.
2. Publishing the seed without `fonts` after this feature reports `changedFiles: 0` against a build made before it (byte identity in production, checked at the cut-over of F5 with `cli publish --if-changed`).
3. Choosing Inter for Precision text on production: `/` references one new `fonts/inter-latin-normal-100-900.<hash>.woff2`, no request leaves the visitor's browser to Google (Playwright network log through Cloudflare), Georgian on `/ka/` renders in the georgian role's face, Lighthouse accessibility stays 100 and performance within 2 points of the default build for `/` and `/ka/`.
4. `curl -s https://samsiani.me/styles.<h>.css | grep -c 'sm-text'` ≥ 1 and the file contains no string from a font's `name` table (`! grep -q 'Inter' styles.<h>.css`).
5. A 1 MB TTF upload is a WOFF2 on the site ≤ 45 % of the TTF size; uploading a PNG renamed `.ttf` is refused with a clear message and nothing is written under `data/fonts/files/`.
6. Deleting a font in use is refused; deleting an unused one removes its files; the daily backup contains the fonts index and no font bytes.
7. Keyboard-only: open the dialog, switch tabs with arrows, search, choose, use, reset; the focus ring is visible throughout; VoiceOver reads the role, the family and the busy/error states.

---

## 8. Milestones (build order; each one reviewable commit; every earlier gate stays green)

| # | Milestone | Files | Done when |
|---|---|---|---|
| F1 | Font file reader and WOFF2 wrapper | `src/typography/{roles,sfnt,woff2,measure}.mjs`, `test/unit/sfnt.test.mjs` | §7.1 sfnt tests pass on the 7 repository fonts; `wrapWoff2` round-trips; zero dependencies added (`git diff package.json` empty) |
| F2 | Resolver and rendering integration | `src/typography/resolve.mjs`, `src/build-site.mjs`, `src/render.mjs`, `src/shared/document.mjs`, `src/layouts/*/layout.mjs` (`fontRoles`), `src/layouts/{studio,ledger,precision}/template.mjs` (override-mode estimators; the constant paths untouched), `src/schema/validate.mjs` (`settings.fonts`), `build.mjs` (`FONTS_DIR`), `test/unit/{golden,fonts-resolve,validate,layouts}.test.mjs` | golden test recorded first, then green after every edit; resolver tests pass; `LAYOUT=precision FONTS_DIR=<fixture store> node build.mjs` ships the custom face and `check-layout-stress` passes on it; `npm run check:all` unchanged (58 runs) |
| F3 | Font store and uploads | `admin/server/lib/fonts/{store,upload,check}.mjs`, `admin/server/routes/fonts.mjs` (upload, list, files, patch, delete, report), `app.mjs` (octet-stream exemption, 3 MB limit for that path), `headers.mjs` (`font-file`), `deps.mjs`, `admin/test/fonts.test.mjs` (upload half) | upload tests pass; `data/fonts/` layout as §3.2; the SPA can `GET` a face with the CSP headers of §4.7 |
| F4 | Google catalogue and downloads | `admin/server/lib/fonts/google.mjs`, `routes/fonts.mjs` (catalogue, google), `test/fixtures/google-fonts/index.json`, `admin/test/fonts.test.mjs` (Google half), `config.mjs` (`GOOGLE_FONTS_FIXTURE`, dev only) | Google tests pass with the fake `fetchImpl` and assert no URL outside the fixture; a manual `POST /fonts/google { "family": "Inter" }` against `npm run dev:server` stores latin faces and answers in < 10 s |
| F5 | Publish, preview, validate, CLI, backup, GC | `admin/server/lib/{publish,preview,swap,backup}.mjs`, `routes/{draft,publish,registry}.mjs`, `cli.mjs` (`fonts ls\|rm\|refetch`), `store.mjs` (`listRevisions` fonts summary), README runbook R10 line | §7.2 publish/preview/backup tests pass; `cli publish --if-changed` on a fonts-free document is a no-op; `cli verify` lists `FONT_UNKNOWN` |
| F6 | Admin UI | `admin/web/src/components/{FontPicker,FontDialog,FontSpecimen}.vue`, `state/fonts.js`, `api.js` (`apiUpload`), `views/DashboardView.vue`, `components/{PublishDialog}.vue`, `views/RevisionsView.vue`, `styles/admin.css`, `test/e2e/admin.e2e.mjs` (E12–E14, E10 screens) | `npm run build:admin` has no inline script/style; `! grep -rn "v-html" admin/web/src`; E12–E14 pass; manual keyboard + VoiceOver pass in Chrome and Safari at 1280 and 390 px |
| F7 | CI fonts gate and docs | `scripts/lib/fonts-fixture.mjs`, `scripts/check-fonts.mjs`, `scripts/check-all.mjs` (step 7), `README.md` (Fonts section), `deploy/admin.env.example` (comment: no new keys) | `npm run check:all` passes with the new step on a clean checkout; the step fails when the fonts block is removed from the build (negative check run once by hand) |
| F8 | Social cards in the chosen fonts (optional) | `src/shared/brand.mjs`, `src/brand/{render,cards}.mjs`, `admin/server/lib/fonts/google.mjs` (satori statics, step 5), `routes/publish.mjs` (`og-preview`), `test/unit/brand.test.mjs`, `admin/test/og.test.mjs` | default cards byte-identical to before (existing determinism test + the same names); a Precision build with an uploaded TTF text font renders the card in it (visual check of `cli brand --out`); a WOFF2-only font yields `FONT_OG_DEFAULT` and the default face |

Production cut-over after F5 or later: deploy as usual (no migration: `cli migrate --dry-run` exits 0), then §7.6 item 2, then the owner picks a font on the dashboard, previews, publishes, and rolls back once to confirm §7.6 item 6 behaviour on the real box.

---

## 9. Risks and mitigations

| Risk | Effect | Mitigation |
|---|---|---|
| Google changes the metadata endpoint or css2 output | picker empty or fetch fails | the reader of §4.2/§4.3 fails closed with `google_unexpected`; the cached catalogue keeps working; uploads unaffected; the fixture keeps the tests green; the parser is regex-per-descriptor, tolerant of new descriptors |
| A font choice breaks the header or overflows | wrapped nav, horizontal scroll | width-based tiers with headroom (D7), Studio fit variables, the CI fonts gate on real swapped fonts with the stress fixture, `FONT_WIDE`/`FONT_NAV_MENU` warnings, the live preview at 390 and 1440 |
| Print length grows | KA PDF beyond 6 pages | `FONT_WIDE` warning; the owner checks "Save as PDF" in the preview; print gates cover the defaults |
| Malicious upload | code execution or CSS injection | fonts are data parsed by a bounded reader (no eval, sizes capped, Brotli output capped, table bounds checked), stored by sha, served with `nosniff`; CSS never contains font-derived strings (D11); the public site's only new bytes are `@font-face` rules and hashed file names |
| Store growth or full disk | failed uploads | per-family and store caps (D9), 507 before writing, delete in the admin, `usage()` protects referenced fonts; publish stages first and fails cleanly as today |
| Default output drifts | byte identity lost silently | the golden test (§7.1) and the pixel-identity step; override code paths run only when `overridden` |
| Licence misuse | owner liability | Google families are open licences (recorded with the specimen licence link); uploads require an explicit attestation stored with the record |
| WOFF2 encoder bug | a custom font fails to load in some browser | round-trip through the reader on every conversion, Playwright loads converted fonts in CI (§7.4), and the original bytes are kept so a re-conversion is possible after a fix; WOFF2 uploads are shipped untouched |
| satori cannot use a face (F8) | card in default fonts | explicit `FONT_OG_DEFAULT` warning; static TTF fetched for Google fonts |
| Restore on a new server | fonts missing | index restored, `cli fonts refetch` for Google records, the admin lists uploads to re-add; publish refuses until resolved (never publishes a broken CSS) |

---

## 10. Build notes (added 2026-09-16, after C1–C7 and F1 landed)

These correct the plan where the tree has moved on. They win over the sections above.

**Schema.** `docs/plans/content-editing.md` landed first, so `SCHEMA_VERSION` is already **2** and
`src/schema/migrate.mjs` exists. D10 still holds: `settings.fonts` is an optional key added to the v2
schema, **no version bump and no migration step** (absent means "every layout uses its defaults").

**Goldens.** C1 added `test/fixtures/golden/*.json` and `test/unit/render-golden.test.mjs`, which pin
today's rendered bytes. In default mode (no `settings.fonts`, or every role `null`) they must stay green
untouched — that is the §7.1 byte-identity criterion, already written. Only a deliberate output change
may run `node scripts/update-golden.mjs`, and F2–F8 must not need it.

**F1 as built** (`src/typography/sfnt.mjs`, commit `880aef6`) — the reader *and* the WOFF2 writer live in
this one module; there is no `woff2.mjs`, so §4.1's table is wrong on that row. Exports: `sniff`,
`parseFont`, `metricsOf`, `coverageOf`, `rangesOf`, `widthOf`, `unwrapWoff2`, `wrapWoff2`,
`FontParseError`, `MKHEDRULI`, `GEORGIAN_RANGE`.
- `widthOf(metrics, text, px, { weight = 400, letterSpacingEm = 0, headroom = 1 })`: no `script` option
  (Georgian is detected per character), and `headroom` defaults to 1, so §5.4's ×1.06 / ×1.12 stay the
  caller's job.
- Means: `latin` over the 95 printable ASCII characters, `georgian` over the 33 Mkhedruli letters.
  §1.3's "Chivo 0.598 em" does not match this repo's file (it measures 0.555 latin); `FONT_WIDE` must
  compare measured means, never the prose figures.
- `parseFont` already refuses collections, bitmap/SVG-only files, absent `OS/2`, `unitsPerEm` outside
  16–16384 and `numGlyphs` outside 2–65535, so §4.4 steps 2–3 shrink to the coverage and italic checks.
- `rangesOf` swallows the smallest gaps to stay within 64 entries instead of falling back to whole-plane
  spans (a tighter fence, same guarantee).
- **Dependency direction:** `roles.mjs` must stay pure and browser-safe (`validate.mjs` imports it), so
  `sfnt.mjs` may import `roles.mjs`, never the reverse — `sfnt.mjs` imports `node:zlib`.
- WOFF2 writing: the file must be padded to a four-byte boundary and `length` must count the padding, or
  Chromium refuses it ("Failed to convert WOFF 2.0 font to SFNT"); `loca` must follow `glyf`; no
  `transformLength` at transform version 3. Encoding costs ~0.3–0.6 s per face, so fetch and upload
  responses must not block a request longer than their timeout budget.
- Google's subset WOFF2 files carry the **instance** name ("Chivo Medium"), so a download's display name
  comes from the catalogue, not from the file.
