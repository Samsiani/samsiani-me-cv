import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setup, req, login, seed } from './_helpers.mjs';

test('POST /og-preview returns a 1200x630 PNG and fills the brand cache', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  for (const lang of ['en', 'ka']) {
    const r = await req(ctx, 'POST', '/admin/api/og-preview', { cookie, body: { lang } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.readUInt32BE(16), 1200); assert.equal(buf.readUInt32BE(20), 630);
  }
  assert.ok(readdirSync(join(ctx.cfg.dataDir, 'brand-cache')).some((n) => /^og-ka\.[0-9a-f]{8}\.png$/.test(n)));
});

test('a publish ships content-named cards; changing a fact renames the cards, not the icons', async () => {
  const ctx = await setup({ password: null });
  const pub = async () => ctx.deps.publisher.publish({ source: 'draft', ifMatch: (await ctx.deps.store.getDraft()).etag, acknowledgeWarnings: true });
  const a = await pub();
  assert.ok(existsSync(join(ctx.cfg.webRoot, a.og.en)));
  const d = await ctx.deps.store.getDraft();
  const s = structuredClone(d.site); s.hero.facts[0].value.en = '11+';
  await ctx.deps.store.saveDraft(s, { ifMatch: d.etag });
  const b = await pub();
  assert.notEqual(b.og.en, a.og.en);
  assert.ok(existsSync(join(ctx.cfg.webRoot, b.og.en)));
  const icons = (dir) => readdirSync(dir).filter((n) => /^(favicon-32|icon-192|icon-512|apple-touch-icon)\./.test(n)).sort();
  assert.deepEqual(icons(join(ctx.cfg.buildsDir, a.buildId)), icons(join(ctx.cfg.buildsDir, b.buildId)));
});
