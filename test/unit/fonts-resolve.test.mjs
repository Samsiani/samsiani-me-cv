// Fonts F2 (docs/plans/fonts.md §5, §7.1): the resolver and its rendering integration. Without an override
// every byte is the byte it was before the feature (render-golden.test.mjs holds that line); with one, the
// chosen faces ship under hashed names, the generated CSS names them by role alias only, and the header fit
// is measured from the real files instead of the constants that were measured in the layouts' own fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSite } from '../../src/build-site.mjs';
import { renderSite } from '../../src/render.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { GEORGIAN_RANGE_CSS } from '../../src/typography/roles.mjs';
import { NO_FONTS, resolveFonts } from '../../src/typography/resolve.mjs';
import { coverageOf, metricsOf, parseFont, rangesOf } from '../../src/typography/sfnt.mjs';
import { renderArgs, seed, stress } from './_helpers.mjs';

const WEB = new URL('../../src/fonts/', import.meta.url);
const sha = (b) => createHash('sha256').update(b).digest('hex');

// A store record of the shape §3.2 describes, built straight from a committed face. F3's upload pipeline
// produces the same shape from an uploaded file; here it only has to be a truthful stand-in.
function record(basename, id, { family, subsets } = {}) {
  const bytes = readFileSync(new URL(`${basename}.woff2`, WEB));
  const font = parseFont(bytes);
  const cov = coverageOf(font);
  const axis = (tag) => font.fvar?.axes.find((a) => a.tag === tag);
  const wght = axis('wght'), wdth = axis('wdth');
  const face = (subset, unicodeRange) => ({
    kind: 'web', subset, style: 'normal', file: `${sha(bytes)}.woff2`, bytes: bytes.length, unicodeRange,
    weight: wght ? [wght.min, wght.max] : [font.weightClass, font.weightClass],
    ...(wdth ? { stretch: `${wdth.min}% ${wdth.max}%` } : {}),
  });
  const want = subsets || [...(cov.latin ? ['latin'] : []), ...(cov.georgian ? ['georgian'] : [])];
  return {
    id, source: 'upload', family: family ?? font.names.family, category: 'Sans Serif',
    coverage: { latin: cov.latin, georgian: cov.georgian }, metrics: metricsOf(font),
    variable: Boolean(wght), axes: wght ? { wght: [wght.min, wght.max] } : {},
    faces: want.map((s) => face(s, s === 'georgian' ? GEORGIAN_RANGE_CSS : rangesOf(font, { excludeGeorgian: true }).join(', '))),
    bytesOf: bytes,
  };
}

/** A loader over hand-built records; `readFace` hands back the bytes they were built from. */
const loaderOf = (...records) => ({
  get: (id) => records.find((r) => r.id === id) || null,
  readFace: (r) => r.bytesOf,
});

const ID = { sans: '1111111111111111', mono: '2222222222222222', geo: '3333333333333333' };
const PLEX = () => [record('ibm-plex-sans-latin-wght-100-700', ID.sans), record('ibm-plex-mono-latin-400', ID.mono)];
const NOTO = () => record('noto-sans-georgian-georgian-normal-400-700', ID.geo, { subsets: ['georgian'] });
const withFonts = (layout, fonts) => { const s = seed(); s.settings.layout = layout; s.settings.fonts = { [layout]: fonts }; return s; };
const precision = LAYOUTS.precision.meta;

test('no settings.fonts, no loader and all-null roles all resolve to the untouched build', async () => {
  const s = seed();
  assert.equal(await resolveFonts(s, precision, loaderOf(...PLEX())), NO_FONTS);
  assert.equal(await resolveFonts(withFonts('precision', { text: ID.sans }), precision, null), NO_FONTS);
  assert.equal(await resolveFonts(withFonts('precision', { text: null, label: null, georgian: null }), precision, loaderOf()), NO_FONTS);
});

test('an overridden text and label role: aliases, fenced ranges and both stacks', async () => {
  const out = await resolveFonts(withFonts('precision', { text: ID.sans, label: ID.mono, georgian: null }), precision, loaderOf(...PLEX()));
  assert.equal(out.overridden, true);
  assert.deepEqual(out.warnings, []);
  assert.match(out.css, /@font-face \{\n {2}font-family: "sm-text";/);
  assert.match(out.css, /@font-face \{\n {2}font-family: "sm-label";/);
  assert.doesNotMatch(out.css, /sm-georgian/); // the Georgian role kept its default face
  // the text and label faces may never be asked to draw Georgian (D6)
  for (const m of out.css.matchAll(/unicode-range: ([^;]+);/g)) {
    assert.doesNotMatch(m[1], /10[A-F0-9]{2}|1C9|2D0/, 'a non-Georgian face claims a Georgian range');
  }
  assert.match(out.css, /:root \{ --sans: "sm-text", "Noto Sans Georgian", system-ui, -apple-system, "Segoe UI", sans-serif; \}/);
  assert.match(out.css, /:root \{ --mono: "sm-label", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; \}/);
  assert.match(out.css, /html\[lang="ka"\] \{ --sans: "Noto Sans Georgian", "sm-text", system-ui, sans-serif; \}/);
  assert.match(out.css, /^\/\* fonts: precision · text=1111111111111111 label=2222222222222222 georgian=default \*\//);
});

test('the files map is content-addressed and the preload order puts Georgian first on /ka/', async () => {
  const out = await resolveFonts(withFonts('precision', { text: ID.sans, georgian: ID.geo }), precision, loaderOf(...PLEX(), NOTO()));
  const names = [...out.files.keys()];
  assert.equal(names.length, 2);
  for (const n of names) assert.match(n, /^fonts\/[a-z0-9-]+\.[0-9a-f]{8}\.woff2$/);
  const text = names.find((n) => n.startsWith('fonts/ibm-plex-sans'));
  const geo = names.find((n) => n.startsWith('fonts/noto-sans-georgian'));
  assert.ok(text && geo, names.join(', '));
  assert.equal(out.files.get(text).length > 1000, true);
  assert.deepEqual(out.preload.en, [text, 'fonts/jetbrains-mono-latin-normal-400-500.woff2']);
  assert.deepEqual(out.preload.ka, [geo, text, 'fonts/jetbrains-mono-latin-normal-400-500.woff2']);
  assert.ok(out.bytes.ka > out.bytes.en, 'the Georgian page carries one more face');
});

test('an id the store does not have falls back to the layout face with FONT_FALLBACK', async () => {
  const out = await resolveFonts(withFonts('precision', { text: 'ffffffffffffffff' }), precision, loaderOf(...PLEX()));
  assert.equal(out.overridden, false);
  assert.deepEqual(out.warnings.map((w) => [w.code, w.path]), [['FONT_FALLBACK', '$.settings.fonts.precision.text']]);
});

test('a font without Georgian letters is never rendered as the Georgian role', async () => {
  const out = await resolveFonts(withFonts('precision', { georgian: ID.sans }), precision, loaderOf(...PLEX()));
  assert.equal(out.overridden, false);
  assert.equal(out.warnings[0].code, 'FONT_FALLBACK');
  assert.match(out.warnings[0].msg, /no Georgian letters/);
});

test('a Georgian-only font in the text role ships nothing and leaves Georgian to its own role', async () => {
  const out = await resolveFonts(withFonts('precision', { text: ID.geo, georgian: ID.geo }), precision, loaderOf(NOTO()));
  assert.equal(out.warnings[0].code, 'FONT_FALLBACK');
  assert.equal(out.warnings[0].path, '$.settings.fonts.precision.text');
  assert.doesNotMatch(out.css, /sm-text/);
  assert.match(out.css, /@font-face \{\n {2}font-family: "sm-georgian";/);
  assert.equal(out.files.size, 1);
});

test('nothing a font file says about itself reaches the stylesheet', async () => {
  const evil = record('ibm-plex-sans-latin-wght-100-700', ID.sans, { family: 'x"}; body{display:none} @font-face{font-family:"y' });
  const out = await resolveFonts(withFonts('precision', { text: ID.sans }), precision, loaderOf(evil));
  assert.doesNotMatch(out.css, /display:none|body\{/);
  // every family the block names is a role alias or a family the layout manifest declares
  const allowed = new Set(['sm-text', 'sm-label', 'sm-georgian', 'Noto Sans Georgian', 'JetBrains Mono', 'Segoe UI']);
  const families = out.css.split('\n').filter((l) => /font-family|--sans|--mono/.test(l));
  assert.ok(families.length >= 4, out.css);
  for (const line of families) {
    for (const m of line.replace(/\[lang="[a-z]+"\]/g, '').matchAll(/"([^"]*)"/g)) assert.ok(allowed.has(m[1]), `unexpected family ${JSON.stringify(m[1])} in ${line}`);
  }
  assert.match([...out.files.keys()][0], /^fonts\/[a-z0-9-]{1,60}-latin-normal-100-700\.[0-9a-f]{8}\.woff2$/);
});

test('buildSite ships the chosen face, links it from the CSS and preloads it', async () => {
  const brand = { files: new Map(), og: { en: 'og-en.png', ka: 'og-ka.png' }, icons: { i32: 'a.png', i180: 'b.png', i192: 'c.png', i512: 'd.png' } };
  const site = withFonts('precision', { text: ID.sans, label: null, georgian: ID.geo });
  const files = await buildSite(site, { brand, today: '2026-09-16', fonts: loaderOf(...PLEX(), NOTO()) });
  const css = files.get(files.cssName).body;
  const custom = [...files.keys()].filter((n) => /^fonts\/.*\.[0-9a-f]{8}\.woff2$/.test(n));
  assert.equal(custom.length, 2);
  for (const n of custom) assert.match(css, new RegExp(`url\\('${n}'\\)`));
  for (const f of LAYOUTS.precision.meta.fonts) assert.ok(files.has(`fonts/${f}.woff2`), `${f} still ships for the layout's own @font-face`);
  assert.deepEqual(files.fonts, { text: ID.sans, label: 'default', georgian: ID.geo });
  const ka = files.get('ka/index.html').body;
  assert.ok(ka.includes(`<link rel="preload" href="/${custom.find((n) => n.includes('noto'))}" as="font"`));
  assert.ok(ka.includes('data-navfit='), 'Precision stamps the measured nav tier in override mode');
  assert.ok(!files.get('index.html').body.includes('fonts/chivo-latin-normal-400-700.woff2" as="font"'), 'the replaced face is no longer preloaded');
});

// The width-based estimators must agree with the constants they replace where the layouts' own fonts are
// concerned: dress each layout's committed faces up as a store record, resolve them and compare the tier.
const asDefaults = (meta) => {
  const ids = { text: ID.sans, label: ID.mono, georgian: ID.geo };
  const recs = Object.entries(meta.fontRoles).map(([role, r]) => record(r.files[0], ids[role], role === 'georgian' ? { subsets: ['georgian'] } : { subsets: ['latin'] }));
  return { fonts: ids, loader: loaderOf(...recs) };
};

// Tier ladders, narrowest first; the last entry hides the inline nav at every width.
const TIERS = {
  precision: { re: /data-navfit="([^"]+)"/, steps: ['1280', '1440', '1680', 'never'], css: { 'index.html': '1440', 'ka/index.html': '1680' } },
  studio: { re: /data-nav="([^"]+)"/, steps: ['1280', '1440', '1600', 'menu'] },
  ledger: { re: /class="lg-top (nav-[a-z0-9]+)"/, steps: ['nav-1280', 'nav-1360', 'nav-1440', 'nav-never'] },
};

for (const [id, layout] of Object.entries(LAYOUTS)) {
  for (const [name, doc] of [['seed', seed], ['stress fixture', stress]]) {
    test(`${id}: the measured nav fit stays as safe as the constants on the ${name}`, async () => {
      const base = doc();
      base.settings.layout = id;
      const { fonts, loader } = asDefaults(layout.meta);
      const over = structuredClone(base);
      over.settings.fonts = { [id]: fonts };
      const plain = renderSite(base, renderArgs(id));
      const measured = renderSite(over, { ...renderArgs(id), fonts: await resolveFonts(over, layout.meta, loader) });
      const { re, steps, css } = TIERS[id];
      for (const page of ['index.html', 'ka/index.html']) {
        const got = steps.indexOf(re.exec(measured[page])[1]);
        assert.ok(got >= 0, `${page}: unknown tier ${re.exec(measured[page])[1]}`);
        // Precision's default mode is a pure CSS breakpoint, so its own stylesheet is the baseline.
        const want = steps.indexOf(css ? css[page] : re.exec(plain[page])[1]);
        // The measured path carries the headroom of D7 on top of the exact advances, so it may land one
        // tier wider than the constants; it may never land narrower, which is the failure that wraps a nav.
        assert.ok(got >= want, `${page}: measured ${steps[got]} is less conservative than ${steps[want]}`);
        assert.ok(got <= want + 1, `${page}: measured ${steps[got]} is more than one tier above ${steps[want]}`);
      }
    });
  }
}
