import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { FONT_ROLES } from '../../src/typography/roles.mjs';

const FONTS = new URL('../../src/fonts/', import.meta.url);
const REQUIRED = ['id', 'label', 'description', 'css', 'fonts', 'preload', 'themeColor', 'manifestBackground', 'fontRoles'];

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

  // The font roles are the contract between the admin, the resolver and this layout's stylesheet
  // (docs/plans/fonts.md §5.1): the variables must exist in styles.css, the default families in fonts.css,
  // and the per-role file lists must account for every face the layout ships.
  test(`${id}: fontRoles matches the stylesheet and the shipped faces`, () => {
    const styles = readFileSync(new URL(`../../src/layouts/${id}/styles.css`, import.meta.url), 'utf8');
    const face = readFileSync(new URL(`../../src/layouts/${id}/fonts.css`, import.meta.url), 'utf8');
    assert.deepEqual(Object.keys(meta.fontRoles), FONT_ROLES);
    for (const [role, r] of Object.entries(meta.fontRoles)) {
      for (const k of ['label', 'help', 'defaultFamily', 'files', 'weights']) assert.ok(r[k], `${role} is missing ${k}`);
      assert.ok(r.files.length && r.files.every((f) => meta.fonts.includes(f)), `${role}: ${r.files} is not in meta.fonts`);
      assert.ok(r.weights.every((w) => Number.isInteger(w) && w >= 100 && w <= 900), `${role} weights`);
      assert.ok(face.includes(`font-family: '${r.defaultFamily}'`), `${role}: fonts.css declares no ${r.defaultFamily}`);
      if (role === 'georgian') {
        assert.equal(r.var, null);
        for (const sel of r.extraSelectors || []) assert.ok(styles.includes(sel), `${sel} is not in styles.css`);
      } else {
        assert.ok(styles.includes(`${r.var}:`), `${role}: styles.css declares no ${r.var}`);
        assert.ok(r.tail && !r.tail.endsWith(';'), `${role} tail`);
      }
    }
    assert.equal(meta.fontRoles.text.kaTail && meta.fontRoles.text.var !== meta.fontRoles.label.var, true);
    const covered = Object.values(meta.fontRoles).flatMap((r) => r.files);
    assert.deepEqual([...covered].sort(), [...meta.fonts].sort(), 'every shipped face belongs to exactly one role');
    // the default preload order is the role order the resolver reproduces when a role is overridden
    assert.deepEqual(meta.preload.en, [...meta.fontRoles.text.files, ...meta.fontRoles.label.files]);
    assert.deepEqual(meta.preload.ka, [...meta.fontRoles.georgian.files, ...meta.preload.en]);
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
