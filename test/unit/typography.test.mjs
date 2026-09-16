// Typography F1 (docs/plans/fonts.md §1.3, §7.1): the zero-dependency font reader and the null-transform
// WOFF2 writer. Every font file in the repository is parsed and its measured values recorded here, a TTF
// converted to WOFF2 keeps table for table its coverage and metrics, a real Chromium loads that conversion
// and draws it at the width the metrics predict, and a malformed file is refused with a reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import {
  FontParseError, GEORGIAN_RANGE, MKHEDRULI, coverageOf, metricsOf, parseFont, rangesOf, sniff, unwrapWoff2, widthOf, wrapWoff2,
} from '../../src/typography/sfnt.mjs';

const WEB = new URL('../../src/fonts/', import.meta.url); // the faces the layouts ship
const TTF = new URL('../../src/brand/fonts/', import.meta.url); // the static faces satori renders cards with
const read = (dir, name) => readFileSync(new URL(name, dir));
const names = (dir, ext) => readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
const load = (dir, name) => parseFont(read(dir, name));
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is further than ${eps} from ${b}`);

// Measured from the committed files on 2026-09-16 with this reader. `latin`/`georgian` are the mean advance
// in em over the 95 printable ASCII and over the 33 Mkhedruli letters, for the file's default instance.
const EXPECT = {
  'archivo-latin-wdth-wght.woff2': { weight: 600, mono: false, axes: { wght: [100, 600, 900], wdth: [62, 100, 125] }, latin: 0.552, georgian: null, mkhedruli: 0, family: 'Archivo SemiBold' },
  'chivo-latin-normal-400-700.woff2': { weight: 500, mono: false, axes: { wght: [100, 500, 900] }, latin: 0.555, georgian: null, mkhedruli: 0, family: 'Chivo Medium' },
  'ibm-plex-mono-latin-400.woff2': { weight: 400, mono: true, axes: null, latin: 0.6, georgian: null, mkhedruli: 0, family: 'IBM Plex Mono' },
  'ibm-plex-mono-latin-500.woff2': { weight: 500, mono: true, axes: null, latin: 0.6, georgian: null, mkhedruli: 0, family: 'IBM Plex Mono Medium' },
  'ibm-plex-sans-latin-wght-100-700.woff2': { weight: 400, mono: false, axes: { wght: [100, 400, 700] }, latin: 0.536, georgian: null, mkhedruli: 0, family: 'IBM Plex Sans' },
  'jetbrains-mono-latin-normal-400-500.woff2': { weight: 400, mono: true, axes: { wght: [400, 400, 800] }, latin: 0.6, georgian: null, mkhedruli: 0, family: 'JetBrains Mono' },
  'noto-sans-georgian-georgian-normal-400-700.woff2': { weight: 400, mono: false, axes: { wght: [100, 400, 900] }, latin: 0.26, georgian: 0.659, mkhedruli: 33, family: 'Noto Sans Georgian' },
  'Chivo-Regular.ttf': { weight: 400, mono: false, axes: null, latin: 0.552, georgian: null, mkhedruli: 0, family: 'Chivo' },
  'Chivo-SemiBold.ttf': { weight: 600, mono: false, axes: null, latin: 0.559, georgian: null, mkhedruli: 0, family: 'Chivo' },
  'JetBrainsMono-Medium.ttf': { weight: 500, mono: true, axes: null, latin: 0.6, georgian: null, mkhedruli: 0, family: 'JetBrains Mono' },
  'JetBrainsMono-Regular.ttf': { weight: 400, mono: true, axes: null, latin: 0.6, georgian: null, mkhedruli: 0, family: 'JetBrains Mono' },
  'NotoSansGeorgian-Regular.ttf': { weight: 400, mono: false, axes: null, latin: 0.534, georgian: 0.659, mkhedruli: 33, family: 'Noto Sans Georgian' },
  'NotoSansGeorgian-SemiBold.ttf': { weight: 600, mono: false, axes: null, latin: 0.55, georgian: 0.678, mkhedruli: 33, family: 'Noto Sans Georgian' },
};

test('every font file in the repository parses into the recorded values', () => {
  const seen = [];
  for (const [dir, ext] of [[WEB, '.woff2'], [TTF, '.ttf']]) {
    for (const name of names(dir, ext)) {
      seen.push(name);
      const want = EXPECT[name];
      assert.ok(want, `${name} is not in EXPECT — record it when a font file is added`);
      const font = load(dir, name);
      const m = metricsOf(font);
      const c = coverageOf(font);
      assert.equal(font.flavor, ext === '.ttf' ? 'ttf' : 'woff2', name);
      assert.equal(sniff(read(dir, name)), font.flavor, `${name} sniffs as its flavor`);
      assert.equal(font.unitsPerEm, 1000, `${name} unitsPerEm`);
      assert.equal(font.italic, false, `${name} is upright`);
      assert.equal(font.weightClass, want.weight, `${name} usWeightClass`);
      assert.equal(font.fixedPitch, want.mono, `${name} fixed pitch`);
      assert.equal(font.names.family, want.family, `${name} family name`);
      assert.deepEqual(font.fvar && Object.fromEntries(font.fvar.axes.map((a) => [a.tag, [a.min, a.default, a.max]])), want.axes, `${name} axes`);
      assert.equal(c.counts.mkhedruli, want.mkhedruli, `${name} Mkhedruli coverage`);
      assert.equal(c.georgian, want.mkhedruli === 33, `${name} Georgian coverage flag`);
      assert.equal(m.latin && m.latin.mean, want.latin, `${name} mean Latin advance`);
      assert.equal(m.georgian && m.georgian.mean, want.georgian, `${name} mean Mkhedruli advance`);
      assert.ok(font.numGlyphs > 100 && font.numGlyphs < 2000, `${name} glyph count ${font.numGlyphs}`);
      assert.ok(m.ascender > 0 && m.descender < 0 && m.capHeight > m.xHeight, `${name} vertical metrics`);
      for (const [ch, em] of Object.entries(m.latin ? m.latin.adv : {})) assert.ok(em >= 0 && em <= 1.5, `${name}: ${ch} is ${em} em`);
    }
  }
  assert.equal(seen.length, 13, 'seven web faces and six static faces');
});

test('only the Noto Sans Georgian faces cover Mkhedruli, and they cover all 33 letters', () => {
  const georgian = [];
  for (const [dir, ext] of [[WEB, '.woff2'], [TTF, '.ttf']]) {
    for (const name of names(dir, ext)) {
      const c = coverageOf(load(dir, name));
      if (c.counts.mkhedruli) georgian.push(name);
      assert.equal(c.counts.mkhedruli, /noto/i.test(name) ? 33 : 0, `${name}: ${c.counts.mkhedruli}/33 Mkhedruli letters`);
      if (!/noto-sans-georgian-georgian/.test(name)) assert.equal(c.latin, true, `${name} covers a-z A-Z 0-9`);
    }
  }
  assert.deepEqual(georgian, ['noto-sans-georgian-georgian-normal-400-700.woff2', 'NotoSansGeorgian-Regular.ttf', 'NotoSansGeorgian-SemiBold.ttf']);
});

test('the shipped WOFF2 and the static TTF of a family agree on the mean advance', () => {
  const geo = (n, d) => metricsOf(load(d, n)).georgian.mean;
  const lat = (n, d) => metricsOf(load(d, n)).latin.mean;
  // Same family, same default weight: the subset WOFF2 and the full TTF must measure the same.
  near(geo('noto-sans-georgian-georgian-normal-400-700.woff2', WEB), geo('NotoSansGeorgian-Regular.ttf', TTF), 0.002, 'Noto Sans Georgian, Mkhedruli');
  near(lat('jetbrains-mono-latin-normal-400-500.woff2', WEB), lat('JetBrainsMono-Regular.ttf', TTF), 0.002, 'JetBrains Mono, Latin');
  // Chivo's web file is variable and defaults to Medium, so it sits between the two static instances.
  const chivo = lat('chivo-latin-normal-400-700.woff2', WEB);
  assert.ok(chivo > lat('Chivo-Regular.ttf', TTF) && chivo < lat('Chivo-SemiBold.ttf', TTF), `Chivo Medium ${chivo} is not between its Regular and SemiBold`);
  near(chivo, lat('Chivo-Regular.ttf', TTF), 0.01, 'Chivo, Latin');
});

test('a WOFF2 keeps its glyf and loca transformed and its hmtx readable', () => {
  const { sfntVersion, tables } = unwrapWoff2(read(WEB, 'noto-sans-georgian-georgian-normal-400-700.woff2'));
  assert.equal(sfntVersion, 0x00010000);
  assert.deepEqual(tables.filter((t) => t.transformed).map((t) => t.tag), ['glyf', 'loca'], 'Google transforms the outlines and nothing else');
  assert.equal(tables.find((t) => t.tag === 'loca').length, 0, 'a transformed loca is empty');
  // The reader never reconstructs glyf, yet every advance width is there.
  const font = parseFont(read(WEB, 'noto-sans-georgian-georgian-normal-400-700.woff2'));
  assert.equal(font.transformed.has('glyf'), true);
  assert.ok(font.advance(font.cmap.get(0x10d0)) > 0, 'ა has an advance');
});

test('wrapWoff2() round-trips a TTF through this reader with the same tables, coverage and metrics', () => {
  for (const name of ['Chivo-Regular.ttf', 'JetBrainsMono-Regular.ttf', 'NotoSansGeorgian-Regular.ttf']) {
    const ttf = read(TTF, name);
    const woff2 = wrapWoff2(ttf);
    assert.equal(sniff(woff2), 'woff2', name);
    assert.ok(woff2.length < ttf.length * 0.7, `${name}: ${woff2.length} of ${ttf.length} bytes`);
    // Blocks start on four-byte boundaries: a file that ends mid-word is refused by browsers (OTS rounds
    // the compressed block up and compares it with the header length), which costs up to three zero bytes.
    assert.equal(woff2.length % 4, 0, `${name} is not four-byte aligned`);
    assert.equal(woff2.readUInt32BE(8), woff2.length, `${name}: the header length must count the padding`);
    const a = parseFont(ttf), b = parseFont(woff2);
    assert.equal(b.flavor, 'woff2');
    assert.deepEqual([...b.tables.keys()].sort(), [...a.tables.keys()].sort(), `${name} table set`);
    for (const [tag, data] of a.tables) assert.equal(Buffer.compare(data, b.tables.get(tag)), 0, `${name}: ${tag} bytes`);
    assert.deepEqual(coverageOf(b), coverageOf(a), `${name} coverage`);
    assert.deepEqual(metricsOf(b), metricsOf(a), `${name} metrics`);
    assert.deepEqual(b.names, a.names, `${name} names`);
    assert.equal(b.cmap.size, a.cmap.size, `${name} cmap`);
    // Null transforms: the writer sets version 3 for glyf and loca, so nothing comes back transformed.
    assert.deepEqual(unwrapWoff2(woff2).tables.filter((t) => t.transformed), [], `${name} is written untransformed`);
    const order = unwrapWoff2(woff2).tables.map((t) => t.tag);
    assert.equal(order.indexOf('loca'), order.indexOf('glyf') + 1, `${name}: loca must follow glyf`);
  }
});

// A minimal WOFF 1.0 container (there is none in the repository, and uploads may bring one): 44-byte header,
// one 20-byte directory entry per table, each table deflated when that helps and padded to four bytes.
function toWoff(sfnt) {
  const n = sfnt.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i, off = sfnt.readUInt32BE(o + 8), len = sfnt.readUInt32BE(o + 12);
    tables.push({ tag: sfnt.toString('latin1', o, o + 4), checksum: sfnt.readUInt32BE(o + 4), data: sfnt.subarray(off, off + len) });
  }
  const dir = Buffer.alloc(20 * n);
  const blocks = [];
  let offset = 44 + 20 * n;
  tables.forEach((t, i) => {
    const z = deflateSync(t.data);
    const body = z.length < t.data.length ? z : t.data; // WOFF stores a table whole when deflate does not help
    const pad = (4 - (body.length % 4)) % 4;
    dir.write(t.tag, 20 * i, 'latin1');
    dir.writeUInt32BE(offset, 20 * i + 4);
    dir.writeUInt32BE(body.length, 20 * i + 8);
    dir.writeUInt32BE(t.data.length, 20 * i + 12);
    dir.writeUInt32BE(t.checksum, 20 * i + 16);
    blocks.push(body, Buffer.alloc(pad));
    offset += body.length + pad;
  });
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(sfnt.readUInt32BE(0), 4);
  header.writeUInt32BE(offset, 8);
  header.writeUInt16BE(n, 12);
  header.writeUInt32BE(12 + 16 * n + tables.reduce((a, t) => a + ((t.data.length + 3) & ~3), 0), 16);
  header.writeUInt16BE(1, 20); // majorVersion
  return Buffer.concat([header, dir, ...blocks]);
}

test('a WOFF is read through its per-table zlib, and the writer takes one as input', () => {
  const ttf = read(TTF, 'NotoSansGeorgian-Regular.ttf');
  const woff = toWoff(ttf);
  assert.equal(sniff(woff), 'woff');
  assert.ok(woff.length < ttf.length, `${woff.length} of ${ttf.length} bytes`);
  const a = parseFont(ttf), b = parseFont(woff);
  assert.equal(b.flavor, 'woff');
  for (const [tag, data] of a.tables) assert.equal(Buffer.compare(data, b.tables.get(tag)), 0, `${tag} bytes`);
  assert.deepEqual(coverageOf(b), coverageOf(a));
  assert.deepEqual(metricsOf(b), metricsOf(a));
  assert.deepEqual(b.names, a.names);
  const woff2 = parseFont(wrapWoff2(woff)); // D5: a WOFF upload ships as WOFF2 too
  assert.equal(woff2.flavor, 'woff2');
  assert.deepEqual(metricsOf(woff2), metricsOf(a));
  // A table whose declared original length is a lie is refused, not trusted.
  const lying = Buffer.from(woff);
  lying.writeUInt32BE(9999, 44 + 12);
  assert.throws(() => parseFont(lying), (e) => e instanceof FontParseError && e.reason === 'format');
});

test('wrapWoff2() refuses a file that is already a WOFF2', () => {
  assert.throws(() => wrapWoff2(read(WEB, 'chivo-latin-normal-400-700.woff2')), (e) => e instanceof FontParseError && e.reason === 'format');
});

test('a malformed file is refused with a reason, never a RangeError', () => {
  const ttf = read(TTF, 'Chivo-Regular.ttf');
  const woff2 = read(WEB, 'chivo-latin-normal-400-700.woff2');
  const patch = (buf, fn) => { const b = Buffer.from(buf); fn(b); return b; };
  const tableAt = (b, tag) => { // the directory entry of one table in an sfnt
    for (let i = 0; i < b.readUInt16BE(4); i++) if (b.toString('latin1', 12 + 16 * i, 16 + 16 * i) === tag) return 12 + 16 * i;
    throw new Error(`no ${tag}`);
  };
  const lengths = unwrapWoff2(woff2).tables.map((t) => t.length);
  const cases = [
    ['nothing at all', Buffer.alloc(0), 'format'],
    ['a PNG', Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(400)]), 'format'],
    ['a font collection', patch(ttf, (b) => b.write('ttcf', 0, 'latin1')), 'format'],
    ['a truncated TTF', ttf.subarray(0, 2048), 'tables'],
    ['65 tables', patch(ttf, (b) => b.writeUInt16BE(65, 4)), 'tables'],
    ['no tables', patch(ttf, (b) => b.writeUInt16BE(0, 4)), 'tables'],
    ['a table past the end of the file', patch(ttf, (b) => b.writeUInt32BE(b.length - 2, tableAt(b, 'cmap') + 8)), 'tables'],
    ['a table longer than the file', patch(ttf, (b) => b.writeUInt32BE(b.length, tableAt(b, 'cmap') + 12)), 'tables'],
    ['no cmap table', patch(ttf, (b) => b.write('zzzz', tableAt(b, 'cmap'), 'latin1')), 'tables'],
    ['no OS/2 table', patch(ttf, (b) => b.write('zzzz', tableAt(b, 'OS/2'), 'latin1')), 'tables'],
    ['no outlines', patch(ttf, (b) => b.write('zzzz', tableAt(b, 'glyf'), 'latin1')), 'tables'],
    ['a wrong head magic number', patch(ttf, (b) => b.writeUInt32BE(1, b.readUInt32BE(tableAt(b, 'head') + 8) + 12)), 'format'],
    ['unitsPerEm 0', patch(ttf, (b) => b.writeUInt16BE(0, b.readUInt32BE(tableAt(b, 'head') + 8) + 18)), 'metrics'],
    ['more glyphs than hmtx entries', patch(ttf, (b) => b.writeUInt16BE(9000, b.readUInt32BE(tableAt(b, 'hhea') + 8) + 34)), 'metrics'],
    ['a truncated WOFF2', woff2.subarray(0, 900), 'format'],
    ['a WOFF2 header length that lies', patch(woff2, (b) => b.writeUInt32BE(b.length + 1, 8)), 'format'],
    ['a 1 GB totalSfntSize', patch(woff2, (b) => b.writeUInt32BE(0x40000000, 16)), 'size'],
    ['a Brotli stream larger than totalSfntSize', patch(woff2, (b) => b.writeUInt32BE(Math.max(...lengths) + 1, 16)), 'size'],
    ['a corrupt Brotli stream', patch(woff2, (b) => b.fill(0xff, b.length - 40)), 'format'],
    ['65 WOFF2 tables', patch(woff2, (b) => b.writeUInt16BE(65, 12)), 'tables'],
  ];
  for (const [what, buf, reason] of cases) {
    assert.throws(() => parseFont(buf), (e) => {
      assert.ok(e instanceof FontParseError, `${what} threw ${e.name}: ${e.message}`);
      assert.equal(e.reason, reason, `${what}: reason ${e.reason} (${e.message})`);
      assert.ok(e.message.length > 8, `${what}: the message must say something`);
      return true;
    }, what);
  }
});

test('a cmap that claims the whole of Unicode is stopped by the mapping cap', () => {
  // A format 12 subtable with one group over every code point: the kind of thing an upload could carry.
  const sub = Buffer.alloc(28);
  sub.writeUInt16BE(12, 0); sub.writeUInt32BE(sub.length, 4); sub.writeUInt32BE(1, 12); // format, length, nGroups
  sub.writeUInt32BE(0, 16); sub.writeUInt32BE(0x10ffff, 20); sub.writeUInt32BE(1, 24); // start, end, startGlyphID
  const cmap = Buffer.concat([Buffer.alloc(12), sub]);
  cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(10, 6); cmap.writeUInt32BE(12, 8);
  const ttf = read(TTF, 'NotoSansGeorgian-Regular.ttf');
  const b = Buffer.concat([ttf, cmap]); // the crafted table goes at the end and the directory is pointed at it
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const o = 12 + 16 * i;
    if (b.toString('latin1', o, o + 4) === 'cmap') { b.writeUInt32BE(ttf.length, o + 8); b.writeUInt32BE(cmap.length, o + 12); }
  }
  const t0 = Date.now();
  assert.throws(() => parseFont(b), (e) => e instanceof FontParseError && e.reason === 'cmap');
  assert.ok(Date.now() - t0 < 2000, `the cap took ${Date.now() - t0} ms to fire`);
});

test('rangesOf() collapses the cmap and fences Georgian out', () => {
  const noto = load(TTF, 'NotoSansGeorgian-Regular.ttf');
  const all = rangesOf(noto);
  const latin = rangesOf(noto, { excludeGeorgian: true });
  assert.ok(all.length <= 64 && latin.length <= 64, `${all.length} / ${latin.length} ranges`);
  for (const r of [...all, ...latin]) assert.match(r, /^U\+[0-9A-F]{4,6}(-[0-9A-F]{4,6})?$/);
  const covers = (list, cp) => list.some((r) => {
    const [a, b = a] = r.slice(2).split('-').map((h) => parseInt(h, 16));
    return cp >= a && cp <= b;
  });
  for (const cp of MKHEDRULI) {
    assert.equal(covers(all, cp), true, `U+${cp.toString(16)} is in the full range list`);
    assert.equal(covers(latin, cp), false, `U+${cp.toString(16)} must not be in a Latin-fenced list`);
  }
  for (const [a, b] of GEORGIAN_RANGE) for (const cp of [a, b]) assert.equal(covers(latin, cp), false, `U+${cp.toString(16)} is fenced out`);
  assert.equal(covers(latin, 0x41), true, 'A is still there');
  assert.equal(rangesOf(noto, { max: 4 }).length, 4, 'the entry cap holds');
});

test('widthOf() sums advances, weights them and adds letter spacing', () => {
  const mono = metricsOf(load(TTF, 'JetBrainsMono-Regular.ttf')); // every glyph is 0.6 em
  const noto = metricsOf(load(TTF, 'NotoSansGeorgian-Regular.ttf'));
  near(widthOf(mono, 'abcdef', 100), 6 * 0.6 * 100, 0.001, 'six monospaced characters at 100 px');
  near(widthOf(mono, '', 100), 0, 0.001, 'the empty string');
  near(widthOf(mono, 'abcdef', 100, { letterSpacingEm: 0.1 }), 6 * 0.7 * 100, 0.001, 'letter spacing after every character');
  near(widthOf(mono, 'abcdef', 13), 6 * 0.6 * 13, 0.001, 'at 13 px');
  near(widthOf(mono, 'abcdef', 100, { headroom: 1.06 }), 6 * 0.6 * 100 * 1.06, 0.001, 'headroom');
  // The weight factor is 1 + 3.5 % per 100 units, clamped to 0.9 - 1.2.
  near(widthOf(mono, 'ab', 100, { weight: 700 }), 2 * 0.6 * 100 * 1.105, 0.001, 'weight 700');
  near(widthOf(mono, 'ab', 100, { weight: 100 }), 2 * 0.6 * 100 * 0.9, 0.001, 'weight 100 is clamped');
  near(widthOf(mono, 'ab', 100, { weight: 1000 }), 2 * 0.6 * 100 * 1.2, 0.001, 'weight 1000 is clamped');
  // Georgian characters are measured with the Georgian metrics, everything else with the Latin ones.
  near(widthOf(noto, 'ა', 100), noto.georgian.adv['ა'] * 100, 0.001, 'one Mkhedruli letter');
  near(widthOf(noto, 'ვებ დეველოპერი', 100), [...'ვებ დეველოპერი'].reduce((n, c) => n + (noto.georgian.adv[c] ?? noto.latin.adv[c]), 0) * 100, 0.01, 'a Georgian phrase with a space');
  // An unmapped character costs its script's mean, and a Latin-only face still measures Georgian somehow.
  const latinOnly = metricsOf(load(TTF, 'Chivo-Regular.ttf'));
  assert.equal(latinOnly.georgian, null);
  near(widthOf(latinOnly, 'ა', 100), latinOnly.latin.mean * 100, 0.001, 'Georgian on a Latin-only face falls back to the Latin mean');
  near(widthOf(noto, '\u{1F600}', 100), noto.latin.mean * 100, 0.001, 'an unmapped character costs the mean');
});

test('a real Chromium loads the encoded WOFF2 and draws it at the width the metrics predict', { timeout: 60_000 }, async (t) => {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('playwright is not installed'); }
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    return t.skip(`Chromium is unavailable (${String(e.message).split('\n')[0]}) — run: npx playwright install chromium`);
  }
  try {
    const metrics = metricsOf(load(TTF, 'NotoSansGeorgian-Regular.ttf'));
    const face = wrapWoff2(read(TTF, 'NotoSansGeorgian-Regular.ttf'));
    const LAT = 'Full-stack web developer', GEO = 'ვებ დეველოპერი';
    // The alias is a role name, never the font's own family: the generated CSS works the same way (D11).
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "sm-f1"; font-style: normal; font-weight: 400; font-display: block;
  src: url(data:font/woff2;base64,${face.toString('base64')}) format('woff2'); }
body { margin: 0 }
span { font-size: 100px; white-space: pre; font-kerning: none; font-variant-ligatures: none; font-feature-settings: "kern" 0, "liga" 0, "calt" 0 }
.f { font-family: "sm-f1" } .s { font-family: serif } .m { font-family: monospace }
</style><div><span class="f" id="lat">${LAT}</span></div><div><span class="f" id="geo">${GEO}</span></div>
<div><span class="s" id="slat">${LAT}</span></div><div><span class="m" id="mlat">${LAT}</span></div>`);
    const r = await page.evaluate(async () => {
      const loaded = await document.fonts.load('100px "sm-f1"');
      await document.fonts.ready;
      const w = (id) => document.getElementById(id).getBoundingClientRect().width;
      return { faces: loaded.length, check: document.fonts.check('100px "sm-f1"'), lat: w('lat'), geo: w('geo'), serif: w('slat'), mono: w('mlat') };
    });
    assert.equal(r.faces, 1, 'the @font-face loaded');
    assert.equal(r.check, true, 'document.fonts.check');
    const within = (got, want, pct, what) => assert.ok(Math.abs(got - want) / want <= pct / 100, `${what}: Chromium drew ${got.toFixed(1)} px, the metrics predict ${want.toFixed(1)} px`);
    within(r.lat, widthOf(metrics, LAT, 100), 2.5, 'Latin');
    within(r.geo, widthOf(metrics, GEO, 100), 2.5, 'Georgian');
    // …and it really is our face, not a fallback that happens to be close.
    for (const [name, px] of [['serif', r.serif], ['monospace', r.mono]])
      assert.ok(Math.abs(px - r.lat) / r.lat > 0.05, `the ${name} fallback drew ${px.toFixed(1)} px, our face ${r.lat.toFixed(1)} px — the test is not proving anything`);
  } finally {
    await browser.close();
  }
});
