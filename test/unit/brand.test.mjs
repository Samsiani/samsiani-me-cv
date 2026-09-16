// Brand images: names from content, deterministic PNGs, cache, static fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandNames, brandPlan, ogInputs } from '../../src/shared/brand.mjs';
import { ogCard } from '../../src/brand/cards.mjs';
import { renderBrand, RENDERER_ID, stats } from '../../src/brand/render.mjs';
import { loadPalettes } from '../../src/palettes.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { seed } from './_helpers.mjs';

const pals = loadPalettes();
const P = (id) => pals.palettes.find((p) => p.id === id);
const meta = LAYOUTS.precision.meta;
const names = (s, pal = 'cobalt') => brandNames(s, P(pal), meta, RENDERER_ID);
const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), sig: buf.subarray(1, 4).toString() });

test('OG cards are 1200x630 and icons 32/180/192/512 (IHDR), deterministic, cached', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'brand-'));
  const a = await renderBrand(seed(), P('cobalt'), meta, { cacheDir });
  for (const lang of ['en', 'ka']) assert.deepEqual(png(a.files.get(a.og[lang])), { w: 1200, h: 630, sig: 'PNG' });
  for (const [k, s] of [['i32', 32], ['i180', 180], ['i192', 192], ['i512', 512]]) assert.deepEqual(png(a.files.get(a.icons[k])), { w: s, h: s, sig: 'PNG' });
  const before = stats.renders;
  const b = await renderBrand(seed(), P('cobalt'), meta, { cacheDir });
  assert.equal(stats.renders, before, 'the second call is a cache hit');
  for (const [n, buf] of a.files) assert.equal(Buffer.compare(buf, b.files.get(n)), 0);
  const fresh = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: mkdtempSync(join(tmpdir(), 'brand-')) });
  for (const [n, buf] of a.files) assert.equal(Buffer.compare(buf, fresh.files.get(n)), 0, `identical bytes for ${n}`);
});

test('brandNames() and renderBrand() agree on the names', async () => {
  const r = await renderBrand(seed(), P('lime'), meta, { cacheDir: mkdtempSync(join(tmpdir(), 'brand-')) });
  const n = names(seed(), 'lime');
  assert.deepEqual(n.og, r.og);
  assert.deepEqual(n.icons, r.icons);
});

test('what changes which name', () => {
  const base = names(seed());
  const fact = seed(); fact.hero.facts[0].value.en = '11+';
  const f = names(fact);
  assert.notEqual(f.og.en, base.og.en, 'fact -> EN card');
  assert.equal(f.og.ka, base.og.ka, 'an EN fact does not change the KA card');
  assert.deepEqual(f.icons, base.icons, 'a fact never changes an icon');
  const factKa = seed(); factKa.hero.facts[0].value.ka = '11+'; factKa.hero.facts[0].value.en = '11+';
  assert.notEqual(names(factKa).og.ka, base.og.ka);
  const skill = seed(); skill.sections.skills.groups[0].items[0].name.en = 'Something else';
  assert.deepEqual(names(skill), base, 'a skill is not on any card');
  const pal = names(seed(), 'crimson');
  assert.notEqual(pal.og.en, base.og.en); assert.notEqual(pal.icons.i32, base.icons.i32);
  const mono = seed(); mono.person.monogram = 'GSX';
  const m = names(mono);
  assert.notEqual(m.icons.i32, base.icons.i32); assert.notEqual(m.og.en, base.og.en);
});

test('every TTF is a static instance whose OS/2 weight matches its name', () => {
  const dir = new URL('../../src/brand/fonts/', import.meta.url);
  const W = { Regular: 400, Medium: 500, SemiBold: 600 };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ttf'))) {
    const b = readFileSync(new URL(f, dir));
    const n = b.readUInt16BE(4);
    const tags = {};
    for (let i = 0; i < n; i++) tags[b.subarray(12 + 16 * i, 16 + 16 * i).toString()] = b.readUInt32BE(12 + 16 * i + 8);
    assert.equal('fvar' in tags, false, `${f} is variable`);
    assert.equal(b.readUInt16BE(tags['OS/2'] + 4), W[f.match(/-(\w+)\.ttf$/)[1]], f);
  }
});

test('the plan lists two cards and four icons', () => {
  const plan = brandPlan(seed(), P('cobalt'), meta, RENDERER_ID);
  assert.deepEqual(plan.map((p) => p.name.split('.')[0]).sort(), ['apple-touch-icon', 'favicon-32', 'icon-192', 'icon-512', 'og-en', 'og-ka']);
});

test('a removed line or fact renders a card without it, under a new name', async () => {
  const base = names(seed());
  const stripped = seed();
  stripped.hero.eyebrow = null;
  stripped.hero.subrole = null;
  assert.notEqual(names(stripped).og.en, base.og.en, 'a removed line changes the card name');
  const inputs = (s, lang = 'en') => ogInputs(s, lang, P('cobalt'), meta);
  assert.equal(inputs(stripped).eyebrow, null);
  assert.equal(inputs(stripped).subrole, null);
  const noChildIsNull = (node) => {
    const kids = node?.props?.children;
    if (!Array.isArray(kids)) return true;
    return kids.every((k) => k != null && noChildIsNull(k));
  };
  for (const n of [0, 1, 3, 4]) {
    const s = structuredClone(stripped);
    s.hero.facts = seed().hero.facts.slice(0, n);
    const card = ogCard(inputs(s));
    assert.ok(noChildIsNull(card), `${n} facts: no null child`);
  }
  const cacheDir = mkdtempSync(join(tmpdir(), 'brand-'));
  const empty = seed();
  empty.hero.eyebrow = null; empty.hero.subrole = null; empty.hero.facts = [];
  const r = await renderBrand(empty, P('cobalt'), meta, { cacheDir });
  for (const lang of ['en', 'ka']) assert.deepEqual(png(r.files.get(r.og[lang])), { w: 1200, h: 630, sig: 'PNG' });
});

// ------------------------------------------------------------------ chosen fonts on the card (fonts plan §5.6)
// The shape resolveFonts() hands the brand pipeline: per role, a key for the name and the bytes to register.
const cardFace = (file, weight = 400) => ({
  key: file.slice(0, 8),
  faces: [{ weight, style: 'normal', read: () => readFileSync(new URL(`../../src/brand/fonts/${file}`, import.meta.url)) }],
});
const NO_SATORI = { text: null, label: null, georgian: null };

test('a font satori cannot read leaves every card name exactly where it was', () => {
  const base = names(seed());
  assert.equal('fonts' in ogInputs(seed(), 'en', P('cobalt'), meta), false, 'no key at all without chosen fonts');
  assert.equal('fonts' in ogInputs(seed(), 'en', P('cobalt'), meta, NO_SATORI), false, 'nor when no role has a readable file');
  const same = brandNames(seed(), P('cobalt'), meta, RENDERER_ID, NO_SATORI);
  assert.deepEqual(same.og, base.og);
  assert.deepEqual(same.icons, base.icons);
});

test('a chosen card face renames the cards, never the icons, and changes the pixels', async () => {
  const base = names(seed());
  const og = { ...NO_SATORI, text: cardFace('JetBrainsMono-Regular.ttf') };
  const inputs = ogInputs(seed(), 'en', P('cobalt'), meta, og);
  assert.deepEqual(inputs.fonts, { text: og.text.key, label: 'default', georgian: 'default' });
  const withFont = brandNames(seed(), P('cobalt'), meta, RENDERER_ID, og);
  assert.notEqual(withFont.og.en, base.og.en);
  assert.notEqual(withFont.og.ka, base.og.ka, 'the Georgian card carries Latin too');
  assert.deepEqual(withFont.icons, base.icons, 'the monogram keeps the built-in face');

  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  const plain = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: dir });
  const custom = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: dir, fonts: og });
  assert.deepEqual(png(custom.files.get(custom.og.en)), { w: 1200, h: 630, sig: 'PNG' });
  assert.notEqual(Buffer.compare(plain.files.get(plain.og.en), custom.files.get(custom.og.en)), 0, 'the card is drawn in the other face');
  for (const k of Object.keys(base.icons)) assert.equal(Buffer.compare(plain.files.get(plain.icons[k]), custom.files.get(custom.icons[k])), 0, `${k} is untouched`);
  // and it is deterministic, like every other card
  const again = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: mkdtempSync(join(tmpdir(), 'brand-')), fonts: og });
  assert.equal(Buffer.compare(custom.files.get(custom.og.en), again.files.get(again.og.en)), 0);
});

test('the Georgian role draws the Georgian card text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  const og = { ...NO_SATORI, georgian: cardFace('NotoSansGeorgian-SemiBold.ttf', 600) };
  const plain = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: dir });
  const custom = await renderBrand(seed(), P('cobalt'), meta, { cacheDir: dir, fonts: og });
  assert.notEqual(custom.og.ka, plain.og.ka);
  assert.notEqual(Buffer.compare(plain.files.get(plain.og.ka), custom.files.get(custom.og.ka)), 0);
});
