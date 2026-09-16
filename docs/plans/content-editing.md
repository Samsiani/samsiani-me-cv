# Content editing: removable lines, hidden and reordered sections — build plan

Owner request: "also any labels / content lines can be removable, move up / down in all" (every content
screen: Person & hero, Contact rail, Profile, Stack & skills, Abilities, How I work, Principles,
Experience, Languages, Let's talk, Interface strings).

Reads: `data-model.md` (§3 fields, §4 validation, §5 localize), `admin-layouts-palettes.md` (§5 layout
contract, §8 admin, §11 gates), `admin-ops.md` (§3.3 draft rules, §6 UI patterns), `layout-studio.md`,
`layout-ledger.md`. Schema version bumps 1 → 2 (§3.3). No new dependencies.

---

## 1. Summary

What exists: `admin/web/src/components/ListEditor.vue` already gives every schema list add / remove
(10 s undo) / move up / move down inside the list's `min`/`max`; `LField.vue` toggles the optional pairs
`nav`, `lead`, `detail` between `null` and `{en, ka}`. What is missing: single lines cannot be removed,
`hero.facts` is fixed at 4, every list needs at least 1 item, and the eight sections are a fixed set in a
fixed order (`SECTION_ORDER` in `src/shared/fragments.mjs`, hard-coded section sequence in every
`template.mjs`).

| Kind of content | Removable | Move up / down | Mechanism |
|---|---|---|---|
| List items (paragraphs, skills, groups, cards, positions, languages, contact items, `sameAs`, buttons) | today (min 1 stays, §2 D5) | today | `ListEditor` |
| Facts strip (`hero.facts`) | **new**: 0–4, strip disappears at 0 | today | `ListEditor`, min 0 |
| Single hero lines: eyebrow, subrole, tagline, location, availability | **new** (`null`) | no (D6) | `LField` optional + undo |
| Skills group lead, "Let's talk" button text (`cta`), footer `ui.builtWith` | **new** (`null`) | — | `LField` optional + undo |
| Section `nav`, `lead` | today | — | `LField` |
| Whole sections (8) | **new**: hide / show | **new**: reorder; numbering follows the shown order | `settings.sectionOrder` + `sections.<k>.hidden`, "Section order" tab |
| Contact rail | items removable/reorderable today; the primary email item is locked while it is the primary | today | `ListEditor` lock |
| Interface strings | only `builtWith` (D7); the rest show why they stay | — | Interface strings tab |
| Name, monogram, role, page title/description, contact heading, section titles | never (D8) | — | reason shown in the form |

Out of scope: reordering lines inside the hero or inside a section head; moving items between
sections; new sections; removing anchors or languages; per-layout placement of lines; drag and drop
(buttons and keyboard only, as `ListEditor`).

---

## 2. Owner decisions (recommendation in bold)

**D1 · Whole sections.** (a) keep the fixed set; (b) hide/show only; **(c) hide/show and reorder**: a
hidden section is not rendered at all (no markup, no nav link, no anchor), the shown sections are numbered
`01…0n` in `settings.sectionOrder`, anchors (`#work-style`, …) never change, the nav budget counts shown
sections only. A hidden section keeps its content and is still validated.

**D2 · Where the section controls live.** (a) Dashboard; (b) buttons inside the content tab list;
**(c) a "Section order" content tab** (a `ListEditor`-style list with Move up / Move down / Hide / Show
and an "Edit" link per section) **plus a "Hide this section" / "Show this section" button at the top of
each section's own tab**; the tab list follows the order and marks hidden tabs.

**D3 · Which single lines become optional.** (a) none beyond `nav`/`lead`/`detail`; **(b) eight lines:
`hero.eyebrow`, `hero.subrole`, `hero.tagline`, `hero.location`, `hero.availability`,
`sections.skills.groups[].lead`, `sections.contact.cta`, `ui.builtWith`**; (c) also `hero.role` and
`contact.heading` (rejected: `role` is the JSON-LD `jobTitle`, the `og:image:alt` and the manifest name;
`contact.heading` is the accessible name of the contact list).

**D4 · Facts strip.** (a) exactly 4; **(b) 0–4**, every layout renders 1–4 cells and omits the strip at 0
(§4.3); (c) 0–6 with wrapping (rejected: the OG card and Ledger strip are drawn for 4).

**D5 · List minimums.** (a) 0 everywhere and a section with an empty list hides itself; **(b) keep
min 1 for the lists that make a section or a group (paragraphs, skill groups and their items, cards,
positions, languages, contact items) and make the container removable instead**: the Remove button at the
minimum stays focusable and says "At least 1 paragraph must stay; to remove the whole section, hide it
under Section order" (skills: "remove the group instead"); (c) 0 with an empty heading rendered (rejected).

**D6 · Hero lines.** **(a) removable only**; (b) reorderable (rejected: each layout composes the hero
differently — rail, bento tile, spine — and a slot order would need per-layout rules).

**D7 · Interface strings.** (a) all stay required; **(b) only `ui.builtWith` (the footer tagline) becomes
optional**; every other `ui.*` string names a control, a landmark or a state (skip link, nav labels, theme
and print buttons, language switch, copy chip, level words, legend, table headers, "present", footer
labels) and is shown in the form with a "Required" chip and the reason; (c) `legend`/`levelHints` optional
too (rejected: the legend is one unit; hide the skills section instead).

**D8 · Always present.** **`person.givenName`/`familyName`/`monogram`, `hero.role`, `meta.*`,
`contact.heading`, at least one contact item, the primary `mailto:` item (locked while it is the
primary), every section's `title`, and at least one shown section** (`NO_SECTIONS` error).

**D9 · Structured data and images follow visibility.** **(a) JSON-LD `knowsAbout` / `knowsLanguage` /
`worksFor` are emitted only when skills / languages / experience are shown; the OG card drops a removed
eyebrow or subrole and draws 0–4 facts** (structured data must describe visible content); (b) derive them
from the data regardless (rejected).

---

## 3. Data model

### 3.1 Schema v2 (`src/schema/validate.mjs`, `buildSchema`)

```js
export const SCHEMA_VERSION = 2;                       // schemaVersion: E([2])
const SECTION_KEYS = SECTIONS.map((s) => s.key);       // from localize.mjs
settings: O({ layout, palette, defaultTheme,
  sectionOrder: A(E(SECTION_KEYS), 8, 8),              // new; canonical position after defaultTheme
  updated, autoUpdateDateOnPublish, siteUrl }),
const head = (leadMax = 200) => ({ hidden: B(), nav: NAV, title: LS(40), lead: LS(leadMax, { ...OPT, ...TEXT }) }); // hidden first
hero: O({ eyebrow: LS(32, OPT), role: LS(40), subrole: LS(80, OPT), tagline: LS(180, { ...OPT, ...TEXT }),
  location: LS(32, OPT), availability: LS(48, OPT), facts: A(O({ id: ID, value: LS(10), label: LS(24) }), 0, 4) }),
skills groups: { id, title: LS(40), lead: LS(100, OPT), items: A(…, 1, 16) }
sections.contact: { ...head(160), cta: LS(24, OPT), primary: REF, buttons: A(REF, 0, 3) }
ui.builtWith: LS(48, OPT)
```

Everything else is unchanged (limits, `CAPS_PATHS`, `TOKEN_PATH_RE`, ids). `canonicalize()` already
writes `null` for a null optional pair. `blank()` (admin) already returns `null` for optional pairs, so a
new skill group starts with `lead: null`.

### 3.2 Validation

| Code | Level | Rule | Draft (`admin/shared/draft-rules.mjs`) |
|---|---|---|---|
| `SECTION_ORDER` | error | `settings.sectionOrder` must contain each of the 8 keys exactly once (on top of `ENUM`/`COUNT`) | blocking (path under `$.settings.`) |
| `NO_SECTIONS` | error, path `$.sections` | every section has `hidden: true` | add to `NON_BLOCKING` (content) |
| `NAV_LABEL`, `NAV_BUDGET` | error | now over **shown** sections only (`hidden !== true`) | unchanged |
| `EYEBROW_YEAR`, `LONG_WORD` | warning | skip `null` lines / empty facts | unchanged |
| `REF`, `REF_PRIMARY` | error | unchanged: the primary `mailto:` item is required even when the "Let's talk" section is hidden (JSON-LD `email`) | unchanged |
| `COUNT` on `hero.facts` | error | now `0–4 items` | unchanged (non-blocking) |

`limitsTable()` keeps a row for every optional line (counters still apply while the pair exists).

### 3.3 Migration v1 → v2 (`src/schema/migrate.mjs`, new, pure)

```js
export const SCHEMA_VERSION = 2;
export function migrateSite(site) -> { site, from, to }   // structuredClone; idempotent at v2; throws on unknown/higher
// v1 → v2: settings.sectionOrder = SECTIONS.map((s) => s.key); sections.<k>.hidden = false; schemaVersion = 2.
// Optional lines keep their values (no line is removed by the migration): today's output is unchanged.
```

Where the upgrade runs ("upgrade on read"; one helper `upgrade = (s) => migrateSite(s).site`):
`store.checkDraft` (save, import, checkpoint, `POST /validate`, `POST /preview` bodies), `store.init`,
`readPublished`, `draftUnlocked` (recovery path included), `getRevision`/`restoreRevision` (so the
changes-vs-draft diff does not list `hidden` on every section), `backup.restore` (before validating each
document), `cli restore-build` and both `.site.json` reads in `lib/publish.mjs` (`rollback`, `reconcile`),
`build.mjs` (after reading `SITE_JSON`, before `buildSite`), `test/unit/_helpers.mjs` `seed()` is not
migrated (the seed file is committed at v2), and the SPA: `draft.js` `adopt()` and `restorePendingCopy()`
run `migrateSite` on documents that arrive from a server or from `localStorage` (a v1 offline copy from
before the deploy). `routes/io.mjs` export envelope and `routes/registry.mjs` report `SCHEMA_VERSION`.

`cli migrate`: `--dry-run` exits 10 when `draft.json` or `site.json` is not at `SCHEMA_VERSION`
(replaces the `!== 1` literal). The real run (service stopped, `deploy/remote-deploy.sh` step 4 already
does stop → backup → migrate) takes the `write` lock, snapshots the draft as `pre-migrate`, rewrites
`draft.json`, `site.json` and every `revisions/*.json` through `canonicalize()` with recomputed `etag`s
(revision ids unchanged), and sets `publish-state.json.publishedEtag` to the new `site.json` etag for
consistency (nothing reads it today; `isDirty()` compares the draft with the rewritten `site.json`
envelope). Build directories are never rewritten (upgraded on read). A deploy revert restores
the v1 `pre-migrate` backup with the previous release's CLI, as today.

Committed files migrated in C1: `src/content/site.json`, `test/fixtures/site.stress.json`.
`docs/plans/site.example.json` stays v1 (design record); `scripts/check-all.mjs` step 6 compares
`canonicalize(upgrade(x))` of both files (minus layout/palette) so the pixel-identity gate keeps running.

**Sharing one migration with `docs/plans/fonts.md`.** If both plans are built together, v2 = the fields
of both plans in one `v1→v2` step of `migrateSite` (a step list `[v1v2]`, each step a pure function); the
plan that lands first creates `src/schema/migrate.mjs`, the second extends the same step before any
release, and `SCHEMA_VERSION` stays 2. If this plan ships alone first, fonts becomes `v2→v3` with the same
mechanics (dry-run exit 10, upgrade on read, migrated seed and fixtures). `fonts.md` did not exist when
this plan was written (checked last: see the closing note).

### 3.4 Publish date rule

`settings.sectionOrder` is content: `lib/publish.mjs` `CONTENT_KEYS` → `contentOf()` also includes
`settings.sectionOrder`; `PublishDialog.vue` `CONTENT` regex adds `\$\.settings\.sectionOrder`. Hiding a
section (`sections.<k>.hidden`) already counts (it is under `sections`).

### 3.5 Localized tree (`src/shared/localize.mjs`)

```js
const T0 = (v) => (v == null ? null : v[lang]);           // optional line → null, never "null"
hero: { eyebrow: T0(hero.eyebrow), role: T(hero.role), subrole: T0(…), tagline: T0(…), location: T0(…), availability: T0(…), facts: hero.facts.map(…) }
ui.builtWith: T0(ui.builtWith);  groups[].lead: T0(g.lead);  sections.contact.cta: T0(s.contact.cta)
sectionOrder: site.settings.sectionOrder.filter((k) => s[k] && s[k].hidden !== true).map((k) => LEGACY[k]) // additive: legacy keys ('education' for languages), shown only
```

`c.sections.*` keep every section (hidden ones included; templates never iterate them directly).
`fragments.mjs`: `orderedSections = (c) => c.sectionOrder.map((k) => c.sections[k]).filter(Boolean)`;
`SECTION_ORDER` stays exported as the full legacy order (tests only). `siteContext()` unchanged.

---

## 4. Rendering

Rule for every layout (extends master plan §5.2 rule 10): a `null` line renders **no element** (no empty
`<p>`, no orphan separator, no rule/margin that belonged to it); a hidden section renders **nothing**;
every `aria-labelledby` target is inside the element that references it, so hiding removes both. HTML
byte-identity for today's content is enforced by the golden test (§6.1); CSS additions change only the
stylesheet hash, never a pixel of today's pages (pixel gate).

### 4.1 Shared modules

| Module | Change |
|---|---|
| `shared/fragments.mjs` | `orderedSections` from `c.sectionOrder` (§3.5) |
| `shared/jsonld.mjs` | `const shown = new Set(c.sectionOrder)`; `knowsLanguage` only if `shown.has('education')`, `knowsAbout` if `shown.has('skills')`, `worksFor` if `shown.has('experience')`; keys stay in today's order, so today's output is identical |
| `shared/document.mjs`, `sitemap.mjs`, `manifest.mjs` | no change (`role`, name, `meta.*` stay required; 2 URLs) |
| `shared/brand.mjs` `ogInputs` | passes `eyebrow`/`subrole` as `null` when removed and 0–4 facts (a removed line changes the hash → new card name, as any card change does) |
| `brand/cards.mjs` `ogCard` | eyebrow element only when `i.eyebrow`; subrole only when `i.subrole`; the rule + facts row only when `i.facts.length`; satori never receives a `null` child |
| `src/main.js` | no change (`a[data-spy]`, `details.menu`, `.sec/.intro` are attribute/class driven; `secs.length === 0` is already guarded) |
| `build.mjs`, `build-site.mjs` | `build.mjs` upgrades the document (§3.3); `buildSite` unchanged |

### 4.2 Optional lines per layout (markup when the line is `null`)

| Line | Precision (`precision/template.mjs`) | Studio | Ledger |
|---|---|---|---|
| `hero.eyebrow` | `<p class="eyebrow">` omitted; CSS `.rail > .name:first-child { margin-top: 0 }` | `<p class="st-eyebrow">` omitted; CSS `.st-t-name > .st-name:first-child { margin-top: 0 }` | `<p class="lg-eyebrow">` omitted (spine label at XL/L, inline line at M/S); guard `split(' · ')` |
| `hero.subrole` | `<p class="subrole">` omitted | `<p class="st-subrole">` omitted | `<p class="lg-subrole">` omitted |
| `hero.tagline` | `<p class="tagline">` omitted | `<p class="st-tagline">` omitted | `<p class="lg-tagline">` omitted |
| `location` / `availability` | `meta = [location, availability].filter(Boolean).join(' · ')`; `<p class="loc">` (dot included) only when `meta` | same inside `<p class="st-loc">` | `<span class="lg-meta">` only when `meta`; `.lg-roleline` keeps the role |
| all of tagline, loc and facts absent | the whole `<section class="intro">` is omitted; CSS `.intro > :first-child { margin-top: 0 }`, `.content > .sec:first-child { margin-top: 0 }` | the role tile keeps `role` (required); `.st-loc` omitted | hero keeps h1 + roleline + contact table |
| `groups[].lead` | `<div class="group-head"><h3>…</h3></div>` without `<p>` | same (`.st-group-head`) | already conditional |
| `sections.contact.cta` | CTA row = `[cta ? primary button : '', ...ghost buttons].filter(Boolean)`; `<div class="cta-row">` only when non-empty; the big mail link stays | same (`.st-cta-row`) | same (`.lg-cta`) |
| `ui.builtWith` | footer `© year name · updated <time>` without ` · builtWith` | same | same |
| `contact.items` / `primary` | unchanged (min 1; `primary` null already omits the mail block) | unchanged | unchanged |

### 4.3 Facts strip, 0–4

- 0 facts: `<ul class="facts">` / `.st-facts` / `.lg-facts` omitted. Studio adds
  `.st-bento > .st-t-contact:last-child { grid-column: 1 / -1 }` so the contact tile fills the row at
  ≥ 768 (no effect today: the facts follow it).
- 1–4 facts: Precision and Studio emit ` style="--n:N"` on the list **only when N ≠ 4** (byte-identical
  today); Ledger already always emits `--n`. Precision CSS: ≥ 720 and print
  `grid-template-columns: repeat(var(--n, 4), 1fr)`; < 720 stays 2 columns with
  `.facts li:last-child:nth-child(odd) { grid-column: 1 / -1 }` (a lone third or single cell spans) and the
  row rule drawn only on cells with a row beneath:
  `.facts li:first-child:nth-last-child(n+3), .facts li:nth-child(2):nth-last-child(n+2) { border-bottom: … }`
  replaces `li:nth-child(-n+2)` (identical for 4). `li:last-child { border-inline-end: 0 }` at every width.
  Studio: 2 columns from 480 with the odd-last span already in place (`:last-child:nth-child(odd)`);
  nothing else. Ledger S tier: the same two-selector rule replaces `li:nth-child(-n+2)` and
  `.lg-facts li:last-child:nth-child(odd) { grid-column: 1 / -1 }`; `facts.slice(0, 4)` stays.
- Validation: `LONG_WORD` per fact unchanged; the OG card lays 1–4 facts with `flex: 1` each.

### 4.4 Hidden and reordered sections

- Templates iterate `orderedSections(c)`; each layout gets a per-key body map
  (`{ profile: (sec) => …, skills, abilities, workstyle, principles, experience, education, contact }`) and one
  `section(sec, n)` wrapper; the join string reproduces today's whitespace exactly (golden test). Numbers:
  Precision `secHead(sec, n)`, Studio `head(sec, n)`, Ledger `num(sec) = order.indexOf(sec) + 1` (already).
  Item numbers (`hang`, `item-idx`) restart inside each section as today.
- Navs (top, rail, menu) list shown sections only, in order, `01…0n`. Studio `navTier` and Ledger
  `navFit` already sum over `order` (fewer labels → the bar fits earlier; the stress gate verifies).
- Skip link `#main`, `main#main`, the footer and the hero never depend on sections.
- Print: hidden sections are absent from the DOM; page budgets can only fall.
- JSON-LD per §4.1; `sitemap.xml`, `robots.txt`, manifest unchanged. Inbound links to a hidden anchor
  (`/#experience`) land at the top of the page (no redirect; the section can be shown again).
- `404.html` = the EN page, so it follows the same order.

### 4.5 Nav budget inputs

`validate()` (`NAV_LABEL`, `NAV_BUDGET`) and `NavBudget.vue` iterate `SECTIONS` filtered by
`!hidden`; the help text becomes "All shown labels together, per language." Re-showing a section that
pushes the total over 100 produces the error at that moment, with the usual link to the label.

---

## 5. Admin UI

### 5.1 "Section order" tab (`admin/web/src/components/SectionOrder.vue`, new)

- `CONTENT_TABS` (router.js): `{ id: 'sections', title: 'Section order' }` before the eight section
  tabs; the eight section tabs are listed in `settings.sectionOrder` order (computed in `ContentView.vue`),
  hidden ones with a muted suffix "· hidden". `TAB_ROOTS.sections = ['$.settings.sectionOrder', '$.sections']`
  (checked before `DASHBOARD_ROOTS` in `routeForPath`; `$.sections` replaces today's
  `'/content/profile'` fallback). `INTRO` per section tab is computed: "Section 03." / "Hidden section."
- Intro: "The order of the sections on the page, and which ones are shown. Numbers follow the shown
  sections. Anchors never change."
- `ListEditor` with `layout="custom"`, `:list="site.settings.sectionOrder"`, `:spec="{ t: 'arr', min: 8, max: 8 }"`
  (fixed → no Add/Remove), new prop `nameOf` (row name = the section's EN title; KA title shown
  beside it with `lang="ka"`). Each row (`data-key` = section key): number `01` (or `—` when hidden), title,
  chip "Hidden" when hidden, actions: Move up / Move down (labels `Move ‘Profile’ up`, `aria-disabled` at the
  ends with `title` "Already first/last"), a toggle button `Hide ‘Profile’` / `Show ‘Profile’` writing
  `site.sections[key].hidden`, and a link `Edit` → `#/content/<tab>`. The toggle on the **last shown**
  section is `aria-disabled` with `aria-describedby` → sr-only "At least one section must stay shown."
  Hidden sections can still be moved (their place is kept for when they are shown again).
- Focus: after a move, the same button on the moved row (ListEditor behaviour); after Hide/Show, focus stays
  on the toggle (its label flips; no toast: it is reversible in place). `IssueList` for
  `$.settings.sectionOrder` and `$.sections` (`NO_SECTIONS`) under the list.
- Each section tab (`ContentView.vue` form head): a button `Hide this section` / `Show this section`
  next to the title; when hidden, a status line (`role="status"`, class `st`): "This section is hidden: it
  is not on the page. Its content is kept and still checked." `SchemaNode.childEntries` skips the key
  `hidden` (never rendered as a checkbox).

### 5.2 Single lines (`LField.vue`)

- `spec.optional` → the existing **Remove** button, now with undo: `removePair()` keeps the pair in a
  local `last` ref, sets `null`, focuses the Add button and shows `toast("Removed ‘Subrole’.", { Undo, 10 s })`;
  Undo restores the kept pair (only if the field is still `null` and `draft.site` is the same object, as
  ListEditor does) and focuses the EN input.
- Off state per field (fields.js `OFF_TEXT`, generic path → text; default "Removed: not shown."):
  `hero.eyebrow` "Removed: no line above the name."; `hero.subrole` "Removed: no line under the role.";
  `hero.tagline` "Removed: no tagline in the introduction."; `hero.location` / `hero.availability`
  "Removed: not shown in the location line."; `sections.skills.groups[].lead` "Removed: the group shows only
  its title."; `sections.contact.cta` "Removed: only the big email link and the extra buttons are shown.";
  `ui.builtWith` "Removed: the footer ends with the date."; `nav`/`lead`/`detail` keep today's texts.
  The button reads **Add back** for the eight content lines and **Add** for `nav`/`lead`/`detail`.
- Required lines get a reason (fields.js `KEEP`, generic path → text, rendered as a muted line
  "Cannot be removed: …" under the label; only paths in the map): `person.givenName`/`familyName`
  "The name is always shown."; `person.monogram` "Drawn in the icons and the social cards."; `hero.role`
  "Also the job title in the structured data, the social-card text and the app name."; `contact.heading`
  "Names the contact list for screen readers."; `sections.*.title` "A section needs a title; to remove the
  section, hide it under Section order."; `contact.items[].label` "Names the row for screen readers.";
  `meta.*` "Required by search engines."

### 5.3 Lists (`ListEditor.vue`)

- New props: `minNote` (string appended to the sr-only "At least N … must stay." text and used as the
  Remove button's `title` at the minimum), `lock(item, i) → string | null` (per-item reason; a locked item's
  Remove is `aria-disabled` with `title` = reason and `aria-describedby` → an sr-only span holding it),
  `nameOf(item, i)` (default `itemTitle`).
- `SchemaNode.vue` passes `minNote` for section lists ("To remove the whole section, hide it under Section
  order.") and skill items ("Remove the group instead."), and `lock` for `contact.items`:
  `it.id === site.sections.contact.primary ? 'This item is the primary email (Let’s talk). Choose another primary first.' : null`.
- Facts: with min 0 the fixed-count text "Exactly 4 facts." disappears; the bound text reads
  "n of at most 4 facts." and the group help (`hero.facts` in `LABELS`) becomes "Up to four value and label
  pairs; the strip is not shown when there are none."

### 5.4 Interface strings tab

`UI_NOTES[k]` gains a third element, the reason the string stays: skip "Keyboard users need the skip
link."; nav "Names the section navigation and the menu button."; theme/themeShort "Name of the theme
button."; print/printShort "Text of the print button."; language/langShort/langSwitch "The language switch
needs both its labels."; copy/copied "Text and state of the copy chip."; legend/levels.*/levelHints.* "The
skills legend is one unit; hide the skills section instead."; colGroup/colSkill/colDepth "Ledger's table
headers."; present "Shown for an open experience period."; atAGlance "Names the introduction for screen
readers."; updated/top "Footer label and link text." Each such row shows a chip "Required" (`class="badge"`)
whose `title` and sr-only text carry the reason. `builtWith` renders as an optional `LField` (§5.2).

### 5.5 Preview, publish, nav budget

- Preview: nothing new — `renderKey` already covers the whole document, so removing a line, hiding or
  moving a section re-renders within 600 ms (E12–E14 assert it).
- `PublishDialog.vue`: a `<dt>Sections</dt><dd>7 of 8 shown · hidden: Experience</dd>` row (or
  "8 of 8 shown"), computed from the draft.
- `NavBudget.vue`: shown sections only (§4.5).

### 5.6 Keyboard, focus, 390 px

Every control is a real `<button>`/`<a>`; bounds and locks use `aria-disabled` + description, never
`disabled` (focus is never lost); toasts stay in the existing `role="status"` region with a reachable Undo;
rows use `.list-item-head` (`flex-wrap`), so at 390 px the actions wrap under the title with 32 px targets and
no horizontal scroll (E10 audits `/content/sections`). Georgian titles carry `lang="ka"`.

---

## 6. Tests and acceptance

### 6.1 Unit (`node --test`, `test/unit`)

- `validate.test.mjs`: v2 seed 0 errors / 0 warnings; new rejections (`MUTATIONS` count updated):
  `sectionOrder` missing a key, duplicated key, unknown key (`SECTION_ORDER`); all sections hidden
  (`NO_SECTIONS`); 5 facts (`COUNT`); `hero.role: null` (`TYPE`); `schemaVersion: 1` (`ENUM`).
  Accepted: 0 facts, every optional line `null`, a hidden section whose 40-character title has no nav label
  (no `NAV_LABEL`), a shown one with the same title (error).
- `migrate.test.mjs` (new): `migrateSite(docs/plans/site.example.json)` canonicalizes to exactly
  `src/content/site.json`; idempotent at v2; v3 throws; the migrated stress fixture validates as today.
- `localize.test.mjs` (new): null lines → `null` (never `"null"`); `sectionOrder` = shown legacy keys in
  `settings.sectionOrder` order; `orderedSections` follows it.
- `render-golden.test.mjs` (new): `renderSite(seed, renderArgs(id))` for every layout; sha256 of
  `index.html`, `ka/index.html`, `404.html`, `site.webmanifest` equals `test/fixtures/golden/<layout>.json`,
  generated in C1 from the pre-change renderer (`node scripts/update-golden.mjs` regenerates them; any
  later deliberate output change, e.g. the fonts plan, regenerates them in its own commit).
- `render-optional.test.mjs` (new), every layout × EN/KA: documents built from the seed by
  (a) `strip()` = every optional line null, 0 facts, `cta` null, `buttons` [], `builtWith` null, group leads
  null; (b) `hideAllBut('profile')`; (c) `reverseOrder()`; (d) `hide('experience','languages','skills')`.
  Assertions: renders; no empty element — `/<(p|span|div|ul|ol|dl|h[1-6]|section)\b[^>]*>\s*<\/\1>/` finds
  nothing except elements with `aria-hidden="true"` or class in `{dot, st-dot, lg-bsep}`; no ` · </`, `> · `,
  `·  ` or ` — </` orphan; every `aria-labelledby`/`aria-describedby` id exists in the document; no
  `class="facts"`/`st-facts`/`lg-facts` at 0 facts; no `cta-row`/`st-cta-row`/`lg-cta` when `cta` null
  and no buttons; nav link count = shown sections, their numbers `01…0n` sequential and hrefs in
  `settings.sectionOrder` order; no `id="experience"` when hidden; JSON-LD has no `worksFor` when
  experience is hidden, no `knowsLanguage` when languages is hidden; Ledger `hang` numbers use the new
  section number; `esc(null)` never appears (`>null<`).
- `brand.test.mjs`: `ogCard` renders with `eyebrow: null`, `subrole: null`, 0 / 1 / 3 facts (no null
  children); `ogInputs` differs when a line is removed → different name.
- `render-draft.test.mjs`: keep; the overfill case now pushes facts to 5 (renders).

### 6.2 Fixtures and page gates

- `test/fixtures/site.minimal.json` (new, v2, validates 0/0): `sectionOrder`
  `["profile","experience","skills","languages","contact","abilities","workstyle","principles"]`, hidden:
  abilities, workstyle, principles, languages (shown: 01 profile, 02 experience, 03 skills, 04 contact);
  hero: only `role` and the name, `facts: []`; one contact item (email, `copy: false`); `buttons: []`,
  `cta: null`; every `lead`/`nav`/`detail`/`orgHref` null; one paragraph, one group with one skill, one
  item per card list, one position (`to: null`), one language; `ui.builtWith: null`; all other strings from
  the seed.
- `scripts/check-all.mjs`: `TABLE[id].minimal = true` per layout as its milestone lands; step 2 builds
  `<layout>-minimal` (`SITE_JSON=test/fixtures/site.minimal.json`); step 3 adds
  `check-pages.mjs --dist <layout>-minimal` (all probes, print budgets trivially met) and
  `check-layout-stress.mjs --dist <layout>-minimal --topnav <nav>`; the layout scripts (`studio.mjs`,
  `ledger.mjs`) are not run on it (they assert the seed's geometry). Runs: 58 → 67. Step 6 (pixel identity)
  normalizes through `migrateSite` (§3.3) and must keep printing `ok precision: pixel identity`.
- `npm run check:stress` unchanged (the stress fixture is migrated, all lists still at max, 4 facts).

### 6.3 Admin tests (`admin/test`)

- `draft-rules.test.mjs`: `NO_SECTIONS` non-blocking; `SECTION_ORDER` blocking; a PUT with 0 facts and
  null lines is stored.
- `store.test.mjs` / `api.test.mjs`: a v1 document PUT/imported is stored as v2 (`GET /draft` has
  `sectionOrder` and `hidden`); export envelope `schemaVersion: 2`; `GET /revisions/:id` of a v1 checkpoint
  lists no `hidden` diffs; publish with `autoUpdateDateOnPublish` sets the date on a reorder-only change.
- `cli-migrate.test.mjs` (new, child process like the other CLI tests): a data dir seeded with v1 files →
  `migrate --dry-run` exits 10; `migrate` rewrites draft, site, revisions and `publishedEtag`, keeps a
  `pre-migrate` revision; second `--dry-run` exits 0; `restore-backup` of a v1 backup and `restore-build`
  of a v1 build succeed afterwards.
- `preview.test.mjs`: a minimal-fixture preview renders both languages (422 never).

### 6.4 End to end (`test/e2e/admin.e2e.mjs`)

- E12 · remove a line and undo: on Person & hero, click `Remove` for Subrole → the preview (`/`) loses
  `.subrole` within 1 s; focus is on `Add back`; the toast `Removed ‘Subrole’.` → `Undo` restores the text and
  focuses the EN input; remove again, wait for save, `GET /draft` has `hero.subrole === null`; `Add back`
  yields an empty pair flagged `EMPTY`.
- E13 · hide and reorder, keyboard only: Section order tab; Enter on `Hide ‘Experience’` (focus stays,
  label flips to `Show ‘Experience’`); Enter on `Move ‘Languages’ up` (focus on the same button of the moved
  row); the preview nav has 7 links, numbered `01…07`, Languages before Experience's old place; the tab
  list shows "Experience · hidden" and the new order; publish; the web root `index.html` has no
  `id="experience"` and its JSON-LD no `worksFor`; show Experience again and publish (cleanup).
- E14 · facts to zero: remove all four facts (Remove stays enabled to 0); the preview has no `.facts`;
  Undo the last removal restores one fact; bound text "1 of at most 4 facts."
- E10: `SCREENS` gains `/content/sections`; the publish-dialog audit covers the new Sections row.

### 6.5 CI

`deploy.yml` unchanged: `npm test` (+ ~1 s), `check:all` (+3 builds, +6 gates ≈ +2 min), `check:stress`,
`test:e2e` (+3 flows ≈ +1 min). The seed notice fires once on the migration commit (expected). The first
production deploy after C1 stops the service, backs up and migrates (remote-deploy.sh step 4, exit 10 path);
verify `cli migrate --dry-run` prints `no pending migrations` afterwards.

### 6.6 Acceptance (whole feature)

1. `npm test`, `npm run check:all` (67 runs, pixel identity `30/30 identical`), `npm run check:stress`,
   `npm run test:e2e` green.
2. With the migrated seed every layout's HTML equals the goldens; `diff -r` of a pre-C1 `dist/` against a
   post-C7 build differs only in the stylesheet name and its content (CSS additions).
3. Minimal fixture, three layouts, EN/KA, light/dark, 320–1920 px and print: no overflow, no empty
   element, no orphan "·", no dangling `aria-labelledby`, contrast AA, focus rings, accessible names.
4. Admin, keyboard only at 1280 and 390 px: remove a line / undo / add back; hide, show and reorder
   sections; remove facts to zero; every bound and lock is announced with its reason.
5. A v1 export imported after the migration is stored as v2; a v1 offline copy is restored and saved.

---

## 7. Milestones (one reviewable commit each)

| # | Scope | Files | Done when |
|---|---|---|---|
| C1 | Schema v2, migration, upgrade on read, migrated seed and fixtures, goldens (no rendering change) | `src/schema/{validate,migrate}.mjs`, `admin/shared/draft-rules.mjs`, `admin/server/lib/{store,backup,publish}.mjs`, `admin/server/cli.mjs`, `admin/server/routes/{io,registry}.mjs`, `admin/web/src/state/draft.js`, `build.mjs`, `scripts/check-all.mjs` (step 6 norm), `scripts/update-golden.mjs`, `src/content/site.json`, `test/fixtures/{site.stress.json,site.minimal.json,golden/*.json}`, `test/unit/{validate,migrate,render-golden}.test.mjs`, `admin/test/{draft-rules,store,api,cli-migrate}.test.mjs` | `npm test` green; `check:all` 58/58 with `ok precision: pixel identity`; `cli migrate --dry-run` exits 10 on a v1 data dir and 0 after `migrate`; `npm run build:admin` + `test:e2e` still green (the SPA shows a plain `Hidden` checkbox per section and Remove on the new optional lines meanwhile) |
| C2 | Shared rendering layer | `src/shared/{localize,fragments,jsonld,brand}.mjs`, `src/brand/cards.mjs`, `test/unit/{localize,brand}.test.mjs` | goldens unchanged; localize/jsonld/brand tests green; templates still hard-code their order (C3–C5) |
| C3 | Precision: section loop, optional lines, facts 0–4, CSS | `src/layouts/precision/{template.mjs,styles.css}`, `test/unit/render-optional.test.mjs` (precision), `scripts/check-all.mjs` (`precision.minimal`) | goldens unchanged; render-optional green for precision; `check:all` precision-minimal gates pass; pixel identity `30/30` |
| C4 | Studio: same | `src/layouts/studio/{template.mjs,styles.css}`, render-optional (studio), check-all (`studio.minimal`) | goldens unchanged; studio-minimal gates and `studio.mjs` on lime/stress pass |
| C5 | Ledger: same | `src/layouts/ledger/{template.mjs,styles.css}`, render-optional (ledger), check-all (`ledger.minimal`) | goldens unchanged; ledger-minimal gates and `ledger.mjs` pass; A5 spine alignment still ±1 px |
| C6 | Admin UI | `admin/web/src/components/{SectionOrder.vue,ListEditor.vue,LField.vue,SchemaNode.vue,NavBudget.vue,PublishDialog.vue}`, `views/ContentView.vue`, `router.js`, `fields.js`, `styles/screens.css` | manual checklist §6.6 item 4 at 1280 and 390 px, light and dark; `build:admin` clean; no `v-html` |
| C7 | End to end, docs | `test/e2e/admin.e2e.mjs` (E12–E14, E10 screen), `README.md` (docs list), `docs/plans/admin-layouts-palettes.md` §13 (structure editing now in scope, link here), `docs/plans/data-model.md` decision 6 note | `test:e2e` green in CI; acceptance §6.6 recorded in the PR |

Build order is fixed (C2 before C3–C5; C6 after C5 so the preview shows every layout correctly).
C3–C5 may be reviewed as one PR of three commits.

---

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Rewriting the hard-coded section sequence changes whitespace or attribute order | HTML no longer byte-identical; pixel gate may still pass and hide it | golden sha256 test from C1; `diff -r` in §6.6 item 2 |
| A null line reaches `esc()` | literal "null" on the page | `T0()` in localize; render-optional asserts `>null<` never appears |
| A hidden section leaves a dangling id reference | broken `aria-labelledby`/`describedby` | the id-existence assertion in render-optional; all targets live inside the section |
| Migration runs while the old release autosaves, or a revert after migration | mixed-version data | unchanged deploy flow: dry-run → stop → backup → migrate; revert restores the v1 backup with the previous CLI; `cli-migrate.test` covers restore of v1 backups and builds |
| Old documents (revisions, builds, exports, offline copies) at v1 after the bump | rejected as structural errors | upgrade on read everywhere (§3.3), SPA included |
| Re-showing a section breaks the 100-character nav budget | publish blocked | the existing `NAV_BUDGET` error with its link; the toggle is reversible |
| Studio bento with 0 facts or Ledger S tier with 1–3 facts | half-empty rows, double rules | the CSS rules in §4.3; minimal fixture in the overflow sweep; screenshot review of the minimal build at 390/768/1440 in C4/C5 |
| Satori receives a null child | OG render throws → publish carries `og_stale` | conditional children in `ogCard`; brand tests |
| Removed eyebrow/subrole/facts change OG names | new card files on the next publish | expected; names are content-hashed (master plan §8.8) |
| Inbound links to a hidden anchor | visitor lands at the top | acceptable; documented in §4.4; sections can be shown again |
| `check:all` runtime | +2 min per run | three extra builds only; no per-palette gates for the minimal fixture |
| Toast-based undo in e2e | flakiness | `waitFor` on the toast text; 10 s window is ample |
| Two plans bump the schema | conflicting migrations | one `v1→v2` step shared per §3.3 |

Closing note: `docs/plans/fonts.md` was not present when this plan was finished; §3.3 states how the two
plans share one migration step if it lands before this plan is built.
