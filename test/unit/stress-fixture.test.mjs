// The stress fixture must keep every limited field at its limit, so the layout gates really test the limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsTable, buildSchema } from '../../src/schema/validate.mjs';
import { stress } from './_helpers.mjs';
import { loadPalettes } from '../../src/palettes.mjs';

const len = (s) => [...s].length;
// expand "a.b[].c" over every array element
function resolveAll(obj, path) {
  let cur = [obj];
  for (const part of path.split('.')) {
    const isArr = part.endsWith('[]');
    const key = isArr ? part.slice(0, -2) : part;
    cur = cur.flatMap((o) => (o && o[key] !== undefined ? (isArr ? o[key] : [o[key]]) : []));
  }
  return cur;
}

const site = stress();
const schema = buildSchema({ paletteIds: loadPalettes().palettes.map((p) => p.id) });
const rows = limitsTable(schema).filter((r) => r.path !== 'settings.siteUrl' && !/^sections\.[a-z]+\.nav$/.test(r.path));

for (const row of rows) {
  test(`reaches the limit: ${row.path} (${row.max})`, () => {
    const values = resolveAll(site, row.path).filter((v) => v !== null && v !== undefined);
    assert.ok(values.length > 0, `${row.path} has no instance in the fixture`);
    if (row.localized) {
      for (const lang of ['en', 'ka']) {
        const best = Math.max(...values.map((v) => len(v[lang] ?? '')));
        assert.equal(best, row.max, `${row.path}.${lang} longest is ${best}, limit ${row.max}`);
      }
    } else {
      const best = Math.max(...values.map((v) => len(String(v))));
      assert.equal(best, row.max, `${row.path} longest is ${best}, limit ${row.max}`);
    }
  });
}

test('nav labels use the whole budget in both languages', () => {
  for (const lang of ['en', 'ka']) {
    const labels = Object.values(site.sections).map((s) => (s.nav ?? s.title)[lang]);
    const total = labels.reduce((n, l) => n + len(l), 0);
    assert.ok(total >= 98, `${lang} nav labels total ${total}`);
    assert.ok(labels.some((l) => len(l) === 28), `${lang}: no nav label at 28`);
  }
});
