// Configuration from the environment (admin-ops.md §9.3). An empty string counts as unset.
import { resolve, join } from 'node:path';
import { readFileSync, accessSync, constants } from 'node:fs';

const ROOT = resolve(new URL('../../', import.meta.url).pathname);
const val = (env, k) => (env[k] === undefined || env[k] === '' ? undefined : env[k]);
const b64len = (s) => { try { return Buffer.from(s, 'base64').length; } catch { return 0; } };

export class ConfigError extends Error {}

/**
 * @param {object} env  process.env or a test object
 * @param {{ cli?: boolean }} opts  the CLI never needs SESSION_SECRET
 */
export function loadConfig(env = process.env, { cli = false } = {}) {
  const production = val(env, 'NODE_ENV') === 'production';
  const siteHome = val(env, 'SITE_HOME');
  const cfg = {
    production,
    cli,
    host: val(env, 'HOST') || '127.0.0.1',
    port: Number(val(env, 'PORT') || 3097),
    publicOrigin: val(env, 'PUBLIC_ORIGIN') || (production ? 'https://samsiani.me' : 'http://localhost:5173'),
    siteUrl: val(env, 'SITE_URL') || 'https://samsiani.me',
    dataDir: resolve(val(env, 'DATA_DIR') || (siteHome ? join(siteHome, 'data') : join(ROOT, 'data'))),
    webRoot: resolve(val(env, 'WEB_ROOT') || join(ROOT, 'dist')),
    buildsDir: resolve(val(env, 'BUILDS_DIR') || (siteHome ? join(siteHome, 'builds') : join(ROOT, '.builds'))),
    webDist: resolve(val(env, 'WEB_DIST') || join(ROOT, 'admin/web/dist')),
    seedFile: resolve(val(env, 'SEED_FILE') || join(ROOT, 'src/content/site.json')),
    release: val(env, 'RELEASE') || readRelease() || 'dev',
    sessionSecrets: [val(env, 'SESSION_SECRET'), val(env, 'SESSION_SECRET_PREV')].filter(Boolean).map((s) => Buffer.from(s, 'base64')),
    edgeSecret: val(env, 'EDGE_SECRET'),
    adminUsername: val(env, 'ADMIN_USERNAME') || 'admin',
    adminInitialPassword: val(env, 'ADMIN_INITIAL_PASSWORD'),
    cookieSecure: production ? true : val(env, 'COOKIE_SECURE') === 'true',
    cfApiToken: val(env, 'CF_API_TOKEN'),
    cfZoneId: val(env, 'CF_ZONE_ID'),
    allowRoot: val(env, 'ALLOW_ROOT') === '1',
    // Development and CI only: answer Google Fonts from test/fixtures/google-fonts instead of the network,
    // so the e2e harness and `npm run dev:server` never leave the machine. Ignored in production.
    googleFixture: production ? null : val(env, 'GOOGLE_FONTS_FIXTURE') || null,
    googleFixtureOffline: !production && val(env, 'GOOGLE_FONTS_FIXTURE_OFFLINE') === '1',
    root: ROOT,
  };
  cfg.cookieName = cfg.cookieSecure ? '__Secure-sm_admin' : 'sm_admin';
  cfg.deviceCookieName = cfg.cookieSecure ? '__Secure-sm_dev' : 'sm_dev';
  cfg.allowedOrigins = new Set([cfg.publicOrigin, ...(production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3097', `http://localhost:${cfg.port}`, `http://127.0.0.1:${cfg.port}`])]);

  if (!cli && !cfg.sessionSecrets.length && !production) {
    cfg.sessionSecrets = [Buffer.from('development-only-session-secret-change-me!!')]; // local dev convenience
  }
  if (production) {
    const problems = [];
    if (!cfg.allowRoot && typeof process.getuid === 'function' && (env.__UID ?? process.getuid()) === 0) problems.push('refusing to run as root (set ALLOW_ROOT=1 only for an emergency)');
    if (!cli && (!cfg.sessionSecrets.length || cfg.sessionSecrets[0].length < 32)) problems.push('SESSION_SECRET must be at least 32 bytes (base64)');
    if (!cli && (!cfg.edgeSecret || b64len(cfg.edgeSecret) < 32)) problems.push('EDGE_SECRET is required and must be at least 32 bytes (base64)');
    if (!cfg.publicOrigin.startsWith('https:')) problems.push('PUBLIC_ORIGIN must be https');
    if (val(env, 'NODE_APP_INSTANCE') !== undefined && val(env, 'NODE_APP_INSTANCE') !== '0') problems.push('cluster mode is not supported (NODE_APP_INSTANCE)');
    if (!cli) for (const [k, d] of [['DATA_DIR', cfg.dataDir], ['WEB_ROOT', cfg.webRoot]]) { try { accessSync(d, constants.W_OK); } catch { problems.push(`${k} ${d} is not writable`); } }
    if (problems.length) throw new ConfigError(problems[0]);
  }
  return cfg;
}

function readRelease() {
  try { return readFileSync(join(ROOT, 'RELEASE'), 'utf8').trim(); } catch { return null; }
}
