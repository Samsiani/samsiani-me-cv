// `cli migrate` on a data directory written by the previous release (schema v1), and the two restore paths
// that can still hand a v1 document to a migrated installation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalize } from '../../src/schema/validate.mjs';
import { sha256 } from '../server/lib/store.mjs';
import { setup, seed } from './_helpers.mjs';

const PORT = '39311'; // nothing answers here: migrate refuses while the service is up
const cli = (ctx, ...args) => spawnSync(process.execPath, ['admin/server/cli.mjs', ...args], {
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'development', PORT, DATA_DIR: ctx.cfg.dataDir, BUILDS_DIR: ctx.cfg.buildsDir, WEB_ROOT: ctx.cfg.webRoot },
});

/** The seed as the previous release wrote it. */
const v1 = (mutate = () => {}) => {
  const s = seed();
  delete s.settings.sectionOrder;
  for (const sec of Object.values(s.sections)) delete sec.hidden;
  s.schemaVersion = 1;
  mutate(s);
  return s;
};
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeV1 = (file, site) => {
  const env = read(file);
  writeFileSync(file, JSON.stringify({ ...env, etag: 'v1-etag', site }, null, 2));
};

async function v1DataDir() {
  const ctx = await setup({ password: null });
  await ctx.deps.store.checkpoint({ note: 'written by the previous release' });
  const d = ctx.cfg.dataDir;
  writeV1(join(d, 'draft.json'), v1((s) => { s.hero.tagline.en = 'Written before the migration.'; }));
  writeV1(join(d, 'site.json'), v1());
  const revDir = join(d, 'revisions');
  for (const n of readdirSync(revDir)) writeV1(join(revDir, n), v1());
  writeFileSync(join(d, 'publish-state.json'), JSON.stringify({ current: null, history: [], publishedRev: 1, publishedEtag: 'v1-etag', publishedAt: null, pending: null }));
  return ctx;
}

test('migrate: dry run reports the pending upgrade, the real run rewrites every document once', async () => {
  const ctx = await v1DataDir();
  const dry = cli(ctx, 'migrate', '--dry-run');
  assert.equal(dry.status, 10, dry.stderr);
  assert.match(dry.stdout, /pending migrations: draft, published/);

  const run = cli(ctx, 'migrate');
  assert.equal(run.status, 0, run.stderr);
  const d = ctx.cfg.dataDir;
  for (const f of ['draft.json', 'site.json']) {
    const env = read(join(d, f));
    assert.equal(env.site.schemaVersion, 2, f);
    assert.ok(Array.isArray(env.site.settings.sectionOrder), f);
    assert.equal(env.etag, sha256(canonicalize(env.site)), `${f} etag follows the document`);
  }
  assert.equal(read(join(d, 'draft.json')).site.hero.tagline.en, 'Written before the migration.');
  assert.equal(read(join(d, 'publish-state.json')).publishedEtag, read(join(d, 'site.json')).etag);

  const revs = readdirSync(join(d, 'revisions')).map((n) => read(join(d, 'revisions', n)));
  const pre = revs.find((r) => r.reason === 'pre-migrate');
  assert.ok(pre, 'the draft is kept as a pre-migrate revision');
  assert.equal(pre.site.schemaVersion, 1, 'the kept revision is the document as it was');
  for (const r of revs.filter((r) => r.reason !== 'pre-migrate')) assert.equal(r.site.schemaVersion, 2, r.id);

  const again = cli(ctx, 'migrate', '--dry-run');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /no pending migrations/);
});

test('after migrating, a v1 backup and a v1 build still restore', async () => {
  const ctx = await v1DataDir();
  assert.equal(cli(ctx, 'migrate').status, 0);

  const file = join(ctx.home, 'v1-backup.json.gz');
  const doc = {
    createdAt: '2026-09-15T10:00:00.000Z', release: 'previous',
    published: { kind: 'published', rev: 1, etag: 'v1-etag', site: v1() },
    draft: { kind: 'draft', rev: 2, etag: 'v1-etag', savedAt: '2026-09-15T10:00:00.000Z', site: v1((s) => { s.hero.tagline.en = 'Restored from a v1 backup.'; }) },
    publishState: null, revisions: [],
  };
  writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(doc))));
  const r = cli(ctx, 'restore-backup', `--file=${file}`, '--part=all');
  assert.equal(r.status, 0, r.stderr);
  const restored = read(join(ctx.cfg.dataDir, 'draft.json'));
  assert.equal(restored.site.schemaVersion, 2);
  assert.equal(restored.site.hero.tagline.en, 'Restored from a v1 backup.');

  const buildId = '20260915T100000Z-r1';
  mkdirSync(join(ctx.cfg.buildsDir, buildId), { recursive: true });
  writeFileSync(join(ctx.cfg.buildsDir, buildId, '.site.json'), JSON.stringify(v1((s) => { s.hero.tagline.en = 'Restored from a v1 build.'; })));
  const rb = cli(ctx, 'restore-build', `--from=${buildId}`);
  assert.equal(rb.status, 0, rb.stderr);
  const draft = read(join(ctx.cfg.dataDir, 'draft.json'));
  assert.equal(draft.site.schemaVersion, 2);
  assert.equal(draft.site.hero.tagline.en, 'Restored from a v1 build.');
  assert.equal(cli(ctx, 'migrate', '--dry-run').status, 0);
});
