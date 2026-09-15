// Admin service entry point (PM2). Listens on 127.0.0.1 only; the public site never depends on it.
import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './config.mjs';
import { createDeps } from './deps.mjs';
import { createApp } from './app.mjs';
import { createBackup } from './lib/backup.mjs';
import { cleanupTemp, exists } from './lib/fsx.mjs';
import { withFileLock } from './lib/lock.mjs';

process.umask(0o022);
let cfg;
try { cfg = loadConfig(process.env); }
catch (e) { if (e instanceof ConfigError) { console.error(`samsiani-admin: ${e.message}`); process.exit(1); } throw e; }

const counts = {};
const deps = createDeps(cfg, {
  log: (line) => console.log(line),
  countRejected: (st) => { counts[st] = (counts[st] || 0) + 1; },
});
setInterval(() => {
  const k = Object.keys(counts);
  if (!k.length) return;
  console.log(`rejected ${[401, 403, 413, 429].map((s) => `${s}=${counts[s] || 0}`).join(' ')}`);
  for (const s of k) delete counts[s];
}, 60_000).unref();

await cleanupTemp({ dataDir: cfg.dataDir, buildsDir: cfg.buildsDir });

// first boot: the initial admin credential, only when nothing was ever published
const hasAuth = await deps.auth.hasAuth();
const everPublished = await exists(join(cfg.dataDir, 'publish-state.json'));
if (!hasAuth && !everPublished && cfg.adminInitialPassword && cfg.adminInitialPassword.length >= 12) {
  await deps.auth.setPassword(cfg.adminInitialPassword, { username: cfg.adminUsername, mustChangePassword: true });
  console.log('initial admin credential created; remove ADMIN_INITIAL_PASSWORD from admin.env');
} else if (!hasAuth) {
  console.log('no admin account: login answers 503 until `cli set-password` creates one');
} else if (cfg.adminInitialPassword) {
  console.warn('ADMIN_INITIAL_PASSWORD is still set; it is ignored now, remove it from admin.env');
}

if (deps.reconcile) await deps.reconcile(); // M6: finish or revert an interrupted publish before listening

const backup = createBackup({ dataDir: cfg.dataDir, store: deps.store, release: cfg.release, paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, audit: deps.audit });
const housekeeping = async () => {
  await backup.daily().catch((e) => console.error(`backup failed: ${e.message}`));
  await deps.auth.pruneSessions().catch(() => {});
};
if (await exists(join(cfg.dataDir, 'site.json'))) await housekeeping();
setInterval(housekeeping, 3600_000).unref();
setInterval(() => deps.limiter.sweep(), 600_000).unref();

const app = createApp(cfg, deps);
const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  console.log(`samsiani-admin ${cfg.release} listening on ${cfg.host}:${info.port} (${cfg.production ? 'production' : 'development'})`);
  process.send?.('ready');
});
await deps.audit.log('boot', { detail: cfg.release });

const stop = async (sig) => {
  console.log(`${sig}: stopping`);
  server.close();
  const deadline = Date.now() + 8000;
  // wait for a publish in progress (the lockfile) before exiting
  try { await withFileLock(join(cfg.dataDir, 'locks'), 'publish', async () => {}, { timeoutMs: Math.max(0, deadline - Date.now()) }); } catch {}
  process.exit(0);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
