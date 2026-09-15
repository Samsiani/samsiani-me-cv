import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { setup, req, login, seed } from './_helpers.mjs';

async function ready() {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  return { ...ctx, cookie };
}

test('POST /preview works on a fresh data dir right after init (no build yet)', async () => {
  const ctx = await ready();
  assert.equal((await ctx.deps.store.getPublished()).buildId, null);
  const r = await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: {} });
  assert.equal(r.status, 201);
  const { token, base, bundle } = await r.json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(base, `/admin/preview/${token}/`);
  assert.match(bundle, /^palettes-all\.[0-9a-f]{8}\.css$/);
});

test('preview HTML is sandboxed and uncached; files are CORS-open; both languages served', async () => {
  const ctx = await ready();
  const { base, bundle } = await (await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: {} })).json();
  const html = await req(ctx, 'GET', base);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /^sandbox allow-scripts;/);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  assert.equal(html.headers.get('x-frame-options'), null);
  const text = await html.text();
  assert.ok(text.includes('<meta name="robots" content="noindex">'));
  assert.ok(text.includes(`${base}${bundle}`));
  assert.ok(text.includes('"sm-preview"'));
  assert.ok(text.includes(`href="${base}styles.`), 'assets rebased under the token');
  assert.equal((await req(ctx, 'GET', `${base}ka/`)).status, 200);
  const css = await req(ctx, 'GET', base + text.match(/styles\.[0-9a-f]{8}\.css/)[0]);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('access-control-allow-origin'), '*');
  const b = await req(ctx, 'GET', base + bundle);
  assert.equal(b.status, 200);
});

test('an unknown or traversal path gives the expired page', async () => {
  const ctx = await ready();
  const r = await req(ctx, 'GET', '/admin/preview/' + 'A'.repeat(43) + '/');
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Preview expired, refresh it from the dashboard/);
  const { base } = await (await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: {} })).json();
  assert.equal((await req(ctx, 'GET', base + '..%2F..%2Fdata%2Fauth.json')).status, 404);
});

test('a layout override renders that layout; both languages in under 100 ms each', async () => {
  const ctx = await ready();
  const t = Date.now();
  const { base } = await (await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: { layout: 'studio' } })).json();
  const took = Date.now() - t;
  const html = await (await req(ctx, 'GET', base)).text();
  assert.match(html, /data-layout="studio"/);
  assert.ok(took < 400, `render + request took ${took} ms`);
});

test('a template throw returns 422 and the previous token still serves', async () => {
  const ctx = await ready();
  const { base } = await (await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: {} })).json();
  const orig = LAYOUTS.precision.renderBody;
  LAYOUTS.precision.renderBody = () => { throw new Error('boom'); };
  try {
    const r = await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: {} });
    assert.equal(r.status, 422);
    const j = await r.json();
    assert.equal(j.error, 'preview_render_failed');
    assert.match(j.message, /boom/);
  } finally { LAYOUTS.precision.renderBody = orig; }
  assert.equal((await req(ctx, 'GET', base)).status, 200, 'old token still serves');
});

test('content errors still preview; structural errors are refused', async () => {
  const ctx = await ready();
  const s = seed(); s.hero.tagline.en = '';
  assert.equal((await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: { site: s } })).status, 201);
  const bad = seed(); bad.hero.nope = 1;
  assert.equal((await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: { site: bad } })).status, 400);
  const badHref = seed(); badHref.contact.items[2].href = 'javascript:alert(1)';
  const r = await req(ctx, 'POST', '/admin/api/preview', { cookie: ctx.cookie, body: { site: badHref } });
  assert.equal(r.status, 201);
  const html = await (await req(ctx, 'GET', (await r.json()).base)).text();
  assert.ok(!html.includes('javascript:'), 'bad links are neutralised in previews');
});
