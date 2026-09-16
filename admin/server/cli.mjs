// Admin CLI (admin-ops.md §10.3). Runs as the site user on the server, or locally with ./data.
//   node admin/server/cli.mjs <init|migrate [--dry-run]|verify|set-password [--username=]|backup [--name=]|
//                              restore-backup (--date=YYYY-MM-DD|--file=path) --part=draft|published|all|
//                              export [--source=draft|published]|import --file=path>
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig, ConfigError } from './config.mjs';
import { createDeps } from './deps.mjs';
import { createBackup } from './lib/backup.mjs';
import { BUILD_ID_RE, sha256 } from './lib/store.mjs';
import { writeJsonAtomic } from './lib/fsx.mjs';
import { passwordProblem } from './lib/auth.mjs';
import { AppError } from './lib/errors.mjs';
import { validate, canonicalize } from '../../src/schema/validate.mjs';
import { SCHEMA_VERSION, canMigrate, migrateSite, upgrade } from '../../src/schema/migrate.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { loadPalettes, checkPalettes } from '../../src/palettes.mjs';

process.umask(0o022);
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

const [cmd, ...rest] = process.argv.slice(2);
// --name=value, --name value, or a bare --name (true)
const flag = (name) => {
  const i = rest.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const a = rest[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  const next = rest[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : true;
};
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

let cfg;
try { cfg = loadConfig(process.env, { cli: true }); } catch (e) { if (e instanceof ConfigError) die(`cli: ${e.message}`); throw e; }
const deps = createDeps(cfg);
const { store, auth, audit } = deps;
const backup = () => createBackup({ dataDir: cfg.dataDir, store, release: cfg.release, paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, audit });

// the newest build by its manifest's createdAt that still has its .site.json
async function newestBuild() {
  let names = [];
  try { names = (await readdir(cfg.buildsDir)).filter((n) => BUILD_ID_RE.test(n)); } catch { return null; }
  const builds = [];
  for (const n of names) {
    try { builds.push({ id: n, m: JSON.parse(await readFile(join(cfg.buildsDir, n, 'manifest.json'), 'utf8')) }); } catch {}
  }
  builds.sort((a, b) => (a.m.createdAt < b.m.createdAt ? 1 : -1));
  return builds[0] || null;
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
      const site = upgrade(JSON.parse(await readFile(join(cfg.buildsDir, id, '.site.json'), 'utf8')));
      const out = await store.importDraft(site, { actor: 'cli' });
      console.log(`draft replaced with the content of ${id} (r${out.rev}); publish to put it live`);
      break;
    }
    case 'brand': {
      const out = typeof flag('out') === 'string' ? flag('out') : null;
      if (!out) die('brand needs --out=<dir>');
      const { renderBrand } = await import('../../src/brand/render.mjs');
      const pals = loadPalettes();
      const site = structuredClone((await store.getDraft().catch(() => null))?.site ?? JSON.parse(await readFile(cfg.seedFile, 'utf8')));
      if (typeof flag('palette') === 'string') site.settings.palette = flag('palette');
      const pal = pals.palettes.find((p) => p.id === site.settings.palette) || pals.palettes.find((p) => p.id === pals.default);
      const b = await renderBrand(site, pal, (LAYOUTS[site.settings.layout] || LAYOUTS.precision).meta, {});
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(out, { recursive: true });
      for (const [n, buf] of b.files) await writeFile(join(out, n), buf);
      console.log(`wrote ${b.files.size} images (${pal.id}) to ${out}`);
      break;
    }
    case 'init': {
      if (existsSync(join(cfg.dataDir, 'site.json')) && existsSync(join(cfg.dataDir, 'draft.json'))) {
        console.log(`data already initialised in ${cfg.dataDir}; nothing changed`);
        break;
      }
      // init never migrates. When data/ is gone but builds exist, the newest build is restored (it is what is
      // live); re-seeding from the repository would publish stale content at the next re-render.
      const b = await newestBuild();
      if (b) {
        let site;
        try { site = JSON.parse(await readFile(join(cfg.buildsDir, b.id, '.site.json'), 'utf8')); }
        catch { die(`init: builds exist but ${b.id}/.site.json is unreadable; see runbooks R7 and R10`); }
        await store.init(site, { source: `build ${b.id}`, buildId: b.id, rev: b.m.rev ?? 1 });
        console.log(`::warning::data/ was missing; restored from build ${b.id}`);
      } else {
        const r = await store.init(JSON.parse(await readFile(cfg.seedFile, 'utf8')), { source: 'seed' });
        console.log(r.created ? `initialised ${cfg.dataDir} from the seed` : 'nothing changed');
      }
      break;
    }
    case 'migrate': {
      // The stored files are read raw here: every other read path upgrades the document it returns.
      const file = (n) => join(cfg.dataDir, n);
      const readEnv = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
      const pending = [];
      for (const [name, f] of [['draft', file('draft.json')], ['published', file('site.json')]]) {
        const d = await readEnv(f);
        if (d?.site && d.site.schemaVersion !== SCHEMA_VERSION) pending.push(name);
      }
      if (flag('dry-run')) {
        console.log(pending.length ? `pending migrations: ${pending.join(', ')}` : 'no pending migrations');
        process.exit(pending.length ? 10 : 0);
      }
      if (await healthAnswers()) die('the admin service is running; stop it before migrating', 2);
      if (!pending.length) { console.log('no pending migrations'); break; }
      // keep the draft as it stands before anything is rewritten (a revert restores the backup, not this)
      const before = await readEnv(file('draft.json'));
      const snap = before?.site ? await store.snapshot('pre-migrate', before.site, { actor: 'cli', rev: before.rev }) : null;
      const docs = [];
      const revDir = file('revisions');
      const revs = (await readdir(revDir).catch(() => [])).filter((n) => n.endsWith('.json') && n !== `${snap?.id}.json`);
      for (const f of [file('draft.json'), file('site.json'), ...revs.map((n) => join(revDir, n))]) {
        const env = await readEnv(f);
        if (env?.site) docs.push({ f, env });
      }
      const unknown = docs.filter((d) => !canMigrate(d.env.site));
      if (unknown.length) die(`documents at an unknown schema version: ${unknown.map((d) => basename(d.f)).join(', ')}; no migration is defined yet`);
      await store.lock('write', async () => {
        for (const { f, env } of docs) {
          const canonical = canonicalize(migrateSite(env.site).site);
          await writeJsonAtomic(f, { ...env, etag: sha256(canonical), site: JSON.parse(canonical) });
        }
        // nothing reads publishedEtag today, but it must keep describing site.json
        const state = await store.readState();
        const pub = await readEnv(file('site.json'));
        if (state && pub) await writeJsonAtomic(file('publish-state.json'), { ...state, publishedEtag: pub.etag });
      }, { op: 'migrate' });
      console.log(`migrated ${docs.length} document(s) to schema version ${SCHEMA_VERSION}${snap ? `; the draft is kept as revision ${snap.id}` : ''}`);
      break;
    }
    case 'verify': {
      const problems = [];
      const [major] = process.versions.node.split('.').map(Number);
      if (major < 24) problems.push(`Node ${process.versions.node} < 24`);
      if (cfg.production && typeof process.getuid === 'function' && process.getuid() === 0) problems.push('running as root; run as the site user');
      const { access, constants } = await import('node:fs/promises');
      for (const [k, d] of [['data dir', cfg.dataDir], ['web root', cfg.webRoot]]) {
        if (existsSync(d)) { try { await access(d, constants.W_OK); } catch { problems.push(`${k} ${d} is not writable`); } }
        else if (k === 'web root') problems.push(`web root ${d} does not exist`);
      }
      if (existsSync(cfg.buildsDir) && existsSync(cfg.webRoot)) {
        const [a, b] = await Promise.all([stat(cfg.buildsDir), stat(cfg.webRoot)]);
        if (a.dev !== b.dev) problems.push('builds and the web root are on different filesystems (the hard-link swap needs one)');
      }
      try {
        const seedDoc = JSON.parse(await readFile(cfg.seedFile, 'utf8'));
        const v = validate(seedDoc, { mode: 'build', paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, today: store.today() });
        if (v.errors.length) problems.push(`the seed has ${v.errors.length} error(s)`);
      } catch (e) { problems.push(`seed ${cfg.seedFile}: ${e.message}`); }
      try { await import('../../src/build-site.mjs'); } catch (e) { problems.push(`buildSite import failed: ${e.message}`); }
      for (const { meta } of Object.values(LAYOUTS)) {
        for (const f of meta.fonts) if (!existsSync(join(cfg.root, 'src/fonts', f + '.woff2'))) problems.push(`font missing: ${f}`);
      }
      const gate = checkPalettes(loadPalettes());
      if (gate.failed) problems.push(`palette gate: ${gate.failed} failed`);
      // content: only once initialised (the first deploy runs verify before init)
      if (existsSync(join(cfg.dataDir, 'site.json'))) {
        const pub = await store.getPublished().catch((e) => { problems.push(`site.json: ${e.message}`); return null; });
        if (pub) {
          const v = validate(pub.site, { mode: 'build', paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, today: store.today() });
          if (v.errors.length) problems.push(`the published document has ${v.errors.length} error(s) under this release: ${v.errors.slice(0, 3).map((e) => `${e.code} ${e.path}`).join(', ')}`);
        }
        await store.getDraft().catch((e) => problems.push(`draft.json: ${e.message}`));
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
      if (r.droppedFonts?.length) console.log(`::warning::${r.droppedFonts.length} font record(s) had no files on this machine and were dropped: ${r.droppedFonts.join(', ')}`);
      break;
    }
    case 'export': {
      const source = flag('source') === 'published' ? 'published' : 'draft';
      const doc = source === 'draft' ? await store.getDraft() : await store.getPublished();
      const out = { format: 'samsiani.me/site', schemaVersion: SCHEMA_VERSION, source, rev: doc.rev, exportedAt: new Date().toISOString(), site: doc.site };
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
