// Drafts can hold content the validator would reject; preview must never crash on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../../src/render.mjs';
import { buildSchema } from '../../src/schema/validate.mjs';
import { seed, layoutIds, renderArgs, eachLocalized } from './_helpers.mjs';

// Grow every list in the site to its schema maximum + 1 (clones the last item, fresh ids).
function overfill(site) {
  let n = 0;
  const walk = (v, spec) => {
    if (!v || !spec) return;
    if (spec.t === 'obj') for (const [k, sub] of Object.entries(spec.shape)) walk(v[k], sub);
    else if (spec.t === 'arr' && Array.isArray(v)) {
      while (v.length && v.length < spec.max + 1) {
        const c = structuredClone(v[v.length - 1]);
        if (c && typeof c === 'object' && 'id' in c) c.id = `x${++n}`;
        v.push(c);
      }
      v.forEach((x) => walk(x, spec.item));
    }
  };
  walk(site, buildSchema());
  return site;
}

const CASES = [
  ['primary contact item deleted', (s) => { s.contact.items = s.contact.items.filter((i) => i.id !== s.sections.contact.primary); }],
  ['no contact items', (s) => { s.contact.items = []; }],
  ['no facts', (s) => { s.hero.facts = []; }],
  ['no skill groups', (s) => { s.sections.skills.groups = []; }],
  ['a skill group with no items', (s) => { s.sections.skills.groups[0].items = []; }],
  ['every Georgian string empty', (s) => { eachLocalized(s, (o) => { o.ka = ''; }); }],
  ['every list at its maximum + 1', (s) => { overfill(s); }],
];

for (const id of layoutIds()) {
  for (const [name, mutate] of CASES) {
    test(`${id}: renders without throwing when ${name}`, () => {
      const s = seed();
      mutate(s);
      const out = renderSite(s, renderArgs(id));
      assert.ok(out['index.html'].includes('</html>'));
      assert.ok(out['ka/index.html'].includes('</html>'));
    });
  }
}
