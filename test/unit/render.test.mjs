import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../../src/render.mjs';
import { seed, layoutIds, renderArgs } from './_helpers.mjs';

for (const id of layoutIds()) {
  test(`${id}: same input renders identical output`, () => {
    const a = renderSite(seed(), renderArgs(id));
    const b = renderSite(seed(), renderArgs(id));
    assert.deepEqual(a, b);
  });

  test(`${id}: JSON-LD cannot be broken out of with </script>`, () => {
    const s = seed();
    s.meta.description.en = '</script><script>alert(1)</script>';
    const html = renderSite(s, renderArgs(id))['index.html'];
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ld, 'JSON-LD block present');
    assert.ok(ld[1].includes('\\u003c/script>'), 'the < is written as \\u003c inside JSON-LD');
    assert.ok(!html.includes('<script>alert(1)'), 'no executable injected script');
  });

  test(`${id}: HTML in the tagline is escaped`, () => {
    const s = seed();
    s.hero.tagline.en = '<img src=x onerror=alert(1)>';
    const html = renderSite(s, renderArgs(id))['index.html'];
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<img src=x'));
  });

  test(`${id}: a hostile updated date is escaped (no validation in between)`, () => {
    const s = seed();
    s.settings.updated = '2026-06-07"><script>x</script>';
    const out = renderSite(s, renderArgs(id));
    for (const [name, body] of Object.entries(out)) {
      assert.ok(!body.includes('<script>x'), `${name} contains a raw injected script`);
    }
  });
}
