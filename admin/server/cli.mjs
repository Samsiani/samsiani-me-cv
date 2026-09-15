// Admin CLI (admin-ops.md §10.3). Runs as the site user on the server, or locally with ./data.
//   node admin/server/cli.mjs <init|migrate [--dry-run]|verify|set-password [--username=]|backup [--name=]|
//                              restore-backup (--date=YYYY-MM-DD|--file=path) --part=draft|published|all|
//                              export [--source=draft|published]|import --file=path>
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './config.mjs';
import { createDeps } from './deps.mjs';
import { createBackup } from './lib/backup.mjs';
import { BUILD_ID_RE } from './lib/store.mjs';
import { passwordProblem } from './lib/auth.mjs';
import { AppError } from './lib/errors.mjs';
import { validate } from '../../src/schema/validate.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { loadPalettes, checkPalettes } from '../../src/palettes.mjs';

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const a = rest.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

let cfg;
try { cfg = loadConfig(process.env, { cli: true }); } catch (e) { if (e instanceof ConfigError) die(`cli: ${e.message}`); throw e; }
const deps = createDeps(cfg);
const { store, auth, audit } = deps;
const backup = () => createBackup({ dataDir: cfg.dataDir, store, release: cfg.release, paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, audit });

async function newestBuildSite() {
  let names = [];
  try { names = (await readdir(cfg.buildsDir)).filter((n) => BUILD_ID_RE.test(n)).sort().reverse(); } catch { return null; }
  for (const n of names) {
    const f = join(cfg.buildsDir, n, '.site.json');
    if (existsSync(f)) return { buildId: n, site: JSON.parse(await readFile(f, 'utf8')) };
  }
  return null;
}

async function healthAnswers() {
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/admin/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// Reads a password without echo on a terminal; from a pipe it reads one line. NEW_PASSWORD serves scripts and tests.
async function readSecret(prompt) {
  if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD;
  process.stderr.write(prompt);
  const tty = process.stdin.isTTY;
  if (tty) process.stdin.setRawMode(true);
  let s = '';
  for await (const chunk of process.stdin) {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\r' || ch === '\n') { if (tty) process.stdin.setRawMode(false); process.stderr.write('\n'); return s; }
      if (ch === CTRL_C) die('\ncancelled');
      if (ch === BACKSPACE) s = s.slice(0, -1);
      else s += ch;
    }
  }
  return s;
}

const WRITING = new Set(['publish', 'rollback', 'restore-build', 'set-password', 'import', 'restore-backup', 'migrate']);
if (WRITING.has(cmd) && existsSync(join(cfg.dataDir, 'publish-state.json'))) {
  const r = await deps.publisher.reconcile();
  if (r.action !== 'none') console.log(`reconcile: ${r.action} ${r.buildId}`);
}

try {
  switch (cmd) {
    case 'publish': {
      const source = flag('source') === 'published' ? 'published' : 'draft';
      const reason = typeof flag('reason') === 'string' ? flag('reason') : 'cli';
      const opts = { source, reason, ifChanged: !!flag('if-changed'), acknowledgeWarnings: true, lockTimeoutMs: 120_000 };
      if (source === 'draft') opts.ifMatch = (await store.getDraft()).etag;
      const out = await deps.publisher.publish(opts);
      console.log(out.unchanged ? 'publish: web root already matches; nothing changed' : `published r${out.publishedRev} as ${out.buildId}: ${out.changedFiles} file(s) changed in ${out.durationMs} ms`);
      break;
    }
    case 'rollback': {
      const out = await deps.publisher.rollback({ buildId: typeof flag('to') === 'string' ? flag('to') : undefined, lockTimeoutMs: 120_000 });
      console.log(`rolled back to ${out.current} (r${out.rev})`);
      break;
    }
    case 'builds': {
      for (const b of await deps.publisher.listBuilds()) console.log(`${b.current ? '*' : ' '} ${b.buildId}  r${b.rev}  ${b.layout}/${b.palette}  ${b.files} files  ${b.bytes} B`);
      break;
    }
    case 'restore-build': {
      const id = flag('from');
      if (typeof id !== 'string' || !BUILD_ID_RE.test(id)) die('restore-build needs --from=<buildId>');
      const site = JSON.parse(await readFile(join(cfg.buildsDir, id, '.site.json'), 'utf8'));
      const out = await store.importDraft(site, { actor: 'cli' });
      console.log(`draft replaced with the content of ${id} (r${out.rev}); publish to put it live`);
      break;
    }
    case 'init': {
      if (existsSync(join(cfg.dataDir, 'site.json')) && existsSync(join(cfg.dataDir, 'draft.json'))) {
        console.log(`data already initialised in ${cfg.dataDir}; nothing changed`);
        break;
      }
      // init never migrates; when data/ is gone but a build exists, it restores from that build instead of the seed
      const fromBuild = await newestBuildSite();
      const site = fromBuild ? fromBuild.site : JSON.parse(await readFile(cfg.seedFile, 'utf8'));
      const r = await store.init(site, { source: fromBuild ? `build ${fromBuild.buildId}` : 'seed' });
      console.log(r.created ? `initialised ${cfg.dataDir} from ${fromBuild ? `build ${fromBuild.buildId}` : 'the seed'}` : 'nothing changed');
      break;
    }
    case 'migrate': {
      const pending = [];
      for (const [name, get] of [['draft', () => store.getDraft()], ['published', () => store.getPublished()]]) {
        const d = await get().catch(() => null);
        if (d && d.site?.schemaVersion !== 1) pending.push(name);
      }
      if (flag('dry-run')) {
        console.log(pending.length ? `pending migrations: ${pending.join(', ')}` : 'no pending migrations');
        process.exit(pending.length ? 10 : 0);
      }
      if (await healthAnswers()) die('the admin service is running; stop it before migrating', 2);
      if (!pending.length) { console.log('no pending migrations'); break; }
      die(`documents at an unknown schema version: ${pending.join(', ')}; no migration is defined yet`);
      break;
    }
    case 'verify': {
      const problems = [];
      const pub = await store.getPublished().catch((e) => { problems.push(`site.json: ${e.message}`); return null; });
      if (pub) {
        const v = validate(pub.site, { mode: 'build', paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, today: store.today() });
        if (v.errors.length) problems.push(`published document has ${v.errors.length} error(s)`);
      }
      await store.getDraft().catch((e) => problems.push(`draft.json: ${e.message}`));
      for (const { meta } of Object.values(LAYOUTS)) {
        for (const f of meta.fonts) if (!existsSync(join(cfg.root, 'src/fonts', f + '.woff2'))) problems.push(`font missing: ${f}`);
      }
      const gate = checkPalettes(loadPalettes());
      if (gate.failed) problems.push(`palette gate: ${gate.failed} failed`);
      if (existsSync(cfg.buildsDir) && existsSync(cfg.webRoot)) {
        const [a, b] = await Promise.all([stat(cfg.buildsDir), stat(cfg.webRoot)]);
        if (a.dev !== b.dev) problems.push('builds and the web root are on different filesystems (the hard-link swap needs one)');
      }
      if (flag('web-root')) {
        const w = await deps.publisher.verifyWebRoot();
        if (w.differ.length) problems.push(`web root differs from ${w.current} in ${w.differ.length} file(s): ${w.differ.slice(0, 8).join(', ')}`);
      }
      if (problems.length) die(`verify: ${problems.join('; ')}`);
      console.log('verify: ok');
      break;
    }
    case 'set-password': {
      const username = typeof flag('username') === 'string' ? flag('username') : (await auth.readAuth())?.username || cfg.adminUsername;
      const pw = await readSecret(`new password for ${username}: `);
      const problem = passwordProblem(pw, { username });
      if (problem) die(`password rejected: ${problem === 'length' ? 'use 12 to 128 characters' : 'must not be the username'}`);
      await auth.setPassword(pw, { username, mustChangePassword: false });
      await audit.log('password_changed', { detail: 'cli set-password; all sessions revoked' });
      console.log(`password set for ${username}; every session was signed out`);
      break;
    }
    case 'backup': {
      const name = typeof flag('name') === 'string' ? flag('name') : undefined;
      console.log(`wrote ${await backup().write(name)}`);
      break;
    }
    case 'restore-backup': {
      const part = typeof flag('part') === 'string' ? flag('part') : 'all';
      const file = typeof flag('file') === 'string' ? flag('file')
        : typeof flag('date') === 'string' ? join(cfg.dataDir, 'backups', `${flag('date')}.json.gz`) : null;
      if (!file) die('restore-backup needs --date=YYYY-MM-DD or --file=path');
      const r = await backup().restore(file, part);
      console.log(`restored ${r.restored.join(', ')}${part !== 'draft' ? ' (publish again to put it live)' : ''}`);
      break;
    }
    case 'export': {
      const source = flag('source') === 'published' ? 'published' : 'draft';
      const doc = source === 'draft' ? await store.getDraft() : await store.getPublished();
      const out = { format: 'samsiani.me/site', schemaVersion: 1, source, rev: doc.rev, exportedAt: new Date().toISOString(), site: doc.site };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      break;
    }
    case 'import': {
      if (typeof flag('file') !== 'string') die('import needs --file=path');
      const body = JSON.parse(await readFile(flag('file'), 'utf8'));
      const out = await store.importDraft(body.format === 'samsiani.me/site' ? body.site : body, { actor: 'cli' });
      console.log(`draft replaced (r${out.rev}); ${out.validation.errors.length} error(s), ${out.validation.warnings.length} warning(s)`);
      break;
    }
    default:
      die('usage: cli.mjs <init|migrate [--dry-run]|verify [--web-root]|set-password [--username=]|backup [--name=]|restore-backup (--date=|--file=) --part=|export [--source=]|import --file=|publish [--source=draft|published] [--reason=] [--if-changed]|rollback [--to=]|builds|restore-build --from=>', 2);
  }
} catch (e) {
  if (e instanceof AppError) die(`${cmd}: ${e.message}${e.details?.errors ? ' ' + JSON.stringify(e.details.errors.slice(0, 5)) : ''}`);
  throw e;
}
await audit.flush();
