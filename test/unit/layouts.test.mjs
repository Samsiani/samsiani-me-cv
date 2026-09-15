import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { LAYOUTS } from '../../src/layouts/index.mjs';

const FONTS = new URL('../../src/fonts/', import.meta.url);
const REQUIRED = ['id', 'label', 'description', 'css', 'fonts', 'preload', 'themeColor', 'manifestBackground'];

for (const [id, { meta, renderBody }] of Object.entries(LAYOUTS)) {
  test(`${id}: manifest has every required key`, () => {
    for (const k of REQUIRED) assert.ok(meta[k] !== undefined && meta[k] !== '', `${id} is missing ${k}`);
    assert.equal(meta.id, id);
    assert.equal(typeof renderBody, 'function');
  });

  test(`${id}: every declared font file exists`, () => {
    for (const f of meta.fonts) assert.ok(existsSync(new URL(`${f}.woff2`, FONTS)), `src/fonts/${f}.woff2 is missing`);
    for (const lang of ['en', 'ka']) for (const f of meta.preload[lang]) assert.ok(meta.fonts.includes(f), `${f} preloaded but not declared`);
  });

  test(`${id}: every declared CSS file exists`, () => {
    for (const f of meta.css) assert.ok(existsSync(new URL(`../../src/layouts/${id}/${f}`, import.meta.url)), `${f} missing`);
  });

  if (meta.thumbnail) {
    test(`${id}: admin thumbnail is a well-formed SVG`, () => {
      const svg = readFileSync(new URL(`../../src/admin-thumbs/${id}.svg`, import.meta.url), 'utf8');
      assert.match(svg, /viewBox="0 0 320 200"/);
      assert.match(svg, /role="img"/);
      assert.match(svg, /aria-label="[^"]+"/);
      assert.doesNotMatch(svg, /<text/);
    });
  }
}

test('admin thumbnails exist only for registered layouts', () => {
  const dir = new URL('../../src/admin-thumbs/', import.meta.url);
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) assert.ok(f.replace(/\.svg$/, '') in LAYOUTS, `${f} has no registered layout`);
});
