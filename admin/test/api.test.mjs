import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, req, login, cookiesFrom, seed } from './_helpers.mjs';

test('login sets exact cookie attributes (dev) and the device cookie', async () => {
  const ctx = await setup();
  const { res } = await login(ctx);
  assert.equal(res.status, 200);
  const lines = res.headers.getSetCookie();
  const sess = lines.find((l) => l.startsWith('sm_admin='));
  assert.match(sess, /; Path=\/admin; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  const dev = lines.find((l) => l.startsWith('sm_dev='));
  assert.match(dev, /Path=\/admin\/api\/auth; HttpOnly; SameSite=Strict; Max-Age=34560000/);
});

test('production cookies are __Secure- and Secure', async () => {
  const ctx = await setup({ production: true });
  const { res } = await login(ctx);
  const lines = res.headers.getSetCookie();
  assert.ok(lines.some((l) => l.startsWith('__Secure-sm_admin=') && /; HttpOnly; Secure; SameSite=Strict/.test(l) && /Path=\/admin;/.test(l)));
  assert.ok(lines.some((l) => l.startsWith('__Secure-sm_dev=') && /Secure/.test(l)));
});

test('401 without a cookie; the mustChangePassword gate', async () => {
  const ctx = await setup({ mustChange: true });
  assert.equal((await req(ctx, 'GET', '/admin/api/draft')).status, 401);
  const { cookie } = await login(ctx);
  const res = await req(ctx, 'GET', '/admin/api/draft', { cookie });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'password_change_required');
  const pw = await req(ctx, 'POST', '/admin/api/auth/password', { cookie, body: { currentPassword: 'correct-horse-battery', newPassword: 'a-brand-new-password' } });
  assert.equal(pw.status, 204);
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie: cookiesFrom(pw, cookie) })).status, 200);
});

test('weak new passwords are refused', async () => {
  const ctx = await setup({ mustChange: true });
  const { cookie } = await login(ctx);
  for (const newPassword of ['short', 'admin', 'correct-horse-battery']) {
    const r = await req(ctx, 'POST', '/admin/api/auth/password', { cookie, body: { currentPassword: 'correct-horse-battery', newPassword } });
    assert.equal(r.status, 400, newPassword);
  }
});

test('draft GET/PUT with If-Match; 428 and 412; structural errors rejected, content errors stored', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const g = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  assert.equal(g.dirty, false);
  const s = structuredClone(g.site);
  s.hero.tagline.ka = '';
  assert.equal((await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s } })).status, 428);
  assert.equal((await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': '"stale"' } })).status, 412);
  const ok = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': `W/"${g.etag}"` } });
  assert.equal(ok.status, 200, 'weak If-Match accepted');
  const body = await ok.json();
  assert.ok(body.validation.errors.some((e) => e.code === 'EMPTY' && e.path === '$.hero.tagline.ka'));
  assert.equal(body.dirty, true);
  const ru = structuredClone(s); ru.hero.role.ru = 'x';
  const bad = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: ru }, headers: { 'If-Match': `"${body.etag}"` } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'draft_rejected');
});

test('an imported settings.siteUrl of another origin is replaced by SITE_URL', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const s = seed(); s.settings.siteUrl = 'https://evil.example';
  const r = await req(ctx, 'POST', '/admin/api/import', { cookie, body: { format: 'samsiani.me/site', schemaVersion: 1, site: s } });
  assert.equal(r.status, 200);
  const d = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  assert.equal(d.site.settings.siteUrl, 'https://samsiani.me');
});

test('settings.updated or siteUrl errors are draft_rejected', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const g = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  const s = structuredClone(g.site); s.settings.updated = '2026-06-07"><script>';
  const r = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': `"${g.etag}"` } });
  assert.equal(r.status, 400);
});

test('force save keeps a pre-overwrite revision; checkpoint with a posted site stores that document', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const s = seed(); s.hero.tagline.en = 'local copy from another device';
  const cp = await req(ctx, 'POST', '/admin/api/draft/checkpoint', { cookie, body: { note: 'my local copy', site: s } });
  assert.equal(cp.status, 201);
  const { id } = await cp.json();
  const rev = await (await req(ctx, 'GET', `/admin/api/revisions/${id}`, { cookie })).json();
  assert.equal(rev.site.hero.tagline.en, 'local copy from another device');
  assert.ok(rev.changes.some((c) => c.path === '$.hero.tagline.en'));
  const f = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s, force: true } });
  assert.equal(f.status, 200);
});

test('GET /registry has layouts, paletteHex and paletteMin', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const r = await (await req(ctx, 'GET', '/admin/api/registry', { cookie })).json();
  assert.deepEqual(r.layouts.map((l) => l.id), ['precision', 'studio', 'ledger']);
  assert.match(r.paletteHex.cobalt.light['--accent-ink'], /^#[0-9a-f]{6}$/);
  assert.ok(r.paletteMin.lime.studio >= 4.5);
  assert.ok(Array.isArray(r.limits) && r.limits.length > 50);
});

test('every /admin/ response has X-Robots-Tag; API is no-store; errors never leak stacks', async () => {
  const ctx = await setup();
  for (const [m, p] of [['GET', '/admin/api/health'], ['GET', '/admin/api/draft'], ['GET', '/admin/'], ['GET', '/admin/api/nope']]) {
    const r = await req(ctx, m, p);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
    const text = await r.text();
    assert.doesNotMatch(text, /at .*\.mjs:\d+/, p);
  }
  const spa = await req(ctx, 'GET', '/admin/');
  assert.match(spa.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('revision restore goes into the draft; bad revision ids are 404', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const s = seed(); s.hero.tagline.en = 'restore me';
  const { id } = await (await req(ctx, 'POST', '/admin/api/draft/checkpoint', { cookie, body: { note: 'x', site: s } })).json();
  const r = await req(ctx, 'POST', `/admin/api/revisions/${id}/restore`, { cookie, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).site.hero.tagline.en, 'restore me');
  assert.equal((await req(ctx, 'GET', '/admin/api/revisions/..%2Fx', { cookie })).status, 404);
});

test('export envelope and 413 above the import limit', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const e = await req(ctx, 'GET', '/admin/api/export?source=published', { cookie });
  assert.equal(e.status, 200);
  assert.match(e.headers.get('content-disposition'), /attachment; filename="samsiani-site-published-r1-\d{4}-\d{2}-\d{2}\.json"/);
  const big = JSON.stringify({ site: seed(), pad: 'x'.repeat(330 * 1024) });
  assert.equal((await req(ctx, 'POST', '/admin/api/import', { cookie, body: big })).status, 413);
});

test('publish: 409 without acknowledging warnings, 400 with errors, 200 then 0 changed files', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  let g = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  const s = structuredClone(g.site);
  s.meta.title.en = 'Giorgi Samsiani — Full-Stack Web Developer · WordPress, WooCommerce, Next.js, Laravel';
  let put = await (await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': `"${g.etag}"` } })).json();
  assert.ok(put.validation.warnings.some((w) => w.code === 'LONG'));
  const noAck = await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: false }, headers: { 'If-Match': `"${put.etag}"` } });
  assert.equal(noAck.status, 409);
  const e = structuredClone(s); e.hero.tagline.ka = '';
  put = await (await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: e }, headers: { 'If-Match': `"${put.etag}"` } })).json();
  const withErr = await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': `"${put.etag}"` } });
  assert.equal(withErr.status, 400);
  assert.equal((await withErr.json()).error, 'invalid');
  put = await (await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': `"${put.etag}"` } })).json();
  const ok = await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': `"${put.etag}"` } });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.ok(j.changedFiles > 0);
  assert.match(j.buildId, /^\d{8}T\d{6}Z-r\d+$/);
  g = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  const again = await (await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': `"${g.etag}"` } })).json();
  assert.equal(again.changedFiles, 0);
  const builds = await (await req(ctx, 'GET', '/admin/api/builds', { cookie })).json();
  assert.equal(builds.items.filter((b) => b.current).length, 1);
});

test('publish with a stale If-Match is 412; rollback via the API', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  let g = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  assert.equal((await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': '"stale"' } })).status, 412);
  await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': `"${g.etag}"` } });
  const s = structuredClone(g.site); s.settings.palette = 'lime';
  const put = await (await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site: s }, headers: { 'If-Match': `"${g.etag}"` } })).json();
  await req(ctx, 'POST', '/admin/api/publish', { cookie, body: { acknowledgeWarnings: true }, headers: { 'If-Match': `"${put.etag}"` } });
  const rb = await req(ctx, 'POST', '/admin/api/builds/rollback', { cookie, body: {} });
  assert.equal(rb.status, 200);
  assert.equal((await ctx.deps.store.getPublished()).site.settings.palette, 'cobalt');
});

test('the export envelope carries the current schema version; a v1 import comes back upgraded', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const env = await (await req(ctx, 'GET', '/admin/api/export', { cookie })).json();
  assert.equal(env.schemaVersion, 2);
  assert.equal(env.site.schemaVersion, 2);
  const old = seed();
  delete old.settings.sectionOrder;
  for (const sec of Object.values(old.sections)) delete sec.hidden;
  old.schemaVersion = 1;
  old.hero.tagline.en = 'Exported by an older release.';
  const r = await req(ctx, 'POST', '/admin/api/import', { cookie, body: { format: 'samsiani.me/site', schemaVersion: 1, site: old } });
  assert.equal(r.status, 200);
  const d = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  assert.equal(d.site.schemaVersion, 2);
  assert.ok(Array.isArray(d.site.settings.sectionOrder));
  assert.equal(d.site.sections.contact.hidden, false);
});
