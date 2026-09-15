import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { clientKey, createLimiter, originAllowed, ifMatchOk } from '../server/lib/guard.mjs';
import { loadConfig } from '../server/config.mjs';
import { setup, req, login, EDGE, B64_32, makeClock, cookiesFrom } from './_helpers.mjs';

const H = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

test('production: no x-sm-edge, a wrong one, or a doubled pair with one wrong part -> 403 edge', async () => {
  const ctx = await setup({ production: true });
  for (const edge of [null, 'wrong', `${EDGE}, wrong`]) {
    const res = await req(ctx, 'GET', '/admin/api/session', { edge: false, headers: edge ? { 'x-sm-edge': edge } : {} });
    assert.equal(res.status, 403, String(edge));
    assert.equal((await res.json()).error, 'edge');
  }
  const ok = await req(ctx, 'GET', '/admin/api/session', { edge: false, headers: { 'x-sm-edge': `${EDGE}, ${EDGE}` } });
  assert.equal(ok.status, 200, 'a doubled correct value passes');
  assert.equal((await req(ctx, 'GET', '/admin/', { edge: false })).status, 403, 'the SPA is behind the edge check too');
});

test('GET /admin/api/health passes without the edge header', async () => {
  const ctx = await setup({ production: true });
  const res = await req(ctx, 'GET', '/admin/api/health', { edge: false, headers: { 'X-Requested-With': null } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('Origin: doubled accepted; mixed, null or missing refused', () => {
  const A = new Set(['https://samsiani.me']);
  assert.equal(originAllowed('https://samsiani.me, https://samsiani.me', A), true);
  assert.equal(originAllowed('https://samsiani.me, https://evil.example', A), false);
  assert.equal(originAllowed('null', A), false);
  assert.equal(originAllowed(undefined, A), false);
});

test('CSRF layers on the API', async () => {
  const ctx = await setup();
  const { cookie } = await login(ctx);
  const post = (headers) => req(ctx, 'POST', '/admin/api/validate', { cookie, body: {}, headers });
  assert.equal((await post({ Origin: null })).status, 403, 'missing Origin');
  assert.equal((await post({ 'X-Requested-With': null })).status, 403, 'missing X-Requested-With');
  assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ 'X-Requested-With': 'samsiani-admin, samsiani-admin' })).status, 200, 'doubled X-Requested-With');
  assert.equal((await post({ 'X-Requested-With': 'samsiani-admin, other' })).status, 403, 'mixed X-Requested-With');
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-origin, same-origin' })).status, 200, 'doubled Sec-Fetch-Site');
  assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
});

test('If-Match: weak and doubled forms accepted when every part is valid', () => {
  assert.equal(ifMatchOk('W/"abc"', 'abc'), true);
  assert.equal(ifMatchOk('"abc", "abc"', 'abc'), true);
  assert.equal(ifMatchOk('"abc", W/"abc"', 'abc'), true);
  assert.equal(ifMatchOk('"abc", "xyz"', 'abc'), false);
});

test('CF-Connecting-IP is used only from the loopback proxy; IPv6 keyed by /64', () => {
  assert.equal(clientKey('127.0.0.1', H({ 'cf-connecting-ip': '198.51.100.4, 198.51.100.4' })), '198.51.100.4');
  assert.equal(clientKey('203.0.113.9', H({ 'cf-connecting-ip': '198.51.100.4' })), '203.0.113.9', 'a direct peer cannot pick its key');
  assert.equal(clientKey('127.0.0.1', H({ 'cf-connecting-ip': '2001:db8:aa:bb:1:2:3:4' })), '2001:db8:aa:bb::/64');
  assert.equal(clientKey('127.0.0.1', H({ 'cf-connecting-ip': '2001:db8:aa:bb::9' })), '2001:db8:aa:bb::/64');
});

test('5 failures lock a client; 60 per hour lock everyone without a device cookie', () => {
  const clock = makeClock();
  const lim = createLimiter({ clock });
  for (let i = 0; i < 5; i++) { assert.equal(lim.loginAllowed({ client: 'a' }).ok, true); lim.loginFailed({ client: 'a' }); }
  assert.equal(lim.loginAllowed({ client: 'a' }).ok, false);
  clock.advance(15 * 60_000 + 1000);
  assert.equal(lim.loginAllowed({ client: 'a' }).ok, true, 'the window drains');
  for (let i = 0; i < 60; i++) lim.loginFailed({ client: `c${i}` });
  assert.equal(lim.loginAllowed({ client: 'fresh' }).ok, false, 'global lock');
  assert.equal(lim.loginAllowed({ client: 'fresh', device: 'dev1' }).ok, true, 'a known device still logs in');
  for (let i = 0; i < 5; i++) lim.loginFailed({ client: 'x', device: 'dev1' });
  assert.equal(lim.loginAllowed({ client: 'x', device: 'dev1' }).ok, false, 'the device has its own lock');
});

test('a valid device cookie logs in during the global lock; a forged one counts as none', async () => {
  const ctx = await setup();
  const first = await login(ctx, { ip: '198.51.100.1' });
  const device = first.cookie.split('; ').find((c) => c.startsWith('sm_dev='));
  for (let i = 0; i < 60; i++) ctx.deps.limiter.loginFailed({ client: `10.0.${i}.1` });
  assert.equal((await login(ctx, { ip: '198.51.100.2' })).res.status, 429, 'new browser refused');
  assert.equal((await login(ctx, { ip: '198.51.100.2', cookie: device })).res.status, 200, 'known browser admitted');
  const forged = 'sm_dev=v1.AAAAAAAAAAAAAAAAAAAAAA.' + Buffer.alloc(32).toString('base64url');
  assert.equal((await login(ctx, { ip: '198.51.100.3', cookie: forged })).res.status, 429, 'forged device cookie = none');
});

test('limits are checked before scrypt', async () => {
  const ctx = await setup();
  for (let i = 0; i < 5; i++) ctx.deps.limiter.loginFailed({ client: '198.51.100.50' });
  const t = Date.now();
  const r = await login(ctx, { ip: '198.51.100.50' });
  assert.equal(r.res.status, 429);
  assert.ok(Date.now() - t < 100, 'no password hash was computed');
});

test('production boot refuses without EDGE_SECRET, with a short SESSION_SECRET, or as root', () => {
  const base = { NODE_ENV: 'production', SESSION_SECRET: B64_32, EDGE_SECRET: EDGE, PUBLIC_ORIGIN: 'https://samsiani.me', DATA_DIR: '/tmp', WEB_ROOT: '/tmp', __UID: 1000 };
  assert.doesNotThrow(() => loadConfig(base));
  assert.throws(() => loadConfig({ ...base, EDGE_SECRET: '' }), /EDGE_SECRET/);
  assert.throws(() => loadConfig({ ...base, SESSION_SECRET: Buffer.alloc(8).toString('base64') }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...base, __UID: 0 }), /refusing to run as root/);
  assert.throws(() => loadConfig({ ...base, NODE_APP_INSTANCE: '1' }), /cluster/);
});

test('the service process exits 1 when production config is incomplete', () => {
  const r = spawnSync(process.execPath, ['admin/server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: B64_32, EDGE_SECRET: '', DATA_DIR: '/tmp', WEB_ROOT: '/tmp' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /EDGE_SECRET|root/);
});
