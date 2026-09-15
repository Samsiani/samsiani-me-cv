#!/usr/bin/env node
// Palette data loader, CSS generator and contrast gate for samsiani.me. Zero dependencies.
// Data: src/palettes.json. build.mjs and buildSite() refuse to build when the gate fails.
//
//   node src/palettes.mjs             run every assertion, print the table, exit 1 on any FAIL
//   node src/palettes.mjs --md        print the markdown tables used in palettes.md
//   node src/palettes.mjs --css ID    print the public-site CSS for one palette (scope :root)
//   node src/palettes.mjs --css-all   print the admin-preview CSS (every palette, scoped by [data-palette])
//   node src/palettes.mjs --html      print a visual proof sheet (every palette x layout x theme)
//   add  --data <path>                             to read another palettes.json (default: the one next to this file)
//
// Colour pipeline: oklch -> OKLab -> LMS -> linear sRGB -> gamut clip -> sRGB (gamma) -> 8-bit
// -> WCAG 2.1 relative luminance -> contrast ratio (L1 + 0.05) / (L2 + 0.05).
// Tokens with alpha (only --accent-soft) are composited over the layout background in
// gamma-encoded sRGB, the way browsers blend. For a colour outside sRGB the ratio is the
// worse of "clipped sRGB" and "true colorimetric Y" (what a wide-gamut screen shows).
//
// The file is a library too: build.mjs can `import { loadPalettes, paletteCss, checkPalettes } from ...`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- colour maths
const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const OKLCH_RE = new RegExp(
  String.raw`^oklch\(\s*(${NUM})(%?)\s+(${NUM})\s+(${NUM})(?:deg)?\s*(?:\/\s*(${NUM})(%?)\s*)?\)$`,
  'i'
);
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); // linear -> sRGB
const encodeSigned = (v) => Math.sign(v) * encode(Math.abs(v));
const decode = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); // WCAG 2.1 linearisation
const luminance = (rgb8) => {
  const [r, g, b] = rgb8.map((v) => decode(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hexOf = (rgb8) => '#' + rgb8.map((v) => v.toString(16).padStart(2, '0')).join('');

export function oklchToLinearSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function fromLinear(src, lin, alpha, lch = null) {
  // "In gamut" = clipping moves no 8-bit channel by half a step or more.
  const half = 0.5 / 255;
  const inGamut = lin.every((v) => {
    const e = encodeSigned(v);
    return e >= -half && e <= 1 + half;
  });
  const rgb8 = lin.map((v) => Math.round(encode(Math.min(1, Math.max(0, v))) * 255));
  const Ytrue = Math.max(0, 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
  return { src, alpha, lch, lin, inGamut, rgb8, hex: hexOf(rgb8), Y: luminance(rgb8), Ytrue };
}

export function parseColor(str) {
  const s = String(str).trim();
  let m = s.match(HEX_RE);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const rgb8 = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return { src: s, alpha: 1, lch: null, inGamut: true, rgb8, hex: hexOf(rgb8), Y: luminance(rgb8), Ytrue: luminance(rgb8) };
  }
  m = s.match(OKLCH_RE);
  if (m) {
    const L = m[2] === '%' ? +m[1] / 100 : +m[1];
    const C = +m[3];
    const H = +m[4];
    const A = m[5] === undefined ? 1 : m[6] === '%' ? +m[5] / 100 : +m[5];
    if (!(L >= 0 && L <= 1) || !(C >= 0) || !(A >= 0 && A <= 1)) throw new Error(`Out-of-range colour "${s}"`);
    return fromLinear(s, oklchToLinearSrgb(L, C, H), A, { L, C, H });
  }
  throw new Error(`Unsupported colour "${s}" (use #rgb, #rrggbb or oklch(L C H [/ A]))`);
}

/** Composite a (possibly translucent) colour over an opaque base, in gamma-encoded sRGB. */
export function over(top, base) {
  if (base.alpha !== 1) throw new Error(`Base colour must be opaque: ${base.src}`);
  const a = top.alpha;
  const rgb8 = top.rgb8.map((v, i) => Math.round(a * v + (1 - a) * base.rgb8[i]));
  const Y = luminance(rgb8);
  return { src: `${top.src} over ${base.src}`, alpha: 1, lch: null, inGamut: true, rgb8, hex: hexOf(rgb8), Y, Ytrue: Y };
}

/**
 * The live hover rule for fills is `filter: brightness(k)` (k = 1.08), which scales the whole element,
 * text included. Browsers differ on whether that multiply happens on gamma-encoded or linear values,
 * so both variants are returned and callers take the worse.
 */
export function brighten(c, k) {
  const mk = (rgb8) => ({ src: `${c.src} x brightness(${k})`, alpha: 1, lch: null, inGamut: true, rgb8, hex: hexOf(rgb8), Y: luminance(rgb8), Ytrue: luminance(rgb8) });
  return [
    mk(c.rgb8.map((v) => Math.min(255, Math.round(v * k)))),
    mk(c.rgb8.map((v) => Math.round(encode(Math.min(1, decode(v / 255) * k)) * 255))),
  ];
}

/** WCAG 2.1 contrast ratio; for out-of-gamut colours, the worse of clipped and colorimetric luminance. */
export function contrast(a, b) {
  const ys = (c) => (c.inGamut ? [c.Y] : [c.Y, c.Ytrue]);
  let worst = Infinity;
  for (const y1 of ys(a))
    for (const y2 of ys(b)) {
      const hi = Math.max(y1, y2), lo = Math.min(y1, y2);
      worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
    }
  return worst;
}

// ---------------------------------------------------------------- data
export function loadPalettes(path = join(HERE, 'palettes.json')) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  validate(data);
  return data;
}

function validate(data) {
  const errs = [];
  const tokens = data.tokens;
  const ids = new Set();
  if (!Array.isArray(tokens) || tokens.length !== 6) errs.push('"tokens" must list the 6 palette tokens');
  if (!Array.isArray(data.palettes) || data.palettes.length < 1) errs.push('"palettes" must be a non-empty array');
  for (const p of data.palettes || []) {
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(p.id || '')) errs.push(`bad palette id "${p.id}" (a-z, 0-9, -; 2-24 chars)`);
    if (ids.has(p.id)) errs.push(`duplicate palette id "${p.id}"`);
    ids.add(p.id);
    if (!p.label || !p.label.en || !p.label.ka) errs.push(`${p.id}: label.en and label.ka are required`);
    for (const theme of ['light', 'dark']) {
      const t = p[theme] || {};
      for (const k of tokens) if (!(k in t)) errs.push(`${p.id}.${theme}: missing ${k}`);
      for (const k of Object.keys(t)) if (!tokens.includes(k)) errs.push(`${p.id}.${theme}: unknown token ${k}`);
      for (const k of tokens) {
        if (!(k in t)) continue;
        let c;
        try { c = parseColor(t[k]); } catch (e) { errs.push(`${p.id}.${theme}.${k}: ${e.message}`); continue; }
        if (k === '--accent-soft') {
          if (!(c.alpha > 0 && c.alpha <= 0.3)) errs.push(`${p.id}.${theme}.--accent-soft: alpha must be in (0, 0.3]`);
        } else if (c.alpha !== 1) errs.push(`${p.id}.${theme}.${k}: must be opaque (only --accent-soft may carry alpha)`);
      }
    }
  }
  if (data.default && !ids.has(data.default)) errs.push(`default "${data.default}" is not a palette id`);
  for (const [id, l] of Object.entries(data.layouts || {}))
    for (const theme of ['light', 'dark'])
      for (const k of ['bg', 'surface', 'ink']) {
        try {
          if (parseColor(l[theme][k]).alpha !== 1) errs.push(`layouts.${id}.${theme}.${k} must be opaque`);
        } catch (e) { errs.push(`layouts.${id}.${theme}.${k}: ${e.message}`); }
      }
  if (errs.length) throw new Error('palettes.json is invalid:\n  ' + errs.join('\n  '));
}

// ---------------------------------------------------------------- checks
// kind: text = 4.5 (WCAG 1.4.3 AA), ui = 3.0 (WCAG 1.4.11), line = decorative sanity, info = not gated.
export const CHECKS = [
  { id: 'ink/bg', fg: '--accent-ink', on: 'bg', kind: 'text', what: 'accent text and links on the page background' },
  { id: 'ink/surf', fg: '--accent-ink', on: 'surface', kind: 'text', what: 'accent text on the layout surface (tile, hover row)' },
  { id: 'on/accent', fg: '--on-accent', on: '--accent', kind: 'text', what: 'text and icons on an accent fill (buttons, ::selection, copied chip)' },
  { id: 'on/hover', fg: '--on-accent', on: 'hover', kind: 'text', what: 'the same pair under the live hover rule filter: brightness(1.08)' },
  { id: 'focus/bg', fg: '--focus', on: 'bg', kind: 'ui', what: 'focus ring against the page background' },
  { id: 'focus/surf', fg: '--focus', on: 'surface', kind: 'ui', what: 'focus ring against the layout surface' },
  { id: 'line/bg', fg: '--accent-line', on: 'bg', kind: 'line', what: 'accent hairline against the background (decorative sanity)' },
  { id: 'ink/soft', fg: '--accent-ink', on: 'soft', kind: 'text', what: 'accent text on --accent-soft (composited over bg and surface, worst)' },
  { id: 'text/soft', fg: 'ink', on: 'soft', kind: 'text', what: "layout ink on --accent-soft (composited over bg and surface, worst)" },
  { id: 'fill/bg', fg: '--accent', on: 'bg', kind: 'info', what: 'accent fill edge against the background (information only)' },
];

export function checkPalettes(data) {
  const th = data.thresholds;
  const layouts = { ...data.layouts, ...(data.envelope ? { envelope: data.envelope } : {}) };
  const rows = [];
  const warnings = [];
  for (const p of data.palettes)
    for (const theme of ['light', 'dark']) {
      const tok = Object.fromEntries(Object.entries(p[theme]).map(([k, v]) => [k, parseColor(v)]));
      for (const [k, c] of Object.entries(tok))
        if (!c.inGamut) warnings.push(`${p.id}.${theme}.${k} ${c.src} is outside sRGB; clipped to ${c.hex}`);
      for (const [lid, l] of Object.entries(layouts)) {
        const bg = parseColor(l[theme].bg);
        const surface = parseColor(l[theme].surface);
        const ink = parseColor(l[theme].ink);
        const env = { bg, surface, ink, ...tok };
        const results = {};
        for (const c of CHECKS) {
          const fg = env[c.fg];
          let ratio;
          if (c.on === 'soft')
            ratio = Math.min(contrast(fg, over(tok['--accent-soft'], bg)), contrast(fg, over(tok['--accent-soft'], surface)));
          else if (c.on === 'hover') {
            const k = data.hoverBrightness ?? 1.08;
            const [fe, fl] = brighten(fg, k), [be, bl] = brighten(tok['--accent'], k);
            ratio = Math.min(contrast(fe, be), contrast(fl, bl));
          } else ratio = contrast(fg, env[c.on]);
          const min = c.kind === 'info' ? null : th[c.kind];
          results[c.id] = { ratio, min, pass: min === null || ratio >= min };
        }
        rows.push({ palette: p.id, layout: lid, theme, results });
      }
    }
  const gated = rows.flatMap((r) => Object.values(r.results).filter((x) => x.min !== null));
  const failed = gated.filter((x) => !x.pass).length;
  return { rows, warnings, total: gated.length, failed };
}

// ---------------------------------------------------------------- CSS generation
/**
 * CSS for one palette. `scope` is ':root' on the public site (only the active palette ships)
 * or ':root[data-palette="id"]' for the admin preview bundle. Dark values apply on screen only,
 * so print always uses the light (paper-safe) values whatever the theme.
 */
export function paletteCss(p, scope = ':root', tokens = Object.keys(p.light)) {
  const block = (sel, vals, ind) =>
    `${ind}${sel} {\n${tokens.map((k) => `${ind}  ${k}: ${vals[k]};`).join('\n')}\n${ind}}`;
  return [
    `/* palette: ${p.id} */`,
    block(scope, p.light, ''),
    `@media screen and (prefers-color-scheme: dark) {\n${block(`${scope}:not([data-theme="light"])`, p.dark, '  ')}\n}`,
    `@media screen {\n${block(`${scope}[data-theme="dark"]`, p.dark, '  ')}\n}`,
  ].join('\n');
}

export const allPalettesCss = (data) =>
  data.palettes.map((p) => paletteCss(p, `:root[data-palette="${p.id}"]`, data.tokens)).join('\n');

// ---------------------------------------------------------------- reports
const f2 = (x) => x.toFixed(2);

function textTable(data, res) {
  const cols = CHECKS.map((c) => c.id);
  const head = ['palette', 'layout', 'theme', ...cols];
  const lines = res.rows.map((r) => [
    r.palette, r.layout, r.theme,
    ...cols.map((id) => {
      const x = r.results[id];
      return f2(x.ratio) + (x.min === null ? ' ' : x.pass ? ' ' : '!');
    }),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (l) => l.map((v, i) => (i < 3 ? v.padEnd(w[i]) : v.padStart(w[i]))).join('  ');
  return [fmt(head), fmt(w.map((n) => '-'.repeat(n))), ...lines.map(fmt)].join('\n');
}

function mdTables(data, res) {
  const out = [];
  out.push('### Token values (sRGB hex is the 8-bit value browsers render)\n');
  out.push('| palette | theme | ' + data.tokens.map((t) => '`' + t + '`').join(' | ') + ' |');
  out.push('|---|---|' + data.tokens.map(() => '---').join('|') + '|');
  for (const p of data.palettes)
    for (const theme of ['light', 'dark'])
      out.push(
        `| ${p.id} | ${theme} | ` +
          data.tokens
            .map((k) => {
              const c = parseColor(p[theme][k]);
              return `\`${p[theme][k]}\`<br>${c.hex}${c.alpha < 1 ? ` @${c.alpha}` : ''}`;
            })
            .join(' | ') +
          ' |'
      );
  out.push('');
  out.push('### Contrast results (ratio : 1; thresholds ' +
    `text ${data.thresholds.text}, ui ${data.thresholds.ui}, line ${data.thresholds.line}; fill/bg is information only)\n`);
  const cols = CHECKS.map((c) => c.id);
  out.push('| palette | layout | theme | ' + cols.map((c) => `\`${c}\``).join(' | ') + ' |');
  out.push('|---|---|---|' + cols.map(() => '--:').join('|') + '|');
  for (const r of res.rows)
    out.push(
      `| ${r.palette} | ${r.layout} | ${r.theme} | ` +
        cols.map((id) => {
          const x = r.results[id];
          return x.min === null ? `_${f2(x.ratio)}_` : x.pass ? f2(x.ratio) : `**${f2(x.ratio)} FAIL**`;
        }).join(' | ') +
        ' |'
    );
  out.push('');
  out.push(summary(res));
  return out.join('\n');
}

const summary = (res) =>
  `${res.failed === 0 ? 'PASS' : 'FAIL'}: ${res.total - res.failed}/${res.total} gated checks passed ` +
  `(${res.rows.length} palette x layout x theme rows), ${res.failed} failed, ${res.warnings.length} gamut warnings.`;

function proofSheet(data) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const layouts = data.layouts;
  const cell = (p, lid, theme) => {
    const l = layouts[lid][theme];
    const t = p[theme];
    const vars = [
      `--bg:${l.bg}`, `--surface:${l.surface}`, `--ink:${l.ink}`,
      ...data.tokens.map((k) => `${k}:${t[k]}`),
    ].join(';');
    return `<div class="cell" style="${esc(vars)}">
  <div class="cap">${lid} · ${theme}</div>
  <div class="row"><span class="idx">02</span><span class="t">Stack &amp; skills</span></div>
  <div class="row"><a href="#">contact@samsiani.com</a><span class="chip">copy</span></div>
  <div class="tile"><span class="eyebrow">Curriculum vitae</span><span class="lv"><i class="core"></i>Core <i class="strong"></i>Strong</span></div>
  <div class="row"><span class="btn">Save as PDF</span><span class="focus">focus</span><span class="soft">chip</span></div>
</div>`;
  };
  const sections = data.palettes
    .map(
      (p) => `<section><h2>${esc(p.label.en)} <small>${esc(p.id)}</small></h2><div class="grid">
${Object.keys(layouts).flatMap((lid) => ['light', 'dark'].map((th) => cell(p, lid, th))).join('\n')}
</div></section>`
    )
    .join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Palette proof sheet</title>
<style>
body{margin:0;padding:24px;background:#e9eaec;font:14px/1.4 system-ui,sans-serif;color:#111}
h2{font:600 18px/1.2 system-ui;margin:28px 0 10px}h2 small{font:400 12px ui-monospace,monospace;color:#555}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.cell{background:var(--bg);color:var(--ink);padding:14px;display:grid;gap:10px;border:1px solid rgb(0 0 0/.12)}
.cap{font:500 10px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.idx{font:500 11px/1 ui-monospace,monospace;color:var(--accent-ink)}.t{font-weight:600}
a{color:var(--ink);text-decoration:none;box-shadow:inset 0 -1px 0 var(--accent-ink)}
.chip{font:400 9.5px/1 ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink);border:1px solid var(--accent-line);padding:3px 5px}
.tile{background:var(--surface);padding:10px;display:grid;gap:6px}
.eyebrow{font:500 10px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}
.lv{font:400 10px/1 ui-monospace,monospace;display:flex;gap:6px;align-items:center}
.lv i{display:inline-block;width:8px;height:8px}.lv .core{background:var(--accent-ink)}
.lv .strong{background:linear-gradient(90deg,var(--accent-ink) 50%,transparent 50%);box-shadow:inset 0 0 0 1px var(--accent-ink)}
.btn{background:var(--accent);color:var(--on-accent);font:500 12px/1 system-ui;padding:9px 12px;border-radius:3px}
.focus{outline:2px solid var(--focus);outline-offset:3px;padding:2px 4px;font-size:12px}
.soft{background:var(--accent-soft);color:var(--accent-ink);padding:3px 6px;font-size:12px}
</style>
${sections}
</html>`;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dataIdx = args.indexOf('--data');
  const data = loadPalettes(dataIdx >= 0 ? resolve(args[dataIdx + 1]) : undefined);
  const res = checkPalettes(data);
  if (args.includes('--probe')) {
    // Tuning aid: node check-palettes.mjs --probe "oklch(48% 0.13 132)" "#ffbf00" ...
    const env = data.envelope;
    const refs = { white: parseColor('#fff'), 'envelope-light': parseColor(env.light.bg), 'envelope-dark': parseColor(env.dark.bg) };
    const maxC = (L, H) => {
      let lo = 0, hi = 0.5;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; fromLinear('', oklchToLinearSrgb(L, m, H), 1).inGamut ? (lo = m) : (hi = m); }
      return lo;
    };
    for (const s of args.slice(args.indexOf('--probe') + 1).filter((a) => !a.startsWith('--'))) {
      const c = parseColor(s);
      const vs = Object.entries(refs).map(([k, r]) => `${k} ${f2(contrast(c, r))}`).join('  ');
      const g = c.lch ? `sRGB max chroma at this L/H ${maxC(c.lch.L, c.lch.H).toFixed(3)}` : '';
      console.log(`${s.padEnd(28)} ${c.hex}  ${c.inGamut ? 'in sRGB ' : 'OUT of sRGB'}  ${g}\n${' '.repeat(29)}contrast vs ${vs}`);
    }
    process.exit(0);
  }
  if (args.includes('--css')) {
    const id = args[args.indexOf('--css') + 1];
    const p = data.palettes.find((x) => x.id === id);
    if (!p) { console.error(`unknown palette "${id}"`); process.exit(2); }
    console.log(paletteCss(p, ':root', data.tokens));
  } else if (args.includes('--css-all')) {
    console.log(allPalettesCss(data));
  } else if (args.includes('--html')) {
    console.log(proofSheet(data));
  } else if (args.includes('--md')) {
    console.log(mdTables(data, res));
  } else {
    console.log(textTable(data, res));
    for (const w of res.warnings) console.log('WARN ' + w);
    console.log('\n' + summary(res));
    for (const c of CHECKS) console.log(`  ${c.id.padEnd(10)} ${c.kind.padEnd(4)} ${c.what}`);
  }
  process.exit(res.failed ? 1 : 0);
}
