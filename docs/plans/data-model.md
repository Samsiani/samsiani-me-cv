# Content data model, migration and template refactor — build plan

Scope: the canonical content store `site.json` that the admin edits, the one-time migration from
`src/content/en.mjs` + `src/content/ka.mjs`, the `localize()` contract that feeds templates, the
validation rules and length limits, and the refactor of `template.mjs` / `styles.css` / `build.mjs`
into shared modules plus one folder per layout.

Everything in this plan was run, not just written. The reference implementation in
`docs/plans/data-model-ref/` builds a `dist/` that is **byte-identical** to the live build
(`diff -r` over all 19 files, binaries included).

| File | What it is |
|---|---|
| `docs/plans/data-model.md` | This document. |
| `docs/plans/site.example.json` | The migrated live content (63,672 bytes). Byte-identical to what `scripts/migrate-content.mjs` writes to `src/content/site.json`. |
| `docs/plans/site.stress.json` | Stress fixture: every limited string at its limit, every list at its maximum count, nav labels at the 100-character budget. Validates with 0 errors. Test input for every layout, never published. |
| `docs/plans/data-model-ref/` | Tested reference implementation of phase 1, laid out at its target paths (`build.mjs`, `scripts/`, `src/…`). Copy file by file, as described in §8. |
| `docs/plans/palettes.md` | Written by the palettes plan. This plan follows it: palette ids, `src/palettes.json`, `src/palettes.mjs`, the build-mode fallback. |

---

## 0. Results (what was proven)

| Check | Result |
|---|---|
| Migration conflicts (fields stored once whose en/ka values differ: contact value/href/icon/copy, skill level, orgHref, period years, section ids, paths) | **0** |
| `localize(site, 'en')` vs `en.mjs`, `localize(site, 'ka')` vs `ka.mjs` | **0 missing keys, 0 differing values, 0 key-order differences.** `JSON.stringify` of the localized tree (with the additive keys removed) is byte-identical to `JSON.stringify` of the original module, for both languages. |
| HTML rendered by the current `src/template.mjs` from the localized trees vs from the original modules | **Identical** for `index.html`, `ka/index.html`, `404.html` (md5 `9385b33f8fc8` / `4a756d091966`). |
| Full refactor (reference implementation: `site.json` → `localize` → shared head + Precision body → `dist/`) vs the current build | **`diff -r` reports no differences** (HTML ×3, sitemap, robots, manifest, `.htaccess`, `_headers`, `styles.b1754418.css`, `main.1d55c0e3.js`, 3 fonts, 6 PNGs). |
| `validate(site.example.json)` | 0 errors, 0 warnings, against the six real palette ids from `palettes.json`. |
| Validator mutation tests | **23/23 rejected**: `javascript:`, `JavaScript:`, `java<TAB>script:`, `http:`, `data:`, `mailto:?bcc=`, `mailto:` in `orgHref`, a `ru` key, Cyrillic text, a "KA · EN · RU" token, missing/empty `ka`, duplicate id, unknown level, `to < from`, over-long nav label, 3 facts, unknown layout, unknown key (`sections.education`), newline in a title, contact primary not `mailto:`, `siteUrl` with a path, 2026-02-30. |
| `canonicalize()` | Reproduces `site.example.json` byte for byte, and restores canonical key order after keys are shuffled and junk keys are added. |
| Stress fixture on the current Precision CSS | **4 failures** (one of them is a live bug; see §9). With the two CSS fixes in §9 applied: **24/24 viewport checks pass.** Revised 2026-09-15: the fixture now reaches every limit, and all three layouts pass with the master plan's review edits (§9). |

**Fields that do not round-trip as a plain copy, and how each is handled** (all are exact after handling):

| # | Legacy field | Stored in site.json as | localize() rebuilds it by |
|---|---|---|---|
| 1 | `hero.name` "Giorgi Samsiani" | `person.givenName` + `person.familyName` (split at the last space) | `given + ' ' + family` |
| 2 | skill `name` "Next.js 16 · App Router, server actions" | `name` + `detail` (split at the **first** " · "); `detail: null` when absent | `detail ? name + ' · ' + detail : name`. Two items contain more than one " · " ("GA4 · Tag Manager · Looker Studio", "Vitest · PHPUnit · test-gated CI"); the detail keeps the rest, and rendering is unchanged because the old template also split at the first separator. |
| 3 | experience `period` "2018 — present" / "2018 — დღემდე" | `from: 2018, to: null`; the word moves to `ui.present` | `formatPeriod(from, to, ui.present[lang])` |
| 4 | `sections.education.langsTitle` | dropped (equal to `title` in both languages and never read by the template) | `langsTitle = title` |
| 5 | `sections.education` (the Languages section), `langs[].level` | `sections.languages`, `items[].proficiency` | renamed back |
| 6 | `contact.items[].copy` (key absent when not copyable) | `copy: false` | key emitted only when `true` |
| 7 | `experience.items[].orgHref` (absent for "E-commerce brands") | `orgHref: null` | key emitted only when non-null |
| 8 | section `lead` (absent for profile, experience, languages) | `lead: null` | key emitted only when non-null |
| 9 | `selfLabel`, `altLabel`, `altTitle` (cross-language: "In English" lived in `ka.mjs`) | `ui.langShort` {en "EN", ka "ქართ"}, `ui.langSwitch` {en "In English", ka "ქართულად"} | `selfLabel = langShort[lang]`, `altLabel = langShort[alt]`, `altTitle = langSwitch[alt]` |
| 10 | `dir`, `path`, `altPath`, `meta.ogLocale`, `sections.*.id` | not stored: code constants (`LOCALES`, `SECTIONS`) | copied from the constants; the migration asserts the legacy values equal them |
| 11 | values shared by both languages | stored once | copied into both trees |
| 12 | two comment lines at the top of `en.mjs` / `ka.mjs` | not carried (not data) | — |

Values that were hard-coded in `src/template.mjs` and `build.mjs` are now data or derived from data (§5.3). The byte-identical build proves each derivation.

---

## 1. Decisions

1. **One file.** `src/content/site.json`, UTF-8, 2-space JSON, trailing newline, keys in canonical schema order (written only through `canonicalize()`, §4.6). `en.mjs` and `ka.mjs` are deleted after the migration.
2. **Localized strings are `{ "en": "…", "ka": "…" }` with exactly those two keys.** A third key is a validation error (a `ru` key gets the dedicated `RUSSIAN` code). The two languages cannot drift structurally: a list item exists once and carries both texts.
3. **Non-translatable values are stored once**: ids, `level`, `href`, `icon`, `copy`, `orgHref`, contact `value`, experience years, `person.monogram`, `person.address`, `person.sameAs`, all `settings`.
4. **Structural constants stay in code, not in the admin**: language codes, paths (`/`, `/ka/`), `dir`, `og:locale`, the eight section keys and their anchors (`#work-style` is a public URL), the three skill levels. Changing any of these is a code change. *(Schema v2: their order is no longer one of them — see decision 6.)*
5. **Every list item has a stable `id`**, unique within its list. The admin adds, removes and reorders by id.
6. **The section set is fixed** (8 sections, fixed keys and anchors). Each section has an optional short `nav` label; when it is `null`, the title is the nav label. *(Schema v2, `content-editing.md`: the order is content — `settings.sectionOrder` — and any section can be hidden with `sections.<key>.hidden`. The numbering `01…0n` follows the shown sections; the anchors never change.)*
7. **Templates never read `site.json` directly.** They read `localize(site, lang)` (the per-language tree) plus `ctx` (non-text data from `siteContext(site)`, the other language's tree, asset names and the layout manifest).
8. **Rendering is a pure function**: `renderSite(site, { layout, palette, assets })` returns `{ path: string }`. `build.mjs` writes it to disk; the admin preview serves the same strings from memory. There is exactly one renderer.
9. **Phased delivery.** Phase 1 (this plan) changes no output byte. Palettes, theme default and CSS fixes follow in phase 2; Studio and Ledger register in phase 3; the admin in phase 4 (§11).

---

## 2. Top-level shape

```text
site.json
├── schemaVersion   1
├── settings        layout, palette, defaultTheme, updated, autoUpdateDateOnPublish, siteUrl
├── person          givenName*, familyName*, alternateName*, monogram, address, sameAs
├── meta            title*, description*
├── ui              chrome strings* (nav, skip link, theme, copy, levels, present, footer, …)
├── hero            eyebrow*, role*, subrole*, tagline*, location*, availability*, facts[4]
├── contact         heading*, items[]
└── sections        profile, skills, abilities, workstyle, principles, experience, languages, contact
                    (* = localized {en, ka})
```

Condensed example (one item per list; the full file is `site.example.json`):

```json
{
  "schemaVersion": 1,
  "settings": {
    "layout": "precision", "palette": "cobalt", "defaultTheme": "system",
    "updated": "2026-06-07", "autoUpdateDateOnPublish": false, "siteUrl": "https://samsiani.me"
  },
  "person": {
    "givenName": { "en": "Giorgi", "ka": "გიორგი" },
    "familyName": { "en": "Samsiani", "ka": "სამსიანი" },
    "alternateName": { "en": "George Samsiani", "ka": "Giorgi Samsiani" },
    "monogram": "GS",
    "address": { "locality": "Tbilisi", "country": "GE" },
    "sameAs": ["https://github.com/Samsiani", "https://samsiani.com", "https://codeon.ge"]
  },
  "meta": { "title": { "en": "…", "ka": "…" }, "description": { "en": "…", "ka": "…" } },
  "ui": { "skip": { "en": "Skip to content", "ka": "კონტენტზე გადასვლა" }, "…": "…",
          "levels": { "core": { "en": "Core", "ka": "ძირითადი" }, "strong": {}, "working": {} },
          "present": { "en": "present", "ka": "დღემდე" } },
  "hero": {
    "eyebrow": { "en": "Curriculum vitae · 2026", "ka": "რეზიუმე · 2026" }, "…": "…",
    "facts": [ { "id": "years-of-experience", "value": { "en": "10+", "ka": "10+" },
                 "label": { "en": "years of experience", "ka": "წლის გამოცდილება" } } ]
  },
  "contact": {
    "heading": { "en": "Contact", "ka": "კონტაქტი" },
    "items": [ { "id": "email", "label": { "en": "Email", "ka": "ელფოსტა" }, "value": "contact@samsiani.com",
                 "href": "mailto:contact@samsiani.com", "icon": "mail", "copy": true } ]
  },
  "sections": {
    "profile":  { "nav": null, "title": {}, "lead": null, "paragraphs": [ { "id": "intro", "text": {} } ] },
    "skills":   { "nav": null, "title": {}, "lead": {}, "groups": [ { "id": "front-end-ui", "title": {}, "lead": {},
                  "items": [ { "id": "next-js-16", "name": { "en": "Next.js 16", "ka": "Next.js 16" },
                               "detail": { "en": "App Router, server actions", "ka": "App Router, server actions" },
                               "level": "core" } ] } ] },
    "abilities":  { "nav": null, "title": {}, "lead": {}, "items": [ { "id": "store-rescue", "title": {}, "text": {} } ] },
    "workstyle":  { "…": "same shape as abilities" },
    "principles": { "…": "same shape as abilities" },
    "experience": { "nav": null, "title": {}, "lead": null, "items": [ { "id": "samsiani-web", "from": 2018, "to": null,
                    "role": {}, "org": {}, "orgHref": "https://samsiani.com", "text": {} } ] },
    "languages":  { "nav": null, "title": {}, "lead": null, "items": [ { "id": "georgian", "name": {}, "proficiency": {} } ] },
    "contact":    { "nav": null, "title": {}, "lead": {}, "cta": {}, "primary": "email", "buttons": ["github", "phone"] }
  }
}
```

---

## 3. Field reference

Notation: **L** = localized string `{en, ka}`, both required and non-empty. **L?** = `null` or a full L. **S** = string. **Max** = maximum length in Unicode code points (`[...s].length`), per language. Every string, localized or not, also passes the global text rules in §4.2. "Cur" = longest current value, en/ka.

### 3.1 `settings` (all required)

| Field | Type | Rule | Default | Notes |
|---|---|---|---|---|
| `layout` | enum | `Object.keys(LAYOUTS)` from `src/layouts/index.mjs`: `precision` now; `studio`, `ledger` once registered | `precision` | Unknown value = error in both modes. |
| `palette` | enum | ids in `src/palettes.json`: `cobalt lime emerald amber crimson graphite` | `cobalt` | Save mode: error. Build mode: warning `PALETTE_FALLBACK`, default palette used (palettes.md §5.3). |
| `defaultTheme` | enum | `system` \| `light` \| `dark` | `system` | Theme for visitors with no stored choice (§5.4). |
| `updated` | S | `YYYY-MM-DD`, a real calendar date | `2026-06-07` | Drives the footer date, the © year and sitemap `lastmod`. Warning `FUTURE_DATE` when after today. |
| `autoUpdateDateOnPublish` | bool | | `false` | See §12.3 for the exact publish rule. |
| `siteUrl` | S | `^https://host(.host)+$`, lowercase, no path, no port, no trailing slash, max 100 | `https://samsiani.me` | Canonical origin. `og:site_name` is its host. |

### 3.2 `person`

| Field | Type | Max | Cur | Notes |
|---|---|---|---|---|
| `givenName` | L | **10** | 6/6 | Rendered on its own line at display size (§7). |
| `familyName` | L | **10** | 8/8 | Display name = `givenName + " " + familyName`. |
| `alternateName` | L | 40 | 15/15 | JSON-LD `alternateName` (en page "George Samsiani", ka page "Giorgi Samsiani"). |
| `monogram` | S | 1–3, `^[A-Z0-9]{1,3}$` | 2 | The "GS" mark. |
| `address.locality` | S | 40 | 7 | JSON-LD only ("Tbilisi" on both pages). |
| `address.country` | S | `^[A-Z]{2}$` | 2 | ISO 3166-1 alpha-2. |
| `sameAs` | S[] | 0–8 items, each `https:` href, max 200 | 3 | JSON-LD `sameAs`. Stored explicitly so that adding a client with an `orgHref` never makes it "sameAs" the owner. Warning on duplicates. |

### 3.3 `meta`

| Field | Type | Max | Cur | Notes |
|---|---|---|---|---|
| `title` | L | 90 (warning `LONG` above 80) | 76/76 | `<title>`, og/twitter title. |
| `description` | L | 260 (warning above 220) | 194/208 | Long-text lints apply. |

### 3.4 `ui` (all L, all required)

| Field | Max | Cur | Current value (en / ka) | Where it shows |
|---|---|---|---|---|
| `skip` | 32 | 15/18 | Skip to content / კონტენტზე გადასვლა | skip link |
| `nav` | 24 | 8/8 | Sections / სექციები | nav `aria-label`, menu button label |
| `theme` | 32 | 19/12 | Toggle colour theme / თემის შეცვლა | theme button `aria-label` + `title` |
| `themeShort` | 10 | 5/4 | **Theme / თემა** (new) | Ledger's visible "◐ Theme" label |
| `print` | **16** | 11/14 | Save as PDF / PDF-ად შენახვა | print button |
| `printShort` | **4** | 3/3 | PDF / PDF | print button below 480 px |
| `language` | 16 | 8/3 | Language / ენა | language nav `aria-label` |
| `langShort` | **4** | 2/4 | EN / ქართ | language switch cell (this page's own label) |
| `langSwitch` | 16 | 10/8 | In English / ქართულად | switch `title`, footer link (shown on the *other* page) |
| `copy` | **8** | 4/4 | copy / ასლი | copy chip |
| `copied` | **12** | 6/9 | copied / დაკოპირდა | copy chip after click |
| `legend` | 24 | 12/16 | Depth of use / გამოყენების დონე | skills legend `aria-label` |
| `levels.core` `.strong` `.working` | **14** | 7/11 | Core, Strong, Working / ძირითადი, საფუძვლიანი, სამუშაო | level labels |
| `levelHints.core` `.strong` `.working` | 32 | 17/24 | daily, production · regular · as needed | legend |
| `colGroup` `colSkill` `colDepth` | 14 | 5/5 | **Group, Skill, Depth / ჯგუფი, უნარი, დონე** (new) | Ledger skills table header |
| `present` | 12 | 7/6 | present / დღემდე | open experience period |
| `atAGlance` | 24 | 11/6 | At a glance / მოკლედ | intro `aria-label` |
| `updated` | 24 | 12/14 | Last updated / ბოლოს განახლდა | footer |
| `builtWith` | 48 | 30/37 | Plain HTML & CSS · no trackers | footer |
| `top` | 24 | 11/15 | Back to top / ზემოთ დაბრუნება | footer |

The four **new** strings (`themeShort`, `colGroup`, `colSkill`, `colDepth`) are seeded by the migration. Their Georgian values need the owner's review before the Ledger layout ships; the Ledger plan may change the wording but must keep the keys.

### 3.5 `hero`

| Field | Type | Max | Cur | Notes |
|---|---|---|---|---|
| `eyebrow` | L | 32 | 23/14 | "Curriculum vitae · 2026". Warning `EYEBROW_YEAR` when it contains a year different from `settings.updated`. |
| `role` | L | 40 | 24/24 | |
| `subrole` | L | 80 | 54/58 | |
| `tagline` | L | 180 | 123/130 | long-text lints |
| `location` | L | 32 | 16/19 | |
| `availability` | L | 48 | 19/32 | |
| `facts` | list | **exactly 4** | 4 | All three layouts are drawn for a 4-cell strip / 2×2 bento. |
| `facts[].id` | id | | | |
| `facts[].value` | L | **10** | 9/9 | Warning `LONG_WORD` when a word is longer than 7 Latin or 4 Georgian letters (§7). |
| `facts[].label` | L | **24** | 19/20 | |

### 3.6 `contact`

| Field | Type | Max | Cur | Notes |
|---|---|---|---|---|
| `heading` | L | 16 | 7/8 | rail `aria-label`; Studio shows it. |
| `items` | list | 1–6 | 4 | order = display order |
| `items[].id` | id | | | referenced by `sections.contact.primary` / `buttons` |
| `items[].label` | L | **14** | 6/8 | screen-reader label in Precision, visible in Ledger. |
| `items[].value` | S | 40 | 20 | the visible text; same in both languages. Warning `VALUE_HREF` when it does not match the href. |
| `items[].href` | S | 200 | 27 | `https:` \| `mailto:` \| `tel:` only (§4.3). Kind is derived from the scheme: `mailto:` email, `tel:` phone, `https:` link (`rel="me noopener"`). |
| `items[].icon` | enum | | | keys of `CONTACT_ICONS` in `src/shared/icons.mjs`: `mail phone github globe`. A new icon is a code change. |
| `items[].copy` | bool | | | shows the copy chip |

### 3.7 `sections`

Every section object starts with the same three fields:

| Field | Type | Max | Notes |
|---|---|---|---|
| `nav` | L? | **28** | Short label for top/side navs. `null` → the title is the nav label. |
| `title` | L | 40 | `<h2>`. When `nav` is `null`, the title must also satisfy the nav rules (28 each, 100 total). |
| `lead` | L? | 200 (contact: 160) | Rendered under the title when not null. Long-text lints. |

| Section key | Anchor | Extra fields |
|---|---|---|
| `profile` | `#profile` | `paragraphs`: 1–6 × `{ id, text: L max 600 }` (cur 4; 423/455) |
| `skills` | `#skills` | `groups`: 1–10 × `{ id, title: L 40, lead: L 100, items: 1–16 × { id, name: L 60, detail: L? 90, level: core\|strong\|working } }` (cur 7 groups, max 10 items; name 41/46, detail 49/51) |
| `abilities` | `#abilities` | `items`: 1–12 × `{ id, title: L 64, text: L 280 }` (cur 9) |
| `workstyle` | `#work-style` | same as abilities (cur 6) |
| `principles` | `#principles` | same as abilities (cur 6; title 43/53, text 120/151) |
| `experience` | `#experience` | `items`: 1–10 × `{ id, from: int 1970–2100, to: int ≥ from \| null, role: L 48, org: L 40, orgHref: https-href \| null, text: L 600 }` (cur 3; text 416/493). `to: null` = "present". `from === to` renders a single year. |
| `languages` | `#languages` | `items`: 1–6 × `{ id, name: L 24, proficiency: L 32 }` (cur 2) |
| `contact` | `#contact` | `cta: L 24` (cur 11/8), `primary: id` of a `mailto:` contact item (big email + main button), `buttons`: 0–3 contact item ids (ghost buttons; a link shows its label, email/phone show the value). |

There is no education or certificates section, and the schema rejects any extra section key (`UNKNOWN_KEY`).

### 3.8 ids

- Pattern `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$` (1–40 chars). Unique within their own list; the same id may appear in two different lists (`headless-wordpress` is both a skill and an ability).
- Migration ids are slugs of the English text, cut at a hyphen near 32 characters (`check-the-code-before-blaming`), with `-2`, `-3` on collision. Paragraph ids are hand-named: `intro stack integrations plugins`. Contact ids: `email phone github web`.
- Ids never change when text changes. The admin creates new ids as 8 random lowercase base36 characters (`crypto.getRandomValues`), retrying on collision within the list.

---

## 4. Validation

Reference: `docs/plans/data-model-ref/src/schema/validate.mjs` (zero dependencies). Exports `buildSchema()`, `validate()`, `hrefError()`, `canonicalize()`, `limitsTable()`.

```js
validate(site, { paletteIds, layoutIds, mode: 'save' | 'build', today: 'YYYY-MM-DD' })
  -> { errors: [{ path, code, msg }], warnings: [{ path, code, msg }] }
```

`path` uses `$` and indexes, e.g. `$.sections.skills.groups[2].items[0].name.ka`, so the admin can put the message next to the exact input.

### 4.1 Where it runs

- `build.mjs`: `mode: 'build'`, `layoutIds = Object.keys(LAYOUTS)`, `paletteIds` from `palettes.json`. Any error prints every message and exits 1 before anything is written. Warnings print and do not stop the build.
- Admin API (save and publish): `mode: 'save'`. Errors → HTTP 400 with the error list; nothing is stored. Warnings are returned with the 200. Request bodies over **256 KB** are rejected before parsing (the maximum-size fixture is 207 KB pretty-printed, 168 KB as a compact request body).

### 4.2 Text rules (every string value, both languages)

| Code | Level | Rule |
|---|---|---|
| `TYPE`, `EMPTY`, `MISSING`, `MISSING_LANG` | error | right type; required fields present; L has both `en` and `ka`; no empty strings |
| `LANG_KEY` / `RUSSIAN` | error | an L object has keys other than `en`/`ka` (`ru` → `RUSSIAN`) |
| `WHITESPACE` | error | leading or trailing whitespace (the admin trims on blur) |
| `CONTROL_CHAR` | error | any C0/C1 control character, including line breaks, or U+2028/U+2029. Paragraphs are separate list items, never newlines. |
| `CYRILLIC` | error | any character in U+0400–U+052F, U+1C80–U+1C8F, U+2DE0–U+2DFF, U+A640–U+A69F |
| `RUSSIAN` | error | the token `RU` (whole word, case-sensitive), or "russian" / "რუსულ" (case-insensitive) anywhere. Enforces "no Russian anywhere", including old copy such as "KA · EN · RU". |
| `TOO_LONG` | error | over the field's max (§3) |
| `PATTERN`, `ENUM`, `INT`, `ID`, `DATE` | error | field-specific formats |
| `UNKNOWN_KEY` | error | any key the schema does not define, at any depth |
| `COUNT` | error | list size outside its range |
| `DUPLICATE_ID` | error | id repeated within one list |
| `LONG` | warning | `meta.title` > 80, `meta.description` > 220 |
| `DOUBLE_SPACE` | warning | two consecutive spaces |
| `MTAVRULI` | warning | Georgian Mtavruli capitals (U+1C90–U+1CBF); Georgian is stored in Mkhedruli |
| `GEORGIAN_IN_CAPS` | error (both modes; not draft-blocking) | a Georgian letter in the `.en` value of a field that layouts render with `text-transform` on `/`, where `--caps` is `uppercase` and the browser would turn Mkhedruli into Mtavruli: `hero.eyebrow`, `hero.facts[].label`, `contact.heading`, `contact.items[].label`, `ui.copy`, `ui.copied`, `ui.levels.*`, `ui.present`, `ui.print`, `ui.printShort`, `ui.nav`, `ui.colGroup`, `ui.colSkill`, `ui.colDepth`, `sections.languages.items[].name`, `sections.languages.items[].proficiency`, `sections.contact.cta` |
| `UNTRANSLATED` | warning | a long-text field (`tagline`, leads, paragraphs, item texts, experience text, `meta.description`) whose `ka` value contains no Georgian letter |
| `WRONG_LANGUAGE` | warning | a long-text `en` value that contains Georgian letters |

Content is plain text. Templates escape every string with `esc()`; nothing in `site.json` is ever inserted as HTML, CSS or script.

### 4.3 Link rules (`hrefError`)

1. Reject any whitespace or control character anywhere (defeats `java\tscript:` and `javascript :`). Error `HREF_WHITESPACE`.
2. Require a scheme; relative URLs are rejected (`HREF_RELATIVE`).
3. Allowed schemes: contact items `https:` `mailto:` `tel:`; `orgHref` and `person.sameAs` `https:` only. Anything else (`javascript:`, `data:`, `vbscript:`, `http:`, `file:`, `ftp:`) → `HREF_SCHEME`. Schemes must be lowercase (`HREF_SCHEME_CASE`).
4. `https:` must parse with `new URL()`, start with `https://`, have a dotted lowercase hostname and no credentials (`HREF_INVALID`, `HREF_HOST`, `HREF_CREDENTIALS`).
5. `mailto:` must be exactly one address, no query: `^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$` (blocks `?bcc=` / `?body=` injection) → `HREF_MAILTO`.
6. `tel:` must be E.164: `^tel:\+[1-9][0-9]{6,14}$` → `HREF_TEL`.

### 4.4 Cross-field rules

| Code | Level | Rule |
|---|---|---|
| `NAV_LABEL` | error | a section with `nav: null` whose title is longer than 28 in either language |
| `NAV_BUDGET` | error | the 8 effective nav labels (`nav ?? title`) total more than **100** characters in one language (cur en 95, ka 99) |
| `PERIOD_ORDER` | error | `to` earlier than `from` |
| `FUTURE_YEAR` | warning | `from` or `to` later than the year of `settings.updated` |
| `REF` / `REF_PRIMARY` | error | `sections.contact.primary` must name a contact item whose href is `mailto:`; every id in `buttons` must exist, no repeats |
| `REDUNDANT` | warning | the primary item also listed in `buttons` |
| `VALUE_HREF` | warning | `mailto:` value differs from the address; `tel:` value (spaces, dots, dashes, brackets removed) differs from the number; an `https:` value is not the start of the link without the scheme |
| `EYEBROW_YEAR` | warning | a year in `hero.eyebrow` differs from the year of `settings.updated` |
| `LONG_WORD` | warning | a word in `facts[].value` longer than 7 Latin / 4 Georgian letters |
| `LONG_TOKEN` | warning | a whitespace-free run longer than 24 characters in a `title`, `name`, `role` or `lead` under `hero` or `sections` (it can only break mid-word; layouts wrap it with `overflow-wrap: break-word` on `body`) |
| `FUTURE_DATE` | warning | `settings.updated` after today |
| `PALETTE_FALLBACK` | warning | build mode only: unknown palette id |

### 4.5 Modes

`save` and `build` differ in one rule only: an unknown `settings.palette` is an error when saving and a fallback warning when building, as the palettes plan requires for a palette that was removed after it was saved.

### 4.6 Canonical serialization

`canonicalize(site)` rebuilds the object in schema key order, drops unknown keys and returns `JSON.stringify(…, null, 2) + "\n"`. The admin writes `site.json` only through it (after `validate` passes), so git diffs show only real edits. Verified: `canonicalize(example) === file`.

---

## 5. `localize(site, lang)` and the template context

Reference: `docs/plans/data-model-ref/src/shared/localize.mjs`.

### 5.1 Contract

`localize(site, lang)` returns exactly the tree `src/content/<lang>.mjs` holds today (same keys, same values, same key order) plus the additive keys in 5.2. The Precision template therefore needs only the edits listed in §8.3; the rest of its markup is unchanged. Constants exported next to it: `LANGS ['en','ka']`, `DEFAULT_LANG 'en'`, `LOCALES`, `SECTIONS`, `ANCHOR`, `LEVELS`, `DETAIL_SEP ' · '`, `PERIOD_SEP ' — '`, and the helpers `altOf`, `joinName`, `formatPeriod`, `displayName`, `hrefKind`.

| Legacy path in the per-language tree | Source |
|---|---|
| `lang` | argument |
| `dir`, `path`, `altPath`, `meta.ogLocale` | `LOCALES[lang]`, `LOCALES[alt]` (`ltr`, `/`, `/ka/`, `en_US`, `ka_GE`) |
| `selfLabel`, `altLabel`, `altTitle` | `ui.langShort[lang]`, `ui.langShort[alt]`, `ui.langSwitch[alt]` |
| `meta.title`, `meta.description` | `meta.*[lang]` |
| `ui.*` (the 15 legacy keys, `levels`, `levelHints`) | `ui.*[lang]` |
| `hero.name` | `displayName(person, lang)` |
| `hero.eyebrow … availability`, `hero.facts[]` | `hero.*[lang]` |
| `contact.heading`, `contact.items[]` | `contact.heading[lang]`; items: `label[lang]`, shared `value/href/icon`, `copy: true` only when true |
| `sections.<k>.id` | `ANCHOR[k]` |
| `sections.<k>.title`, `.lead` | `[lang]`; `lead` key only when not null |
| `sections.profile.paragraphs[]` | `paragraphs[].text[lang]` (plain strings) |
| `sections.skills.groups[].items[].name`, `.level` | `joinName(name[lang], detail?.[lang])`, `level` |
| `sections.{abilities,workstyle,principles}.items[]` | `title[lang]`, `text[lang]` |
| `sections.experience.items[].period` | `formatPeriod(from, to, ui.present[lang])` |
| `sections.experience.items[].orgHref` | only when not null |
| `sections.education` | from `sections.languages`: `id 'languages'`, `title`, `langsTitle = title`, `langs[] = { name, level: proficiency }` |
| `sections.contact` | `id`, `title`, `lead`, `cta` |

### 5.2 Additive keys (ignored by the legacy template; used by the refactored and new layouts)

`ui.present`, `ui.themeShort`, `ui.colGroup`, `ui.colSkill`, `ui.colDepth` · `hero.givenName`, `hero.familyName` · `id` on every list item (`hero.facts[]`, `contact.items[]`, skill groups and items, abilities, workstyle, principles, experience, `education.langs[]`; profile paragraphs stay plain strings) · skill items `label` (name without detail) and `detail` (or `null`) · experience items `from`, `to` · `navLabel` on all 8 sections (`nav ?? title`) · `sections.contact.primary` (the localized primary contact item) and `sections.contact.buttons` (localized items, in order).

Rule for later work: new data needed by a layout is added to the schema (optional with a fallback, or required with a migration seed) and exposed as another additive key. No layout reads `site.json` directly and no layout hard-codes content.

### 5.3 `siteContext(site)` → `ctx`

`build.mjs` passes `ctx = { ...siteContext(site), alt: localize(site, altLang), assets, layout: layout.meta }` to both `renderHead` and the layout's `renderBody`.

| `ctx` key | Value | Replaces this hard-coded value |
|---|---|---|
| `siteUrl`, `host` | `settings.siteUrl`, its host | `SITE`; `og:site_name "samsiani.me"` |
| `updated` | `settings.updated` | `BUILD_DATE \|\| '2026-06-07'` |
| `layoutId`, `paletteId`, `defaultTheme` | `settings.layout`, `settings.palette`, `settings.defaultTheme` | — |
| `person` | `site.person` | `'GS'`, `alternateName`, JSON-LD `address`, `sameAs` |
| `authorName` | `displayName(person, 'en')` | `<meta name="author" content="Giorgi Samsiani">` |
| `email` | primary contact href (`mailto:…`, as shipped today) | JSON-LD `email` |
| `telephone` | first `tel:` item without `tel:` | JSON-LD `telephone` |
| `alt` | the other language's localized tree | `ctx.alt` (unchanged) |
| `assets` | `{ cssHref, jsHref, og: { en, ka } }` | `cssHref`, `jsHref`, `/og-<lang>.png` |
| `layout` | the layout manifest (`preload`, `themeColor`, …) | preload list, `theme-color` hex values |

Also derived: `profile:first_name/last_name` from `hero.givenName/familyName`; JSON-LD `knowsAbout` from core skill `label`s; `worksFor` from experience items with `orgHref` **and `to === null`** (current roles only; today this gives the same two organizations); manifest `name` = display name + " — " + `hero.role.en`, `short_name` = `familyName.en`.

### 5.4 Default theme

`src/shared/theme-init.mjs` emits the inline head script. Precedence: `?theme=` URL parameter > the visitor's stored choice (`localStorage.theme`) > `settings.defaultTheme` > OS preference. For `system` it emits byte-for-byte today's script. For `light`/`dark` it adds `if(t!=='dark'&&t!=='light'){t='<default>'}` before applying, and sets the default in the `catch` branch as well (storage blocked). `main.js` needs no change: it already reads `html[data-theme]`.

---

## 6. Migration

`docs/plans/data-model-ref/scripts/migrate-content.mjs` → copy to `scripts/migrate-content.mjs`. Exports `migrate(en, ka)` and `slug()`. Run as a CLI:

```bash
node scripts/migrate-content.mjs
# note: sections.education.langsTitle dropped (equals title in both languages); localize() re-derives it.
# wrote src/content/site.json (63672 bytes); round trip exact for en and ka
```

The CLI writes nothing and exits 1 if there is any conflict, any legacy value that `localize()` does not reproduce, or any validation error. The output must be byte-identical to `docs/plans/site.example.json` (`cmp` it). It was.

Order of operations for the builder:

1. `git switch -c content-model` (the owner commits; do not commit from the plan).
2. `node build.mjs && mv dist /tmp/dist-before` (the build of the current code).
3. Copy the reference files (§8.1), then `node scripts/migrate-content.mjs`.
4. `cmp src/content/site.json docs/plans/site.example.json`.
5. Delete `src/content/en.mjs`, `src/content/ka.mjs`, `src/template.mjs`. Move `src/styles.css` and `src/fonts.css` into `src/layouts/precision/`.
6. `node build.mjs && diff -r dist /tmp/dist-before` → must print nothing.
7. Keep `scripts/migrate-content.mjs` until phase 4 ships, then delete it (it imports the deleted modules and only runs against a checkout from before step 5).

---

## 7. Length limits and how they were measured

Measured with Playwright against the live build and the real self-hosted fonts (Chivo, JetBrains Mono, Noto Sans Georgian) at the sizes Precision uses. Georgian runs 20–30% wider per character than Latin in the same slot.

| Field (per language) | Cur en/ka | Limit | Basis |
|---|---|---|---|
| `person.givenName`, `familyName` | 6/6, 8/8 | **10** | Each part is one line of the Precision rail `<h1>`: the box is 263 px at ≥ 1080 px. "Samsiani" = 191 px (Chivo 600 45 px, 23.8 px/char); "სამსიანი" = 178 px (Noto 600 38 px, 22.2 px/char). An 11-letter Georgian name ("კონსტანტინე") overflows by 4 px; 10 letters leave ≥ 2 px (verified with "ალექსანდრე"/"სამსიანიძე"). Studio (92 px wide display in a ~716 px tile) and Ledger (76 px, one line) are looser. |
| effective nav label (`nav ?? title`) | 25/28 | **28**, total **100** | Precision top nav, 13 px: en 6.43 px/char, ka 8.33 px/char, 22 px gaps. Today en needs 765 px and gets 739 px at 1280 px, so four links wrap into two lines between 1280 and 1305 px (live bug, §9). At the full budget with a 10+10 name, en fits from 1440 px and ka from 1680 px. Studio and Ledger must pass the same fixture. |
| `hero.facts[].value` | 9/9 | **10**, plus `LONG_WORD` | The narrowest fact cell is 107 px (Precision at 720 px). Chivo 600 30 px: "WP · Next" 129 px (wraps at its spaces), "Laravel" 104 px, "WordPress" 157 px, "TypeScript" 150 px; Georgian "წელი" 84 px, "ათწლე" 110 px. Unbreakable words longer than 7 Latin / 4 Georgian letters therefore cannot fit, which is why layouts must set `overflow-wrap: anywhere` on fact values (§9). |
| `hero.facts[].label` | 19/20 | **24** | 10.5 px mono uppercase = 7.14 px/char → 15 per line in 107 px; ≤ 2 lines. |
| `ui.levels.*` | 7/11 | **14** | "საფუძვლიანი" = 78.7 px at 10.5 px. Precision's level column is `auto` with `min-width: 62px`; Ledger's Depth column is 150 px minus the 16 px marker. |
| `ui.print` / `printShort` | 11/14, 3/3 | **16 / 4** | The print button is 130 px in Georgian at ≥ 480 px; the short form shows below 480 px. The first measurement (0 px header overflow at 320 px) used the short values "ENG"/"PDF"; with `printShort` and `langShort` at 5 the header overflowed at 320 px in all three layouts (Precision EN +11 px, KA +22 px; Studio KA +4/+5 px at 320/600 px; Ledger KA +3 px). At 4, with every other header string at its limit, all three pass (Precision needs its < 380 px block, master plan §6 item 6). |
| `ui.copy` / `copied` | 4/4, 6/9 | **8 / 12** | chip 36–40 px; "დაკოპირდა" 60.5 px at 9.5 px |
| `ui.langShort` | 2/4 | **4** | language switch cell (82–90 px for both cells); 5 overflows the 320 px header, see `printShort` |
| `contact.items[].label` | 6/8 | **14** | Ledger label column 120 px at 11 px mono uppercase, 0.1 em ≈ 7.7 px/char |
| `contact.items[].value` | 20 | 40 | wraps anywhere in the rail; big email is 31 px with `overflow-wrap: anywhere` |
| `sections.contact.cta` | 11/8 | 24 | button |
| `ui.present` | 7/6 | 12 | "2018 — present" in Precision's 252 px item-head column |

Non-critical text fields have bounds that are about 1.3–2× the current maximum (§3). They stop layout damage from pasted paragraphs; they are not style rules. `limitsTable()` returns all 91 limits (`{ path, max, localized }`) for the admin's character counters.

Counts: facts exactly 4; contact items 1–6; paragraphs 1–6; skill groups 1–10 with 1–16 items each; abilities, workstyle, principles 1–12; experience 1–10; languages 1–6; `sameAs` 0–8; contact buttons 0–3. The `pad(i)` numbering supports up to 99.

---

## 8. Refactor: file tree and what moves where

### 8.1 Target tree (phase 1 files marked ●, later phases ○)

```text
build.mjs                          ● rewritten (reference: data-model-ref/build.mjs)
scripts/
  migrate-content.mjs              ● one-time migration CLI (delete after phase 4)
  check-layout-stress.mjs          ● layout robustness gate (§9)
test/fixtures/
  site.stress.json                 ● moved from docs/plans/site.stress.json
src/
  content/site.json                ● canonical content (replaces en.mjs + ka.mjs)
  render.mjs                       ● renderSite(site, { layout, palette, assets }) -> { path: string }
  schema/validate.mjs              ● buildSchema, validate, hrefError, canonicalize, limitsTable
  shared/
    localize.mjs                   ● LANGS, LOCALES, SECTIONS, LEVELS, localize(), siteContext(), helpers
    escape.mjs                     ● esc(), pad(), jsonForScript()
    icons.mjs                      ● UI_ICONS {theme, menu, arrow}, CONTACT_ICONS {mail, phone, github, globe}
    document.mjs                   ● renderHead(c, ctx) + renderDocument(c, ctx, body): doctype, <head>, skip link, script tag
    jsonld.mjs                     ● personJsonLd(c, ctx)
    theme-init.mjs                 ● themeInitScript(defaultTheme)
    fragments.mjs                  ● copyButton, themeToggle, printButton, langSwitchLink, orderedSections, isExternal
    sitemap.mjs                    ● sitemapXml(site), robotsTxt(site)
    manifest.mjs                   ● webmanifest(site, layoutMeta, palette)
    og.mjs                         ○ ogInputs(site, lang) + hashed OG names (OG/admin plan, §12.2)
  layouts/
    index.mjs                      ● LAYOUTS registry { precision } (+ studio, ledger in phase 3)
    precision/
      layout.mjs                   ● manifest: id, label, css[], fonts[], preload{en,ka}, themeColor{light,dark}, manifestBackground
      template.mjs                 ● renderBody(c, ctx): header + shell (from src/template.mjs)
      styles.css                   ● moved verbatim from src/styles.css (phase 2 edits: palettes.md §10 + §9 here)
      fonts.css                    ● moved verbatim from src/fonts.css
    studio/  {layout.mjs, template.mjs, styles.css, fonts.css}   ○ Studio plan
    ledger/  {layout.mjs, template.mjs, styles.css, fonts.css}   ○ Ledger plan
  palettes.json                    ○ moved from docs/plans/palettes.json (palettes plan)
  palettes.mjs                     ○ moved from docs/plans/check-palettes.mjs (palettes plan)
  main.js                          ● unchanged in phase 1 (shared runtime for every layout)
  fonts/*.woff2                    ● all faces for all layouts; each build copies only the active layout's `fonts[]`
  brand/make.mjs                   ● reads site.json through localize() (4-line change, §8.5)
  og-en.png, og-ka.png             ● unchanged until the OG pipeline lands
```

`data-model-ref/` mirrors these paths. Copy `data-model-ref/build.mjs` → `build.mjs`, `data-model-ref/src/…` → `src/…`, `data-model-ref/scripts/…` → `scripts/…`. The Precision `styles.css` and `fonts.css` are moved from the repo itself, not copied from the reference.

### 8.2 Layout module contract

```js
// src/layouts/<id>/layout.mjs
export default {
  id: 'precision',                       // = settings.layout value, = folder name
  label: 'A · Precision',                // admin picker label
  css: ['fonts.css', 'styles.css'],      // concatenated with "\n", then + palette CSS (phase 2)
  fonts: ['chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500', 'noto-sans-georgian-georgian-normal-400-700'],
  preload: { en: [/* woff2 basenames */], ka: [/* Georgian first */] },
  themeColor: { light: '#fafafb', dark: '#151619' },   // <meta name="theme-color">, = the layout's --bg
  manifestBackground: '#111318',
};
// src/layouts/<id>/template.mjs
export function renderBody(c, ctx) { /* returns everything between the skip link and the <script> tag */ }
```

`renderBody` must: render `<main id="main">` (the shared skip link targets it); give every section `id = sec.id`; use `sec.navLabel` in navs; escape every string with `esc()`; use the shared fragments for the copy, theme, print and language-switch controls (their `data-*` attributes are the `main.js` contract); never text-transform Georgian (keep the `--caps` pattern: `html[lang="ka"] { --caps: none }`).

### 8.3 `src/template.mjs` → where each part went

| Current code (line) | Goes to | Change |
|---|---|---|
| `esc`, `pad` (2–4) | `shared/escape.mjs` | verbatim; plus `jsonForScript` |
| `icons`, `contactIcons` (6–18) | `shared/icons.mjs` | verbatim (generated by slicing the original source), renamed `UI_ICONS`, `CONTACT_ICONS` |
| `splitName` (21–24) | removed | Precision uses `i.label` + `i.detail` (identical markup) |
| `order`, `navLinks` (32–36) | `precision/template.mjs` | `esc(sec.title)` → `esc(sec.navLabel)`; order from `fragments.orderedSections(c)` |
| `preload` (37–39) | `precision/layout.mjs` → `preload` | data |
| `jsonLd` (41–56) | `shared/jsonld.mjs` | literals → `ctx.person`, `ctx.email`, `ctx.telephone`; `knowsAbout` uses `label`; `worksFor` filters `to === null` |
| `contactList` (58–68) | `precision/template.mjs` | copy button via `fragments.copyButton` |
| `secHead`, `legend`, `skillGroups` (70–92) | `precision/template.mjs` | skill name via `label`/`detail` |
| `nameHtml` (94) | `precision/template.mjs` | `givenName + '<br>' + familyName` |
| `<!doctype>` … `</head>` (96–137) | `shared/document.mjs` → `renderHead`, `renderDocument` | author, theme-color, `og:site_name`, `og:image`, `profile:*`, preload and theme script from data; JSON-LD through `jsonForScript` |
| skip link (139) | `shared/document.mjs` | every layout gets it |
| topbar … footer (141–251) | `precision/template.mjs` → `renderBody` | `'GS'` → `ctx.person.monogram`; big email, CTA and ghost buttons from `s.contact.primary` / `s.contact.buttons`; `updated` → `ctx.updated`; theme/print/lang-switch via fragments |
| `<script src>` (253) | `shared/document.mjs` | |

### 8.4 `build.mjs`, `styles.css`, `main.js`

| Current | Goes to |
|---|---|
| `build.mjs`: `SITE_URL` / `BUILD_DATE` env | `settings.siteUrl` / `settings.updated`. The env vars remain local-preview overrides, applied **after** validation (so `SITE_URL=http://localhost:4173` works). New test overrides `LAYOUT=`, `PALETTE=` (applied before validation), `SITE_JSON=` (content path), `OUT_DIR=`. CI sets none of them. |
| `build.mjs`: CSS = `fonts.css + "\n" + styles.css` | `layout.meta.css` list, joined with `"\n"` (same bytes for Precision → same hash `b1754418`), then `+ paletteCss(...)` in phase 2 |
| `build.mjs`: `cp('src/fonts', 'dist/fonts')` | copies only `layout.meta.fonts` |
| `build.mjs`: sitemap, robots, manifest | `shared/sitemap.mjs`, `shared/manifest.mjs` (hreflang list from `LOCALES`) |
| `build.mjs`: `.htaccess`, `_headers` | stay in `build.mjs`, verbatim (server files, not content) |
| `src/styles.css` | `src/layouts/precision/styles.css`, verbatim in phase 1 |
| `src/fonts.css` | `src/layouts/precision/fonts.css`, verbatim |
| `src/main.js` | stays. Phase 3, backwards compatible: reveal selector `'.sec, .intro'` → `'.sec, .intro, [data-reveal]'`; menu `details.menu` → `details.menu, details[data-menu]`. Everything else is already attribute-driven (`[data-theme-toggle]`, `[data-print]`, `[data-copy]`, `[data-lang-switch]`, `a[data-spy]`). |

### 8.5 Other files

- `src/brand/make.mjs`: replace the two `import('../content/en.mjs'|'ka.mjs')` lines with `readFileSync(join(here, '..', 'content', 'site.json'))` and `localize(site, 'en' | 'ka')`. The rest reads `hero.eyebrow/name/role/subrole/facts`, which the localized tree still has. Reference: `data-model-ref/src/brand/make.mjs`.
- `README.md`: "Edit content" becomes "`src/content/site.json` (or the admin)"; "Structure" lists `src/render.mjs`, `src/shared/`, `src/schema/`, `src/layouts/<id>/`.
- `package.json` scripts: `"migrate": "node scripts/migrate-content.mjs"`, `"check:stress": "SITE_JSON=test/fixtures/site.stress.json OUT_DIR=/tmp/dist-stress node build.mjs && node scripts/check-layout-stress.mjs --dist /tmp/dist-stress"`.
- `.github/workflows/deploy.yml`: no change in phase 1 (`node build.mjs` still builds everything).

---

## 9. Layout robustness contract and the stress fixture

`site.stress.json` (revised 2026-09-15) sets every limited string, in every instance and both languages, to **exactly** its limit (words repeated from the field's own text and cut inside a word where needed), except `settings.siteUrl` (fixed by `SITE_URL` on the server and shown as Ledger's brand) and the nav labels, which total 98 (EN) / 99 (KA) of the 100-character budget with one label at 28. Header strings at their limits include `langShort` "ENGL"/"ქართ", `printShort` "Save"/"ბეჭდ", `copy` "Kopieren"/"კოპირება", `themeShort` "Appearance"/"ფერთასქემა", the three levels at 14 ("საფუძვლიანობით"), contact labels at 14. Every list is at its maximum (160 skill rows, 12 abilities), the name is 10+10 letters ("Alexandros Gelashvili" / "ალექსანდრე სამსიანიძე"), the monogram "KSM", the email value 40 characters, the null leads are filled, and there are unbreakable tokens: one 10-letter fact value per language ("TypeScript", "ათწლეულები"), the 29-letter "ინფრასტრუქტურისადმინისტრირება" in `sections.skills.title.ka` and "WordPress/WooCommerce/WPGraphQL/StoreAPI" as the first skill name. It validates with 0 errors and 10 expected warnings (`LONG` ×4, `LONG_TOKEN` ×3, `LONG_WORD` ×3). `test/unit/stress-fixture.test.mjs` keeps every `limitsTable()` row at its limit.

**Gate** (`scripts/check-layout-stress.mjs`): serves a built `dist/`, loads `/` and `/ka/` at 320, 360, 400, 600, 720, 1080, 1280, 1360, 1440, 1600, 1680 and 1920 px, and fails on (a) any horizontal page scroll, naming the offending elements, or (b) any top-nav link that wraps or a top nav that overflows its box (`--topnav <selector>`, default `.topnav`). Playwright is not a project dependency: set `PLAYWRIGHT=/path/to/playwright/index.mjs` (default: the same local path `src/brand/make.mjs` already uses).

The gate also fails when a served page is not HTTP 200 or lacks `main#main`, and when the last visible child of the header's inner row (`header > :first-child`) ends beyond `innerWidth - 8`.

**Every layout must pass the gate with `site.example.json` and with the stress fixture** before it can be registered in `LAYOUTS`. With the revised fixture all three layouts pass once the master plan's review edits are in (Precision M2 task 8, Studio E4, Ledger E6); without them Precision fails at EN 320 px (+57 px) and KA 320–400 px (+225/+185/+145 px), Ledger at EN 320 px (+21 px) and KA 320 px (+148 px).

Results for Precision today:

```text
live content, current CSS:     FAIL en 1280px: top nav links wrap: Stack & skills | What I can own end to end | How I work | Let’s talk
stress fixture, current CSS:   FAIL en 1280px, en 1360px: top nav links wrap
                               FAIL ka 320px: page scrolls horizontally by 15px (the fact cells: "ათწლეულები")
                               FAIL ka 1600px: top nav links wrap
stress fixture, fixes below:   PASS: 24 viewport checks
```

Phase 2 CSS fixes for `src/layouts/precision/styles.css` (tested by appending them to the built stylesheet):

```css
.topnav a { white-space: nowrap; }
.fact-value { overflow-wrap: anywhere; }
/* replace the two existing top-nav breakpoints */
@media (min-width: 1440px) { html[lang="en"] .topnav { display: flex; } }   /* was 1280px */
@media (min-width: 1680px) { .topnav { display: flex; } }                   /* was 1600px */
```

The first line of the live failure is a bug on the production site today (four links wrap into two lines between 1280 and 1305 px, confirmed with a screenshot). Below the new breakpoints the rail nav and the menu already cover navigation, so hiding the top nav there loses nothing.

---

## 10. Build pipeline (phase 1)

`data-model-ref/build.mjs`, in order:

1. Read `SITE_JSON` (default `src/content/site.json`). Apply `LAYOUT` / `PALETTE` test overrides.
2. `validate(site, { mode: 'build', layoutIds: Object.keys(LAYOUTS), paletteIds })`. Print warnings. On errors, print them all and `process.exit(1)` before touching `dist/`.
3. Apply the `SITE_URL` / `BUILD_DATE` preview overrides.
4. CSS = the layout's `css[]` joined with `"\n"` (+ palette block in phase 2) → `styles.<md5-8>.css`. JS = `src/main.js` → `main.<md5-8>.js`.
5. Copy the layout's fonts and the brand PNGs. `renderSite()` → `index.html`, `ka/index.html`, `404.html`, `sitemap.xml`, `robots.txt`, `site.webmanifest`.
6. Write `.htaccess` and `_headers` verbatim.
7. Log `built dist/ (precision, cobalt, styles.b1754418.css, main.1d55c0e3.js) · updated 2026-06-07`.

In phase 1 the palette table is the single entry `cobalt` with an empty CSS block and the old manifest colour `#1a4fd6`, so the output stays identical. Phase 2 replaces it with `loadPalettes()` / `paletteCss()` exactly as `palettes.md` §5 describes.

---

## 11. Phases and acceptance criteria

**Phase 1 — data refactor (this plan). No visible change.**
1. `node scripts/migrate-content.mjs` exits 0, and `src/content/site.json` is byte-identical to `docs/plans/site.example.json`.
2. `node build.mjs && diff -r dist /tmp/dist-before` prints nothing (19 files, binaries included).
3. `src/content/en.mjs`, `src/content/ka.mjs`, `src/template.mjs`, `src/styles.css`, `src/fonts.css` no longer exist. `grep -rn "content/en.mjs\|content/ka.mjs" src build.mjs` finds nothing.
4. Corrupting `site.json` (for example `contact.items[2].href = "javascript:alert(1)"`) makes `node build.mjs` exit 1, print `error HREF_SCHEME $.contact.items[2].href`, and leave the previous `dist/` untouched.
5. `SITE_URL=http://localhost:4173 node build.mjs` builds, and the pages reference `http://localhost:4173`.

**Phase 2 — palettes, default theme, robustness** (with `palettes.md`).
1. Palette tokens leave `precision/styles.css`; `paletteCss()` is appended; `<html data-layout data-palette>` is stamped in `shared/document.mjs`. All `palettes.md` §10 criteria hold.
2. The §9 CSS fixes are applied; `npm run check:stress` passes for Precision; the live-content gate passes.
3. `defaultTheme: "dark"` with empty storage renders dark on first paint; a stored `light` choice still wins; `?theme=light` wins over both.

**Phase 3 — Studio and Ledger.** Each registers in `LAYOUTS` only after it passes the gate with both fixtures and uses only the localized tree, `ctx`, and the shared fragments.

**Phase 4 — admin.** Edits go through `validate(mode 'save')` and `canonicalize()`; see §12.

---

## 12. Notes for the other plans

### 12.1 Admin: one writer, and where site.json lives

`deploy.yml` builds from the repository and uploads `dist/` with `rsync --delete`. If the admin rewrote `site.json` or `dist/` on the server only, the next code push would overwrite those edits with the repository copy. `site.json` must therefore have exactly one source of truth. Recommendation: **git**. On Publish, the admin server commits `src/content/site.json` through the GitHub contents API (`PUT /repos/{owner}/{repo}/contents/src/content/site.json`, sending the file's current `sha`, which gives optimistic locking for free), and the existing CI builds and deploys it. This matches the owner's rule that production changes go through CI and that a rollback is a revert. The token is a fine-grained, single-repository, contents-write token stored on the server outside the repository, never in it. Drafts and the preview never touch git: the preview calls `renderSite()` in memory. The final decision belongs to the admin plan, but it must pick one writer.

Editing rules the admin needs from this model:
- Generate the form from `buildSchema()`: EN and KA inputs side by side for every L field, counters from `limitsTable()`, a "copy EN → KA" action for strings that are the same in both (tool names).
- Lists: add (new 8-character base36 id), remove, reorder (buttons and keyboard, not only drag). Ids never change.
- Trim on blur; never submit strings with line breaks.
- Save: `validate(mode 'save')` on the server (400 + error list with `$.paths` → highlight inputs), then `canonicalize()`, then store. Use an ETag = sha256 of the stored canonical JSON, and `If-Match` on save.
- Layout picker = `Object.keys(LAYOUTS)` with each `label`; palette picker = `palettes.json` (palettes.md §8).

### 12.2 OG images

`og-en.png` / `og-ka.png` show `hero.eyebrow`, the display name, `hero.role`, `hero.subrole`, all four `hero.facts` (value + label), the host (hard-coded "samsiani.me" in `src/brand/og.html` today; use `ctx.host`) and two palette colours (palettes.md §7). Any change to these fields makes the images stale. The OG pipeline should compute `ogInputs(site, lang)` from exactly these fields, hash them into the file name (`og-en.<md5-8>.png`) because Cloudflare caches fixed names, and pass the name through `assets.og[lang]`; `shared/document.mjs` already reads it from there. Until that pipeline exists, the admin should show "OG image out of date" when the hash of `ogInputs` differs from the one the committed images were made from.

### 12.3 `autoUpdateDateOnPublish`

When `true`, Publish sets `settings.updated` to today's date in Asia/Tbilisi (`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date())`), but only when the canonical JSON of `person`, `meta`, `ui`, `hero`, `contact` or `sections` differs from the last published version. A publish that changes only `layout`, `palette` or `defaultTheme` keeps the date. When `false` (the default), the date changes only when the owner edits it; the live date is deliberately pinned to 2026-06-07.

### 12.4 Security properties this model guarantees

- All content is plain text and is escaped by `esc()` in every template. There is no rich-text field.
- JSON-LD goes through `jsonForScript()`, which escapes `<`, so no content can close the `<script type="application/ld+json">` element. The current template uses a bare `JSON.stringify`; that was harmless while content lived in code, but it becomes an injection point once the admin can edit `meta.description` or skill names.
- Only `https:`, `mailto:` and `tel:` links can be stored (§4.3).
- No content value reaches CSS or the inline theme script: palette and theme values are enums, and CSS is generated from `palettes.json` only.
- `site.json` contains no server detail. `siteUrl` is the public origin.

### 12.5 Layout plans

- Read only `c` (the localized tree) and `ctx`. Use `c.hero.givenName` / `familyName` for two-line names, `item.label` / `item.detail` for skill names, `sec.navLabel` for navs, `c.sections.contact.primary` / `buttons` for contact actions, and `c.ui.colGroup/colSkill/colDepth/themeShort` for Ledger chrome.
- Pass `scripts/check-layout-stress.mjs` with both fixtures; set `overflow-wrap: anywhere` on fact values, names at display size and contact values, and `overflow-wrap: break-word` on `body`; `white-space: nowrap` on top-nav links, with a breakpoint where the 100-character budget fits.
- `renderBody` must not throw for any document that passes the admin's draft rules: lists may be empty or over their maximum, KA strings empty, `c.sections.contact.primary` `null`. Escape every value, `ctx.updated` included.
- The design explorations contain old copy ("KA · EN · RU", "Georgian bank gateways", "Education", "Open to remote and contract work"). All copy comes from `site.json`; the validator rejects the Russian token outright.
