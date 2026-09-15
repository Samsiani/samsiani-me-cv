# Layout C — "Ledger" · build specification

| | |
|---|---|
| Direction | **C · Ledger**: pure white, IBM Plex, numbered index column ("spine"), skills as a real table |
| Source | Claude Design export `samsiani.me.dc.html`, artboard `1c` (header, hero and skills at 1440 only) |
| Status | Verified. The module below was built through the data-model reference pipeline (`docs/plans/data-model-ref`) with `site.example.json` and with `site.stress.json`, and in the cobalt, lime and crimson palettes. Every measured value (widths, alignment, contrast, page counts) comes from Chromium via Playwright. |
| Companion files | `layout-ledger/src/layouts/ledger/`: the **drop-in layout module** for the data-model contract (`layout.mjs`, `template.mjs`, `styles.css`, `fonts.css`) · `layout-ledger/preview.mjs`: builds a real `dist/` with it, without touching `src/` · `layout-ledger/verify.mjs`: the acceptance script (§8) · `layout-ledger/ref-*.png`: reference renders |
| Contracts it follows | `data-model.md` §8.2 (layout module, `renderBody(c, ctx)`, shared fragments), §5 (localized tree), §9 (stress gate) · `palettes.md` §2 (six palette tokens), §6 (dark on `screen` only) |
| Authoritative copy | `site.json` through `localize()` (today `src/content/*.mjs`). The exploration's old copy is listed in Appendix B and must never come back. |

**How to use this plan (phase 3 of `data-model.md` §11):** copy `layout-ledger/src/layouts/ledger/` to `src/layouts/ledger/` and register it in `src/layouts/index.mjs`. Add the three IBM Plex files (§7) and the one-line `headExtra` hook (§9.2). Then build with `LAYOUT=ledger` and run `verify.mjs` and the stress gate until both pass. The tables in this document explain the reasoning behind every value in the module. If a table and the module ever disagree, the module is the one that was tested, so follow it.

Preview and checks, which need no change to the repository:
```bash
node docs/plans/layout-ledger/preview.mjs --out /tmp/ledger-dist [--palette lime] [--site docs/plans/site.stress.json]
node docs/plans/layout-ledger/verify.mjs /tmp/ledger-dist                                   # 20 checks, both languages
node docs/plans/data-model-ref/scripts/check-layout-stress.mjs --dist /tmp/ledger-dist --topnav .lg-nav
```

---

## 1. Design tokens

### 1.1 Every colour in the exploration, with its role

All values are measured on `#fff`. The contrast column is the WCAG 2.1 ratio against white. Values that differ by at most ΔL .02 are merged into one token in §1.2. The difference cannot be seen, and it keeps the scale small.

| Exploration value | sRGB | vs #fff | Where the exploration uses it | Token |
|---|---|---|---|---|
| `#fff` | #ffffff | — | page ground | `--paper` |
| `oklch(.17 .008 250)` | #0d1013 | 19.11 | all primary text, h1, h2; header bottom rule (1px); table-head rule (2px); group-end rules (1px); facts top (2px) and bottom (1px); PDF-button border; link underlines; active-nav and current-language underline; Core/Strong depth marks | `--ink`, `--rule-strong` |
| `oklch(.28 .008 250)` | #26292d | 14.58 | hero tagline | `--ink-2` (.29) |
| `oklch(.30 .008 250)` | #2b2e32 | 13.63 | depth label text ("CORE") | `--ink-2` (.29) |
| `oklch(.36 .008 250)` | #3a3d41 | 10.85 | section lead | `--ink-3` |
| `oklch(.40 .008 250)` | #44484c | 9.20 | header nav links | `--muted` (.42) |
| `oklch(.42 .008 250)` | #4a4d51 | 8.45 | "samsiani.me" in header; table header labels | `--muted` |
| `oklch(.44 .008 250)` | #4f5357 | 7.76 | inactive language, "◐ Theme", location line, group lead, legend | `--muted-2` (.45) |
| `oklch(.45 .008 250)` | #52565a | 7.43 | Working mark outline | `--muted-2` |
| `oklch(.46 .008 250)` | #55585c | 7.12 | contact keys, fact labels, skill detail after " · " | `--muted-2` (.45) |
| `oklch(.48 .008 250)` | #5a5e62 | 6.53 | hero spine text "00 / CV · 2026" | `--index` |
| `oklch(.55 .008 250)` | #6e7276 | 4.85 | the "/" between EN and ქართ | `--faint` |
| `oklch(.86 .004 250)` | #cfd1d3 | 1.53 | 1 × 16 px separator between "GS" and "samsiani.me" | `--sep` |
| `oklch(.90 .004 250)` | #dcdee0 | 1.35 | spine rule, contact-row rules, facts inner dividers | `--rule` |
| `oklch(.93 .004 250)` | #e6e8ea | 1.23 | skill-row hairlines | `--row` |
| `oklch(.45 .16 250)` | #0055a9 | 7.31 | "COPY" actions, section number "02" | palette `--accent-ink` (cobalt: `oklch(47% .18 255)`, #0056bc, 6.87) |

### 1.2 Structural tokens (layout-owned, not affected by the palette)

The dark theme follows one rule: the light theme's ink becomes the dark theme's paper. All ratios are against that theme's `--paper`.

| Token | Light | ratio | Dark | ratio | Used for |
|---|---|---|---|---|---|
| `--paper` | `#fff` | — | `oklch(.17 .008 250)` (#0d1013) | — | page, header, menu ground |
| `--ink` | `oklch(.17 .008 250)` | 19.11 | `oklch(.96 .003 250)` | 17.02 | h1, h2, h3, values, items, Core/Strong marks, button text |
| `--ink-2` | `oklch(.29 .008 250)` | 14.10 | `oklch(.87 .005 250)` | 12.90 | tagline, prose, list text, depth labels, periods |
| `--ink-3` | `oklch(.36 .008 250)` | 10.85 | `oklch(.81 .006 250)` | 10.59 | section leads |
| `--muted` | `oklch(.42 .008 250)` | 8.45 | `oklch(.76 .007 250)` | 8.91 | header nav, domain, table-header labels |
| `--muted-2` | `oklch(.45 .008 250)` | 7.43 | `oklch(.73 .007 250)` | 8.00 | micro-labels, meta, subrole, group lead, skill detail, legend, footer, Working mark, org name |
| `--index` | `oklch(.48 .008 250)` | 6.53 | `oklch(.70 .007 250)` | 7.16 | "00", hero eyebrow, sub-numbers 3.1 … |
| `--faint` | `oklch(.55 .008 250)` | 4.85 | `oklch(.64 .007 250)` | 5.69 | "/" and "·" separators in UI chrome |
| `--sep` | `oklch(.86 .004 250)` | 1.53 | `oklch(.36 .006 250)` | 1.76 | brand separator (decorative) |
| `--rule` | `oklch(.90 .004 250)` | 1.35 | `oklch(.31 .006 250)` | 1.45 | spine, kv rows, list rows, facts dividers, profile column rule |
| `--row` | `oklch(.93 .004 250)` | 1.23 | `oklch(.265 .006 250)` | 1.25 | skill-row hairlines, menu-item dividers |
| `--rule-strong` | `oklch(.17 .008 250)` | 19.11 | `oklch(.80 .004 250)` | 10.24 | header bottom, 2px table/list heads, group/list ends, facts, footer double rule, outline buttons |
| `--hover` | `oklch(.965 .003 250)` | — | `oklch(.215 .008 250)` | — | menu-item hover wash (text on it stays ≥ 15.5:1) |

The dark `--rule-strong` is set to .80 instead of the full .96 ink. At .96 the 2px rules glare on near-black. Rules are decorative: text meaning never depends on a rule. Text contrast is therefore checked for text only, and the depth marks are checked at 3:1 (§8, A3).

Both dark blocks are wrapped in `@media screen` (`@media screen and (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }` and `@media screen { :root[data-theme="dark"] … }`), exactly like the palette blocks, so print never sees dark values (`palettes.md` §6).

`theme-color` metas for this layout (manifest `themeColor`): `#ffffff` (light) and `#0d1013` (dark).

**Neutrals to record in `palettes.json → layouts.ledger`** (one line each; replaces the "proposed" dark row):

| Theme | bg (`--paper`) | surface (`--hover`, carries accent numbers in the menu) | ink |
|---|---|---|---|
| light | `#fff` | `oklch(96.5% 0.003 250)` | `oklch(17% 0.008 250)` |
| dark | `oklch(17% 0.008 250)` | `oklch(21.5% 0.008 250)` | `oklch(96% 0.003 250)` |

Both rows sit inside the palette envelope (light L ≥ 93 %, dark L ≤ 27 %, C ≤ 0.012, hue 250). With these values `node docs/plans/check-palettes.mjs --data <copy with the ledger rows updated>` prints **PASS 432/432**.

### 1.3 Accent tokens (palette-owned)

Ledger follows the palette contract in `palettes.md` §2. The palette block, appended by the build after the layout CSS, owns six tokens: `--accent`, `--on-accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--focus`. **`styles.css` never declares any of them.** It uses four of them:

| Where in Ledger (complete list) | Token | Rule from palettes.md |
|---|---|---|
| section numbers 01–08 in the spine; numbers in the Sections menu | `--accent-ink` | accent text |
| "COPY / ასლი" text | `--accent-ink` | accent text |
| hover underline on links (`.u-link`, 2px) | `--accent-ink` | thin marker |
| big-email underline (2px), arrow, and hover colour | `--accent-ink` | thin marker and text |
| "copied" state of COPY | `--accent` fill + `--on-accent` text | fill component |
| primary CTA ("Write to me") | `--accent` background and border + `--on-accent` text | fill component |
| `::selection` | `--accent` + `--on-accent` | fill |
| focus ring (2px, 3px offset) | `--focus` | focus uses `--focus` |

**The accent is never used for:** depth marks (layout ink, as in the export; `palettes.md` §10 agrees), the active-nav underline (ink, as in the exploration), rules, `00`, sub-numbers 3.1 …, or headings. Ledger is the most monochrome of the three layouts: choosing a palette changes exactly the rows above. `--accent-soft` and `--accent-line` are not used.

The exploration's `oklch(.45 .16 250)` is therefore replaced by the palette. The default cobalt gives `oklch(47% 0.18 255)` (#0056bc, 6.87:1 on #fff) in light and `oklch(80% 0.15 255)` (9.85:1 on the Ledger dark paper) in dark. That is the same blue family, and the live Precision value.

**Contrast is guaranteed by the palette gate**, not by Ledger code: every palette is checked against `layouts.ledger` (§1.2) for `--accent-ink` on bg and surface, `--on-accent` on `--accent`, and `--focus` on bg and surface. Ledger's own `verify.mjs` repeats these checks on the rendered page (A3). It passes for cobalt, lime and crimson (`ref-en-1440-lime.png` shows lime).

### 1.4 Typography

**Families**
```css
--sans:  "IBM Plex Sans", "Noto Sans Georgian", system-ui, -apple-system, "Segoe UI", sans-serif;
--mono:  "IBM Plex Mono", "Noto Sans Georgian", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
/* ka: --sans: "Noto Sans Georgian", "IBM Plex Sans", system-ui, sans-serif;  micro-labels switch from --mono to --sans */
```
Noto Sans Georgian sits second in the **mono** stack on purpose. Without it, a Georgian character inside a mono element falls back to a random system Georgian font. Weights in use: Plex Sans **300** (h1, fact values, big email), **400**, **500** (role, h3, group titles). Plex Mono **400** and **500** (GS mark, table headers, buttons). There is no Mono 600: the exploration's `600` "GS" renders at 500, and `font-synthesis: none` stops the browser from faking a bolder weight.

**Type scale.** Sizes are listed for the tiers XL / L / M / S (§2.2). KA values come from language factors in `styles.css` §2 and are shown already computed.

| Role | Selector | Face · weight | EN size (XL/L/M/S) | Line height | Tracking · case | Colour | KA |
|---|---|---|---|---|---|---|---|
| Brand mark | `.lg-gs` | Mono 500 | 14 | 1 | .06em | ink | = |
| Domain | `.lg-domain` | Mono 400 | 12.5 (hidden at M, S) | 1 | 0 | muted | = |
| Header nav | `.lg-nav a` | Sans 400 | 12.5 · gap 20 | 1 | 0 | muted; current = ink + 1px underline, offset 6 | Noto 12 · gap 14 |
| Lang / Theme | `.lg-lang`, `.lg-theme` | Mono 400 | 12 | 1 | 0 | current ink + underline · other muted-2 · "/" faint | Georgian labels Noto 12.5 |
| PDF button, menu summary | `.lg-pdf`, `.lg-menu summary` | Mono 500 | 11.5 | 1 | .04em · UPPER | ink; 1px rule-strong border | Noto 12.5 · .01em · no caps |
| Spine number | `.lg-n` | Mono 400 | 11 | 1.5 | .1em | sections `--accent-ink` · hero index | = (digits) |
| Hero eyebrow | `.lg-eyebrow` | Mono 400 | 11 (L 10.5) | 1.5 | .04em | index | Noto 12 · .01em |
| Name | `.lg-hero h1` | Sans **300** | 76 / 64 / 52 / 40 | .98 / .98 / 1 / 1.02 | −.03em (S −.025em) | ink | Noto **350** · 60.8 / 51.2 / 41.6 / 32 · lh 1.08/1.08/1.1/1.12 · −.01em |
| Role | `.lg-role` | Sans 500 | 20 / 20 / 18 / 17 | 1.3 | 0 | ink | = (mixed Latin + Georgian) |
| Location · availability | `.lg-meta` | Mono 400 | 13 (S 12.5) | 1.4 | 0 | muted-2 | **Noto** 14 (S 13.5) |
| Subrole *(extrapolated)* | `.lg-subrole` | Sans 400 | 14.5 | 1.5 | 0 | muted-2 | = |
| Tagline | `.lg-tagline` | Sans 400 | 21 / 20 / 19 / 18 · max 760 | 1.45 | 0 | ink-2 | ×0.9 · lh 1.55 · max 800 |
| Contact key | `.lg-kv th` | Mono 400 | 11 | 1.4 | .1em · UPPER | muted-2 | Noto 12 · .02em · no caps |
| Contact value | `.lg-kv td` | Sans 400 | 14.5 | 1.4 | 0 | ink · 1px underline, offset 3 | = |
| COPY | `.lg-copy` | Mono 400 | 11 | 1 | .06em · UPPER | `--accent-ink` | Noto 12 · .01em |
| Fact value | `.lg-fv` | Sans **300** | 32 / 28 / 24 / 24 | 1.05 | −.02em | ink | = (Latin values) |
| Fact label | `.lg-fl` | Mono 400 | 10.5 | 1.4 | .08em · UPPER | muted-2 | Noto 11.45 · .01em |
| Section title | `.lg-sec h2` | Sans 400 | 34 / 32 / 30 / 27 | 1.1 | −.02em | ink | Noto 400 ×0.88 (29.9/28.2/26.4/23.8) · lh 1.2 · −.005em |
| Section lead | `.lg-lead` | Sans 400 | 15.5 (S 15) · max 660 | 1.55 | 0 | ink-3 | lh 1.65 · max 720 |
| Profile prose *(extrap.)* | `.lg-prose` | Sans 400 | 16 | 1.62 | 0 | ink-2 | 15.5 · lh 1.7 |
| Table header | `.lg-skills thead th` | Mono **500** | 10.5 | 1.4 | .12em · UPPER | muted | Noto 11.45 · .02em |
| Group title | `.lg-grp h3` | Sans 500 | 17 | 1.3 | 0 | ink | = |
| Group lead | `.lg-glead` | Sans 400 | 13 | 1.5 | 0 | muted-2 | = |
| Skill item | `.lg-item` | Sans 400 | 14.5 | 1.4 | 0 | ink; " · detail" muted-2 | = |
| Depth label | `.lg-depth` | Mono 400 | 11 · hanging indent 16, may wrap | 1.4 | .08em · UPPER | ink-2 | Noto 12 · .01em |
| Legend | `.lg-legend` | Mono 400 | 11.5 | 1.6 | 0 · as written | muted-2 · dots faint | Noto 12.5 |
| Sub-number *(extrap.)* | `.lg-hang` | Mono 400 | 11 | 1.5 | .1em | index | = |
| List title *(extrap.)* | `.lg-li h3`, `dt` | Sans 500 | 17 (experience 18) | 1.3 | 0 | ink | = |
| List text *(extrap.)* | `.lg-li p`, `dd` | Sans 400 | 15 · max 700 (languages 16) | 1.55 | 0 | ink-2 | lh 1.65 |
| Period *(extrap.)* | `.lg-period` | Mono 400 · tabular-nums | 12.5 | 1.75 | 0 | ink-2 | Noto 13.6 · lh 1.65 |
| Big email *(extrap.)* | `.lg-bigmail` | Sans **300** | 48 / 42 / 34 / 26 | 1.15 | −.02em | ink; 2px `--accent-ink` underline, offset .14em | = (Latin) |
| Button *(extrap.)* | `.lg-btn` | Mono 500 | 11.5 · h 40 (S 44) · pad 0 16 | 1 | .04em · UPPER | outline ink / primary `--on-accent` on `--accent` | Noto 12.5 · .01em |
| Footer *(extrap.)* | `.lg-foot` | Mono 400 | 11 | 1.6 | 0 | muted-2 | Noto 12 |
| Menu item | `.lg-menu-list a` | Sans 400 | 14 · pad 11 14 | 1.35 | 0 | ink; number Mono 11 `--accent-ink` | = |

### 1.5 Spacing, rules, marks

**Vertical rhythm at XL.** In the order the page reads:
- hero padding-top 56
- eyebrow top 22
- h1 → role line 20; role line → subrole 6; subrole → tagline 26
- tagline → contact table 40; contact rows 11 / 0
- contact table → facts 36; facts cells 18 / 20; fact label margin-top 8
- section gap 88 (L 76 · M 64 · S 56)
- h2 → lead 12; lead → data block 32 (prose 28)
- `thead th` padding 0 16 10 0; group cell 16 16 20 0; item cells 9 16 9 0; group lead margin-top 7
- legend margin-top 20; list rows 18 / 0 / 20
- big email margin-top 28; CTA row margin-top 28, gap 12
- footer margin-top = section gap, padding 14 0 48

**Rules** (the vocabulary of a ledger):

| Rule | Spec | Where |
|---|---|---|
| Header rule | 1px `--rule-strong` | bottom of the sticky header |
| Spine | 1px `--rule`, one segment per section (`border-inline-start` of `.lg-body`) | the index column |
| Head rule | 2px `--rule-strong` | under the skills `thead`, top of every ruled list, top of the facts strip |
| End rule | 1px `--rule-strong` | bottom of every skill group, ruled list, and the facts strip |
| Row hairline | 1px `--row` (skills) · 1px `--rule` (lists, contact table, facts dividers) | between rows |
| Column rule | 1px `--rule` | between the two profile columns |
| Total rule | **3px double** `--rule-strong` | above the footer (the double underline under an account total) |
| Separator | 1 × 16 px `--sep` | between "GS" and "samsiani.me" |

Corner radius is **0** everywhere. There are no pills, chips, cards or shadows. The only shadow-like element in the design is the menu's 1px border.

**Depth marks: the ■ ◧ □ legend glyphs.** They are drawn in CSS with **borders only**, so they print even when "Background graphics" is off and stay visible in forced-colours mode. The same element (`<span class="lg-dm" data-level>`, `aria-hidden`) is used in the table and in the legend. The word next to the mark carries the meaning.

| Level | Glyph | CSS (8 × 8 px box, `vertical-align: baseline`, margin-inline-end 8, legend 6) |
|---|---|---|
| core | ■ | `border: 4px solid var(--ink)` (fully filled) |
| strong | ◧ | `border: 1px solid var(--ink); border-inline-start-width: 4px` (left half filled) |
| working | □ | `border: 1px solid var(--muted-2)` |

The exploration's legend text shows U+25E8 ◨ (right half), but its table draws the left half. This spec follows the table. Unicode glyphs are never used as text: U+25E7/25E8 exist in neither Plex nor Noto, so they would fall back to a random system font, and screen readers announce them as "square with left half black". The bottom of the mark sits on the baseline, which puts its top at the cap height of 11 px uppercase mono. Print size: 6pt box, 3pt fill, .75pt line.

---

## 2. Page grid

### 2.1 Anatomy (XL, 1440 × any height)

```
|44|<-------- 96 -------->|1|40|<------------------------------ 1215 ------------------------------>|44|
    00                     │    Giorgi Samsiani                                     h1 Sans 300 / 76
    Curriculum             │    Full-Stack Web Developer  Tbilisi, Georgia · Open to remote work
    vitae                  │    Web applications · online stores · system integrations
    2026                   │    I build websites and online stores that load fast, …   (max 760)
                           │    ─────────────────────────────────────────────────────── 1px rule
                           │    EMAIL      contact@samsiani.com                               COPY
                           │    PHONE / GITHUB / WEB …
                           │    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2px ink
                           │    10+          │ PHP · TS       │ WP · Next      │ KA · EN
                           │    ─────────────────────────────────────────────────────── 1px ink
                                                   (88 gap: the spine segment ends here)
    01 (accent ink)        │    Profile                                               h2 Sans 400 / 34
    3.1 (hanging, grey)    │    …
```
- `.lg-page { max-width: 1440px; margin-inline: auto; padding-inline: var(--gutter) }`. Above 1440 the page is centred. The header content uses the same 1440 cap, so it lines up with the page. The header's rule stays full-bleed.
- Every section is a two-column grid: `grid-template-columns: var(--idx) minmax(0,1fr)`. The spine column holds the number (`.lg-idx`, `aria-hidden`). The body carries the 1px spine rule and the inset (`.lg-body`, `padding-inline-start: var(--body-pl)`).
- Each section starts `--sec-gap` below the previous one, so the spine is **segmented, one segment per entry**. This is what the exploration renders (see `ref-en-1440-lists.png`).

### 2.2 Tiers and exact widths

| Tier | Viewport range | Reference | Gutter | Spine (text + pad) | Body inset | **Content width** | Skills: Group · Item · Depth | List label col | Split title col | Contact key col | Section gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **XL** | ≥ 1280 | 1440 | 44 | 96 (72 + 24) | 1 + 40 | **1215** | 226 · 839 · 150 | 226 | 440 | 120 | 88 |
| **L** | 1024–1279 | 1080 | 32 | 88 (68 + 20) | 1 + 32 | **895** | 200 · 559 · 136 | 200 | 360 | 120 | 76 |
| **M** | 720–1023 | 768 | 24 | 48 (36 + 12) | 1 + 20 | **651** | 160 · 379 · 112 | 160 | stacked | 104 | 64 |
| **S** | < 720 | 390 | 20 (16 at ≤ 400) | none (becomes a "section tab") | 0 | **358** @390 | stacked: item 1fr · depth 76 EN / 108 KA | stacked | stacked | 92 | 56 |

Content width = min(viewport, 1440) − 2·gutter − spine − 1 − inset. The Item column is the remainder; Group includes a 16 px cell gutter. The table uses `table-layout: fixed` with `<colgroup>` widths (`--c-group`, `--c-depth`). The contact key column is `--c-kv`. Media queries: `max-width: 1279px`, `1023px`, `719px`, plus `479px` (short "PDF" label) and `400px` (gutter 16, legend entries may wrap). The inline nav uses `min-width: 1280px | 1360px | 1440px` together with the nav-fit class (§2.4).

### 2.3 Spine rules

- **Section numbers** `01`–`08` (Mono 11, `--accent-ink`) share the **baseline of the h2**. This comes from `.lg-sec { align-items: baseline }` on the section grid, so it holds for both languages at every size without offsets. It was measured at 0.0 px in EN and KA at 1440, 1080 and 768.
- **Hero** `00` (index grey) is top-aligned (`padding-top: 6px`). The eyebrow `hero.eyebrow` is split at " · " into one line per segment ("Curriculum / vitae / 2026") and hangs in the spine. It is positioned inside `.lg-body`: `position:absolute; inset-inline-start: calc(-1px - var(--idx)); top: 22px; width: calc(var(--idx) - var(--idx-pr))`. "Curriculum" (≈ 70 px at 11 px; ≈ 67 px at 10.5 px) fits the 72 px (XL) and 68 px (L) spine text width. At M and S the eyebrow returns to the flow above the h1 on one line ("Curriculum vitae · 2026"), and `00` stays in the spine at M.
- **Hanging sub-numbers** *(extrapolated)*: numbered lists put `3.1`–`3.9` (abilities) and `5.1`–`5.6` (principles) in the spine, level with each row's h3 baseline. They use `.lg-hang { position:absolute; inset-inline-start: calc(-1px - var(--idx) - var(--body-pl)); top: 23px }` and are `aria-hidden`, because the `<ol>` already numbers the items for screen readers. The format is `${sectionIndex}.${i+1}`, computed from the section's position in the order array, never hard-coded. "How I work" is an unordered list and has no numbers.
- **S tier:** the spine disappears. Each section starts with a "section tab": a 1px `--rule` top border, 12 px, then the number, then 12 px, then the h2. The hero has no tab. Sub-numbers become static labels above each h3.

### 2.4 Header

- **Behaviour:** `position: sticky; top: 0; z-index: 50`, height **62 px** on every tier. Opaque `--paper`, 1px `--rule-strong` bottom rule. It never hides or shrinks on scroll. It is hidden in print. Sections use `scroll-margin-top: calc(62px + 24px)`.
- **Contents, left to right** (`<header class="lg-top nav-…">`):
  - the brand link: `ctx.person.monogram` ("GS"), a 1 × 16 separator, `ctx.host` ("samsiani.me"), and an sr-only " — {hero.name}"
  - the inline nav: 8 links, `a[data-spy]`, labels `sec.navLabel`
  - the language switch: the current `c.selfLabel` is an underlined span with `aria-current="page"`; the other language is `langSwitchLink(c, alt, c.altLabel, title=altTitle)`
  - the theme button: `themeToggle({ ...c.ui, theme: c.ui.themeShort }, 'lg-theme', UI_ICONS.theme + '<span class="lg-theme-t">{themeShort}</span>')`. The shared fragment writes its `aria-label` and `title` from `ui.theme`; passing `themeShort` there makes the accessible name equal to the visible word ("Theme" / "თემა"). This satisfies WCAG 2.5.3 in Georgian too, which the long "თემის შეცვლა" would not, because it does not contain "თემა". `aria-pressed` is set by main.js.
  - "SAVE AS PDF": `printButton(c.ui, 'lg-pdf')`, 32 px high with a 1px border; the fragment's `.label-long` / `.label-short` spans swap at ≤ 479 px
  - the Sections menu: `<details class="menu lg-menu">`; the class `menu` is what main.js closes
- **Per tier:**
  - the inline nav shows only from the nav-fit breakpoint (below); otherwise the Sections menu shows
  - at M and S the domain and its separator are hidden
  - at S (< 720) the Theme word and the Sections label become sr-only, so both controls are icon-only (32 × 32 and 40 × 32), and the PDF label switches to `ui.printShort` at ≤ 479
- **Nav-fit (automatic; admin-safe).** `navFit(c, ctx)` in `template.mjs` estimates the header's natural width from every string it shows and puts one class on `<header>`: `nav-1280 | nav-1360 | nav-1440 | nav-never`. The strings are the monogram, host, language labels, `themeShort`, `ui.print` and the eight `navLabel`s. CSS shows the inline nav from that breakpoint up. Because the header content is capped at 1440, a nav that needs more than 1440 never goes inline.
  ```js
  const FIT = { en: { nav: 5.9, gap: 20 }, ka: { nav: 7.8, gap: 14 } };  // measured 5.81 / 7.69 px per character
  const CH  = { mono14: 9.3, mono12: 7.3, mono12_5: 7.6, btn: 7.4, geo12_5: 8.2 };
  need = monogram·9.3 + 25 + host·7.6            // brand
       + labels(selfLabel, altLabel) + 19.3       // language switch (Latin 7.3, Georgian 8.2 px per character)
       + 18 + label(themeShort)                   // theme
       + 26 + print·(7.4 EN | 8.2 KA)             // PDF button
       + 2·16 + navChars·FIT.nav + 7·FIT.gap + 2·32 + 2·44
  class = 'nav-' + ([1280, 1360, 1440].find((bp) => bp >= need) ?? 'never')
  ```
  Results: `site.example.json` gives EN **nav-1280** (estimate 1240; natural nav 692 px) and KA **nav-1440** (estimate 1440; measured need 1417). `site.stress.json` gives EN **nav-1360** and KA **nav-never**, and passes the stress gate.
- **Sections menu:** the panel is `position:absolute; inset-inline-end:0; top:calc(100% + 8px)`, with `min-width: min(300px, 100vw − 2·gutter)` and max-width 100vw − 2·gutter, a 1px `--rule-strong` border, and radius 0. Rows are `grid 28px 1fr`, padded 11 × 14, separated by 1px `--row`. Each row is the number (Mono 11, `--accent-ink`) plus `<span class="t">` for the title; the current section underlines only `.t`. When open, the summary inverts to ink with paper text.

---

## 3. Sections

Parts marked **[exploration]** follow the export. Parts marked **[extrapolated]** are new and follow the same visual language. The full markup is in `layout-ledger/src/layouts/ledger/template.mjs`; Appendix A maps its parts.

### 3.0 Hero — `00` [exploration, with live content]
- `<section class="lg-row lg-hero" aria-label="{ui.atAGlance}">`, with the spine showing `00` and the body in this order:
  1. eyebrow (§2.3)
  2. `h1` `hero.name` on one line (EN 486 px wide at 76 px; KA 518 px at 60.8 px); a 10 + 10-letter name wraps with `text-wrap: balance` at S
  3. role line, a wrapping flex with baseline alignment and gap 16 / 6: `hero.role` (Sans 500) followed by `hero.location · hero.availability` (Mono)
  4. subrole line `hero.subrole` **[extrapolated: the exploration had no subrole]**
  5. tagline `hero.tagline`
  6. contact key-value table
  7. facts strip
- **Contact table** `.lg-kv` (`<table aria-label="{contact.heading}">`, `<th scope=row>` keys): keys are `contact.items[].label` in uppercase Mono (EN) or plain Noto (KA). Values are links. The third column holds `COPY` only when `item.copy`: the shared `copyButton(i.value, c.ui, 'lg-copy copy')`, which renders `hidden`, `data-copy`, `data-copied` and `aria-label="{ui.copy}: {value}"`. It is right-aligned, `min-height: 28px`, and pulled −6 px so the text sits flush right. The copied state is an `--accent` fill with `--on-accent` text, radius 0. Rows have 1px `--rule` top and bottom. Icons are not used in Ledger: the exploration uses text keys, and the 120 px key column has room for them.
- **Facts** `.lg-facts` (`hero.facts`, 1–4 items; the template sets `style="--n:{count}"`): a grid of `repeat(var(--n), minmax(0,1fr))` with a 2px ink top rule and a 1px ink bottom rule. Cells are padded 18 / 20 (the first has no inline-start padding; the last has no inline-end padding) and divided by 1px `--rule`. The value is Sans 300 and allowed to wrap (`overflow-wrap:anywhere`); the label is a micro-label. At S the grid is 2 × 2 and the first row gets a `--rule` bottom border.
- Per tier: M stacks nothing and keeps 4 facts, with cells padded 14 / 12. S puts the role and meta on separate lines and moves the eyebrow into the flow.

### 3.1 Profile — `01` [extrapolated]
- The h2 has no lead (content has none). Below it sit `profile.paragraphs` in `.lg-prose`: **two CSS columns** at XL and L (`column-gap: 56px; column-rule: 1px solid var(--rule)`, `p { break-inside: avoid }`, 14 px between paragraphs), and one column at M and S (max-width 680).

### 3.2 Stack & skills — `02` [exploration]
- The h2 is followed by `skills.lead`, then a **real table**. Explicit ARIA roles are required, because the S tier changes `display`:
```html
<table class="lg-skills" role="table" aria-labelledby="skills-title" aria-describedby="skills-legend">
  <colgroup><col class="g"><col><col class="d"></colgroup>
  <thead role="rowgroup"><tr role="row">
    <th role="columnheader" scope="col">{ui.colGroup}</th><th role="columnheader" scope="col">{ui.colSkill}</th><th role="columnheader" scope="col">{ui.colDepth}</th></tr></thead>
  <!-- one tbody per skills.groups[] -->
  <tbody class="lg-grp" role="rowgroup">
    <tr role="row">
      <th role="rowheader" scope="rowgroup" rowspan="{items.length}"><h3>{group.title}</h3><p class="lg-glead">{group.lead}</p></th>
      <td role="cell" class="lg-item">{item.label}<span class="sub"> · {item.detail}</span></td>
      <td role="cell" class="lg-depth"><span class="lg-dm" data-level="core" aria-hidden="true"></span>{ui.levels[level]}</td></tr>
    <tr role="row"><td role="cell" class="lg-item">…</td><td role="cell" class="lg-depth">…</td></tr>
  </tbody>
</table>
<p class="lg-legend" id="skills-legend">…</p>
```
- The header labels are `ui.colGroup / colSkill / colDepth`, seeded by the data model as **Group / Skill / Depth** (KA ჯგუფი / უნარი / დონე). The exploration's "Item" becomes "Skill": it names what the column holds and matches the Georgian. The owner can change the wording in the admin.
- Each item renders `item.label` (ink) and, when present, `item.detail` (muted-2) after " · ". `localize()` has already split them.
- **Depth cell:** the mark plus `ui.levels[level]`. The cell has a hanging indent (`padding-inline-start: 16px; text-indent: -16px`) and may wrap, because the admin allows level names up to 14 characters (the stress fixture's "Core Core Core" wraps onto two lines instead of overflowing).
- **Rules:** 2px ink under the thead, 1px `--row` between rows, and 1px ink under the group cell and under the group's last row, so each group closes with an ink line. `tr:last-child td { border-bottom-color: var(--rule-strong) }`.
- **Legend** (below the table, as a footnote): `{ui.legend} —` followed by three entries `[mark] {levels[l]}: {levelHints[l]}`. The "·" separator is an `aria-hidden` span *inside* the preceding entry, and every entry is `white-space: nowrap` (normal at ≤ 400), so no line ever starts with a dot. The exploration's "+ 4 more groups follow" is dropped: all 7 groups render.
- **S tier (stacked):** `table … td { display:block }`; `thead` becomes sr-only; `colgroup` is hidden; the table gets a 2px ink top rule. Each `.lg-grp` ends with a 1px ink rule. Each `tr` is a grid `minmax(0,1fr) var(--c-depth)` with column-gap 12, baseline alignment, and a 1px `--row` bottom border on the **row**, not the cells (cell borders break when the item wraps). The group `th` spans the full width, padded 16 / 0 / 10. The depth column has a fixed width (76 EN / 108 KA), so the marks form one vertical column (see `ref-390-en-hero-ka-skills.png`).

### 3.3 What I can own end to end — `03` [extrapolated]
- The h2 and `abilities.lead` are followed by a **ruled list, label variant** `<ol class="lg-list">`: 2px ink top rule, 1px ink bottom rule, rows separated by 1px `--rule`. Each row is a grid `var(--c-group) 1fr`, so titles line up with the skills Group column and texts line up with the Skill column. The row content is the hanging number `3.{i}`, then `h3` (Sans 500 / 17), then `p` (Sans 400 / 15, max 700).

### 3.4 How I work — `04` [extrapolated]
- A **ruled list, split variant** `<ul class="lg-list lg-list--split">`. The titles are sentences, so the title column is wider: **440** at XL and **360** at L, with 40 px padding-inline-end. At M and S the title stacks above the text (gap 6). There are no numbers.

### 3.5 Principles — `05` [extrapolated]
- Same as 3.4 (split variant), plus hanging numbers `5.1`–`5.6`.

### 3.6 Experience — `06` [extrapolated]
- Label-variant `<ol class="lg-list lg-exp">`. The label column holds `period` (Mono 12.5, tabular numbers, ink-2; Noto in KA). The body column holds `h3` = `role` (Sans 500 / 18) followed by `<span class="lg-org">· {org}</span>`. The org is 400 weight in muted-2; when `orgHref` is set it is a `.u-link` in **ink**. `text` follows with 8 px margin-top.

### 3.7 Languages — `07` [extrapolated]
- `<dl class="lg-list lg-langs">` with one `<div class="lg-li">` per language: `dt` = `name` (Sans 500 / 17) and `dd` = `level` (Sans 400 / 16, ink-2). At S the grid is `1fr auto` (name left, level right). This is the only "education-like" section; no education or certificates block is ever added.

### 3.8 Let's talk — `08` [extrapolated]
- The h2 and `contact.lead` are followed by the big email link: a `mailto:` in Sans 300 at 48 / 42 / 34 / 26, with a **2px `--accent-ink` underline** (offset .14em) and the shared arrow icon (`UI_ICONS.arrow`, 0.46 em, `--accent-ink`). On hover the text turns `--accent-ink`. The address and link come from `sections.contact.primary`; when no primary item is set, the email and the CTA row are omitted. It uses `overflow-wrap:anywhere`.
- Then the CTA row (flex-wrap, gap 12). The primary button is `contact.cta` ("Write to me") linking to the primary item: `--accent` fill, `--on-accent` text. The outline buttons are `sections.contact.buttons` in order (today GitHub, then the phone): external links show the item `label`, `mailto:`/`tel:` links show the `value`, all with a 1px `--rule-strong` border. Buttons are square, 40 px high (44 at S), Mono 500 / 11.5 uppercase (EN) or Noto 500 / 12.5 (KA). Hover on any button inverts it to an ink fill with paper text.

### 3.9 Footer [extrapolated]
- Spans the full content width, from gutter to gutter (under the spine too). It has a **3px double** `--rule-strong` top border and padding 14 / 0 / 48. It is a flex row, `space-between`, wrapping with gaps 8 / 24:
  - left: `© {year} {name} · {ui.updated} <time>{ctx.updated}</time> · {ui.builtWith}`. `ctx.updated` is `settings.updated`, pinned to 2026-06-07 today.
  - right: a link to the other language (`altTitle`, `data-lang-switch`) and `{ui.top} ↑`.
- Mono 11 in muted-2 (Noto 12 in KA). Links get ink and an underline on hover.

### 3.10 States and motion

| Element | Hover | Focus-visible | Active / current |
|---|---|---|---|
| any focusable | — | 2px `--focus` outline, 3px offset, square | — |
| nav link | ink | ring | `aria-current` → ink + 1px underline, offset 6 |
| `.u-link` | underline turns `--accent-ink`, 2px | ring | — |
| outline button, PDF | ink fill, paper text | ring | — |
| primary CTA | ink fill, paper text | ring (outside the accent fill) | — |
| COPY | underline | ring | `data-state="copied"` → `--accent` fill, `--on-accent` text, 1.5 s (main.js) |
| menu summary | — | ring | `[open]` → ink fill, paper text |
| menu item | `--hover` wash | ring | current → `.t` underlined |

Motion: only 120 ms colour and underline transitions. **There is no reveal-on-scroll**: Ledger sections do not carry `.sec` or `.intro`, so main.js's observer finds nothing, which is intended because a ledger page is static. `@view-transition { navigation: auto }` is kept for the language switch. Under `prefers-reduced-motion: reduce`, smooth scroll, the view transition and all transitions are off.

---

## 4. Theme

- **Light-first.** `--paper: #fff` and the page reads like printed paper. **Dark = inverted ledger:** the light ink `oklch(.17 .008 250)` becomes the paper, and text runs from `.96` down to `.64` (§1.2). The strong rules drop to `.80` to avoid glare. The accent switches to the palette's dark value.
- It uses the same three theme states as today: an explicit `data-theme="dark|light"` on `<html>` (set by the existing pre-paint script and toggle), otherwise `prefers-color-scheme`. The CSS defines the full light set on `:root` and redefines the tokens under `@media screen and (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `@media screen { :root[data-theme="dark"] }`.
- **Print always uses the light tokens and the palette's light values**, even when the visitor is in dark mode, because both the layout's and the palette's dark rules are `@media screen` only (§6).
- See `ref-en-1440-dark.png`. Every dark text pair measures ≥ 7.16:1, except `--faint` at 5.69:1 (§1.2).

---

## 5. Georgian adaptation

1. **Fonts.** IBM Plex has no Georgian glyphs. For `lang="ka"`, `--sans` puts **Noto Sans Georgian first** and `--mono` keeps Noto second, so Georgian characters always render in Noto and Latin/digits in Plex. The existing Noto file is a **variable font with a weight axis of 100–900** (verified from its `fvar` table). Today's `@font-face` declares `400 700`. Ledger's own `fonts.css` declares the same file as **`font-weight: 100 900`**. That costs no extra bytes and unlocks weight 350. Precision's `fonts.css` can stay as it is.
2. **Display weight: KA h1 uses Noto Sans Georgian 350 at 0.8 × the EN size** (60.8 px at XL). In a side-by-side test, Noto 300 at 60 px has thinner absolute strokes than Plex 300 at 76 px, because stroke width scales with font size, and it looks spindly on Mkhedruli's round forms. Noto 400 looks heavier than the Latin name. 350 matches the stroke colour of Plex 300 at 76 px. KA h2 stays at 400 (EN h2 is 400). Fact values and the big email are Latin, so they stay Plex 300.
3. **Casing.** `text-transform` is only ever `var(--caps)`. The token is `uppercase` for EN and `none` for KA, so browsers never turn Mkhedruli into Mtavruli. The only literal `uppercase` in the stylesheet is the token definition. `verify.mjs` A4 fails if any element containing Georgian has computed `uppercase`.
4. **Micro-labels switch face in KA.** Everything that is Mono in EN and can hold Georgian text (contact keys, fact labels, table headers, depth labels, COPY, legend, eyebrow, period, meta, buttons, PDF, menu summary, footer) uses `--label` (Mono in EN, Noto in KA). Size ×1.09, tracking .01–.02em, no caps. Spine numbers stay Mono because they are digits only. The KA meta line must not stay Mono: Plex Mono's wide spaces between Georgian words looked broken in the prototype.
5. **Language factors** (`styles.css` §2, `html[lang=ka]`): `--k-display .8`, `--k-head .88`, `--k-tag .9`, `--k-label 1.09`, `--k-prose .97`, `--w-display 350`. KA line heights: h1 1.08, h2 1.2, tagline 1.55, lead 1.65, prose 1.7, text 1.65. Every KA size is a token × factor, so tiers and print override the base value once and KA follows automatically. (Without this, `html[lang=ka] .x {font-size}` rules outrank print rules. That bug appeared in the prototype and printed the KA profile at 11.6 pt.)
6. **Long-label risks** (measured in the prototype):

| Risk | Measured | Handling |
|---|---|---|
| Inline nav | EN 692 px, KA 859 px (12 px / gap 14) | nav-fit class; KA goes inline only at ≥ 1440 |
| Depth label "საფუძვლიანი" | 103 px incl. mark (12 px) | S depth column 108 px; M 112; L 136; XL 150 |
| Group title "საინჟინრო პრაქტიკა და AI-ხელსაწყოები" | 3 lines in 160 px (M), 2 in 226 (XL) | `text-wrap: balance`; the rowspan cell grows |
| Fact label "ძირითადი პლატფორმები" | 2 lines at M (cell ≈ 139 px) | cells align to the top; allowed |
| Split-list title (principle 1, KA) | 3 lines in 440 px | allowed; stacks at M and S |
| Hero eyebrow segment | "რეზიუმე" 51 px | fits the 72 / 68 px spine; `overflow-wrap:anywhere` as a guard |
| Menu summary "სექციები" (stress: 17+ chars) | 103 px button | icon-only below 720 px, label kept for screen readers |
| Level names up to 14 characters (stress) | "Core Core Core" ≈ 121 px | depth cell wraps with a hanging indent |
| Legend (KA) | one line at XL, wraps at M and S | entries `nowrap`; the dot stays inside the preceding entry |
| Hyphenated tokens ("WP-CLI") | may break after the hyphen at M | accepted (no Georgian hyphenation dictionary; `hyphens: manual`) |

7. **Length limits come from `data-model.md` §7** (for example `ui.levels.*` ≤ 14, `hero.facts[].value` ≤ 10, nav labels ≤ 28 each and ≤ 100 in total, `hero.eyebrow` ≤ 32). Ledger passes the stress fixture that sets every field to its limit (§8, A15). It adds no limits of its own. Two things to know when editing:
   - an eyebrow segment longer than about 10 characters wraps inside the 72 px spine at XL/L;
   - longer nav labels only move the inline-nav breakpoint (nav-fit) or switch to the Sections menu.

---

## 6. Print (A4). Ledger is the most print-like layout

- **Page:** `@page { size: A4; margin: 14mm 14mm 16mm }`, which leaves a 182 mm text block. **The spine stays in print** at 13 mm (3 mm padding), then a .75 pt rule, then a 5 mm inset, giving ≈ 164 mm of content. Print columns: Group 40 mm · Depth 25 mm · split title 62 mm · contact key 22 mm · section gap 8 mm.
- **Hidden in print:** header, skip link, COPY buttons and their column, the CTA row, footer links, the email arrow. **Kept:** everything else. Links stay clickable in the PDF and are **not** expanded with URLs.
- **Colours:** the light tokens are forced even from dark mode. Rules become darker so they survive toner (`--rule .84`, `--row .90`, `--sep .80`). The accent prints as the palette's light value. Depth marks are borders, so they print with "Background graphics" off.
- **Print type scale** (tokens; KA via factors): h1 30 pt (KA 24) · h2 15 pt (KA 13.2) · tagline 12 · role 12 · fact value 15 · email 16 · meta 8 · subrole / lead 8.5 · prose 9 (2 columns, 7 mm gap) · h3 9.5 · list text / items 8.5 · kv 9 · group lead 7.5 · spine / legend / footer 7 · labels 6.5 · th 6. Rules: .75 pt thin, 1.5 pt head, 2.25 pt double.
- **Breaks:**
  - `h2, .lg-lead { break-after: avoid; break-inside: avoid }`. `break-inside` on the lead is required: without it Chrome split a two-line lead across pages and left the h2 orphaned.
  - `.lg-grp { break-inside: avoid }`: a skill group never splits, and Chrome repeats the `thead` on continuation pages.
  - `.lg-li { break-inside: avoid }`; `.lg-legend`, `.lg-langs`, and the contact body `{ break-inside: avoid }`.
  - print prose: `p { break-inside: auto; orphans: 2; widows: 2 }`, so the two columns balance.
- **Running footer** (Chromium ≥ 131; other browsers ignore it). `styles.css` holds the static part: `@page { @bottom-left { font: 400 7pt "IBM Plex Mono", "Noto Sans Georgian", monospace; color: #55585c } @bottom-right { content: counter(page) " / " counter(pages); … } }`. That part always prints "n / N". The name needs content, so `layout.mjs` exports `headExtra(c, ctx)`, which returns `<style media="print">@page{@bottom-left{content:"{hero.name} · {ctx.host}"}}</style>` (§9.2). Because the admin can edit the name, the string goes through a CSS-string escaper: `'"' + s.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3C ').replace(/\n/g, '\\A ') + '"'`, which turns `</style>` into `\3C /style>`. Without the hook the PDF simply has no name in the footer.
- **Measured result:** EN **5 pages**, KA **6 pages**, the same as Precision today, for both light and dark themes (`ref-print-en.png`, `ref-print-ka.png`). EN page 1 ends after Profile. The first skills group (10 rows ≈ 88 mm) does not fit in the remaining ≈ 84 mm, so it moves to page 2 together with its heading, which is the correct behaviour.

---

## 7. Fonts to self-host

| File (new, in `src/fonts/`) | Source (css2 query, `latin` block) | Axis / weight | Bytes |
|---|---|---|---|
| `ibm-plex-sans-latin-wght-100-700.woff2` | `family=IBM+Plex+Sans:wght@100..700` | **variable**, wght 100–700, wdth fixed at 100 | 40,240 |
| `ibm-plex-mono-latin-400.woff2` | `family=IBM+Plex+Mono:wght@400;500` (first latin block) | static 400 | 10,052 |
| `ibm-plex-mono-latin-500.woff2` | same query (second latin block) | static 500 | 10,060 |
| `noto-sans-georgian-georgian-normal-400-700.woff2` (existing, unchanged) | — | variable 100–900 (the descriptor changes only) | 41,456 |

- **Weights needed:** Sans 300 / 400 / 500, all from one variable file. That is smaller than three static files (300 = 19,300 B; 400 = 17,604 B; 500 ≈ 17.6 kB; ≈ 54.5 kB together). Mono 400 and 500. No Mono 600.
- **Totals:** EN **60,352 B (≈ 59 KB)**; KA with Noto **101,808 B (≈ 99 KB)**. Precision today is 64.6 KB EN and 106 KB KA.
- **Fetch on the build machine** (never on the server). The URLs were current on 2026-09-14 (Plex Sans v23, Plex Mono v20):
  ```bash
  UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  latin() { curl -sA "$UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" | awk '/\/\* latin \*\//{f=1} f&&/src:/{match($0,/https:[^)]*/);print substr($0,RSTART,RLENGTH);f=0}'; }
  latin 'IBM+Plex+Sans:wght@100..700'     # → …/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYbSB4Zh.woff2
  latin 'IBM+Plex+Mono:wght@400;500'      # → …/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q131nj-o.woff2 (400)
                                          #   …/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgsAXHNk.woff2 (500)
  curl -so src/fonts/ibm-plex-sans-latin-wght-100-700.woff2 <url>   # and the two mono files
  ```
  Check each downloaded size against the table (±3 %). The API returns HTTP 400 for `wght@100..800`, which confirms the axis ends at 700.
- **`src/layouts/ledger/fonts.css`** (complete in `layout-ledger/src/layouts/ledger/fonts.css`) uses the latin `unicode-range` exactly as in the current `src/fonts.css`:
  ```css
  @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 100 700; font-stretch: 100%; font-display: swap;
    src: url('fonts/ibm-plex-sans-latin-wght-100-700.woff2') format('woff2'); unicode-range: /* latin */; }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; font-display: swap;
    src: url('fonts/ibm-plex-mono-latin-400.woff2') format('woff2'); unicode-range: /* latin */; }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; font-display: swap;
    src: url('fonts/ibm-plex-mono-latin-500.woff2') format('woff2'); unicode-range: /* latin */; }
  @font-face { font-family: 'Noto Sans Georgian'; font-style: normal; font-weight: 100 900; font-stretch: 100%; font-display: swap;
    src: url('fonts/noto-sans-georgian-georgian-normal-400-700.woff2') format('woff2'); unicode-range: /* georgian, as today */; }
  ```
- **Preload** (Ledger only): `ibm-plex-sans-latin-wght-100-700`, `ibm-plex-mono-latin-400`, `ibm-plex-mono-latin-500`, plus Noto on `/ka/`. Never preload or declare Chivo or JetBrains Mono on a Ledger page (verify A4).
- **Cache:** the new files have new names, so nothing stale is served. If a font file is ever replaced, it must get a new file name, because Cloudflare caches `/fonts/*` as immutable. The build may also add a content hash to font names.
- **Licence:** IBM Plex is SIL OFL 1.1. Add `src/fonts/OFL-IBM-Plex.txt`, copied from `github.com/IBM/plex` `LICENSE.txt`.
- **Known gap:** "→" (U+2192, in "Figma → production") is outside Google's latin subset, so it renders in the system font. This is acceptable. Do not widen `unicode-range` unless the file is shown to contain the glyph.

---

## 8. Acceptance criteria

### 8.1 Script-checked: `node docs/plans/layout-ledger/verify.mjs <dist dir | http://…>`
It prints `ALL LEDGER CHECKS PASS` (20 checks) today for the preview build of `site.example.json` in the cobalt, lime and crimson palettes. The real build must pass the same checks.

| # | Check | Pass condition |
|---|---|---|
| A1 | overflow sweep | `scrollWidth − clientWidth = 0` at every width 320…1600 (step 10), EN and KA |
| A2 | header | `.lg-top-in` never overflows at 390…1920; the inline nav is displayed **iff** the width ≥ the nav-fit class on `.lg-top` (example content: EN 1280, KA 1440) |
| A3 | contrast | every visible text colour/background pair ≥ 4.5:1 in light **and** dark; `--accent-ink` on `--paper` and on `--hover` ≥ 4.5; `--on-accent` on `--accent` ≥ 4.5; `--focus` on `--paper` ≥ 3; depth-mark borders ≥ 3 |
| A4 | Georgian + fonts | no element containing Georgian has computed `text-transform: uppercase`; Plex Sans and Plex Mono loaded (and Noto on KA); no Chivo, JetBrains or Archivo; h1 computed weight 300 (EN) / 350 (KA) |
| A5 | spine | abs(number baseline − h2 baseline) ≤ 1 px and abs(sub-number baseline − h3 baseline) ≤ 1 px at 1440, 1080, 768 |
| A6 | geometry | h1 box width 1215 / 895 / 651 / 358 at 1440 / 1080 / 768 / 390; skills Group/Depth 226/150, 200/136, 160/112 (±1); no depth label overflows |
| A7 | print | A4; EN ≤ 5 pages, KA ≤ 6, from both themes; printed body background `rgb(255,255,255)`; header and CTA hidden |

### 8.2 Grep and DOM checks (add to verify.mjs or CI; all pass on the preview build today)

| # | Check |
|---|---|
| A8 | output HTML: exactly one `h1`; eight `h2` with ids `{id}-title`; `table.lg-skills[role=table]` with 3 `columnheader`s and 7 `tbody[role=rowgroup]`; every group `th[rowspan]` equals its item count; `aria-describedby="skills-legend"` resolves |
| A9 | every skill row has exactly one `.lg-dm[data-level∈core,strong,working]`, and its label equals `ui.levels[level]` |
| A10 | no retired copy in the output: command `A10` below prints `0` for both files (the preview build prints 0 today). The pattern is case-sensitive, so the lowercase "education" in the experience text is allowed. |
| A11 | command `A11` below prints only the `--caps: uppercase` line |
| A12 | command `A12` below prints nothing (no pills, serif faces, textures or shadows), and the light `--paper` is `#fff` (no cream) |
| A13 | font files present with the sizes in §7 (±3 %); the Noto `@font-face` declares `font-weight: 100 900` |
| A14 | Lighthouse (`npx lighthouse`, the default mobile run and `--preset=desktop`) Accessibility = 100; record CLS, target ≤ 0.1 |
| A15 | stress gate (`data-model.md` §9): `scripts/check-layout-stress.mjs --dist <dir> --topnav .lg-nav` prints PASS for a `site.example.json` build **and** a `site.stress.json` build (24 viewport checks each: no horizontal scroll, the top nav never wraps or clips). Both pass today. |
| A16 | palette greps (`palettes.md` §10) on `src/layouts/ledger/styles.css`: no declaration of the six palette tokens, no `color: var(--accent)`, no outline using `--accent`. See command `A16` below. |

```bash
# A10: retired exploration copy (expect 0 and 0)
grep -cE '\bRU\b|Russian|русск|რუსულ|Education|Georgian bank gateways|contract work|most people avoid|more groups follow' dist/index.html dist/ka/index.html
# A11: casing only through the token (expect exactly one line: --caps: uppercase)
grep -n uppercase src/layouts/ledger/styles.css
# A12: rejected visual ideas (expect no output)
grep -nE 'border-radius:\s*[1-9]|(^|[^-])serif|radial-gradient|dotted|box-shadow' src/layouts/ledger/styles.css
# A16: palette contract (expect no output from all three)
grep -nE -- '--(accent|on-accent|accent-ink|accent-soft|accent-line|focus)[[:space:]]*:' src/layouts/ledger/styles.css
grep -nE '(^|[^-])color:[[:space:]]*var\(--accent\)' src/layouts/ledger/styles.css
grep -nE 'outline[^;]*var\(--accent' src/layouts/ledger/styles.css
```

### 8.3 Screenshot checks (compare with `docs/plans/layout-ledger/ref-*.png`)

| # | View | Must show |
|---|---|---|
| S1 | EN 1440 top (`ref-en-1440-top.png`) | 62 px header with a 1px ink rule and the inline nav; spine `00 / Curriculum / vitae / 2026`; one-line h1 in Plex 300; role and mono meta on one line; 4-row contact table with accent COPY on email and phone; facts with a 2px ink top rule |
| S2 | EN 1440 lists (`ref-en-1440-lists.png`) | spine segment per section; `03` in accent at the h2 baseline; `3.1`–`3.9` grey in the spine; titles in the 226 px column; the split list for How I work |
| S3 | EN 1440 end (`ref-en-1440-end.png`) | experience periods in mono; languages dl; 48 px email with an accent underline; square buttons (one accent fill); 3px double footer rule |
| S4 | KA 1440 (`ref-ka-1440-top.png`) | Georgian nav inline at 1440; h1 Noto 350; no capitals anywhere in Georgian; KA meta in Noto (not mono) |
| S5 | EN 1080 (`ref-en-1080-top.png`) | Sections menu instead of the nav; spine 88; skills 200 · 559 · 136 |
| S6 | KA 768 (`ref-ka-768-top.png`) | 48 px spine with `00`; eyebrow above the h1; 3-column table 160 · 379 · 112 |
| S7 | 390 (`ref-390-en-hero-ka-skills.png`) | no spine; hairline section tabs; facts 2 × 2; stacked skills with an aligned depth column; no overflow |
| S8 | dark 1440 (`ref-en-1440-dark.png`) | near-black paper #0d1013, light rules, lifted accent |
| S9 | print sheets (`ref-print-en.png`, `ref-print-ka.png`) | spine kept; running footer `name · samsiani.me   n / N`; `thead` repeated on page 3; no group split; no h2 at the foot of a page |
| S10 | lime palette (`ref-en-1440-lime.png`: contact table, then section 08 and the footer) | only the §1.3 surfaces change: COPY, `08`, the email underline and the arrow in leaf-green `--accent-ink`; "Write to me" as a lime `--accent` fill with dark `--on-accent` text. Rules, marks, headings and outline buttons stay ink. |

### 8.4 Manual

| # | Check |
|---|---|
| M1 | Chrome print dialog with "Background graphics" **off**: depth marks and rules are still visible. With "Headers and footers" **on**: confirm Chrome's own header and footer do not collide with the running footer. If they do, keep the running footer: Chrome's header and footer are a per-print user option. |
| M2 | Safari and Firefox at 1440 and 390: spine numbers sit on the h2 baseline (grid `align-items: baseline`); if a browser misaligns, add `padding-top: 3px` on `.lg-sec .lg-n` for that engine only after measuring. The missing `@page` footer is acceptable there. |
| M3 | Keyboard: skip link → brand → nav (when inline) → language → Theme → PDF → Sections → content links → COPY; the focus ring is visible on every stop, including the accent CTA. |
| M4 | VoiceOver: at ≥ 720 px the skills table is announced with column headers and group row headers; at 390 px rows and cells are still announced (explicit roles). |
| M5 | A native speaker reviews the new KA UI strings (§9.3). |

---

## 9. Build integration

Ledger is written for the layout contract in `data-model.md` §8.2 and registers in phase 3 (`data-model.md` §11). It only reads the localized tree `c` and `ctx`, and uses the shared fragments.

### 9.1 Files (copy `docs/plans/layout-ledger/src/layouts/ledger/` → `src/layouts/ledger/`)

| File | What it is |
|---|---|
| `layout.mjs` | Manifest: `id: 'ledger'`, `label: 'C · Ledger'`, `css: ['fonts.css', 'styles.css']`, `fonts` (3 Plex files + Noto), `preload` (EN: Plex Sans, Mono 400, Mono 500; KA: Noto first, then the same three), `themeColor { light: '#ffffff', dark: '#0d1013' }`, `manifestBackground: '#0d1013'`, and the optional `headExtra(c, ctx)` (§9.2). |
| `template.mjs` | `renderBody(c, ctx)`: the header and `<main id="main">`, everything between the shared skip link and the script tag. It also exports `navFit(c, ctx)` (§2.4). It is pure: no fs, no globals, no hard-coded content. |
| `styles.css` | The verified stylesheet (sections 1–14: tokens, base, header, grid, hero, heads, profile, skills, lists, contact, footer, tiers, print), plus two lines appended after review: `body { overflow-wrap: break-word; }` (a 29-letter Georgian word in a heading or a 40-character tool list in a skill name otherwise scrolls the page by 148 px KA / 21 px EN at 320 px) and `@media (min-width: 401px) { .lg-leg { display: inline-block; max-width: 100%; white-space: normal; } }` (a legend item at its limits, 14-letter level and 32-letter hint, otherwise overflows KA 410–450 px by up to 41 px; items still never break while they fit on a line, so the seed renders identically). A11 and A12 still pass. The template also escapes `ctx.updated` in the footer (master plan Appendix B, E6). |
| `fonts.css` | The four `@font-face` rules in §7. |

Register it in `src/layouts/index.mjs`:
```js
import ledger from './ledger/layout.mjs';
import { renderBody as ledgerBody } from './ledger/template.mjs';
export const LAYOUTS = { precision: { meta: precision, renderBody: precisionBody }, ledger: { meta: ledger, renderBody: ledgerBody } };
```
Add `src/fonts/ibm-plex-sans-latin-wght-100-700.woff2`, `ibm-plex-mono-latin-400.woff2`, `ibm-plex-mono-latin-500.woff2` and `OFL-IBM-Plex.txt` (§7).

### 9.2 The one shared change: an optional head hook
`shared/document.mjs` `renderHead` gets one line, just before the stylesheet link:
```js
${layout.headExtra ? layout.headExtra(c, ctx) : ''}
<link rel="stylesheet" href="${assets.cssHref}">
```
Ledger uses it only for the printed running footer (§6). `preview.mjs` applies exactly this patch to its temporary copy. If the owner of `document.mjs` declines the hook, delete `headExtra` from `layout.mjs`: the PDF then shows "n / N" without the name, and nothing else changes.

### 9.3 Content used (all from `localize()`; nothing is hard-coded)

| Content | Ledger element |
|---|---|
| `ctx.person.monogram`, `ctx.host`, `ctx.updated` | brand mark, brand domain and running footer, footer year and date |
| `hero.eyebrow` | spine lines at XL/L, one line above the h1 at M/S (split at " · ") |
| `hero.name` / `role` / `location` / `availability` / `subrole` / `tagline` | one-line h1 / role line / meta / meta / subrole / tagline |
| `contact.heading`, `contact.items[{label,value,href,copy}]` | contact table `aria-label`, rows (`icon` unused: Ledger shows text keys) |
| `hero.facts[{value,label}]` (up to 4; `--n` = count) | facts strip |
| `sections.*.title` / `.lead` / `.id` / `.navLabel` | h2 (`id="{id}-title"`) / lead / section id and spy / nav and menu labels |
| `profile.paragraphs[]` | 2-column prose |
| `skills.groups[{title,lead,items[{label,detail,level}]}]` | one `tbody` per group |
| `ui.levels`, `ui.levelHints`, `ui.legend`, `ui.colGroup`, `ui.colSkill`, `ui.colDepth` | depth labels, legend, table header |
| `abilities.items[{title,text}]` | numbered label list (3.1 …) |
| `workstyle.items[{title,text}]` | unnumbered split list |
| `principles.items[{title,text}]` | numbered split list (5.1 …) |
| `experience.items[{period,role,org,orgHref,text}]` | experience list (`period` comes from `formatPeriod`) |
| `education.langs[{name,level}]` (section id `languages`) | languages dl |
| `contact.lead`, `contact.cta`, `contact.primary`, `contact.buttons` | contact section |
| `ui.themeShort`, `ui.theme`, `ui.print`, `ui.printShort`, `ui.copy`, `ui.copied`, `ui.nav`, `ui.language`, `ui.atAGlance`, `ui.updated`, `ui.builtWith`, `ui.top`, `selfLabel`, `altLabel`, `altTitle`, `path`, `altPath` | header controls, footer, labels |

The four Ledger strings `ui.themeShort`, `ui.colGroup`, `ui.colSkill`, `ui.colDepth` are already in the data model (seeded "Theme / თემა", "Group, Skill, Depth / ჯგუფი, უნარი, დონე"). This plan keeps that wording. The KA values still need the owner's review (M5).

### 9.4 Runtime (`src/main.js`, no change)
Ledger uses only the shared hooks:
- `[data-theme-toggle]` (main.js sets `aria-pressed`)
- `[data-print]` (starts `hidden`)
- `[data-copy][data-copied]` (starts `hidden`; the button text is swapped)
- `[data-lang-switch]`
- `a[data-spy]` in both the nav and the menu (sets `aria-current="location"`)
- `details.menu` (closes after a choice or an outside click)

It uses neither `.sec` / `.intro` nor `[data-reveal]`, so there is no reveal animation, by design. `styles.css` includes `[hidden]{display:none!important}` so that no `display` rule can show a JS-only control before main.js runs.

### 9.5 Build
`LAYOUT=ledger node build.mjs` (or `settings.layout = "ledger"`). The CSS is `fonts.css + styles.css` followed by the palette block from `palettes.mjs` (phase 2), and the build hashes it into `styles.<hash>.css` as today. The build copies only `meta.fonts`, so Chivo and JetBrains Mono are neither copied nor preloaded on a Ledger site. `404.html` renders with the same template.

### 9.6 Out of scope and constraints
- No server details in the repository; Ledger is static CSS, HTML and fonts, and has no server-side part.
- Not part of this layout: photos, a project list, Russian, education or certificates.
- The rejected ideas stay excluded (A12): cream or beige paper, terracotta, serif display, dotted textures, pill chips, 3-column rounded cards.
- CV register: the layout adds no copy; all words come from the data model.
- **OG images:** they belong to the OG/admin pipeline (`data-model.md` §12.2, `palettes.md` §7). If per-layout OG cards are ever made, a Ledger card is white with the Plex 300 name, a 2px ink rule and the four facts. Like every OG image, it needs a content-hashed file name.

---

## Appendix A: where each part lives in `template.mjs`

| Part | Code in `renderBody` |
|---|---|
| Header | `<header class="lg-top ${navFit(c, ctx)}">` with brand, `.lg-nav`, `.lg-ctl` (language, `themeToggle`, `printButton`, `details.menu.lg-menu`) |
| Section shell | `open(sec)` = `<section class="lg-row lg-sec" id aria-labelledby>` + `.lg-idx` number + `<div class="lg-body">` + h2 + lead; `close` |
| Hero | `.lg-row.lg-hero`: `00`, `.lg-eyebrow` spans, h1, `.lg-roleline`, `.lg-subrole`, `.lg-tagline`, `table.lg-kv`, `ul.lg-facts` |
| Skills | `table.lg-skills` with roles, `tbody.lg-grp` per group, `p.lg-legend#skills-legend` |
| Lists | `ol.lg-list` (abilities, with `hang()` 3.x), `ul.lg-list--split` (work style), `ol.lg-list--split` (principles, 5.x), `ol.lg-list.lg-exp`, `dl.lg-list.lg-langs` |
| Contact | `.lg-sec--contact`: `a.lg-bigmail` + `.lg-cta` from `contact.primary` / `buttons` |
| Footer | `footer.lg-foot` inside `main`, with `langSwitchLink` and "↑" |

## Appendix B: exploration copy that is **not** used (the live content is authoritative)

| Exploration | Live replacement |
|---|---|
| nav "Education" | `sections.education.title` = "Languages" / "ენები" |
| "Open to remote and contract work" | `hero.availability` "Open to remote work" |
| tagline "I build e-commerce systems that stay fast, talk to banks and ERPs…" | `hero.tagline` |
| facts "years building for the web · primary languages · primary platforms · **KA · EN · RU** product locales shipped" | live facts, ending "KA · EN · interface languages" (**no RU**) |
| skills lead "Grouped by where they sit… not a self-rating." | `skills.lead` |
| "Georgian bank gateways · BOG, TBC…" | "Bank payment gateways · BOG, TBC, Liberty, Credo, Flitt, iPay" |
| group lead "The part of the stack most people avoid." | "Connecting shops to banks, ERP systems and service providers." |
| "+ 4 more groups follow" | removed; all 7 groups render (Front end has 10 items live, not 9) |
| "CV · 2026" | `hero.eyebrow` "Curriculum vitae · 2026", split into lines |
| "Legend —" | `ui.legend` "Depth of use —" |
