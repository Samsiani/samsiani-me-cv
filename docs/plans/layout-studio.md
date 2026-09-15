# Layout B · Studio — build specification

Layout B of the three owner-selectable layouts. Source: Claude Design export, option **1b "B · Dark studio — bento hero, Archivo wide display, lime accent, hairline bands"** (`samsiani.me.dc.html`, extracted to `dir-studio.html`). The export covers only header, hero and the Stack & skills section at 1440 px, dark theme. Everything else is extrapolated here, and every extrapolated part is labelled **[extrapolated]**. Parts taken from the export are labelled **[export]**.

Everything in this plan was built and run, not just written. The reference implementation in `docs/plans/layout-studio/` renders both languages through the data-model plan's shared shell (`docs/plans/data-model-ref/src/shared/`) with the palette plan's generated palette block, and passes every check in §8.

| File (`docs/plans/layout-studio/`) | Target path after the build | What it is |
|---|---|---|
| `layout.mjs` | `src/layouts/studio/layout.mjs` | Layout manifest (data-model meta + admin registry fields + `defaultTheme`). |
| `template.mjs` | `src/layouts/studio/template.mjs` | `renderBody(c, ctx)`: body markup only, uses the shared fragments. |
| `fonts.css` | `src/layouts/studio/fonts.css` | `@font-face` for Archivo (new), JetBrains Mono, Noto Sans Georgian. |
| `styles.css` | `src/layouts/studio/styles.css` | The complete stylesheet (499 lines): tokens, layout, Georgian, responsive, motion, print. |
| `admin-thumb-studio.svg` | `src/render/admin-thumbs/studio.svg` | 320×200 layout thumbnail for the admin picker (admin plan §6). |
| `verify-build.mjs` | stays in docs (review tool) | Builds the reference through the shared shell into any folder, optional `--serve`. |
| `check-studio.mjs` | `tools/check-studio.mjs` or stays in docs | Acceptance script (§8). Playwright is not a project dependency. |
| `ref-*.png`, `ref-print-*.pdf` | stays in docs | Reference screenshots and print output of the verified build. |

Verified results (lime palette unless stated):

| Check | Result |
|---|---|
| Horizontal overflow, every 10 px from 320 to 1600, EN/KA × dark/light | none, on the live content **and** on `site.stress.json` |
| WCAG 2.1 AA contrast of every visible text node (DOM walk), EN/KA × dark/light × 1440/390 | pass, for **all six palettes** (cobalt, lime, emerald, amber, crimson, graphite) |
| Georgian text with `text-transform` ≠ `none` | none |
| Palette gate `check-palettes.mjs` with Studio's final neutrals (§1.2) | PASS 432/432 |
| Palette plan grep gates (no palette token declared, no `color: var(--accent)`, no `outline: var(--accent…)`) | all print nothing |
| Data-model stress gate `check-layout-stress.mjs --topnav .st-nav` | PASS 24/24 |
| Save as PDF (A4), live content | EN 4 pages, KA 5 pages |

---

## 0. Decisions, files, integration

### 0.1 Key decisions

1. **Dark-first by default attribute, not by a different theme model.** Studio's neutrals use the same three-state pattern as the palette block (light on `:root`, dark on screen only). Studio is dark-first because the document always carries `data-theme` and its default is `"dark"` (§4). All six palettes and both themes therefore always agree; print is always light.
2. **Accents come only from the palette plan's tokens.** Studio reads `--accent`, `--on-accent`, `--accent-ink`, `--accent-line` and `--focus`, and never declares them. The export's lime becomes the default `lime` palette, value for value (§1.3).
3. **Hero = 12-column bento** with four tiles (name 7, role 5 / contact 5, facts 7 as a 2×2 grid) at ≥ 1080 px, as in the export. It re-flows to 12 / 6 + 6 / 12 at 768–1079 and to one column below 768 (§2.4).
4. **Sections are full-bleed hairline bands.** Each band is a 1 px top rule across the viewport and a content column capped at 1360 px. Inside, four patterns carry every section: head row, split rows, hairline cells, tiles (§3.0).
5. **No 3-column card grid.** The only three-column grid is the skills table from the export: hairlines only, no fills, no radius. The nine abilities are split rows, not cards.
6. **Header nav bar shows only when it fits.** The template estimates the bar width from the actual labels and emits `data-nav="1280|1440|1600|menu"`. The live content gives EN 1280 and KA 1600. Below the tier, the `<details>` menu is shown (§2.3).
7. **Names and big values fit their tiles.** The h1 and the fact/language values size themselves as `min(scale, 100cqi / (longest word × em))` from a build-time `data-len`, so the 10-letter maximum names of the stress fixture never break mid-word (§3.1).
8. **Archivo is self-hosted as the Google latin variable file** (90,096 B, width 62–125 %, weight 100–900). An optional instancing step can trim it (§7).
9. **Georgian:** Noto Sans Georgian first in the stack, labels switch from JetBrains Mono to Noto with `text-transform: none`, headings drop to normal width, sizes and leading are re-tuned (§5).
10. **`main.js` is unchanged.** Studio uses the existing hooks: `[data-theme-toggle]`, `[data-print]`, `[data-copy]`, `[data-lang-switch]`, `a[data-spy]`, `.sec`, `details.menu`, `.skip`, `.label-long/.label-short`.

### 0.2 Build steps (in order)

1. Fetch Archivo (§7.1) to `src/fonts/archivo-latin-wdth-wght.woff2`.
2. Copy `layout.mjs`, `template.mjs`, `fonts.css`, `styles.css` to `src/layouts/studio/`.
3. Register the layout: `src/layouts/index.mjs` → `studio: { meta: studio, renderBody: studioBody }` (data-model plan), and add it to the admin registry `LAYOUTS` (admin plan §5.1; `name`, `description`, `thumbnail` are already in `layout.mjs`).
4. Apply the shared-shell change of §0.3 (a).
5. Copy `admin-thumb-studio.svg` to `src/render/admin-thumbs/studio.svg`.
6. Update `palettes.json → layouts.studio.light` (§0.3 (c)) and re-run the palette gate.
7. Build with `LAYOUT=studio PALETTE=lime node build.mjs`, serve, run `check-studio.mjs` (§8). Also build `site.stress.json` and run the stress gate with `--topnav .st-nav`.

### 0.3 Integration points with the other plans

**(a) Shared shell (`src/shared/document.mjs`, data-model plan).** Two additions, both inert for Precision:

```js
// in renderDocument(c, ctx, body)
const theme = ctx.defaultTheme === 'system' && ctx.layout.defaultTheme ? ctx.layout.defaultTheme : ctx.defaultTheme;
const themeAttr = theme === 'light' || theme === 'dark' ? ` data-theme="${theme}"` : '';
// <html lang="…" dir="…" data-layout="${ctx.layout.id}" data-palette="${ctx.palette}"${themeAttr}>
// and pass the effective value on: renderHead(c, { ...ctx, defaultTheme: theme })
```

- `data-theme="dark"` in the static HTML makes no-JS visitors dark as well. The inline init script still overrides it (URL > stored choice > default).
- Precision has no `defaultTheme` in its manifest, so with `settings.defaultTheme = "system"` it emits exactly today's HTML apart from the `data-layout`/`data-palette` attributes that the palette plan (§5 step 4) already asks for.
- `verify-build.mjs` contains exactly this wrapper and is the proof that it works.

**(b) Admin plan R6 (theme precedence).** Amend to: `?theme=` > stored choice > `settings.defaultTheme` when not `system` > **the layout's `defaultTheme`** > `prefers-color-scheme`. With this, "Follow visitor's system" in the admin means "the layout's own default" for Studio. If the admin plan rejects the amendment, the fallback is for the admin to pre-select "Dark" in the Default-theme radios when the owner picks Studio. Studio renders correctly either way; only the first-visit theme differs.

**(c) Palette plan.** Studio's final light neutrals replace the proposed ones in `palettes.json → layouts.studio` (the proposal had near-white tiles on a grey page; Studio keeps the export's recessed-tile logic in light too):

```json
"studio": {
  "_source": "layout-studio.md §1.2 — dark = export 1b; light = page oklch(97.5% .003 258), recessed tile oklch(94% .005 258)",
  "light": { "bg": "oklch(97.5% 0.003 258)", "surface": "oklch(94% 0.005 258)", "ink": "oklch(19% 0.012 258)" },
  "dark":  { "bg": "oklch(19% 0.012 258)",   "surface": "oklch(23.5% 0.012 258)", "ink": "oklch(96% 0.004 250)" }
}
```

Gate with these values: PASS 432/432. The lowest accent-text ratio on a Studio surface is 5.18 : 1 (emerald light, `--accent-ink` on the tile); lime light is 5.81 on the page and 5.22 on the tile. All Studio surfaces that carry accent text stay inside the palette envelope (light L ≥ 93 %, dark L ≤ 27 %). This is why the light hover tint is 94 % and not 92 %. Studio uses the fill/hover treatment `filter: brightness(1.08)`, the same as the gate's `hoverBrightness`.

**(d) Data model.** Studio consumes the `localize()` tree unchanged and uses its additive keys: `sections.*.navLabel`, `hero.givenName`/`familyName`, `skills…items[].label`/`detail`, `sections.contact.primary`/`buttons`, `ctx.person.monogram`, `ctx.updated`. It needs **no** extra limits or counts: it passes the full `site.stress.json` fixture. The facts grid also accepts 2–6 items (an odd last item spans both columns), so the admin could relax `hero.facts` to 2–6 for Studio. Keeping 4 is recommended for parity with the other layouts.

**(e) OG images.** Studio ships without its own `og` builder, so the admin falls back to the default card (admin plan §5.6), coloured by the palette. A Studio-styled card is a later, optional addition. It would need static Archivo TTF instances, because Satori reads neither WOFF2 nor variable axes.

**(f) Things Studio does not touch:** `main.js`, `build.mjs` logic beyond the registry, the palette module, the admin.

---

## 1. Design tokens

### 1.1 Inventory of the export (every colour actually used)

All from the `style` attributes of `dir-studio.html`. Contrast is WCAG 2.1 against the page `#101419` and the tile `#1b1e24`; hex is the 8-bit sRGB the browser renders.

| # | oklch in export | hex | Role(s) in the export | vs bg | vs tile | Becomes |
|---|---|---|---|--:|--:|---|
| 1 | `.19 .012 258` | `#101419` | page background; text on the lime mark and on the Save-as-PDF button; text of the active language cell | — | — | `--st-bg` (dark); palette `--on-accent` |
| 2 | `.235 .012 258` | `#1b1e24` | every bento tile | 1.11 | — | `--st-tile` (dark) |
| 3 | `.96 .004 250` | `#f0f2f4` | h1, h2, h3, values, names, brand name, hovered nav link; background of the active language cell | 16.44 | 14.84 | `--st-ink`, `--st-invert-bg` |
| 4 | `.84 .008 250` | `#c7cbd0` | tagline paragraph on the role tile | 11.31 | 10.21 | `--st-ink-2` |
| 5 | `.85 .008 250` | `#caced3` | theme-toggle glyph | 11.69 | 10.55 | `--st-ink-2` (icon) |
| 6 | `.80 .008 250` | `#babec3` | location line, legend, level labels, section lead | 9.89 | 8.93 | `--st-muted` |
| 7 | `.78 .008 250` | `#b4b8bc` | inactive language ("ქართ"), skill-group lead | 9.23 | 8.33 | `--st-muted` |
| 8 | `.76 .008 250` | `#adb1b6` | fact labels, skill detail ("· App Router…") | 8.61 | 7.77 | `--st-muted-2` |
| 9 | `.74 .008 250` | `#a7abb0` | nav links | 8.01 | 7.23 | `--st-muted-2` |
| 10 | `.72 .008 250` | `#a1a5a9` | "CONTACT" tile label, ↗ arrows, "+ 4 more groups" note | 7.45 | 6.72 | `--st-muted-2` |
| 11 | `.86 .20 124` | `#b6e630` | lime: GS mark fill, Save-as-PDF fill, eyebrow, active nav text + 2 px underline, location square, copy-chip text, section index "02", level squares | 12.58 | 11.35 | palette `--accent` (fills) and `--accent-ink` (text, marks) |
| 12 | `.45 .09 124` | `#4b5d1f` | copy-chip border | 2.55 | 2.30 | palette `--accent-line` |
| 13 | `.62 .01 258` | `#82868c` | outline of the "Working" level square | 5.07 | 4.58 | `--st-sq-off` |
| 14 | `.28 .01 258` | `#26292e` | hairline between skill-cell rows | 1.27 | 1.14 | `--st-line-soft` |
| 15 | `.30 .01 258` | `#2b2e33` | hairline between contact rows inside the tile | 1.35 | 1.22 | `--st-line-tile` |
| 16 | `.32 .01 258` | `#303338` | header bottom rule, band top rule, skill-group top rule, divider above the location line | 1.46 | 1.31 | `--st-line` |
| 17 | `.36 .01 258` | `#3a3d42` | borders of the language switch and the theme button | 1.70 | 1.54 | `--st-ctl` |

The seven text greys of the export (#4–#10) collapse into three tokens (`--st-ink-2`, `--st-muted`, `--st-muted-2`). Each merge moves a value by ≤ 0.02 L, and every result still exceeds 7 : 1 on both the page and the tile. The light theme keeps the same tile-to-page step: 1.11 : 1 in both themes.

### 1.2 Structural tokens (layout owns, `styles.css` §1)

Declared as in the palette block: light on `:root`; dark in `@media screen and (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again in `@media screen { :root[data-theme="dark"] }`. Because Studio always carries `data-theme`, the second dark block is the one that normally applies (§4).

| Token | Role | Dark | hex | Light | hex |
|---|---|---|---|---|---|
| `--st-bg` | page, header, menu panel | `oklch(19% .012 258)` | `#101419` | `oklch(97.5% .003 258)` | `#f5f7f9` |
| `--st-tile` | bento tiles, language tiles | `oklch(23.5% .012 258)` | `#1b1e24` | `oklch(94% .005 258)` | `#e9ebee` |
| `--st-ink` | headings, values, names | `oklch(96% .004 250)` | `#f0f2f4` | `oklch(19% .012 258)` | `#101419` |
| `--st-ink-2` | body copy, tagline, icons | `oklch(84% .008 250)` | `#c7cbd0` | `oklch(32% .012 258)` | `#2f3339` |
| `--st-muted` | leads, legend, level words, location, periods | `oklch(80% .008 250)` | `#babec3` | `oklch(42% .012 258)` | `#494d54` |
| `--st-muted-2` | nav, micro labels, fact labels, details, footer | `oklch(74% .008 250)` | `#a7abb0` | `oklch(47% .012 258)` | `#575b62` |
| `--st-line-soft` | row hairlines between cells and rows | `oklch(28% .01 258)` | `#26292e` | `oklch(90.5% .005 258)` | `#dee0e3` |
| `--st-line-tile` | hairlines inside tiles | `oklch(30% .01 258)` | `#2b2e33` | `oklch(87% .006 258)` | `#d2d4d8` |
| `--st-line` | band, group and header rules | `oklch(32% .01 258)` | `#303338` | `oklch(87% .006 258)` | `#d2d4d8` |
| `--st-ctl` | control borders, org-link underline | `oklch(36% .01 258)` | `#3a3d42` | `oklch(80% .008 258)` | `#bbbec3` |
| `--st-sq-off` | "Working" level square outline | `oklch(62% .01 258)` | `#82868c` | `oklch(60% .01 258)` | `#7d8086` |
| `--st-hover` | hover tint (language switch, icon buttons, menu rows, ghost buttons) | `oklch(26% .012 258)` | `#20242a` | `oklch(94% .005 258)` | `#e9ebee` |
| `--st-invert-bg` / `--st-invert-fg` | active language cell, open menu button | ink / bg | | ink / bg | |
| `--st-shadow` | menu panel | `0 16px 40px -16px rgb(0 0 0/.6)` | | `0 16px 40px -18px rgb(0 0 0/.25)` | |

Contrast of the text tokens (ratio : 1; the lowest pair of each theme is in bold):

| Token | dark on bg | dark on tile | dark on hover | light on bg | light on tile | light on hover |
|---|--:|--:|--:|--:|--:|--:|
| `--st-ink` | 16.44 | 14.84 | 13.83 | 17.18 | 15.49 | 15.49 |
| `--st-ink-2` | 11.31 | 10.21 | 9.52 | 11.80 | 10.64 | 10.64 |
| `--st-muted` | 9.89 | 8.93 | 8.32 | 7.87 | 7.09 | 7.09 |
| `--st-muted-2` | 8.01 | 7.23 | **6.74** | 6.35 | **5.72** | 5.72 |
| `--st-sq-off` (non-text, ≥ 3) | 5.07 | 4.58 | — | 3.67 | 3.31 | — |

Lines and control borders are decorative (1.1–1.7 : 1). Every control carries a text or icon label; the focus ring is the palette's `--focus` (≥ 3 : 1 by the palette gate).

Non-colour structural tokens:

| Token | Value | Notes |
|---|---|---|
| `--st-max` | `1360px` | content cap = the export's content width at 1440 (1440 − 2 × 40) |
| `--st-pad` | 16 / 20 / 32 / 40 px | page gutter: < 400 / < 768 / 768–1079 / ≥ 1080 |
| `--st-gap` | `12px` | bento gap, facts/language grid gap, language-band column gap [export] |
| `--st-top-h` | `64px` | header height [export] |
| `--st-split` | `300px` | head column of split layouts at ≥ 1080 [export: skill group 300 px + 40 px gap] |
| `--st-ease` | `cubic-bezier(.2,.7,.2,1)` | same as Precision |
| `--st-h1` | EN `clamp(44px, 14vw, 92px)`; KA `clamp(40px, 12vw, 78px)` | upper bound; the fit rule of §3.1 may go lower |
| `--st-h2` | EN 30 / 36 / 42 px; KA 25 / 30 / 34 px | < 768 / 768–1079 / ≥ 1080 |
| `--st-h3` | EN 19 / 21 px; KA 17.5 / 19 px | < 1080 / ≥ 1080 |
| `--st-fact-size` | 26 / 30 / 34 px | < 480 / 480–1079 / ≥ 1080 |
| `--st-w-h1 … --st-w-mail` | 112 / 110 / 104 / 106 / 108 / 110 % | Archivo `font-stretch` for h1 / h2 / h3 / role / fact / big mail. KA: h2, h3 and role are 100 % |
| `--st-name-em` | EN 0.62, KA 0.72 | average advance of one bold display letter, in em (§3.1) |

### 1.3 Accent tokens (palette owns)

Studio never declares these; the build appends the active palette block after `styles.css` (palette plan §5). The default palette for Studio is `lime`, which is the export's colour:

| Token | lime dark | lime light | Where Studio uses it |
|---|---|---|---|
| `--accent` | `oklch(86% .2 124)` `#b6e630` | `oklch(86% .2 124)` `#b6e630` | fills only: GS mark, Save as PDF, primary CTA "Write to me", copied-state chip, skip link, `::selection` |
| `--on-accent` | `oklch(18.5% .012 258)` | `oklch(18.5% .012 258)` | text on those fills |
| `--accent-ink` | `oklch(86% .2 124)` | `oklch(48% .13 132)` `#406c07` | eyebrow, section index, row numbers, menu index, active nav text + 2 px underline, active menu row, copy-chip label, location square, level squares (Core fill, Strong half fill and outline), link-hover underlines, big-mail hover and arrow |
| `--accent-line` | `oklch(45% .09 124)` `#4b5d1f` | `oklch(72% .17 128)` `#85b72e` | copy-chip border |
| `--focus` | `oklch(86% .2 124)` | `oklch(48% .13 132)` | `:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px }`, and `outline-offset: -3px` inside the clipped language switch |
| `--accent-soft` | — | — | not used by Studio |

Rules Studio follows (the palette plan's §2 rules, checked by its grep gates): text never uses `--accent`; thin or small marks use `--accent-ink`; every `--accent` fill carries `--on-accent` content. Verified with all six palettes on the live DOM (§8).

### 1.4 Typography

Font stacks:

| Token | EN | KA |
|---|---|---|
| `--st-sans` | `Archivo, "Noto Sans Georgian", system-ui, -apple-system, "Segoe UI", sans-serif` | `"Noto Sans Georgian", Archivo, system-ui, -apple-system, "Segoe UI", sans-serif` |
| `--st-mono` | `"JetBrains Mono", "Noto Sans Georgian", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (review edit: Georgian in an EN mono context, such as the footer's "ქართულად" or Georgian typed into an EN label, uses the self-hosted Noto instead of an OS font; Noto's `unicode-range` leaves Latin untouched) | same (used only for digits and "EN") |
| `--st-label` | `var(--st-mono)` | `var(--st-sans)` (JetBrains Mono has no Georgian) |
| `--st-caps` | `uppercase` | `none` |

`unicode-range` limits Noto Sans Georgian to Georgian code points, so Latin inside Georgian text always renders in Archivo, whatever the stack order.

Type scale. Sizes are px; "B" = < 768, "T" = 768–1079, "D" = ≥ 1080. "Label" means `var(--st-label)` with `text-transform: var(--st-caps)`.

| Element (class) | Family | Wt | Size B / T / D | LH | Tracking | Stretch | Colour | Source |
|---|---|---|---|---|---|---|---|---|
| Brand mark `.st-mark` (30 × 30) | Archivo | 700 | 12 | 1 | 0 | 100 % | `--on-accent` on `--accent` | export |
| Brand name `.st-brand-name` (visible ≥ 600 px; below, visually hidden, never `display: none`, so the brand link keeps its accessible name) | sans | 500 | 13 | 1 | 0 | 100 % | ink | export |
| Nav link `.st-nav a` | sans | 400 | 13 | 1 | 0 | 100 % | muted-2; hover ink; current accent-ink + `inset 0 -2px 0` | export |
| Language switch `.st-lang` | mono (KA cell: Noto 12.5) | 500 | 12 | 1 | 0 | — | muted; current invert | export |
| Save as PDF `.st-ctl-primary` | sans | 600 | 12.5 | 1 | 0 | 100 % | on-accent on accent | export |
| Eyebrow `.st-eyebrow` | label | 500 | 11 (KA 12) | 1.3 | .16em (KA .04em) | — | accent-ink | export |
| Name `.st-name` (h1) | sans | 700 | `--st-h1`, fit (§3.1): 44.8 @320, 54.6 @390, 92 @≥658 | .92 (KA 1.04) | −.03em (KA −.02em) | 112 % | ink | export |
| Role `.st-role` | sans | 500 | 20 (KA 18) | 1.25 (KA 1.35) | 0 | 106 % (KA 100 %) | ink | export |
| Subrole `.st-subrole` | sans | 400 | 13.5 | 1.45 | 0 | 100 % | muted-2 | extrapolated |
| Tagline `.st-tagline` | sans | 400 | 17 (KA 16) | 1.45 (KA 1.6) | 0 | 100 % | ink-2 | export |
| Location `.st-loc` | sans | 400 | 13.5 | 1.4 | 0 | 100 % | muted; 7 × 7 accent-ink square | export |
| Tile label `.st-tile-label` | label | 500 | 10.5 (KA 11.5) | 1.3 | .14em (KA .03em) | — | muted-2 | export |
| Contact value `.st-clink` | sans | 400 | 15 | 1.3 | 0 | 100 % | ink | export |
| Copy chip `.st-copy` | label | 400 | 10 (KA 11) | 1 | .06em (KA .02em) | — | accent-ink, 1 px accent-line border, 4 × 6 padding, radius 0 | export |
| Fact / language value `.st-fact-value` | sans | 700 | 26 / 30 / 34, fit (§3.1) | 1 | −.02em | 108 % | ink | export |
| Fact label `.st-fact-label` | label | 400 | 11 (KA 12) | 1.4 (KA 1.45) | .06em (KA .02em) | — | muted-2 | export |
| Section index `.st-idx` | mono | 500 | 12 | 1 | 0 | — | accent-ink | export |
| Section title `.st-head h2` | sans | 700 | `--st-h2` | 1.02 (KA 1.15) | −.025em (KA −.01em) | 110 % (KA 100 %) | ink, `text-wrap: balance` | export |
| Section lead `.st-lead` | sans | 400 | 15 (KA 14.5) | 1.5 (KA 1.6) | 0 | 100 % | muted, max 560 (D: 520 column) | export |
| Profile prose `.st-prose` | sans | 400 | 16; 17 at ≥ 1280 (KA 15.5 / 16) | 1.65 (KA 1.75) | 0 | 100 % | ink-2 | extrapolated |
| Legend `.st-legend` | mono (KA sans 12) | 400 | 11.5 | 1.4 (KA 1.5) | 0 | — | muted; squares 8 × 8, gap 7 | export |
| Group title `.st-group-head h3` | sans | 600 | `--st-h3` | 1.2 (KA 1.35) | 0 | 104 % (KA 100 %) | ink | export |
| Group lead | sans | 400 | 13.5 | 1.5 | 0 | 100 % | muted | export |
| Skill name `.st-cell-name` | sans | 500 | 15 (KA 14.5) | 1.3 (KA 1.45) | 0 | 100 % | ink; detail `.st-sub` 400 muted-2 | export |
| Level word `.st-lvl` | label | 400 | 10.5 (KA 11.5) | 1 | .06em (KA .02em) | — | muted; square 8 × 8, gap 6 | export |
| Row title `.st-row-head h3`, role `.st-row-body h3` | sans | 600 | `--st-h3` | 1.25 (KA 1.35) | 0 | 104 % (KA 100 %) | ink, balance | extrapolated |
| Row number `.st-num` | mono | 500 | 11 | 1 | .04em | — | accent-ink | extrapolated |
| Row text `.st-row-text` | sans | 400 | 15 (KA 14.5) | 1.6 (KA 1.7) | 0 | 100 % | ink-2, max 720 | extrapolated |
| Work-style title `.st-cell--text h3` | sans | 600 | 18 (KA 16.5) | 1.3 (KA 1.4) | 0 | 104 % (KA 100 %) | ink | extrapolated |
| Work-style text | sans | 400 | 15 (KA 14.5) | 1.6 (KA 1.7) | 0 | 100 % | ink-2, max 600 | extrapolated |
| Period `.st-period` | label | 400 | 11.5 (KA 12.5) | 1.5 | .06em (KA .02em) | — | muted | extrapolated |
| Organisation `.st-org` | sans | 400 | 15 | 1.4 | 0 | 100 % | muted; link ink + 1 px `--st-ctl` underline | extrapolated |
| Big mail `.st-bigmail` | sans | 700 | `clamp(22px, 6.4vw, 60px)` | 1.05 | −.03em | 110 % | ink; arrow .6em accent-ink | extrapolated |
| Buttons `.st-btn` | sans | 600 | 13 | 1 | 0 | 100 % | 40 px high, 0 18 px padding, radius 3 | extrapolated |
| Menu row `.st-menu-list a` | sans | 400 | 14 | 1.35 | 0 | 100 % | ink; index mono 500 11 accent-ink | extrapolated |
| Footer `.st-foot-in` | label | 400 | 11 (KA 11.5) | 1.7 | .04em (KA .01em) | — | muted-2 | extrapolated |

Body default: `400 15px/1.5 var(--st-sans)`, antialiased.

### 1.5 Spacing, hairlines, radii, sizes

Spacing values used by the export (px): 4, 5, 6, 7, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 52, 56. Studio keeps them as literal values in the component rules (see the tables in §2 and §3), because they are tuned per component. The only spacing tokens are `--st-pad`, `--st-gap` and `--st-split`.

| Kind | Value |
|---|---|
| Hairlines | 1 px solid everywhere (`--st-line`, `--st-line-tile`, `--st-line-soft`); print 0.75 pt |
| Emphasis rule | active nav underline `box-shadow: inset 0 -2px 0 var(--accent-ink)`, 4 px below the text |
| Radii | 3 px: language switch, icon buttons, menu button, Save as PDF, CTA buttons, menu panel (menu rows 2 px). **0**: tiles, chips, squares, location marker |
| Squares | level/legend 8 × 8 with 1 px border (box-sizing border-box), location 7 × 7, brand mark 30 × 30 |
| Control heights | 36 px below 1080 (touch), 32 px at ≥ 1080 (export); icon buttons 36 / 34 px wide |

---

## 2. Page grid, breakpoints, header

### 2.1 Breakpoints

| Range | Gutter | What changes |
|---|---|---|
| 320–399 | 16 | as 400–479, plus: tile side padding 18; contact-row gaps 10; header control gap 6; language cells 0 8 px |
| 400–479 | 20 | single column; fact/language tiles are rows (value left, label right); print button shows "PDF"; brand mark only |
| 480–599 | 20 | fact/language grids 2 columns; tiles stacked; print button shows the long label |
| 600–767 | 20 | brand name visible |
| 768–1079 | 32 | hero 12 / 6 + 6 / 12; split rows 220 px + 32 px gap; h2 36 (KA 30) |
| 1080–1279 | 40 | hero bento of the export; head row = title | lead; split rows 300 + 40; profile in 2 columns; controls 32 px |
| 1280–1439 | 40 | EN nav bar (tier 1280); profile prose 17 px |
| 1440–1599 | 40 | reference width of the export; tier-1440 nav bars appear |
| ≥ 1600 | 40, content capped at 1360 and centred | KA nav bar (tier 1600) |

Content column: `.st-wrap { max-width: calc(1360px + 2 × gutter); margin-inline: auto; padding-inline: gutter }`. Bands and the header draw their hairlines across the full viewport; only their content is capped. The header's inner row uses the same cap, so brand and content edges align at every width.

### 2.2 Grids inside the column

- **Bento**: `repeat(12, minmax(0, 1fr))`, gap 12. Column width at 1440 = 102.33 px; span 7 = 788.3 px, span 5 = 559.7 px. At 1080: span 7 = 578.3, span 5 = 409.7.
- **Split** (skill groups, abilities, experience): `300px | minmax(0, 1fr)`, gap 40 at ≥ 1080; `220px | 1fr`, gap 32 at 768–1079; one column below.
- **Wide split** (principles): `minmax(0, 5fr) | minmax(0, 7fr)`, gap 40 at ≥ 1080; `1fr | 1fr` at 768–1079.
- **Cells** (skills, work style): driven by container queries on `.st-cells-c`. Skills: 2 columns at container ≥ 480 px, 3 at ≥ 840 (EN) or ≥ 960 (KA). At 1440 the items area is 1020 px (3 columns of 340); at 1280 it is 860 (EN 3, KA 2); at 1080 it is 660 (2). Work style: 2 columns at container ≥ 640.

### 2.3 Header [export; behaviour extrapolated]

- `position: sticky; top: 0; z-index: 50; height: 64px; background: var(--st-bg); border-bottom: 1px solid var(--st-line)`. No blur, no transparency.
- Row: brand · nav · controls, `justify-content: space-between`, gap 12 (the export's 32 px gap only matters when the nav shows; the estimate below counts 2 × 32).
- Controls: language switch (EN | ქართ), theme toggle (shared SVG icon, not the export's "◐" glyph), Save as PDF (`hidden` until `main.js` enables it), `<details class="st-menu menu">`.
- Sections scroll to `scroll-margin-top: 63px`, so a band's top rule meets the header rule.

**Nav visibility.** The template computes the bar's width from the labels and emits `<header class="st-top" data-nav="…">`:

```js
const est = (s, latin, georgian) => [...s].reduce((n, ch) => n + (GEORGIAN.test(ch) ? georgian : latin), 0);
const nav = Σ est(navLabel, 6.3, 8.7) + 20 × (8 − 1);   // 13 px Archivo / Noto, 20 px gaps
const brand = 40 + est(name, 6.6, 8.2);                  // 30 px mark + 10 px gap + 13 px/500 name
const controls = 86 + 34 + 28 + est(ui.print, 7.0, 8.4) + 24;
const need = nav + brand + controls + 64 + 80;           // header gaps + 40 px gutters
tier = [1280, 1440, 1600].find((bp) => need <= bp) ?? 'menu';
```

The per-glyph averages are measured values plus a ~6 % margin (Archivo 13 px: 562 px for the 95 EN nav characters = 5.92 px each; Noto Sans Georgian 13 px: 822 px for the 99 KA characters = 8.30 px each).

| Content | Estimated need (px) | Measured need (px) | Tier |
|---|--:|--:|---|
| live EN | 1271 | 1226 | 1280 |
| live KA | 1575 | 1539 | 1600 |
| stress EN ("Alexandros Gelashvili", 98 nav characters) | 1364 | 1332 | 1440 |
| stress KA ("ალექსანდრე სამსიანიძე") | 1624 | 1599 | menu (the estimate errs on the safe side) |

"Measured need" = nav `scrollWidth` + brand + control group + 64 + 80, read in Chromium with the real fonts.

CSS: `.st-nav { display: none }`, and `@media (min-width: T) { .st-top[data-nav="T"] .st-nav { display: flex } .st-top[data-nav="T"] .st-menu { display: none } }` for T = 1280, 1440, 1600. `white-space: nowrap` on the bar. The stress gate verifies that the bar never wraps or clips when shown.

Header content per width:

| Width | Brand | Nav | Controls |
|---|---|---|---|
| < 480 | mark only | menu | EN/ქართ · theme · "PDF" · menu (36 px) |
| 480–599 | mark only | menu | long print label |
| 600–1079 | mark + name | menu | 36 px controls, gap 8 |
| ≥ 1080 | mark + name | bar from the tier width, else menu | 32 px controls, gap 12 (export) |

The mobile menu is a `<details>` panel: absolute, right-aligned, `top: calc(100% + 8px)`, `min-width: min(260px, 100vw − 2 × gutter)`, `background: var(--st-bg)`, 1 px `--st-ctl` border, radius 3, shadow; rows use a `26px | 1fr` grid with 11 × 10 padding and the index in mono accent-ink.

### 2.4 Hero bento per breakpoint

```
≥ 1080 (export)                               768–1079                      < 768 (390 shown)
┌───────────── 7 ─────────────┬──── 5 ────┐   ┌──────────── 12 ─────────┐   ┌──── 12 ────┐
│ CURRICULUM VITAE · 2026     │ Role      │   │ eyebrow                  │   │ name tile  │
│                             │ subrole   │   │ Giorgi                   │   ├────────────┤
│ Giorgi                      │ tagline   │   │ Samsiani                 │   │ role tile  │
│ Samsiani                    │ ───────── │   ├──────── 6 ───┬──── 6 ────┤   ├────────────┤
│                             │ ■ loc     │   │ role tile    │ contact   │   │ contact    │
├──────── 5 ───────┬──────────┴─── 7 ────┤   ├──────────────┴───────────┤   ├────────────┤
│ CONTACT          │ 10+      │ PHP · TS │   │ 10+        │ PHP · TS    │   │ 10+    lbl │
│ mail      [COPY] ├──────────┼──────────┤   ├────────────┼─────────────┤   │ PHP·TS lbl │
│ phone     [COPY] │ WP · Next│ KA · EN  │   │ WP · Next  │ KA · EN     │   │ WP·Next  … │
│ github         ↗ │          │          │   │            │             │   │ KA · EN  … │
│ web            ↗ │          │          │   └────────────┴─────────────┘   └────────────┘
└──────────────────┴──────────┴──────────┘   (facts span 12, 2 × 2)        (facts: one column of rows)
```

| Tile | < 768 | 768–1079 | ≥ 1080 | Padding B / T / D | min-height B / T / D |
|---|---|---|---|---|---|
| `.st-t-name` | 1 / -1 | 1 / -1 | span 7 | 24 22 22 / 32 32 28 / 36 36 32 (< 400: 18 px sides) | none / 240 / 280 |
| `.st-t-role` | 1 / -1 | span 6 | span 5 | 22 22 20 / 28 28 24 / 32 32 28 | row-stretched |
| `.st-t-contact` | 1 / -1 | span 6 | span 5 | 20 22 22 / 24 28 26 / 26 30 28 | row-stretched |
| `.st-facts` (ul) | 1 / -1, 1 column (< 480) or 2 | 1 / -1, 2 columns | span 7, 2 columns | each `.st-fact`: 16 18 / 20 22 22 / 24 26 | — |

Hero section padding (top / bottom): 20 / 32 below 768, 32 / 44 at 768–1079, 44 / 52 at ≥ 1080 (export). Tiles are flat `--st-tile` blocks with no border, radius or shadow. Name and role tiles use `display: flex; flex-direction: column; justify-content: space-between`, so the eyebrow sits at the top and the name at the bottom (export).

---

## 3. Section-by-section rendering

Markup is in `layout-studio/template.mjs`. Every text value goes through `esc()`. Section order, anchors and numbering come from `orderedSections(c)`: 01 profile, 02 skills, 03 abilities, 04 work-style, 05 principles, 06 experience, 07 languages, 08 contact.

### 3.0 Shared band pattern [export: the skills band; applied to every section]

```html
<section class="st-band sec" id="{id}" aria-labelledby="{id}-title">
  <div class="st-wrap">
    <div class="st-head">
      <div class="st-head-title"><span class="st-idx" aria-hidden="true">02</span><h2 id="{id}-title">…</h2></div>
      <p class="st-lead">…</p>            <!-- only when the section has a lead -->
    </div>
    …section body…
  </div>
</section>
```

- Band: `border-top: 1px solid var(--st-line)`; padding 36/44 below 768, 40/52 at 768–1079, 44/56 at ≥ 1080 (export). The hero has no top rule (the header rule sits above it).
- Head: below 1080 the title row sits above the lead (lead `margin-top: 14px`, `max-width: 560px`). At ≥ 1080 it is `grid-template-columns: minmax(0, 1fr) minmax(0, 520px); column-gap: 48px; align-items: end` (export: title left, lead right, bottoms aligned).
- Title row: `display: flex; align-items: baseline; gap: 14px` (18 at ≥ 768): mono index, then the h2.
- Body offset: the first block after the head starts `margin-top: 28px` (34 at ≥ 1080) with its own `1px var(--st-line)` top rule. This rule-then-content rhythm is the "hairline band" language, and every section repeats it.
- Reveal: `.js .sec` fades from `opacity: 0; translate: 0 8px` over 0.5 s when `main.js` adds `.in`. The hero is deliberately not animated (LCP). Reduced motion: no reveal, no smooth scroll, `transition-duration: 0s`.

Body patterns:

| Pattern | Classes | Rules |
|---|---|---|
| Split rows | `ol.st-rows > li.st-row` | container `border-top: 1px var(--st-line)`; rows `padding: 20px 0 22px` (22/24 at ≥ 1080); `.st-row + .st-row { border-top: 1px var(--st-line-soft) }`; head `26px | 1fr` grid (number + h3, baseline) |
| Hairline cells | `.st-cells-c > ul.st-cells > li.st-cell` | cells `border-top: 1px var(--st-line-soft)`; no fills; column counts from container queries (§2.2); the first row loses its top rule when a rule already sits above it |
| Tiles | `.st-tile` | flat `--st-tile`, radius 0; hero, facts, languages only |

### 3.1 Hero [export; subrole, sizes below 1440 and the fit rule extrapolated]

```html
<section class="st-hero" aria-label="{ui.atAGlance}">
  <div class="st-wrap st-bento">
    <div class="st-tile st-t-name"><p class="st-eyebrow">…</p><h1 class="st-name" data-len="8">Giorgi<br>Samsiani</h1></div>
    <div class="st-tile st-t-role"><div><p class="st-role">…</p><p class="st-subrole">…</p><p class="st-tagline">…</p></div>
      <p class="st-loc"><span class="st-dot" aria-hidden="true"></span><span>{location} · {availability}</span></p></div>
    <div class="st-tile st-t-contact"><p class="st-tile-label" id="hero-contact">{contact.heading}</p>
      <dl class="st-contact" aria-labelledby="hero-contact">
        <div class="st-crow"><dt class="sr-only">Email</dt><dd><a class="st-clink" href="mailto:…"><span>…</span></a>{copyButton(value, ui, 'st-copy')}</dd></div>
        <div class="st-crow"><dt class="sr-only">GitHub</dt><dd><a class="st-clink" href="https://…" rel="me noopener"><span>…</span>{UI_ICONS.arrow}</a></dd></div>
      </dl></div>
    <ul class="st-facts"><li class="st-tile st-fact" [data-len] [data-geo]><span class="st-fact-value">10+</span><span class="st-fact-label">…</span></li> ×4</ul>
  </div>
</section>
```

- Eyebrow → 26 px → h1 (export). Role → subrole 6 px [extrapolated: the export has no subrole] → tagline 18 px. The location line sits at the tile bottom: `margin-top: 22px; padding-top: 16px; border-top: 1px var(--st-line)`, a 7 × 7 accent-ink square, gap 10 (export).
- Contact rows: list `margin-top: 18px`, `gap: 12px`; every row except the last has `padding-bottom: 11px; border-bottom: 1px var(--st-line-tile)` (export). The value link spans the row (`flex: 1`), with the copy chip (email, phone) or the shared arrow SVG (external links) at the right. The export's "↗" glyph is replaced by the SVG because the JetBrains Mono subset lacks U+2197.
- The copy chip is the shared `copyButton()` with class `st-copy`: `hidden` until `main.js` sees `navigator.clipboard`. In the copied state it becomes an `--accent` fill with `--on-accent` text for 1.5 s. The < 400 px rules keep the copied label "დაკოპირდა" on one row at 320 px.
- Facts below 480: `display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px`, value `flex: 0 1 auto`, label `flex: 1 1 0; min-width: 8em; text-align: end`. The label drops to its own line when the value is long. At ≥ 480 they are blocks, label `margin-top: 10px` (export).
- **Fit rule** (name, facts, languages). Each of these is an `inline-size` container. The template writes `data-len` = the length of the longest word (name: clamped 4–12; values: only when > 6, clamped to 12) and `data-geo` when a value contains Georgian:

```css
.st-t-name { container-type: inline-size; }
.st-name { font-size: min(var(--st-h1), calc(100cqi / (var(--st-name-len, 8) * var(--st-name-em)))); }
.st-name[data-len="10"] { --st-name-len: 10; }   /* one rule per value 4–12 */
.st-fact { container-type: inline-size; --st-fact-len: 6; --st-fact-em: 0.56; }
.st-fact[data-geo] { --st-fact-em: 0.75; }
.st-fact-value { font-size: min(var(--st-fact-size), calc(100cqi / (var(--st-fact-len) * var(--st-fact-em)))); }
```

  The em factors are measured: "Samsiani" is 4.71 em (0.59 per letter) and "Alexandros" 5.78 em (0.58) at 700/112 %; "ალექსანდრე" is 6.94 em (0.69) in Noto Bold; "TypeScript" is 5.44 em (0.54) and "ათწლეულები" 7.27 em (0.73) at the fact style. For the live content the rule never binds: the name stays 92 px (78 KA) at ≥ 658 px, and the values keep their scale. With the stress name "Alexandros Gelashvili" at 1080 px the h1 becomes 81.7 px (KA 70.3 px) and both words stay on one line each. Browsers without container units ignore the `font-size` declaration and keep the scale value.

### 3.2 01 Profile [extrapolated]

`div.st-prose` holding four `<p>`: margin-top 28/34, `padding-top: 22px; border-top: 1px var(--st-line)`, 16 px/1.65 ink-2 (17 px at ≥ 1280). At ≥ 1080 it has `columns: 2; column-gap: 56px`, with `p { break-inside: avoid; margin-bottom: 14px }` (the owner's "2 CSS columns on wide screens"). No lead, so the head is the title only.

### 3.3 02 Stack & skills [export]

```html
<p class="st-legend" aria-label="{ui.legend}"><span class="st-legend-item"><span class="st-sq" data-level="core" aria-hidden="true"></span><span>Core — daily, production</span></span> …×3</p>
<div class="st-groups">
  <div class="st-group">
    <div class="st-group-head"><h3>Front end & UI</h3><p>{lead}</p></div>
    <div class="st-cells-c"><ul class="st-cells">
      <li class="st-cell"><span class="st-cell-name">Next.js 16 <span class="st-sub">· App Router, server actions</span></span>
        <span class="st-lvl" data-level="core"><span class="st-sq" data-level="core" aria-hidden="true"></span><span>Core</span></span></li>
```

- Legend: `margin-top: 20px; display: flex; flex-wrap: wrap; gap: 8px 24px`; items `gap: 7px` (export).
- Group: `border-top: 1px var(--st-line); padding-top: 20px` (22 at ≥ 1080). The legend-to-first-group distance is 28 px (34 at ≥ 1080) and group-to-group is 28 px (32 at ≥ 1080), the export's 34 / 32. At ≥ 1080: `300px | 1fr`, gap 40. Below: the head sits above the cells, gap 14. The group lead: `margin-top: 9px`.
- Cell: `display: flex; flex-direction: column; gap: 5px; padding: 12px 20px 14px 0; border-top: 1px var(--st-line-soft)` (export). The top rule of the first row is removed only in the split layout (≥ 1080, where the group rule already sits above it), per column count: `:first-child`, plus `:nth-child(2)` at container ≥ 480, plus `:nth-child(3)` at ≥ 840 (EN) or ≥ 960 (KA). This is written as `@container` rules nested in `@media (min-width: 1080px)`. Stacked groups keep the first rule, which separates the head from the list.
- Level squares (export): Core = filled accent-ink; Strong = `linear-gradient(90deg, accent-ink 50%, transparent 50%)` plus a 1 px accent-ink border; Working = 1 px `--st-sq-off` border. They use borders instead of the export's inset box-shadow, and `print-color-adjust: exact`, so they print. The level is always also a word, so the squares are `aria-hidden`.
- The export's footnote "+ 4 more groups — …" is dropped: all groups render.

### 3.4 03 What I can own end to end [extrapolated]

Split rows, `ol.st-rows`. Each `li.st-row` = `.st-row-head` (mono number `01`–`09` in accent-ink, then the h3) | `p.st-row-text` (max 720). Nine items are deliberately rows, not a 3 × 3 grid (§0.1 item 5).

### 3.5 04 How I work [extrapolated]

Hairline cells with two columns (`.st-cells-c.st-cells-c--band > ul.st-cells.st-cells--2`). The container has `border-top: 1px var(--st-line)`; cells `padding: 20px 32px 24px 0`, h3 18 px, text `margin-top: 8px`, max 600. Two columns at container ≥ 640 px; the first row never has a top rule. There are no numbers, because the list is unordered, as in Precision.

### 3.6 05 Principles [extrapolated]

Split rows with the wide modifier (`ol.st-rows.st-rows--wide`): the statement (number + h3) takes 5fr and the explanation 7fr at ≥ 1080, and 1fr | 1fr at 768–1079. The statements are full sentences; 5fr (≈ 550 px at 1440) keeps most of them on one line in EN and on two in KA.

### 3.7 06 Experience [extrapolated]

Split rows: `.st-row-meta > .st-period` ("2018 — PRESENT" in EN via `--st-caps`; the KA "2018 — დღემდე" is never uppercased) | `.st-row-body` = h3 role → `p.st-org` (6 px; linked org in ink with a 1 px `--st-ctl` underline that turns accent-ink on hover) → `p.st-row-text` (12 px). The period has `padding-top: 5px` in split mode, to sit on the h3 cap line.

### 3.8 07 Languages [extrapolated]

The band repeats the hero's lower row: at ≥ 1080 `.st-lang-band` is a 12-column grid with the head in columns 1–5 and `ul.st-langs` (two tiles) in columns 6–12, the same place as the facts. Tiles reuse `.st-fact`: the language name as the value (34 px) and the proficiency as the label ("NATIVE", "PROFESSIONAL WORKING"; KA not uppercased). Below 1080 the tiles follow the head (`margin-top: 24px`), in 2 columns at ≥ 480 and as rows below. An odd last tile spans both columns.

### 3.9 08 Let's talk [extrapolated]

```html
<div class="st-contact-body">
  <a class="st-bigmail" href="{primary.href}"><span>{primary.value}</span>{UI_ICONS.arrow}</a>
  <div class="st-cta-row"><a class="st-btn" href="{primary.href}">{contact.cta}</a>{buttons: .st-btn--ghost}</div>
</div>
```

- When `sections.contact.primary` is `null` (the owner deleted the email item in the admin), the whole `.st-contact-body` is omitted, as in Ledger (master plan Appendix B, E5).
- Body: margin 28/34, `padding-top: 26px`, 1 px `--st-line` top rule.
- The big mail is `inline-flex; flex-wrap: wrap`, `clamp(22px, 6.4vw, 60px)`, 700/110 %. It measures 713 px at 60 px (11.9 em), so about 262 px at 22 px: it fits at 320 (288 px column), and the arrow wraps first if it ever has to. Hover: text and arrow in accent-ink, arrow nudged `translate: .08em -.08em`.
- CTA row `margin-top: 28px`, gap 10, wraps. Primary: `--accent` fill + `--on-accent`, 1 px `--accent` border. Ghost: transparent, ink text, 1 px `--st-ctl` border; hover `--st-hover` fill + `--st-muted-2` border. The ghost buttons come from `sections.contact.buttons`: links show their label ("GitHub"), phone and email show the value (admin plan R9).

### 3.10 Footer [extrapolated]

`<footer class="st-foot">` outside `<main>` (its own contentinfo landmark): `border-top: 1px var(--st-line); padding-block: 20px 28px`. Inner `.st-wrap.st-foot-in`: `flex; wrap; space-between; gap: 8px 24px`, label face 11 px, .04em, muted-2. Text: `© {updated year} {name} · {ui.updated} <time>{updated}</time> · {ui.builtWith}`. Links: the shared `langSwitchLink(c, alt, c.altTitle)` and `#main` "{ui.top} ↑" (U+2191 is inside the font subsets). The date is `ctx.updated`, which stays pinned to 2026-06-07 until the owner changes it.

### 3.11 Deviations from the export, and copy that must not come back

| Export | Studio | Why |
|---|---|---|
| "KA · EN · RU", "product locales shipped" | live fact "KA · EN" / "interface languages" | no Russian anywhere |
| nav item "Education" | "Languages" (`navLabel`) | education section removed |
| "I build e-commerce systems that stay fast, talk to banks and ERPs…", "Open to remote and contract work", "years building for the web", "primary languages/platforms", "Georgian bank gateways", "The part of the stack most people avoid.", "Grouped by where they sit… not a self-rating." | whatever `site.json` holds | the content model is authoritative; the template has no copy of its own |
| "◐" glyph, "↗" glyph | shared SVG icons | glyphs are missing from the self-hosted subsets |
| "Profile" shown white in the nav | hover state (`--st-ink`); only `aria-current` is accent | the export shows a static hover |
| 1 px row gap in the skills grid | none | invisible at 1× and double-draws rules |
| inset box-shadow level squares | borders + `print-color-adjust: exact` | shadows and backgrounds drop in print |
| "+ 4 more groups" footnote | all seven groups | artefact of the export |

Rejected ideas that Studio does not use: no cream or beige surface (the light page is cool `#f5f7f9`, chroma 0.003 at hue 258); no terracotta; no serif display; no dotted textures; no pill chips (chips and squares are square-cornered, buttons 3 px); no rounded card grids; no photo; no project list; no Russian; no education/certificates.

---

## 4. Theme

### 4.1 Token sets

Dark (default) and light are the two columns of §1.2; accents are the palette's dark and light sets (§1.3). The `color-scheme` property follows the theme (`dark` / `light`), so scrollbars and form controls match.

### 4.2 How Studio is dark-first

| Visitor state | `<html data-theme>` | Result |
|---|---|---|
| first visit, JS on, no `?theme` | init script: stored? no → `settings.defaultTheme` if light/dark → else layout default `dark` | dark |
| JS off | static `data-theme="dark"` from the shared shell (§0.3 a) | dark (neutrals and palette agree) |
| toggled to light (stored `theme=light`) | `light` | light, remembered across layouts |
| `?theme=light` (admin preview toggles) | `light` | light |
| owner sets Default theme = Light | `light` for new visitors | light-first Studio |
| print | any | light neutrals, white paper, palette light values (the dark blocks are screen-only) |

- `main.js` needs no change: `current()` reads `html[data-theme]`, which Studio always has, so the first toggle click always flips visibly.
- `<meta name="theme-color">` comes from `layout.themeColor` (`#f5f7f9` / `#101419`) with the shared `prefers-color-scheme` media pair; `<meta name="color-scheme" content="light dark">` stays as the shared head has it.

---

## 5. Georgian adaptation

### 5.1 Rules

1. **Stack**: Noto Sans Georgian first. It is self-hosted as a static-width file (`font-stretch: 100%` in `@font-face`), so `font-stretch` has no effect on Georgian glyphs, and browsers never synthesise width.
2. **Width axis off for mixed-script headings**: `--st-w-h2`, `--st-w-h3` and `--st-w-role` are `100%` in KA, so Latin fragments ("WordPress და WooCommerce", "Full-Stack ვებდეველოპერი") stay as wide as the Georgian around them. Latin-only elements keep their widths (fact values 108 %, big mail 110 %).
3. **Casing**: the only uppercase mechanism in Studio is `text-transform: var(--st-caps)` on label classes (eyebrow, tile label, chip, fact label, level word, period). `--st-caps` is `none` in KA. Nothing else sets `text-transform`, and no `font-variant-caps` is used. Latin labels that should look uppercase in KA ("EN", "PDF", "KA · EN") are uppercase in the content itself. The check script fails on any Georgian text node whose computed `text-transform` is not `none`.
4. **Labels leave the mono face**: `--st-label` is the sans stack in KA, with tracking cut to .02–.04em. Mono-spaced tracking of .16em on Mkhedruli reads as broken words.
5. **Leading**: Mkhedruli has ascenders and descenders on most letters, so every multi-line Georgian style gets more leading (below).

### 5.2 Georgian overrides (`styles.css` §7 and tokens)

| Element | EN | KA |
|---|---|---|
| h1 | `clamp(44px,14vw,92px)` / .92 / −.03em | `clamp(40px,12vw,78px)` / 1.04 / −.02em (78 = 92 × 0.85, the ratio Precision uses) |
| h2 | 30 / 36 / 42, lh 1.02 | 25 / 30 / 34, lh 1.15, −.01em |
| h3 (groups, rows) | 19 / 21, lh 1.2–1.25 | 17.5 / 19, lh 1.35, tracking 0 |
| role | 20 / 1.25 / 106 % | 18 / 1.35 / 100 % |
| tagline | 17 / 1.45 | 16 / 1.6 |
| lead | 15 / 1.5 | 14.5 / 1.6 |
| prose | 16–17 / 1.65 | 15.5–16 / 1.75 |
| row and cell text | 15 / 1.6 | 14.5 / 1.7 |
| work-style h3 | 18 / 1.3 | 16.5 / 1.4 |
| skill name | 15 / 1.3 | 14.5 / 1.45 |
| eyebrow | mono 11, .16em, upper | sans 12, .04em, none |
| tile label / chip / fact label / level / period / legend / footer | mono 10–11.5, .04–.14em, upper | sans 11–12.5, .01–.03em, none |
| skills: 3 columns from | container 840 px | container 960 px |
| header nav bar | tier 1280 | tier 1600 |
| name fit em | 0.62 | 0.72 |

### 5.3 Longest-string risks (measured in the rendering fonts)

| String | Where | Measured width | Outcome |
|---|---|--:|---|
| "რას ვასრულებ თავიდან ბოლომდე" | nav bar, 13 px | 235 px | part of the 822 px KA bar → tier 1600; menu below |
| same | h2 at 34 / 30 / 25 px | 642 / — / 472 px | 1 line at ≥ 1440 (792 px title column) and at 768–1079 (stacked head, full width); 2 balanced lines at 1080–1439 and at 390; 3 lines at 320 (measured) |
| same | menu row at 320 px, 14 px | wraps to 2 lines inside the 288 px panel | accepted |
| "საფუძვლიანი" | level word, 11.5 px | 82 px | never truncated (cells are ≥ 200 px wide) |
| "საფუძვლიანი — რეგულარული" | legend, 12 px | 191 px | legend wraps as a flex row |
| "ძირითადი — ყოველდღიური, პროდაქშენში" | legend, 12 px | 269 px | fits at 320 (288 px) |
| "დაკოპირდა" | copied chip, 11 px | 68 px (+14 padding/border) | < 400 px rules keep the row at 250 of 252 px at 320 |
| "ელექტრონული კომერციის ბრენდები" | organisation line in the row body, 15 px | 293 px | one line from 390 px up, two lines at 320 (measured) |
| "ინფრასტრუქტურა" | longest single word in a KA heading, 19 px/600 | 185 px | fits the 300 px group column |
| "PDF-ად შენახვა" | print button, 12.5 px | 101 px | long label from 480 px; the KA control group measures 322 px at 1080–1440 and 221 px (short label) at 390; no header overflow at any width |
| "გიორგი სამსიანი" | brand, 13 px | 116 px | shown from 600 px |
| "ალექსანდრე" (stress) | h1 | 6.94 em | fit rule: 70.3 px at 1080, 35 px at 320, one line each |
| "ათწლეულები" (stress, 10 letters) | fact value | 7.27 em | fit rule: one line at every width |

---

## 6. Print (A4)

`@media print` at the end of `styles.css`. Rules are prefixed `html[lang]` so they outrank both base rules and the `html[lang="ka"]` screen overrides.

| Aspect | Rule |
|---|---|
| Page | `@page { size: A4; margin: 12mm 13mm 14mm }` |
| Colours | `:root` overrides: `--st-bg`/`--st-tile` `#fff`, ink `#111`, ink-2 `#222`, muted `#444`, muted-2 `#555`, lines `#c4c4c4` / `#d0d0d0` / `#e0e0e0`, `--st-sq-off #888`. Accents: the palette's light values arrive on their own (its dark rules are screen-only), so squares, indices and the eyebrow print in `--accent-ink` (lime: leaf green `#406c07`). |
| Hidden | header, skip link, copy chips, CTA row, footer links, menu, link arrows |
| Hero | the same 7/5 · 5/7 bento; tiles become white boxes with a 0.75 pt `--st-line` border, `break-inside: avoid`; h1 30 pt (KA 26 pt); role 12 pt; tagline 10 pt; facts 2 × 2 at 14 pt with 7 pt labels |
| Bands | `margin-top: 5mm; padding-top: 4mm; border-top: 0.75pt`; head grid `1fr | 88mm`, h2 15 pt (KA 13.5), lead 8.5 pt, `break-after: avoid` |
| Profile | 2 columns, 7 mm gap, 9 pt / 1.5 (KA 8.5 / 1.6) |
| Skills | groups `38mm | 1fr`, group lead hidden, cells always 3 columns at 8.5 pt (KA 8), level words 6.5 pt, squares 6 px, `break-inside: avoid` per cell |
| Rows | `38mm | 1fr` (principles 5fr | 7fr), 8.5 pt / 1.45 (KA 8 / 1.55), `break-inside: avoid` per row |
| Languages | head in columns 1–5, tiles in 6–12 |
| Contact | big mail 15 pt, no buttons |
| Footer | 7 pt, top rule |
| Reveal | forced visible (`opacity: 1 !important`) |
| Result | live content: EN 4 pages, KA 5 pages, in dark or light screen theme. See `layout-studio/ref-print-en.pdf` and `ref-print-ka.pdf` |

---

## 7. Fonts

### 7.1 Archivo (new)

- Google Fonts css2 query (the export's own request): `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap`. Studio needs only `Archivo:wdth,wght@100..112,400..700`, but Google serves the **same full variable file** (width 62–125 %, weight 100–900) for any request that includes `wdth`.
- Subset: **latin only**. The content uses U+0000–00FF, `—` U+2014, `’` U+2019, `“` U+201C, `„` U+201E; the template adds `©` and `↑` U+2191. All are inside the latin `unicode-range`. `→` U+2192 (in "Figma → production") is outside it and falls back to the system font, exactly as it does in Precision today. latin-ext and vietnamese are not needed.
- File: `https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2` → `src/fonts/archivo-latin-wdth-wght.woff2`, **90,096 bytes** (`curl -o` works directly on this URL). If Google has moved to a newer version, take the `/* latin */` block of the css2 response, requested with a desktop-browser User-Agent (without one, the css2 endpoint lists TTF, not WOFF2).
- `@font-face` (`layout-studio/fonts.css`): `font-weight: 400 700; font-stretch: 100% 112%`, `font-display: swap`, the latin `unicode-range`, `src: url('fonts/archivo-latin-wdth-wght.woff2')` (relative, admin plan R7). The declared ranges clamp requests: weights outside 400–700 and widths outside 100–112 % cannot be selected by accident.
- **Optional trim** (on the Mac, never on the server): `python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli`, then `fonttools varLib.instancer Archivo[wdth,wght].ttf wdth=100:112 wght=400:700 -o a.ttf` (from the Google Fonts TTF) and `pyftsubset a.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD" --layout-features='*' --flavor=woff2 --output-file=archivo-latin-wdth100-112-wght400-700.woff2`. The estimate is 45–60 KB (unmeasured; the tools are not installed here). Ship it under the **new file name**, never under the old one (Cloudflare and admin plan R3), and update `layout.mjs` and `fonts.css`. It would also cover `→`.

### 7.2 Existing files

| File | Bytes | Studio use |
|---|--:|---|
| `jetbrains-mono-latin-normal-400-500.woff2` | 31,340 | EN labels, all indices and numbers |
| `noto-sans-georgian-georgian-normal-400-700.woff2` | 41,456 | all Georgian; also loads on EN pages (the "ქართ" switch and the "ქართულად" footer link) |
| `chivo-latin-normal-400-700.woff2` | 33,252 | not used by Studio (not in `layout.fonts`, never downloaded) |

Preload (`layout.preload`): EN = Archivo, JetBrains Mono; KA = Noto Sans Georgian, Archivo, JetBrains Mono. Font payload per page: 162.9 KB (Archivo 90.1 + JetBrains Mono 31.3 + Noto Sans Georgian 41.5); with the optional trim about 115–130 KB. CSS: 32.7 KB for the layout, 34.0 KB with fonts and the palette block, before gzip.

---

## 8. Acceptance criteria

### 8.1 Script (`layout-studio/check-studio.mjs`)

```
node docs/plans/layout-studio/verify-build.mjs docs/plans/site.example.json /tmp/studio-dist lime --serve 4189   # before the refactor
LAYOUT=studio PALETTE=lime node build.mjs && node serve.mjs                                                      # after it (port 4173; not `npm run dev`, which rebuilds without the overrides)
PLAYWRIGHT_MJS=/path/to/playwright/index.mjs node docs/plans/layout-studio/check-studio.mjs [http://localhost:4189]
```

All of these must print `ok`; the script exits 1 otherwise:

| # | Check | Pass condition |
|---|---|---|
| 1 | Horizontal overflow | every 10 px from 320 to 1600, EN/KA × dark/light: `scrollWidth ≤ clientWidth` and no visible element's right edge beyond the viewport |
| 2 | Contrast | every visible text node, EN/KA × dark/light × 1440/390: ≥ 4.5 : 1 (≥ 3 : 1 for ≥ 24 px, or ≥ 18.66 px at 700) against its nearest opaque background |
| 3 | No uppercase Georgian | every text node containing U+10A0–10FF / U+1C90–1CBF / U+2D00–2D2F has computed `text-transform: none` and `font-variant-caps: normal` |
| 4 | Header and bento geometry at 1920, 1600, 1440, 1280, 1279, 1080, 768, 390, 320 | header 64 px and `sticky`; nav bar shown iff width ≥ `data-nav` tier; menu shown otherwise; a shown bar has no wrapped link and no overflow; hero spans 7/5/5/7 (≥ 1080), 12/6/6/12 (768–1079), all 12 (< 768), within 2 px; each name word on exactly one line |
| 5 | Raw HTML | `<html … data-layout="studio" … data-theme="dark">` in the static file |
| 6 | Runtime | default theme `dark` with empty storage; Archivo (and Noto) `loaded`; one click on the toggle gives `data-theme="light"`, `aria-pressed="false"`; with reduced motion, bands have opacity 1; a keyboard-focused link has a `solid 2px` outline |
| 7 | Print | `page.pdf` A4 of the live content: EN ≤ 5 pages, KA ≤ 6 (reference 4 / 5) |

Extra runs that must also pass:

- **All palettes**: repeat for `cobalt emerald amber crimson graphite` (build with each id). Result at hand-off: all pass.
- **Stress**: build `site.stress.json`, then `node docs/plans/data-model-ref/scripts/check-layout-stress.mjs --dist <dir> --topnav .st-nav` → `PASS: 24 viewport checks`. `check-studio.mjs` checks 1–6 also pass on it (check 7 does not apply: the fixture is 3× the live content).
- **Palette gates**: `node src/palettes.mjs` → PASS with the §0.3 (c) values; the three grep gates of palettes.md §10 print nothing for `src/layouts/studio/styles.css`.

### 8.2 Screenshot review (compare with `layout-studio/ref-*.png`)

| Width, theme | Must show |
|---|---|
| 1440, EN, dark (`ref-en-1440-dark-top.png`) | the export's header (lime GS mark, 8 nav items with "Profile" underlined in lime, EN/ქართ, toggle, lime "Save as PDF"); the 4-tile bento: name 92 px in two lines, role tile with subrole, tagline and the location line at the bottom, contact tile with COPY chips and arrows, 2 × 2 facts at 34 px |
| 1440, EN, dark, skills (`ref-en-1440-dark-skills.png`) | title left / lead right; legend with three squares; groups as 300 px head + 3 hairline columns; Core / Strong / Working squares |
| 1440, EN, dark, principles and experience (`ref-en-1440-dark-lists.png`, `-end.png`) | 5fr / 7fr statements; experience period as a mono label on the left |
| 1440, KA, light (`ref-ka-1440-light-top.png`) | no nav bar (menu button instead); Georgian name at 78 px; no uppercase Georgian anywhere; lime button with dark text; leaf-green eyebrow and chips; grey tiles on the cool near-white page |
| 1080, EN (`ref-en-1080-dark-top.png`) | the same bento, narrower; menu button; name still 92 px |
| 768, KA (`ref-ka-768-dark-top.png`) | full-width name tile; role and contact side by side; facts 2 × 2 across |
| 390, EN (`ref-en-390-dark-top.png`) | one column; facts as rows (value left, label right); header = mark + EN/ქართ + toggle + "PDF" + menu |
| 320, KA (`ref-ka-320-dark-hero.png`) | no horizontal scroll; "WP · Next" on one line; after clicking "ასლი", the "დაკოპირდა" state does not wrap the email |
| Print preview, EN and KA | light paper at any screen theme; bento as outlined boxes; level squares visible; 4 / 5 pages |

### 8.3 Manual accessibility pass

- Tab order: skip link → brand → nav (when shown) → language link → theme → Save as PDF → menu → hero contact links and copy buttons → section content. Every stop has a visible 2 px `--focus` ring (inset inside the language switch).
- Screen reader: landmarks banner, navigation "Sections" (the bar, or the menu's list once the menu is open; the other is `display: none` or inside a closed `<details>`), navigation "Language", main, contentinfo. Contact `dt` labels are announced ("Email", "Phone"). Level squares are hidden, the words are read. Row numbers and section indices are `aria-hidden`.
- 200 % zoom at 1280: no horizontal scroll (equivalent to the 640 px check).
