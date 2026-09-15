import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBackup } from '../server/lib/backup.mjs';
import { setup, seed, makeClock } from './_helpers.mjs';

const make = (ctx) => createBackup({ dataDir: ctx.cfg.dataDir, store: ctx.deps.store, clock: ctx.clock, paletteIds: ctx.deps.paletteIds, layoutIds: ctx.deps.layoutIds });

test('a daily file is written once per UTC day, 30 kept, without credentials', async () => {
  const clock = makeClock();
  const ctx = await setup({ clock });
  const b = make(ctx);
  assert.ok(await b.daily());
  assert.equal(await b.daily(), null, 'second call the same day writes nothing');
  const file = join(b.dir, readdirSync(b.dir)[0]);
  const doc = JSON.parse(gunzipSync(readFileSync(file)).toString());
  assert.ok(doc.published && doc.draft && Array.isArray(doc.revisions));
  const text = JSON.stringify(doc);
  assert.doesNotMatch(text, /scrypt\$1\$/, 'no password hash');
  assert.doesNotMatch(text, /"sessions"/, 'no session registry');
  for (let d = 0; d < 35; d++) { clock.advance(86_400_000); await b.daily(); }
  assert.ok(readdirSync(b.dir).length <= 30);
});

test('backup --name writes backups/<name>.json.gz', async () => {
  const ctx = await setup();
  const f = await make(ctx).write('pre-migrate-abc123');
  assert.match(f, /backups\/pre-migrate-abc123\.json\.gz$/);
  await assert.rejects(() => make(ctx).write('../x'), (e) => e.status === 400);
});

test('restore-backup rejects a revision id "../x", an invalid published document or a truncated gzip, writing nothing', async () => {
  const ctx = await setup();
  const b = make(ctx);
  const good = JSON.parse(gunzipSync(readFileSync(await b.write('good'))).toString());
  const before = readFileSync(join(ctx.cfg.dataDir, 'draft.json'), 'utf8');
  const cases = {
    traversal: { ...good, revisions: [{ id: '../x', rev: 1, site: seed(), reason: 'publish', createdAt: new Date().toISOString() }] },
    invalidPublished: { ...good, published: { ...good.published, site: { ...seed(), hero: { ...seed().hero, facts: [] } } } },
  };
  for (const [name, doc] of Object.entries(cases)) {
    const f = join(ctx.home, `${name}.json.gz`);
    writeFileSync(f, gzipSync(Buffer.from(JSON.stringify(doc))));
    await assert.rejects(() => b.restore(f, 'all'), (e) => e.status === 400, name);
  }
  const trunc = join(ctx.home, 'trunc.json.gz');
  writeFileSync(trunc, gzipSync(Buffer.from(JSON.stringify(good))).subarray(0, 50));
  await assert.rejects(() => b.restore(trunc, 'all'), (e) => e.status === 400);
  assert.equal(readFileSync(join(ctx.cfg.dataDir, 'draft.json'), 'utf8'), before, 'nothing written');
  assert.equal(readdirSync(ctx.cfg.dataDir).filter((n) => n.startsWith('.restore-')).length, 0, 'no staging left');
});

test('a valid backup restores the draft', async () => {
  const ctx = await setup();
  const b = make(ctx);
  const s = seed(); s.hero.tagline.en = 'backed up text';
  const d = await ctx.deps.store.getDraft();
  await ctx.deps.store.saveDraft(s, { ifMatch: d.etag });
  const f = await b.write('snap');
  const d2 = await ctx.deps.store.getDraft();
  const s2 = structuredClone(d2.site); s2.hero.tagline.en = 'changed later';
  await ctx.deps.store.saveDraft(s2, { ifMatch: d2.etag });
  await b.restore(f, 'draft');
  assert.equal((await ctx.deps.store.getDraft()).site.hero.tagline.en, 'backed up text');
});

test('init restores from the newest build when site.json is gone but a build exists', async () => {
  const ctx = await setup({ init: false, password: null });
  const s = seed(); s.hero.tagline.en = 'content from the newest build';
  const bdir = join(ctx.cfg.buildsDir, '20260915T100000Z-r7'); mkdirSync(bdir, { recursive: true });
  writeFileSync(join(bdir, '.site.json'), JSON.stringify(s));
  const r = spawnSync(process.execPath, ['admin/server/cli.mjs', 'init'], { env: { ...process.env, NODE_ENV: 'development', DATA_DIR: ctx.cfg.dataDir, BUILDS_DIR: ctx.cfg.buildsDir, WEB_ROOT: ctx.cfg.webRoot }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /from build 20260915T100000Z-r7/);
  assert.equal(JSON.parse(readFileSync(join(ctx.cfg.dataDir, 'site.json'), 'utf8')).site.hero.tagline.en, 'content from the newest build');
});

test('migrate --dry-run exits 0 with nothing pending and 10 with a pending migration', async () => {
  const ctx = await setup({ password: null });
  const env = { ...process.env, NODE_ENV: 'development', PORT: '39997', DATA_DIR: ctx.cfg.dataDir, BUILDS_DIR: ctx.cfg.buildsDir, WEB_ROOT: ctx.cfg.webRoot };
  assert.equal(spawnSync(process.execPath, ['admin/server/cli.mjs', 'migrate', '--dry-run'], { env }).status, 0);
  const f = join(ctx.cfg.dataDir, 'draft.json');
  const d = JSON.parse(readFileSync(f, 'utf8')); d.site.schemaVersion = 0; writeFileSync(f, JSON.stringify(d));
  assert.equal(spawnSync(process.execPath, ['admin/server/cli.mjs', 'migrate', '--dry-run'], { env }).status, 10);
});

test('migrate refuses while the health endpoint answers', async () => {
  const ctx = await setup({ password: null });
  const { spawn } = await import('node:child_process');
  const port = String(39000 + Math.floor(Math.random() * 900));
  const env = { ...process.env, NODE_ENV: 'development', PORT: port, DATA_DIR: ctx.cfg.dataDir, BUILDS_DIR: ctx.cfg.buildsDir, WEB_ROOT: ctx.cfg.webRoot };
  const srv = spawn(process.execPath, ['admin/server/index.mjs'], { env });
  try {
    await new Promise((ok, no) => { srv.stdout.on('data', (d) => /listening/.test(d) && ok()); setTimeout(() => no(new Error('server did not start')), 8000); });
    const f = join(ctx.cfg.dataDir, 'draft.json');
    const d = JSON.parse(readFileSync(f, 'utf8')); d.site.schemaVersion = 0; writeFileSync(f, JSON.stringify(d));
    const r = spawnSync(process.execPath, ['admin/server/cli.mjs', 'migrate'], { env, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /running/);
  } finally { srv.kill('SIGTERM'); }
});
