# Colour palettes — build plan

Owner request: "option to choose color palette", independent of the layout choice.
Gate result for the values in this plan: **PASS 432/432** (six palettes × four neutral sets × two themes, nine gated checks each; details in §13).

| File | What it is |
|---|---|
| `docs/plans/palettes.json` | The data: token list, thresholds, per-layout neutrals, worst-case envelope, six palettes. |
| `docs/plans/check-palettes.mjs` | Zero-dependency library + CLI: oklch → sRGB maths, WCAG 2.1 contrast gate, CSS generator, proof sheet, tuning probe. |
| `docs/plans/palettes.md` | This document. |

---

## 1. Decisions at a glance

1. **A palette owns exactly six tokens** (§2). Layouts own every neutral (`--bg`, `--ink`, `--ink-2`, `--muted*`, `--line`, `--rule`, `--border`, `--mark-*`, `--hover-bg`, surfaces) and the status colour `--green`. No layout stylesheet declares any of the six; no palette declares a neutral.
2. **Runtime: generate at build time, ship only the active palette** as custom properties on `:root`, using the same three-state theme pattern the layouts already use. `<html data-palette="…">` is stamped for the admin preview and debugging. The admin preview loads a separate bundle holding all six palettes scoped by `[data-palette]` (§5).
3. **Dark values apply on `screen` only**, so print always resolves to the light, paper-safe values (§6).
4. **The checker is a build gate.** `build.mjs` refuses to build when any check fails.
5. **Cobalt is the live accent, value for value.** Precision + cobalt must render exactly as the live site does today.

---

## 2. Token contract

| Token | Role | Paired with | Gate |
|---|---|---|---|
| `--accent` | Fill colour only: primary buttons (`.btn`, `.ctl-primary`), `::selection` background, the "copied" chip, Studio's GS mark, large decorative fills. | `--on-accent` on top of it | `on/accent` ≥ 4.5, `on/hover` ≥ 4.5; `fill/bg` reported for information |
| `--on-accent` | Text and icons drawn on an `--accent` fill. | `--accent` | same as above |
| `--accent-ink` | Accent-coloured text and links on the page background or a layout surface (section index "02", item index, eyebrow, copy-chip label, big-mail hover, arrow icons). **Also every thin or small non-text marker**: link-hover underline, active nav bar and underline, level squares (Core/Strong), location square. | bg, surface, `--accent-soft` | `ink/bg`, `ink/surf`, `ink/soft` ≥ 4.5 |
| `--accent-soft` | Translucent tint (alpha ≤ 0.3) for small areas only: chip background, hovered row, selected option. | text on it is `--accent-ink` or the layout ink | `ink/soft`, `text/soft` ≥ 4.5 |
| `--accent-line` | Decorative accent hairline or border (Studio's copy-chip border, accent rules). Opaque. Never the only indicator of a state. | bg | `line/bg` ≥ 1.8 (sanity check) |
| `--focus` | The `:focus-visible` ring: `outline: 2px solid var(--focus); outline-offset: 3px`. | bg, surface | `focus/bg`, `focus/surf` ≥ 3.0 (WCAG 1.4.11) |

### Usage rules (enforced by the grep gates in §10)

1. `color: var(--accent)` is forbidden. Text always uses `--accent-ink`.
2. Thin (≤ 3 px) and small graphical markers use `--accent-ink`, never `--accent`. The reason: lime and amber are light colours. Their fills measure only 1.2–1.7 : 1 against light pages (`fill/bg` column), so a 2 px lime bar on white would disappear. `--accent-ink` is ≥ 4.5 : 1 on every surface by construction.
3. `--accent` appears only as the `background` / `border-color` of a fill component whose content is `--on-accent`. Lime and amber fills in light themes rely on their dark text for identification, which WCAG 1.4.11 allows for components with a visible text label.
4. Focus rings use `--focus`, never `--accent`.
5. `--accent-soft` never covers more than a chip, a row or an option, and never a section or page background. This keeps the rejected cream/beige paper look out; a warm amber tint over white is cream by definition.
6. `--green` (availability dot) is layout-owned status colour, not a palette token. A layout that wants its location marker in the accent (Studio) uses `--accent-ink`.
7. No palette colour is hard-coded in layout CSS, templates or scripts. Everything goes through the six properties.

Why six and not three: in cobalt, `--accent-ink` = `--focus` = `--accent`. They diverge only for light hues (lime, amber) in light themes and for crimson in dark themes. Keeping them separate lets all three layouts follow one rule set with zero palette-specific CSS.

---

## 3. The six palettes

| id | Character | Model |
|---|---|---|
| `cobalt` | The live accent, unchanged. | Light theme: dark fill + white text. Dark theme: light fill + dark text. |
| `lime` | Studio's signature `oklch(86% 0.2 124)`. Text and markers in light themes use leaf green `#406c07`. | Light fill + dark text in both themes. |
| `emerald` | Deep emerald `#0c6f4d` / mint `#62d8a6`. | Same as cobalt. |
| `amber` | Canonical amber `#ffbf00` = `oklch(84% 0.17 84)`. Text and markers in light themes use deep amber `#805708`. Hue 76–84, well away from the rejected terracotta (hue 33–38). | Light fill + dark text in both themes. |
| `crimson` | Hue 20; crimson `#dc143c` is `oklch(57% 0.22 20)`. Chroma ≥ 0.17, unlike terracotta's ~0.14. | Dark fill + white text in **both** themes. A light red fill reads as salmon, so dark-theme fills stay mid-crimson `#cc243d`. Text on dark pages uses rose `#f56b7a`. |
| `graphite` | Steel slate `#2e3948` / light steel `#d9dee6`. Near-monochrome. Links stay identifiable by their underline (WCAG 1.4.1), never by colour alone. | Same as cobalt. |

The generated value table (oklch as authored, plus the 8-bit sRGB hex browsers render) is in §13.

**Gamut policy.** Every designed colour sits inside sRGB at 8-bit precision. The six gamut warnings the checker prints all belong to cobalt's live accent: `oklch(47% 0.18 255)` and `oklch(80% 0.15 255)` both lie outside sRGB. They clip to `#0056bc` / `#78c0ff` on sRGB screens and show more saturated on P3 screens. They are kept exactly as instructed. The checker scores any out-of-gamut colour at the worse of its clipped and its true colorimetric luminance, so the ratios hold on both kinds of screen.

---

## 4. Neutrals the palettes are checked against

Taken from `palettes.json → layouts` and `envelope`. A "surface" is the most contrast-reducing non-page background that can carry accent text in that layout.

| Layout | Theme | bg | surface | ink | Source |
|---|---|---|---|---|---|
| precision | light | `oklch(98.5% 0.003 258)` | `oklch(94.5% 0.005 258)` (`--hover-bg`) | `oklch(20% 0.012 258)` | live `src/styles.css` |
| precision | dark | `oklch(18.5% 0.012 258)` | `oklch(24% 0.012 258)` | `oklch(96% 0.004 250)` | live |
| studio | light | `oklch(95.5% 0.005 258)` | `oklch(99.5% 0.002 258)` (tiles raised to near-white) | `oklch(19% 0.012 258)` | **proposed** (the export shows dark only) |
| studio | dark | `oklch(19% 0.012 258)` | `oklch(23.5% 0.012 258)` (bento tile) | `oklch(96% 0.004 250)` | design export 1b |
| ledger | light | `#fff` | `oklch(96.5% 0.003 250)` (row hover) | `oklch(17% 0.008 250)` | export 1c; surface **proposed** |
| ledger | dark | `oklch(15.5% 0.006 250)` | `oklch(20.5% 0.008 250)` | `oklch(95% 0.004 250)` | **proposed** |
| envelope | light | `oklch(93% 0.012 258)` | same | `oklch(20% 0.012 258)` | worst case (below) |
| envelope | dark | `oklch(27% 0.012 258)` | same | `oklch(95% 0.004 250)` | worst case |

**Envelope: the contract for the layout plans.** In light themes, any surface that carries accent text or a focus ring keeps L ≥ 93%. In dark themes it keeps L ≤ 27%. Chroma stays ≤ 0.012 on the cool 250–258 hue. Every palette passes against these extremes, so the layout plans can move their neutrals anywhere inside the envelope without re-tuning palettes. When the Studio-light and Ledger-dark plans settle their final values, update `layouts` in `palettes.json` (one line each) and re-run the gate.

---

## 5. Runtime: how a palette reaches the page

**Recommendation: generate the custom properties at build time and ship only the active palette.**

- Only the admin chooses a palette; visitors never do. Shipping all six (5.5 KB) to every visitor buys nothing. The active block is about 850 bytes.
- The tokens are in the stylesheet before first paint, so there is no JavaScript and no flash.
- **Cache safety comes for free.** Switching palette changes the stylesheet bytes, `build.mjs` already names it `styles.<md5>.css`, and Cloudflare can never serve a stale palette.
- Every theme state and print work in pure CSS (verified, §6).
- Layout CSS stays palette-agnostic because it only references `var(--accent-ink)` and the rest. One layout stylesheet works with every palette.

Rejected alternatives:
- (a) Ship all palettes and switch with `[data-palette]` on the public site: six times the bytes, and the attribute does nothing for visitors.
- (b) Substitute literal colours into layout CSS at build time: layout CSS becomes a template and palette logic spreads across three layout files.

### Builder steps

1. Move `docs/plans/palettes.json` → `src/palettes.json` and `docs/plans/check-palettes.mjs` → `src/palettes.mjs`. No code edit is needed, because the default data path is `join(HERE, 'palettes.json')`. Keep the `_doc` / `_note` / `_source` fields; nothing reads them.
2. Settings: the admin stores `{ "layout": "<id>", "palette": "<id>" }`. The field names are fixed here; the storage location belongs to the admin plan. The default palette is `palettes.json → default` (`"cobalt"`).
3. `build.mjs` (the palette block goes **after** the layout CSS; specificity already wins, and the order is extra insurance):
   ```js
   import { loadPalettes, checkPalettes, paletteCss, allPalettesCss, parseColor } from './src/palettes.mjs';
   const palettes = loadPalettes();                       // throws on malformed data
   const gate = checkPalettes(palettes);
   if (gate.failed) throw new Error(`palette gate: ${gate.failed} failing checks; run: node src/palettes.mjs`);
   const pal = palettes.palettes.find((p) => p.id === settings.palette)
            ?? palettes.palettes.find((p) => p.id === palettes.default);
   if (pal.id !== settings.palette) console.warn(`unknown palette "${settings.palette}", using ${pal.id}`);
   const css = fontsCss + '\n' + layoutCss + '\n' + paletteCss(pal, ':root', palettes.tokens);
   // cssName = `styles.${hash(css)}.css`, as today
   ```
4. `template.mjs`: `<html lang="…" dir="…" data-layout="${layout}" data-palette="${pal.id}">`.
5. Admin preview bundle: `allPalettesCss(palettes)` is written to a hashed file served only to the admin preview (the path belongs to the admin plan). It must never be linked from public pages.
6. Validation: the admin API accepts `palette` only when it equals one of the ids in `palettes.json` (they already match `/^[a-z][a-z0-9-]{1,23}$/`). Anything else gets HTTP 400. No raw colour value ever travels from an admin form into CSS.

---

## 6. How dark mode and print compose with a palette

Generated shape (`node src/palettes.mjs --css lime`):

```css
/* palette: lime */
:root { --accent: oklch(86% 0.2 124); --on-accent: …; --accent-ink: oklch(48% 0.13 132); … }   /* light */
@media screen and (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { …dark values… }
}
@media screen {
  :root[data-theme="dark"] { …dark values… }
}
```

| OS scheme | `data-theme` | Medium | Resolves to |
|---|---|---|---|
| light | none | screen | light |
| dark | none | screen | dark |
| dark | `light` (toggle) | screen | light |
| light | `dark` (toggle) | screen | dark |
| any | any | print | light |

I verified this with Playwright, reading the computed value of all six tokens against the live stylesheet with its accent declarations removed. All 24 cases passed: the table above for public cobalt, public lime, the admin bundle alone, and the admin bundle stacked on a public cobalt block.

- **Specificity.** Public light `:root` = (0,1,0); public dark = (0,2,0). Admin light `:root[data-palette="x"]` = (0,2,0); admin dark = (0,3,0). The admin bundle therefore overrides the public block in every state, whatever the load order.
- **Theme toggle.** No change. `main.js` keeps stamping `data-theme`, and the palette follows.
- **`<meta name="theme-color">`** is layout-owned (neutral page colours). Palettes do not touch it.
- **Print.** The dark rules are screen-only, so print always gets the palette's light values. Delete `--accent: #1f4fbf; --on-accent: #fff;` from the print block (`src/styles.css:323`). Cobalt's printed accent becomes `#0056bc`, the same value the screen shows.

> **Existing bug (layout-owned, verified on the live stylesheet).** The print block `@media print { :root { --bg:#fff; --ink:#111; … } }` has specificity (0,1,0). It loses to the dark selectors `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`, both (0,2,0). Printing with the OS in dark mode, or with the toggle on dark, keeps `--ink: oklch(96% 0.004 250)`: near-white text on white paper. The fix belongs to whichever plan rewrites the layout CSS. Wrap each layout's two dark blocks in `@media screen`, exactly as the palette blocks are wrapped. Print then sees light neutrals plus the print overrides.

---

## 7. Palette-dependent outputs outside CSS

| Output | Today | With palettes |
|---|---|---|
| `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | `src/brand/icon.html`: fill `oklch(.47 .18 255)`, glyph `#fff` | Fill = the palette's light `--accent`, glyph = light `--on-accent` (lime and amber get a dark GS). `make.mjs` loops over `palettes.json` on the Mac and writes `src/brand/icons/<id>/icon-{32,180,192,512}.png` (24 committed PNGs; the glyph never depends on content). The build copies the active set with hashed names (`favicon-32.<md5>.png` and so on) and the template links those names. Fixed names would stay cobalt behind Cloudflare. |
| `og-en.png`, `og-ka.png` | `og.html`: `.accent` bar and `.url` text use `oklch(.80 .15 255)` | Bar = dark `--accent`, URL text = dark `--accent-ink`. The OG images also contain content the admin can edit, so their regeneration pipeline belongs to the admin/build plan; the palette contributes exactly these two colours. They need hashed names for the same cache reason. |
| `site.webmanifest` `theme_color` | `'#1a4fd6'` | `parseColor(pal.light['--accent']).hex` (cobalt gives `#0056bc`). `background_color` stays layout-owned. The manifest itself gets a hashed name, because it references the hashed icons. |
| `<meta name="theme-color">` | neutral | unchanged |

---

## 8. Admin picker: swatch preview spec

A native radio group laid out as a list. There are no cards and no pill chips; the only rounding is 2 px on the swatch frame.

```html
<fieldset class="pal-picker" aria-describedby="pal-help">
  <legend>Colour palette</legend>
  <p class="pal-help" id="pal-help">Accent colour for links, buttons and markers, in light and dark themes.</p>
  <div class="pal-list">
    <label class="pal-opt">
      <input type="radio" name="palette" value="cobalt" checked>
      <span class="sw" aria-hidden="true">
        <span class="sw-h" style="--sw-bg:…layout light bg…;--sw-fill:…light --accent…;--sw-on:…light --on-accent…;--sw-ink:…light --accent-ink…">
          <i class="sw-fill">Aa</i><b class="sw-ink">Aa</b></span>
        <span class="sw-h" style="--sw-bg:…layout dark bg…;--sw-fill:…dark --accent…;--sw-on:…dark --on-accent…;--sw-ink:…dark --accent-ink…">
          <i class="sw-fill">Aa</i><b class="sw-ink">Aa</b></span>
      </span>
      <span class="pal-name">Cobalt</span>
      <span class="pal-meta">#0056bc · min 5.86 : 1</span>
    </label>
    <!-- one label per palette, in palettes.json order -->
  </div>
</fieldset>
```

```css
.pal-picker { border: 0; margin: 0; padding: 0; max-width: 560px; }
.pal-picker legend { padding: 0; font: 600 13px/1.3 var(--adm-sans); color: var(--adm-ink); }
.pal-help { margin: 6px 0 12px; font: 400 12.5px/1.5 var(--adm-sans); color: var(--adm-muted); }
.pal-list { border-block: 1px solid var(--adm-line); }
.pal-opt { display: grid; grid-template-columns: 16px 128px minmax(0, 1fr) auto; gap: 14px; align-items: center;
           min-height: 64px; padding: 8px 12px; border-top: 1px solid var(--adm-line); cursor: pointer; }
.pal-opt:first-child { border-top: 0; }
.pal-opt:hover { background: var(--adm-hover); }
.pal-opt:has(input:checked) { background: var(--adm-hover); box-shadow: inset 3px 0 0 var(--adm-ink); }
.pal-opt:has(input:focus-visible) { outline: 2px solid var(--adm-focus); outline-offset: -2px; }
.pal-opt input { width: 16px; height: 16px; margin: 0; accent-color: var(--adm-ink); }
.pal-opt input:focus-visible { outline: none; }              /* the ring is drawn on the row */
.sw { display: grid; grid-template-columns: 1fr 1fr; width: 128px; height: 48px;
      border: 1px solid var(--adm-line); border-radius: 2px; overflow: hidden; }
.sw-h { display: grid; grid-template-rows: 16px 1fr; align-items: end; gap: 4px; padding: 7px 8px; background: var(--sw-bg); }
.sw-fill { display: grid; place-items: center; width: 32px; height: 16px; background: var(--sw-fill);
           color: var(--sw-on); font: normal 600 9.5px/1 system-ui, sans-serif; }
.sw-ink { font: 600 15px/1 system-ui, sans-serif; color: var(--sw-ink); }
.pal-name { font: 500 14px/1.3 var(--adm-sans); color: var(--adm-ink); }
.pal-meta { font: 400 11.5px/1.3 var(--adm-mono); color: var(--adm-muted); white-space: nowrap; }
@media (max-width: 480px) {
  .pal-opt { grid-template-columns: 16px 104px minmax(0, 1fr); row-gap: 2px; }
  .pal-opt input, .sw { grid-row: span 2; }
  .sw { width: 104px; }
  .pal-meta { grid-column: 3; }
}
```

`--adm-*` are the admin plan's neutrals. Until they exist, fall back to Precision light: `--adm-ink` = `oklch(20% 0.012 258)`, `--adm-muted` = `oklch(44% 0.012 258)`, `--adm-line` = `oklch(91.5% 0.006 258)`, `--adm-hover` = `oklch(94.5% 0.005 258)`, `--adm-focus` = `oklch(47% 0.18 255)`.

Behaviour:

- **Swatch halves use the neutrals of the layout currently selected** in the layout picker (`layouts[layout].light.bg` / `.dark.bg` from `palettes.json`), so the owner sees the real combination. When the layout choice changes, only the two `--sw-bg` values per row are rewritten.
- **`pal-meta`** shows the light `--accent-ink` hex, then `min X : 1`. X is the lowest `ink/bg` or `ink/surf` ratio for the selected layout across both themes. Both come from `GET /registry` (`paletteHex[id].light['--accent-ink']`, `paletteMin[id][layout]`), which the server computes with `parseColor(v).hex` and `checkPalettes()`; the admin SPA never imports this module.
- **Live preview.** On `change`, post `{ type: 'sm-preview', palette, theme }` to the preview frame (superseded by admin-ops §6.7: the frame is sandboxed with an opaque origin, so `contentDocument` is unreachable; the bridge sets `data-palette` with no request, and the parent re-posts on every frame load).
- **Persistence.** The choice is persisted only by the admin's Save flow. The server validates the id (§5.6), stores it and triggers the rebuild.
- **Keyboard.** Native radio behaviour. Tab lands on the checked row, arrow keys move the selection (and preview it), and the focus ring shows on the row. The accessible name is the label text ("Cobalt #0056bc · min 5.86 : 1"); the swatch is `aria-hidden`.
- **No transitions** in the picker, so reduced motion is respected trivially.

---

## 9. The gate: `check-palettes.mjs`

```
node src/palettes.mjs                 # run every check, print the table, exit 1 on any failure
node src/palettes.mjs --md            # markdown tables (section 13 is this output)
node src/palettes.mjs --css <id>      # public CSS for one palette
node src/palettes.mjs --css-all       # admin-preview bundle (all palettes)
node src/palettes.mjs --html > x.html # proof sheet: every palette x layout x theme with real UI samples
node src/palettes.mjs --probe "oklch(48% 0.13 132)" "#ffbf00"   # hex, gamut, max chroma, contrast vs white/envelope
add --data <path> to use another palettes.json
```

- **Pipeline.** oklch → OKLab → LMS → linear sRGB (Björn Ottosson's matrices). Then clip to gamut, apply the sRGB transfer, quantise to 8 bits, compute WCAG 2.1 relative luminance (0.03928 threshold) and the ratio `(L1 + 0.05) / (L2 + 0.05)`.
- **Alpha.** `--accent-soft` is composited over both the layout bg and the surface in gamma-encoded sRGB, the way browsers blend. The worse result counts.
- **Hover.** `on/hover` applies the live `filter: brightness(1.08)` to both the fill and its text, multiplying both gamma-encoded and linear values (browsers differ), and keeps the worse. If a layout plan changes the fill-hover treatment, change `hoverBrightness` in `palettes.json`, or add a check.
- **Out of gamut.** A colour outside sRGB is reported as a warning, and its contrast is the worse of its clipped and its true colorimetric luminance.
- **Thresholds** (`palettes.json → thresholds`): text 4.5 (WCAG 1.4.3 AA), ui 3.0 (WCAG 1.4.11), line 1.8 (decorative sanity). `fill/bg` is reported but not gated.
- **Data validation** (throws before any check): palette ids are unique and match `^[a-z][a-z0-9-]{1,23}$`. `label.en` and `label.ka` are present. Every theme has exactly the six tokens, with no extras. Only `--accent-soft` may carry alpha, and it must be in (0, 0.3]. `default` names an existing palette. Layout colours are opaque.
- **Exit codes:** 0 = pass, 1 = at least one gated check failed, 2 = unknown palette id passed to `--css`.

---

## 10. Build acceptance criteria

1. `node src/palettes.mjs` prints `PASS: 432/432 …` and exits 0. `build.mjs` throws when the gate fails.
2. With `layout=precision, palette=cobalt`: the computed `--accent`, `--on-accent`, `--accent-ink` and `--focus` equal the live values in all four screen states. A screenshot diff of `/` and `/ka/` at 1440×900 and 390×844, in light and dark, against the current live build shows zero changed pixels. The only intended change is that print uses `#0056bc` instead of `#1f4fbf`.
3. Grep gates over every layout stylesheet (all must print nothing):
   - `grep -nE -- '--(accent|on-accent|accent-ink|accent-soft|accent-line|focus)[[:space:]]*:' <layout css>` (layouts never declare palette tokens)
   - `grep -nE '(^|[^-])color:[[:space:]]*var\(--accent\)' <layout css>` (text never uses the fill token)
   - `grep -nE 'outline[^;]*var\(--accent' <layout css>` (focus uses `--focus`)
4. Switching the palette changes the `styles.<hash>.css` filename, and the new HTML references only the new file.
5. `<html>` carries `data-palette` equal to the saved setting, or `cobalt` after the unknown-id fallback, which also logs a warning.
6. Print preview with the OS in dark mode shows the light palette values (and, once the §6 layout fix is in, light neutrals).
7. The admin API answers 400 to `palette: "x"` and `palette: "cobalt;}"`.
8. `dist/` holds the active palette's four icons under hashed names, and the HTML and the manifest reference them.
9. `node src/palettes.mjs --html` renders all 36 palette × layout × theme cells with no invisible text or markers.

### Edit list for the live Precision stylesheet (`src/styles.css`)

| Line | Current | Change |
|---|---|---|
| 13–14, 39–40, 57–58 | `--accent` / `--on-accent` declarations | delete (the palette block supplies them) |
| 82 | `:focus-visible { outline: 2px solid var(--accent) … }` | `var(--focus)` |
| 83 | `::selection { background: var(--accent); color: var(--on-accent) }` | unchanged |
| 99 | `.ul:hover { box-shadow: inset 0 -1px 0 var(--accent) }` | `var(--accent-ink)` |
| 110 | `.topnav a[aria-current] { … inset 0 -2px 0 var(--accent) }` | `var(--accent-ink)` |
| 120 | `.ctl-primary { background: var(--accent); color: var(--on-accent) … }` | unchanged |
| 150 | `.contact dd a:hover { box-shadow: inset 0 -1px 0 var(--accent) }` | `var(--accent-ink)` |
| 151 | `.copy { … color: var(--accent) … }` | `color: var(--accent-ink)` |
| 153 | `.copy:hover { border-color: var(--accent) }` | `var(--accent-ink)` |
| 154 | `.copy[data-state="copied"] { background/border: var(--accent); color: var(--on-accent) }` | unchanged |
| 159 | `.railnav a[aria-current] { border-inline-start-color: var(--accent) … }` | `var(--accent-ink)` |
| 160 | `.railnav a[aria-current] .idx { color: var(--accent) }` | `var(--accent-ink)` |
| 179 | `.sec-idx { … color: var(--accent) }` | `var(--accent-ink)` |
| 221 | `.item-idx { … color: var(--accent) }` | `var(--accent-ink)` |
| 229 | `.item .org a:hover { box-shadow: inset 0 -1px 0 var(--accent) }` | `var(--accent-ink)` |
| 239 | `.big-mail svg { color: var(--accent) }` | `var(--accent-ink)` |
| 240 | `.big-mail:hover { color: var(--accent) }` | `var(--accent-ink)` |
| 243 | `.btn { background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent) }` | unchanged |
| 323 | print: `--accent: #1f4fbf; --on-accent: #fff;` | delete these two declarations |
| `build.mjs:40` | `theme_color: '#1a4fd6'` | light `--accent` hex (§7) |

Cobalt has `--accent-ink` = `--focus` = `--accent` in both themes, so every row above is a visual no-op for cobalt.

The same mapping applies when the Studio and Ledger stylesheets are written from the design export:
- Studio: eyebrow, active nav, section index, copy label, location square and level squares → `--accent-ink`; the GS mark and "Save as PDF" button → `--accent` + `--on-accent`; the copy-chip border `oklch(.45 .09 124)` → `--accent-line` (it is exactly lime's dark `--accent-line`).
- Ledger: "COPY" and the section index `oklch(.45 .16 250)` → `--accent-ink`. Its level squares are ink-coloured in the export and stay layout-owned.

---

## 11. How to add a 7th palette

1. **Pick a hue H and a model.**
   - Model A (dark fill, white text in light themes): blues, greens, reds, violets, i.e. hues whose sRGB chroma peaks at mid lightness.
   - Model B (light fill, dark text): yellows, limes, ambers, cyans, i.e. hues whose chroma peaks at high lightness.
2. **Avoid the rejected looks.** No hue 30–55 below chroma 0.16 (terracotta). No warm hue (60–100) whose `--accent-soft` alpha goes above 0.25 (it turns into cream paper).
3. **Starting values** (then tune with `--probe`, which prints the hex, gamut status, the maximum in-gamut chroma at that L/H, and contrast against white and both envelope extremes):

   | Token | Light, model A | Light, model B | Dark (both models) |
   |---|---|---|---|
   | `--accent` | L 0.47–0.52, max in-gamut C | L 0.82–0.88 | L 0.78–0.84 (model A) or keep the light fill (model B) |
   | `--on-accent` | `#fff` | `oklch(18.5% 0.012 258)` | `oklch(18.5% 0.012 258)` |
   | `--accent-ink` | = `--accent` | L 0.47–0.50, same hue ±8° | = `--accent` |
   | `--accent-soft` | `--accent` at alpha 0.06–0.09 | `--accent` at alpha 0.20–0.24 | `--accent` at alpha 0.10–0.14 |
   | `--accent-line` | L 0.70–0.74, C ≈ 0.10 | L 0.72, C ≈ 0.15 | L 0.45–0.50, C 0.08–0.12 |
   | `--focus` | = `--accent-ink` | = `--accent-ink` | = `--accent-ink` |

   Keep every value inside sRGB (`--probe` says `in sRGB`). A dark-theme fill in model A that looks washed out (reds) may stay mid-lightness with `#fff` text, as crimson does.
4. **Add the object** to the `palettes` array in `src/palettes.json`: a new `id` (never rename or reuse an existing one, because saved settings reference ids), `label.en`, `label.ka`, and `light` and `dark` with all six tokens.
5. **Run `node src/palettes.mjs`.** It must print `PASS` and exit 0. Then run `--html` and look at the proof sheet: the fill must read as the colour's name, and the text must not look muddy.
6. **Re-run `--md`** and replace §13 in this document.
7. **Render icons:** `node src/brand/make.mjs` (the palette loop from §7) writes `src/brand/icons/<id>/`. Commit them.
8. **Done.** The admin picker lists the new palette automatically, because it reads `palettes.json`. No CSS or template change is needed.

Removing a palette: delete the object and its icon folder. A saved setting that still names the removed id falls back to `default` at build time with a warning (§5 step 3), and the admin shows the default as selected.

---

## 12. Notes for the other plans

- **Layout plans:** never declare the six tokens; follow the §2 usage rules; keep accent-bearing surfaces inside the §4 envelope; wrap dark neutral blocks in `@media screen` (the §6 bug); report the final Studio-light and Ledger-dark neutrals so `layouts` in `palettes.json` can be updated.
- **Admin plan:** store `palette` as an id; validate against `palettes.json`; load the `--css-all` bundle in the preview only; regenerate the OG images with the palette's dark `--accent` / `--accent-ink` (§7).
- **Georgian:** palettes carry no typography. Palette names appear only in the admin (`label.ka`), never on the public site.

---

## 13. Final values and pass table (generated by `node docs/plans/check-palettes.mjs --md`)

Columns:
- `ink/bg`, `ink/surf`: `--accent-ink` on the page background and on the layout surface.
- `on/accent`, `on/hover`: `--on-accent` on the fill, and the same pair under `brightness(1.08)`.
- `focus/bg`, `focus/surf`: the focus ring.
- `line/bg`: the accent hairline.
- `ink/soft`, `text/soft`: accent text and layout ink on `--accent-soft`, composited over both bg and surface (worse result).
- `fill/bg` (italic): the fill's edge against the page, information only.

### Token values (sRGB hex is the 8-bit value browsers render)

| palette | theme | `--accent` | `--on-accent` | `--accent-ink` | `--accent-soft` | `--accent-line` | `--focus` |
|---|---|---|---|---|---|---|---|
| cobalt | light | `oklch(47% 0.18 255)`<br>#0056bc | `#fff`<br>#ffffff | `oklch(47% 0.18 255)`<br>#0056bc | `oklch(47% 0.15 255 / 0.09)`<br>#0859ac @0.09 | `oklch(72% 0.1 255)`<br>#79a7e2 | `oklch(47% 0.18 255)`<br>#0056bc |
| cobalt | dark | `oklch(80% 0.15 255)`<br>#78c0ff | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(80% 0.15 255)`<br>#78c0ff | `oklch(80% 0.1 255 / 0.14)`<br>#92c1fd @0.14 | `oklch(48% 0.12 255)`<br>#285e9f | `oklch(80% 0.15 255)`<br>#78c0ff |
| lime | light | `oklch(86% 0.2 124)`<br>#b6e630 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(48% 0.13 132)`<br>#406c07 | `oklch(86% 0.2 124 / 0.24)`<br>#b6e630 @0.24 | `oklch(72% 0.17 128)`<br>#85b72e | `oklch(48% 0.13 132)`<br>#406c07 |
| lime | dark | `oklch(86% 0.2 124)`<br>#b6e630 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(86% 0.2 124)`<br>#b6e630 | `oklch(86% 0.2 124 / 0.12)`<br>#b6e630 @0.12 | `oklch(45% 0.09 124)`<br>#4b5d1f | `oklch(86% 0.2 124)`<br>#b6e630 |
| emerald | light | `oklch(48% 0.1 163)`<br>#0c6f4d | `#fff`<br>#ffffff | `oklch(48% 0.1 163)`<br>#0c6f4d | `oklch(48% 0.1 163 / 0.06)`<br>#0c6f4d @0.06 | `oklch(72% 0.09 163)`<br>#6db794 | `oklch(48% 0.1 163)`<br>#0c6f4d |
| emerald | dark | `oklch(80% 0.13 163)`<br>#62d8a6 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(80% 0.13 163)`<br>#62d8a6 | `oklch(80% 0.13 163 / 0.14)`<br>#62d8a6 @0.14 | `oklch(48% 0.08 163)`<br>#2b6c50 | `oklch(80% 0.13 163)`<br>#62d8a6 |
| amber | light | `oklch(84% 0.17 84)`<br>#febf12 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(49% 0.1 76)`<br>#805708 | `oklch(84% 0.17 84 / 0.22)`<br>#febf12 @0.22 | `oklch(72% 0.14 80)`<br>#d29922 | `oklch(49% 0.1 76)`<br>#805708 |
| amber | dark | `oklch(84% 0.17 84)`<br>#febf12 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(84% 0.17 84)`<br>#febf12 | `oklch(84% 0.17 84 / 0.12)`<br>#febf12 @0.12 | `oklch(48% 0.09 80)`<br>#785715 | `oklch(84% 0.17 84)`<br>#febf12 |
| crimson | light | `oklch(51% 0.19 20)`<br>#ba1b35 | `#fff`<br>#ffffff | `oklch(51% 0.19 20)`<br>#ba1b35 | `oklch(51% 0.19 20 / 0.07)`<br>#ba1b35 @0.07 | `oklch(72% 0.11 20)`<br>#e18888 | `oklch(51% 0.19 20)`<br>#ba1b35 |
| crimson | dark | `oklch(55% 0.2 20)`<br>#cc243d | `#fff`<br>#ffffff | `oklch(70% 0.17 16)`<br>#f56b7a | `oklch(70% 0.17 16 / 0.1)`<br>#f56b7a @0.1 | `oklch(48% 0.12 18)`<br>#953c43 | `oklch(70% 0.17 16)`<br>#f56b7a |
| graphite | light | `oklch(34% 0.03 258)`<br>#2e3948 | `#fff`<br>#ffffff | `oklch(34% 0.03 258)`<br>#2e3948 | `oklch(34% 0.03 258 / 0.07)`<br>#2e3948 @0.07 | `oklch(66% 0.02 258)`<br>#8b939f | `oklch(34% 0.03 258)`<br>#2e3948 |
| graphite | dark | `oklch(90% 0.012 258)`<br>#d9dee6 | `oklch(18.5% 0.012 258)`<br>#0f1318 | `oklch(90% 0.012 258)`<br>#d9dee6 | `oklch(90% 0.012 258 / 0.09)`<br>#d9dee6 @0.09 | `oklch(50% 0.015 258)`<br>#5e646c | `oklch(90% 0.012 258)`<br>#d9dee6 |

### Contrast results (ratio : 1; thresholds text 4.5, ui 3, line 1.8; fill/bg is information only)

| palette | layout | theme | `ink/bg` | `ink/surf` | `on/accent` | `on/hover` | `focus/bg` | `focus/surf` | `line/bg` | `ink/soft` | `text/soft` | `fill/bg` |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cobalt | precision | light | 6.58 | 5.86 | 6.87 | 6.13 | 6.58 | 5.86 | 2.38 | 5.15 | 13.58 | _6.58_ |
| cobalt | studio | light | 6.02 | 6.76 | 6.87 | 6.13 | 6.02 | 6.76 | 2.18 | 5.25 | 14.13 | _6.02_ |
| cobalt | ledger | light | 6.87 | 6.23 | 6.87 | 6.13 | 6.87 | 6.23 | 2.49 | 5.44 | 15.11 | _6.87_ |
| cobalt | envelope | light | 5.58 | 5.58 | 6.87 | 6.13 | 5.58 | 5.58 | 2.02 | 4.90 | 12.92 | _5.58_ |
| cobalt | precision | dark | 9.57 | 8.41 | 9.57 | 10.10 | 9.57 | 8.41 | 2.83 | 6.20 | 10.76 | _9.57_ |
| cobalt | studio | dark | 9.49 | 8.57 | 9.57 | 10.10 | 9.49 | 8.57 | 2.81 | 6.36 | 11.04 | _9.49_ |
| cobalt | ledger | dark | 10.05 | 9.23 | 9.57 | 10.10 | 10.05 | 9.23 | 2.98 | 6.95 | 11.71 | _10.05_ |
| cobalt | envelope | dark | 7.71 | 7.71 | 9.57 | 10.10 | 7.71 | 7.71 | 2.28 | 5.66 | 9.55 | _7.71_ |
| lime | precision | light | 5.97 | 5.32 | 12.74 | 13.57 | 5.97 | 5.32 | 2.28 | 4.98 | 14.47 | _1.40_ |
| lime | studio | light | 5.46 | 6.14 | 12.74 | 13.57 | 5.46 | 6.14 | 2.09 | 5.12 | 15.16 | _1.28_ |
| lime | ledger | light | 6.24 | 5.65 | 12.74 | 13.57 | 6.24 | 5.65 | 2.38 | 5.26 | 16.08 | _1.46_ |
| lime | envelope | light | 5.07 | 5.07 | 12.74 | 13.57 | 5.07 | 5.07 | 1.94 | 4.83 | 14.01 | _1.19_ |
| lime | precision | dark | 12.74 | 11.19 | 12.74 | 13.57 | 12.74 | 11.19 | 2.56 | 8.39 | 10.94 | _12.74_ |
| lime | studio | dark | 12.63 | 11.41 | 12.74 | 13.57 | 12.63 | 11.41 | 2.54 | 8.59 | 11.20 | _12.63_ |
| lime | ledger | dark | 13.38 | 12.28 | 12.74 | 13.57 | 13.38 | 12.28 | 2.69 | 9.39 | 11.90 | _13.38_ |
| lime | envelope | dark | 10.26 | 10.26 | 12.74 | 13.57 | 10.26 | 10.26 | 2.06 | 7.65 | 9.69 | _10.26_ |
| emerald | precision | light | 5.92 | 5.27 | 6.18 | 5.49 | 5.92 | 5.27 | 2.27 | 4.84 | 14.20 | _5.92_ |
| emerald | studio | light | 5.42 | 6.09 | 6.18 | 5.49 | 5.42 | 6.09 | 2.08 | 4.97 | 14.87 | _5.42_ |
| emerald | ledger | light | 6.18 | 5.60 | 6.18 | 5.49 | 6.18 | 5.60 | 2.37 | 5.15 | 15.90 | _6.18_ |
| emerald | envelope | light | 5.02 | 5.02 | 6.18 | 5.49 | 5.02 | 5.02 | 1.93 | 4.64 | 13.61 | _5.02_ |
| emerald | precision | dark | 10.56 | 9.27 | 10.56 | 11.19 | 10.56 | 9.27 | 2.99 | 6.82 | 10.74 | _10.56_ |
| emerald | studio | dark | 10.47 | 9.45 | 10.56 | 11.19 | 10.47 | 9.45 | 2.96 | 7.01 | 11.02 | _10.47_ |
| emerald | ledger | dark | 11.09 | 10.18 | 10.56 | 11.19 | 11.09 | 10.18 | 3.14 | 7.65 | 11.70 | _11.09_ |
| emerald | envelope | dark | 8.51 | 8.51 | 10.56 | 11.19 | 8.51 | 8.51 | 2.41 | 6.23 | 9.53 | _8.51_ |
| amber | precision | light | 6.12 | 5.45 | 11.25 | 11.74 | 6.12 | 5.45 | 2.42 | 5.00 | 14.16 | _1.59_ |
| amber | studio | light | 5.60 | 6.29 | 11.25 | 11.74 | 5.60 | 6.29 | 2.21 | 5.10 | 14.75 | _1.45_ |
| amber | ledger | light | 6.39 | 5.79 | 11.25 | 11.74 | 6.39 | 5.79 | 2.52 | 5.24 | 15.64 | _1.66_ |
| amber | envelope | light | 5.20 | 5.20 | 11.25 | 11.74 | 5.20 | 5.20 | 2.05 | 4.80 | 13.61 | _1.35_ |
| amber | precision | dark | 11.25 | 9.88 | 11.25 | 11.74 | 11.25 | 9.88 | 2.82 | 7.63 | 11.27 | _11.25_ |
| amber | studio | dark | 11.16 | 10.08 | 11.25 | 11.74 | 11.16 | 10.08 | 2.79 | 7.83 | 11.56 | _11.16_ |
| amber | ledger | dark | 11.82 | 10.85 | 11.25 | 11.74 | 11.82 | 10.85 | 2.96 | 8.53 | 12.24 | _11.82_ |
| amber | envelope | dark | 9.07 | 9.07 | 11.25 | 11.74 | 9.07 | 9.07 | 2.27 | 6.98 | 10.01 | _9.07_ |
| crimson | precision | light | 6.10 | 5.43 | 6.37 | 5.65 | 6.10 | 5.43 | 2.49 | 4.85 | 13.79 | _6.10_ |
| crimson | studio | light | 5.58 | 6.27 | 6.37 | 5.65 | 5.58 | 6.27 | 2.28 | 4.98 | 14.44 | _5.58_ |
| crimson | ledger | light | 6.37 | 5.77 | 6.37 | 5.65 | 6.37 | 5.77 | 2.60 | 5.16 | 15.45 | _6.37_ |
| crimson | envelope | light | 5.18 | 5.18 | 6.37 | 5.65 | 5.18 | 5.18 | 2.11 | 4.64 | 13.20 | _5.18_ |
| crimson | precision | dark | 6.45 | 5.67 | 5.40 | 4.76 | 6.45 | 5.67 | 2.67 | 4.91 | 12.66 | _3.45_ |
| crimson | studio | dark | 6.40 | 5.78 | 5.40 | 4.76 | 6.40 | 5.78 | 2.65 | 5.03 | 12.94 | _3.42_ |
| crimson | ledger | dark | 6.78 | 6.22 | 5.40 | 4.76 | 6.78 | 6.22 | 2.80 | 5.48 | 13.72 | _3.62_ |
| crimson | envelope | dark | 5.20 | 5.20 | 5.40 | 4.76 | 5.20 | 5.20 | 2.15 | 4.52 | 11.30 | _2.78_ |
| graphite | precision | light | 11.20 | 9.97 | 11.70 | 10.85 | 11.20 | 9.97 | 2.97 | 8.85 | 13.71 | _11.20_ |
| graphite | studio | light | 10.25 | 11.52 | 11.70 | 10.85 | 10.25 | 11.52 | 2.72 | 9.10 | 14.38 | _10.25_ |
| graphite | ledger | light | 11.70 | 10.60 | 11.70 | 10.85 | 11.70 | 10.60 | 3.10 | 9.42 | 15.36 | _11.70_ |
| graphite | envelope | light | 9.51 | 9.51 | 11.70 | 10.85 | 9.51 | 9.51 | 2.52 | 8.48 | 13.13 | _9.51_ |
| graphite | precision | dark | 13.79 | 12.12 | 13.79 | 14.75 | 13.79 | 12.12 | 3.12 | 9.69 | 11.66 | _13.79_ |
| graphite | studio | dark | 13.68 | 12.36 | 13.79 | 14.75 | 13.68 | 12.36 | 3.09 | 9.93 | 11.96 | _13.68_ |
| graphite | ledger | dark | 14.49 | 13.30 | 13.79 | 14.75 | 14.49 | 13.30 | 3.28 | 10.81 | 12.65 | _14.49_ |
| graphite | envelope | dark | 11.12 | 11.12 | 13.79 | 14.75 | 11.12 | 11.12 | 2.51 | 8.86 | 10.36 | _11.12_ |

PASS: 432/432 gated checks passed (48 palette x layout x theme rows), 0 failed, 6 gamut warnings.
