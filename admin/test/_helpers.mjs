// Test helpers: temp data dirs, config, deps with an injectable clock, request helpers.
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { createDeps } from '../server/deps.mjs';
import { createApp } from '../server/app.mjs';
import { fixtureFetch } from '../server/lib/fonts/fixture.mjs';

export const SEED = JSON.parse(readFileSync(new URL('../../src/content/site.json', import.meta.url), 'utf8'));
export const seed = () => structuredClone(SEED);
export const B64_32 = Buffer.alloc(32, 7).toString('base64');
export const EDGE = Buffer.alloc(32, 9).toString('base64');

export function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'sm-admin-'));
  for (const d of ['data', 'web', 'builds']) mkdirSync(join(home, d), { recursive: true });
  return home;
}

export function makeClock(start = Date.parse('2026-09-15T10:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (ms) => { t = ms; } };
}

/**
 * cfg + deps + app on a fresh temp home. production: true switches on the edge secret and Secure cookies.
 * `google` swaps the Google Fonts fetch for the frozen fixture; `ctx.seen` then lists every URL the server
 * asked for, so a test can prove nothing reached the network.
 */
export async function setup({ production = false, clock = makeClock(), init = true, password = 'correct-horse-battery', mustChange = false, env = {}, google = false, offline = false } = {}) {
  const home = tempHome();
  const seen = [];
  const cfg = loadConfig({
    NODE_ENV: production ? 'production' : 'development',
    DATA_DIR: join(home, 'data'), WEB_ROOT: join(home, 'web'), BUILDS_DIR: join(home, 'builds'),
    SESSION_SECRET: B64_32, ...(production ? { EDGE_SECRET: EDGE, PUBLIC_ORIGIN: 'https://samsiani.me', __UID: 1000 } : {}),
    SITE_URL: 'https://samsiani.me', ...env,
  });
  const fetchImpl = google
    ? fixtureFetch(new URL('../../test/fixtures/google-fonts/', import.meta.url).pathname, { offline, seen })
    : () => { throw new Error('a test must never reach the network'); };
  const deps = createDeps(cfg, { clock, fetchImpl });
  if (init) await deps.store.init(seed());
  if (password) await deps.auth.setPassword(password, { username: 'admin', mustChangePassword: mustChange });
  const app = createApp(cfg, deps);
  return { home, cfg, deps, app, clock, seen };
}

const ORIGIN = (cfg) => cfg.publicOrigin;
// A Buffer or typed array is the body as it stands (the font upload route); anything else is JSON.
const bodyOf = (b) => (b === undefined ? undefined : typeof b === 'string' || ArrayBuffer.isView(b) ? b : JSON.stringify(b));

/** app.request with the standard admin headers; opts.cookie, opts.headers override */
export function req(ctx, method, path, { body, cookie, headers = {}, ip = '203.0.113.9', edge = ctx.cfg.production } = {}) {
  const h = { 'X-Requested-With': 'samsiani-admin', ...(method !== 'GET' ? { Origin: ORIGIN(ctx.cfg), 'Content-Type': 'application/json' } : {}), ...(edge ? { 'x-sm-edge': EDGE } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  return ctx.app.request(path, { method, headers: h, body: bodyOf(body) }, { remoteAddress: ip });
}

/** cookie header value from Set-Cookie lines (name=value pairs only) */
export function cookiesFrom(res, prev = '') {
  const jar = new Map(prev ? prev.split('; ').map((p) => p.split(/=(.*)/s).slice(0, 2)) : []);
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const [k, v] = pair.split(/=(.*)/s);
    if (/Max-Age=0/.test(line)) jar.delete(k); else jar.set(k, v);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

export async function login(ctx, { username = 'admin', password = 'correct-horse-battery', cookie = '', ip } = {}) {
  const res = await req(ctx, 'POST', '/admin/api/auth/login', { body: { username, password }, cookie, ip });
  return { res, cookie: cookiesFrom(res, cookie), json: await res.clone().json().catch(() => null) };
}
