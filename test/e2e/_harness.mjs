// Harness for the admin end-to-end suite: builds the SPA once, creates ONE temp directory holding DATA_DIR,
// BUILDS_DIR and WEB_ROOT, runs `cli init` there, and runs admin/server/index.mjs on a free port with
// PUBLIC_ORIGIN = that origin (so the preview CSP and the bridge accept the admin page). The developer's
// ./data and ./dist are never touched.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const USERNAME = 'admin';
export const INITIAL_PASSWORD = 'initial-e2e-password-2026';
export const PASSWORD = 'owner-chosen-e2e-password';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function buildSpa() {
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'admin/web/vite.config.mjs', '--logLevel', 'warn'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vite build failed:\n${r.stdout}\n${r.stderr}`);
}

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Poll fn until it returns a truthy value; throws with `message` after `timeout` ms. */
export async function waitFor(fn, { timeout = 10_000, interval = 50, message = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms waiting for ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
    await sleep(interval);
  }
}

export async function createHarness() {
  const tmp = mkdtempSync(join(tmpdir(), 'sm-admin-e2e-'));
  const dirs = { DATA_DIR: join(tmp, 'data'), BUILDS_DIR: join(tmp, 'builds'), WEB_ROOT: join(tmp, 'web') };
  mkdirSync(dirs.WEB_ROOT, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // a clean environment: nothing from the developer's shell (.env.development is not read either)
  // GOOGLE_FONTS_FIXTURE: the font picker reads the catalogue from test/fixtures/google-fonts/ instead of
  // the network (dev only, dropped in production), so the suite never leaves the machine.
  const baseEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir(),
    NODE_ENV: 'development', SITE_URL: 'https://samsiani.me',
    GOOGLE_FONTS_FIXTURE: 'test/fixtures/google-fonts', ...dirs,
  };
  const init = spawnSync(process.execPath, ['admin/server/cli.mjs', 'init'], { cwd: ROOT, env: baseEnv, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`cli init failed:\n${init.stdout}\n${init.stderr}`);
  const secret = randomBytes(48).toString('base64'); // the same across restarts, so open sessions survive them
  const logs = [];
  let proc = null;

  async function start(extraEnv = {}) {
    proc = spawn(process.execPath, ['admin/server/index.mjs'], {
      cwd: ROOT,
      env: { ...baseEnv, HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: origin, SESSION_SECRET: secret, ADMIN_INITIAL_PASSWORD: INITIAL_PASSWORD, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => logs.push(String(d)));
    proc.stderr.on('data', (d) => logs.push(String(d)));
    const me = proc;
    await waitFor(async () => {
      if (me.exitCode !== null) throw new Error(`the server exited:\n${logs.join('')}`);
      const r = await fetch(`${origin}/admin/api/health`).catch(() => null);
      return r?.ok;
    }, { timeout: 20_000, interval: 100, message: 'the admin server' });
  }

  async function stop() {
    const p = proc;
    if (!p || p.exitCode !== null) return;
    const exited = new Promise((r) => p.once('exit', r));
    p.kill('SIGTERM');
    await Promise.race([exited, sleep(10_000)]);
    if (p.exitCode === null) { p.kill('SIGKILL'); await exited; }
  }

  const browser = await chromium.launch();

  /** A fresh browser context (own cookies and storage) and page. */
  async function open({ width = 1280, height = 900, colorScheme = 'light', ...rest } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce', acceptDownloads: true, ...rest });
    const page = await context.newPage();
    return { context, page };
  }

  /** Sign in through the SPA's login screen and wait for the dashboard. */
  async function login(page, password = PASSWORD) {
    await page.goto(`${origin}/admin/`);
    await page.locator('#login-user').fill(USERNAME);
    await page.locator('#login-pass').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('main h1', { hasText: 'Dashboard' }).waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="draft-status"]').waitFor();
  }

  /** The admin API with the page's cookies (Origin and the CSRF header as the SPA sends them). */
  async function api(page, method, path, body) {
    const headers = { 'X-Requested-With': 'samsiani-admin', ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }) };
    const res = await page.request.fetch(`${origin}/admin/api${path}`, { method, headers, data: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status(), json, text };
  }

  const previewFrame = (page) => page.frames().find((f) => f.url().includes('/admin/preview/')) || null;

  /** Wait until the preview frame satisfies `fn` (evaluated inside the frame). */
  async function inPreview(page, fn, arg, opts = {}) {
    return waitFor(async () => {
      const f = previewFrame(page);
      if (!f) return false;
      return f.evaluate(fn, arg).catch(() => false);
    }, { timeout: 10_000, message: 'the preview frame', ...opts });
  }

  const status = (page) => page.locator('[data-testid="draft-status"]').innerText();
  async function waitSaved(page, timeout = 15_000) {
    return waitFor(async () => /^Saved · r\d+/.test((await status(page)).trim()), { timeout, message: 'the draft status "Saved"' });
  }

  const readData = (name) => JSON.parse(readFileSync(join(dirs.DATA_DIR, name), 'utf8'));
  const webFile = (rel) => readFileSync(join(dirs.WEB_ROOT, rel));

  async function close() {
    await browser.close().catch(() => {});
    await stop();
    rmSync(tmp, { recursive: true, force: true });
  }

  return { tmp, dirs, port, origin, logs, start, stop, open, login, api, previewFrame, inPreview, status, waitSaved, readData, webFile, close, browser };
}
