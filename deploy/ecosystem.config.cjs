// Evaluated by the PM2 CLI (root) as /opt/samsiani-admin/shared/ecosystem.config.cjs. Server facts
// and secrets come from the root-only env files next to it; nothing server-specific is in git.
// The deploy job writes this file from its own checkout; it never travels in the release artifact.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { resolve } = require('node:path');

const APP_HOME = resolve(__dirname, '..'); // /opt/samsiani-admin
const read = (f) => parseEnv(readFileSync(resolve(__dirname, f), 'utf8'));
const d = read('deploy.env');
const s = read('admin.env');
for (const k of ['SITE_USER', 'NODE_BIN', 'SITE_HOME', 'WEB_ROOT']) if (!d[k]) throw new Error(`deploy.env: ${k} is missing`);
for (const k of ['SESSION_SECRET', 'EDGE_SECRET']) if (!s[k]) throw new Error(`admin.env: ${k} is missing`);

const env = {
  NODE_ENV: 'production', HOST: '127.0.0.1', PORT: d.PORT || '3097',
  PUBLIC_ORIGIN: 'https://samsiani.me', SITE_URL: 'https://samsiani.me',
  SITE_HOME: d.SITE_HOME, WEB_ROOT: d.WEB_ROOT,
  SESSION_SECRET: s.SESSION_SECRET, EDGE_SECRET: s.EDGE_SECRET,
};
// Optional keys are always present, '' when unset: PM2 keeps a variable that disappears from the
// file on reload, so a removed secret must be overwritten, not dropped. The app treats '' as unset.
for (const k of ['SESSION_SECRET_PREV', 'ADMIN_INITIAL_PASSWORD', 'ADMIN_USERNAME', 'CF_API_TOKEN', 'CF_ZONE_ID']) env[k] = s[k] ?? '';

module.exports = {
  apps: [{
    name: 'samsiani-admin',
    cwd: resolve(APP_HOME, 'current'),
    script: 'admin/server/index.mjs',
    interpreter: d.NODE_BIN,
    exec_mode: 'fork',
    instances: 1,
    uid: d.SITE_USER,
    gid: d.SITE_USER,
    filter_env: true, // inherit nothing from the root shell that runs pm2
    env,
    wait_ready: true, // index.mjs calls process.send('ready') after listen
    listen_timeout: 10000,
    kill_timeout: 10000, // lets an in-flight publish finish (index.mjs waits up to 8 s)
    max_memory_restart: '400M',
    exp_backoff_restart_delay: 200,
    max_restarts: 20,
    min_uptime: 5000,
    autorestart: true,
    watch: false,
    time: true,
    merge_logs: true,
    out_file: resolve(APP_HOME, 'logs', 'samsiani-admin.out.log'),
    error_file: resolve(APP_HOME, 'logs', 'samsiani-admin.err.log'),
  }],
};
