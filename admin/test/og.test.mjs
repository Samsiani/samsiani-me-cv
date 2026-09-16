import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
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

// ------------------------------------------------------------------ the cards in the chosen fonts (fonts plan §5.6, D8)
const FONT = (name) => readFileSync(new URL(`../../src/${name}`, import.meta.url));
const addFont = async (ctx, cookie, bytes, filename) => (await req(ctx, 'POST', '/admin/api/fonts/upload', {
  cookie, body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Font-Filename': filename, 'X-Font-Licence': 'attested' },
})).json();
const setFonts = async (ctx, cookie, roles) => {
  const d = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  const site = structuredClone(d.site);
  site.settings.fonts = { precision: { text: null, label: null, georgian: null, ...roles } };
  const res = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site }, headers: { 'If-Match': `"${d.etag}"` } });
  assert.equal(res.status, 200, await res.text());
};
const publishNow = async (ctx) => ctx.deps.publisher.publish({ source: 'draft', ifMatch: (await ctx.deps.store.getDraft()).etag, acknowledgeWarnings: true });

test('an uploaded TTF draws the cards under a new name; the icons keep the built-in face', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const before = await publishNow(ctx);
  const rec = await addFont(ctx, cookie, FONT('brand/fonts/NotoSansGeorgian-SemiBold.ttf'), 'NotoSansGeorgian-SemiBold.ttf');
  assert.ok(rec.faces.some((f) => f.kind === 'satori'), 'a TTF keeps its original bytes for the card renderer');
  await setFonts(ctx, cookie, { georgian: rec.id });
  const after = await publishNow(ctx);
  assert.notEqual(after.og.ka, before.og.ka, 'the Georgian card is drawn in the chosen face');
  assert.notEqual(after.og.en, before.og.en, 'and the English card carries Georgian glyphs too');
  assert.ok(existsSync(join(ctx.cfg.webRoot, after.og.ka)));
  const icons = (dir) => readdirSync(dir).filter((n) => /^(favicon-32|icon-192|icon-512|apple-touch-icon)\./.test(n)).sort();
  assert.deepEqual(icons(join(ctx.cfg.buildsDir, after.buildId)), icons(join(ctx.cfg.buildsDir, before.buildId)));
  const v = await (await req(ctx, 'POST', '/admin/api/validate', { cookie, body: {} })).json();
  assert.equal(v.warnings.some((w) => w.code === 'FONT_OG_DEFAULT'), false, 'nothing falls back');
});

test('a WOFF2 the card renderer cannot read warns and leaves the cards untouched', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const before = await publishNow(ctx);
  const rec = await addFont(ctx, cookie, FONT('fonts/ibm-plex-sans-latin-wght-100-700.woff2'), 'plex.woff2');
  assert.equal(rec.faces.some((f) => f.kind === 'satori'), false);
  await setFonts(ctx, cookie, { text: rec.id });
  const v = await (await req(ctx, 'POST', '/admin/api/validate', { cookie, body: {} })).json();
  const w = v.warnings.find((x) => x.code === 'FONT_OG_DEFAULT');
  assert.ok(w, JSON.stringify(v.warnings));
  assert.equal(w.path, '$.settings.fonts.precision.text');
  assert.match(w.msg, /social cards keep Chivo/);
  const after = await publishNow(ctx);
  assert.equal(after.og.en, before.og.en, 'the card is the same card, so it keeps its name and its bytes');
  assert.equal(after.og.ka, before.og.ka);
});

test('POST /og-preview draws with the chosen face', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const png = async () => Buffer.from(await (await req(ctx, 'POST', '/admin/api/og-preview', { cookie, body: { lang: 'ka' } })).arrayBuffer());
  const plain = await png();
  const rec = await addFont(ctx, cookie, FONT('brand/fonts/NotoSansGeorgian-Regular.ttf'), 'NotoSansGeorgian-Regular.ttf');
  await setFonts(ctx, cookie, { georgian: rec.id });
  const custom = await png();
  assert.equal(custom.readUInt32BE(16), 1200);
  assert.notEqual(Buffer.compare(plain, custom), 0, 'the preview follows the draft’s fonts');
});
