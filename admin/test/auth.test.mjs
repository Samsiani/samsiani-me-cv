import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashPassword, verifyPassword, sign, unsign, parseHash, SCRYPT } from '../server/lib/auth.mjs';
import { setup, makeClock, req, login, B64_32 } from './_helpers.mjs';

test('hash/verify round trip; wrong password fails', async () => {
  const h = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong horse battery', h), false);
  assert.equal(parseHash(h).N, SCRYPT.N);
});

test('wrong username and wrong password each cost one scrypt (similar time)', async () => {
  const ctx = await setup();
  await ctx.deps.auth.ready();
  const t = async (u, p) => { const s = process.hrtime.bigint(); await ctx.deps.auth.checkCredentials(u, p); return Number(process.hrtime.bigint() - s) / 1e6; };
  const a = await t('nobody', 'whatever-long-pass'), b = await t('admin', 'whatever-long-pass');
  assert.ok(a > 100 && b > 100, `both ran scrypt (${a.toFixed(0)} ms, ${b.toFixed(0)} ms)`);
});

test('params upgrade re-hashes, but not over a hash written meanwhile', async () => {
  const ctx = await setup({ password: null });
  const weak = await hashPassword('correct-horse-battery', { N: 16384, r: 8, p: 1, keylen: 64 });
  const f = ctx.deps.auth.files.auth;
  writeFileSync(f, JSON.stringify({ v: 1, username: 'admin', hash: weak, mustChangePassword: false, epoch: 1, updatedAt: new Date().toISOString() }));
  assert.equal(await ctx.deps.auth.upgradeHashIfNeeded('correct-horse-battery', weak), true);
  assert.equal(parseHash(JSON.parse(readFileSync(f, 'utf8')).hash).N, SCRYPT.N);
  // simulate the CLI writing a new hash after verification
  const other = await hashPassword('another-password-123');
  writeFileSync(f, JSON.stringify({ v: 1, username: 'admin', hash: other, mustChangePassword: false, epoch: 2, updatedAt: new Date().toISOString() }));
  assert.equal(await ctx.deps.auth.upgradeHashIfNeeded('correct-horse-battery', weak), false);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).hash, other);
});

test('tampered cookies are rejected (payload, mac, version)', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const value = cookie.match(/sm_admin=([^;]+)/)[1];
  const [v, p, m] = value.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  const forged = [
    `${v}.${Buffer.from(JSON.stringify({ ...payload, iat: payload.iat + 1 })).toString('base64url')}.${m}`,
    `${v}.${p}.${Buffer.alloc(32).toString('base64url')}`,
    `v2.${p}.${m}`,
    `${v}.${p}`,
  ];
  for (const f of forged) {
    const res = await req(ctx, 'GET', '/admin/api/draft', { cookie: `sm_admin=${f}` });
    assert.equal(res.status, 401, f);
  }
});

test('idle 12 h and absolute 7 d expiry (injected clock)', async () => {
  const clock = makeClock();
  const ctx = await setup({ clock });
  let { cookie } = await login(ctx);
  clock.advance(12 * 3600_000 + 5000);
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie })).status, 401, 'idle expiry');
  ({ cookie } = await login(ctx));
  const { cookiesFrom } = await import('./_helpers.mjs');
  for (let step = 0; step < 27; step++) { // active every 6 h for 6.75 days: sliding keeps it alive
    clock.advance(6 * 3600_000);
    const res = await req(ctx, 'GET', '/admin/api/draft', { cookie });
    assert.equal(res.status, 200, `step ${step}`);
    cookie = cookiesFrom(res, cookie);
  }
  clock.advance(6 * 3600_000 + 60_000); // 7 days + 1 minute since login
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie })).status, 401, 'absolute expiry after 7 days');
});

test('an epoch bump invalidates every cookie; logout removes the sid', async () => {
  const ctx = await setup();
  const a = await login(ctx);
  const b = await login(ctx);
  const out = await req(ctx, 'POST', '/admin/api/auth/logout', { cookie: a.cookie, body: {} });
  assert.equal(out.status, 204);
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie: a.cookie })).status, 401, 'logged-out cookie');
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie: b.cookie })).status, 200);
  await ctx.deps.auth.setPassword('a-new-password-2026', {});
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie: b.cookie })).status, 401, 'epoch bumped');
});

test('SESSION_SECRET_PREV is accepted for verification', async () => {
  const payload = { sid: 'x', iat: 1, lat: 1, ep: 1 };
  const prev = Buffer.from('previous-secret-previous-secret-!!'), cur = Buffer.from(B64_32, 'base64');
  assert.deepEqual(unsign(sign(payload, prev), [cur, prev]), payload);
  assert.equal(unsign(sign(payload, prev), [cur]), null);
});

test('with the service running, cli set-password revokes the old cookie and the old password at once', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie })).status, 200);
  const r = spawnSync(process.execPath, ['admin/server/cli.mjs', 'set-password'], {
    env: { ...process.env, NODE_ENV: 'development', DATA_DIR: ctx.cfg.dataDir, WEB_ROOT: ctx.cfg.webRoot, BUILDS_DIR: ctx.cfg.buildsDir, NEW_PASSWORD: 'set-by-the-cli-2026' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie })).status, 401, 'old cookie refused on the next request');
  assert.equal((await login(ctx)).res.status, 401, 'old password refused');
  assert.equal((await login(ctx, { password: 'set-by-the-cli-2026', ip: '198.51.100.7' })).res.status, 200, 'new password works');
});

test('a sliding update never writes revoked sessions back', async () => {
  const clock = makeClock();
  const ctx = await setup({ clock });
  const { cookie } = await login(ctx);
  clock.advance(10 * 60_000); // past the 5-min sliding threshold
  await ctx.deps.auth.setPassword('another-password-2026', {}); // CLI-style reset: sessions emptied
  assert.equal((await req(ctx, 'GET', '/admin/api/draft', { cookie })).status, 401);
  assert.deepEqual(JSON.parse(readFileSync(ctx.deps.auth.files.sessions, 'utf8')).sessions, []);
});

test('auth.json is not re-created from ADMIN_INITIAL_PASSWORD once publish-state.json exists', async () => {
  const ctx = await setup({ password: null });
  writeFileSync(join(ctx.cfg.dataDir, 'publish-state.json'), '{}');
  const r = spawnSync(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 1500); await import("./admin/server/index.mjs")', '--input-type=module'], {
    env: { ...process.env, NODE_ENV: 'development', PORT: '0', DATA_DIR: ctx.cfg.dataDir, WEB_ROOT: ctx.cfg.webRoot, BUILDS_DIR: ctx.cfg.buildsDir, ADMIN_INITIAL_PASSWORD: 'initial-password-2026' },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(existsSync(ctx.deps.auth.files.auth), false, r.stdout + r.stderr);
});
