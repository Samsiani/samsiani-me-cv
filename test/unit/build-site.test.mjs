import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSite } from '../../src/build-site.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBrand } from '../../src/brand/render.mjs';

const CACHE = mkdtempSync(join(tmpdir(), 'brand-'));
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { seed } from './_helpers.mjs';

const TODAY = '2026-09-14';
const build = (site, opts = {}) => buildSite(site, { brand: (s, pal, meta) => renderBrand(s, pal, meta, { cacheDir: CACHE }), today: TODAY, ...opts });

test('ships only the active layout\'s fonts', async () => {
  const files = await build(seed());
  const fonts = [...files.keys()].filter((k) => k.startsWith('fonts/')).map((k) => k.slice(6, -6)).sort();
  assert.deepEqual(fonts, [...LAYOUTS.precision.meta.fonts].sort());
});

test('a preview base prefixes every root-relative href/src except the language links', async () => {
  const base = '/x/';
  const files = await build(seed(), { mode: 'preview', base });
  for (const page of ['index.html', 'ka/index.html']) {
    const html = String(files.get(page).body);
    const refs = [...html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
    const bad = refs.filter((r) => r !== '/' && r !== '/ka/' && !r.startsWith(base));
    assert.deepEqual(bad, [], `${page}: ${bad.join(', ')}`);
    const doubled = refs.filter((r) => r.indexOf(base, 1) > 0);
    assert.deepEqual(doubled, [], `${page}: base applied twice: ${doubled.join(', ')}`);
  }
});

test('preview mode omits robots, sitemap and server config files', async () => {
  const files = await build(seed(), { mode: 'preview', base: '/x/' });
  for (const f of ['robots.txt', 'sitemap.xml', '.htaccess', '_headers']) assert.ok(!files.has(f), `${f} present`);
  const pub = await build(seed());
  for (const f of ['robots.txt', 'sitemap.xml', '.htaccess', '_headers']) assert.ok(pub.has(f), `${f} missing in publish mode`);
});

test('identical input gives an identical file map', async () => {
  const a = await build(seed());
  const b = await build(seed());
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const [k, v] of a) assert.equal(Buffer.compare(Buffer.from(v.body), Buffer.from(b.get(k).body)), 0, k);
});

test('every PNG, the manifest, the stylesheet and the script carry an 8-hex hash', async () => {
  const files = await build(seed());
  for (const k of files.keys()) {
    if (/\.(png|webmanifest|css|js)$/.test(k)) assert.match(k, /\.[0-9a-f]{8}\.(png|webmanifest|css|js)$/, k);
  }
});

test('an invalid site throws with the validation errors', async () => {
  const s = seed();
  s.contact.items[2].href = 'javascript:alert(1)';
  await assert.rejects(() => build(s), (e) => e.name === 'BuildValidationError' && e.errors.some((x) => x.code === 'HREF_SCHEME'));
});

test('preview mode tolerates content errors and neutralises bad links', async () => {
  const s = seed();
  s.contact.items[2].href = 'javascript:alert(1)';
  const files = await build(s, { mode: 'preview', base: '/x/' });
  const html = String(files.get('index.html').body);
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('#invalid-link'));
});

test('robots.txt disallows the admin', async () => {
  const files = await build(seed());
  assert.match(String(files.get('robots.txt').body), /Disallow: \/admin\//);
});
