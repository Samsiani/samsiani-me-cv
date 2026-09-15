import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, utimesSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hooks as swapHooks, gcWebRoot } from '../server/lib/swap.mjs';
import { hooks as pubHooks } from '../server/lib/publish.mjs';
import { setup, seed, makeClock } from './_helpers.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
async function draftEdit(deps, mutate) {
  const d = await deps.store.getDraft();
  const s = structuredClone(d.site); mutate(s);
  return deps.store.saveDraft(s, { ifMatch: d.etag });
}
const publishDraft = async (deps, extra = {}) => deps.publisher.publish({ source: 'draft', ifMatch: (await deps.store.getDraft()).etag, acknowledgeWarnings: true, ...extra });

test('publish from the seed produces both languages, 404 and hashed assets', async () => {
  const { deps, cfg } = await setup({ password: null });
  const out = await publishDraft(deps);
  for (const f of ['index.html', 'ka/index.html', '404.html', 'robots.txt', 'sitemap.xml']) assert.ok(existsSync(join(cfg.webRoot, f)), f);
  const names = readdirSync(cfg.webRoot);
  assert.ok(names.some((n) => /^styles\.[0-9a-f]{8}\.css$/.test(n)));
  assert.ok(names.some((n) => /^og-en\.[0-9a-f]{8}\.png$/.test(n)));
  assert.match(readFileSync(join(cfg.webRoot, 'robots.txt'), 'utf8'), /Disallow: \/admin\//);
  assert.equal((await deps.store.getPublished()).buildId, out.buildId);
  assert.equal((await deps.store.readState()).pending, null);
});

test('an unchanged --if-changed re-render is a no-op; a hand-edited web-root file makes it re-apply', async () => {
  const { deps, cfg } = await setup({ password: null });
  await publishDraft(deps);
  const again = await deps.publisher.publish({ source: 'published', ifChanged: true });
  assert.equal(again.unchanged, true);
  writeFileSync(join(cfg.webRoot, 'index.html'), 'tampered');
  const repair = await deps.publisher.publish({ source: 'published', ifChanged: true });
  assert.equal(repair.unchanged, undefined);
  assert.ok(readFileSync(join(cfg.webRoot, 'index.html'), 'utf8').includes('<html lang="en"'));
});

test('publishing the same draft again changes 0 files', async () => {
  const { deps } = await setup({ password: null });
  await publishDraft(deps);
  const second = await publishDraft(deps);
  assert.equal(second.changedFiles, 0);
});

test('rollback restores the previous bytes in under a second; the draft is untouched', async () => {
  const { deps, cfg } = await setup({ password: null });
  const first = await publishDraft(deps);
  const man1 = JSON.parse(readFileSync(join(cfg.buildsDir, first.buildId, 'manifest.json'), 'utf8'));
  await draftEdit(deps, (s) => { s.settings.palette = 'lime'; });
  await publishDraft(deps);
  const draftBefore = (await deps.store.getDraft()).etag;
  const t = Date.now();
  const rb = await deps.publisher.rollback({});
  assert.ok(Date.now() - t < 1000, 'under a second');
  assert.equal(rb.current, first.buildId);
  for (const [rel, f] of Object.entries(man1.files)) assert.equal(sha(join(cfg.webRoot, rel)), f.sha256, rel);
  const css = Object.keys(man1.files).find((p) => p.startsWith('styles.'));
  assert.ok(readFileSync(join(cfg.webRoot, 'index.html'), 'utf8').includes(css));
  assert.equal((await deps.store.getPublished()).rev, man1.rev);
  assert.equal((await deps.store.getDraft()).etag, draftBefore);
});

test('an immutable name with new bytes aborts before any rename', async () => {
  const { deps, cfg } = await setup({ password: null });
  const first = await publishDraft(deps);
  const man = JSON.parse(readFileSync(join(cfg.buildsDir, first.buildId, 'manifest.json'), 'utf8'));
  const font = Object.keys(man.files).find((p) => p.startsWith('fonts/'));
  writeFileSync(join(cfg.webRoot, font), 'different bytes under the same name');
  const indexBefore = readFileSync(join(cfg.webRoot, 'index.html'), 'utf8');
  await draftEdit(deps, (s) => { s.hero.tagline.en = 'A new tagline for the test.'; });
  await assert.rejects(() => publishDraft(deps), (e) => e.status === 500 && e.details.stage === 'swap' && e.details.code === 'immutable_changed');
  assert.equal(readFileSync(join(cfg.webRoot, 'index.html'), 'utf8'), indexBefore, 'nothing renamed');
  assert.equal((await deps.store.readState()).pending, null);
});

test('a failure in swap pass 2 re-applies the previous build', async () => {
  const { deps, cfg } = await setup({ password: null });
  await publishDraft(deps);
  const indexBefore = sha(join(cfg.webRoot, 'index.html'));
  await draftEdit(deps, (s) => { s.settings.palette = 'crimson'; s.hero.tagline.en = 'Changed for the failure test.'; });
  swapHooks.beforeLink = (rel, n) => { if (n === 2) throw new Error('simulated I/O error'); };
  try { await assert.rejects(() => publishDraft(deps), (e) => e.details?.stage === 'swap'); }
  finally { swapHooks.beforeLink = null; }
  assert.equal(sha(join(cfg.webRoot, 'index.html')), indexBefore);
  assert.equal((await deps.store.readState()).pending, null);
});

test('SIGKILL between swap and commit: the next start completes the commit; a later --if-changed keeps the new index', async () => {
  const { deps, cfg } = await setup({ password: null });
  await publishDraft(deps);
  await draftEdit(deps, (s) => { s.hero.tagline.en = 'Published right before the crash.'; });
  const child = `
    import { loadConfig } from ${JSON.stringify(new URL('../server/config.mjs', import.meta.url).href)};
    import { createDeps } from ${JSON.stringify(new URL('../server/deps.mjs', import.meta.url).href)};
    import { hooks } from ${JSON.stringify(new URL('../server/lib/publish.mjs', import.meta.url).href)};
    const cfg = loadConfig({ NODE_ENV: 'development', DATA_DIR: ${JSON.stringify(cfg.dataDir)}, WEB_ROOT: ${JSON.stringify(cfg.webRoot)}, BUILDS_DIR: ${JSON.stringify(cfg.buildsDir)}, SITE_URL: 'https://samsiani.me' }, { cli: true });
    const deps = createDeps(cfg);
    hooks.afterSwap = () => process.kill(process.pid, 'SIGKILL');
    await deps.publisher.publish({ source: 'draft', ifMatch: (await deps.store.getDraft()).etag, acknowledgeWarnings: true });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
  assert.equal(r.signal, 'SIGKILL', r.stderr);
  const pending = (await deps.store.readState()).pending;
  assert.ok(pending, 'the write-ahead record survived');
  assert.ok(readFileSync(join(cfg.webRoot, 'index.html'), 'utf8').includes('Published right before the crash.'), 'new build is live');
  assert.notEqual((await deps.store.getPublished()).buildId, pending.buildId, 'site.json still behind');
  const rec = await deps.publisher.reconcile();
  assert.equal(rec.action, 'recovered');
  assert.equal((await deps.store.getPublished()).buildId, pending.buildId);
  assert.equal((await deps.store.getPublished()).site.hero.tagline.en, 'Published right before the crash.');
  const again = await deps.publisher.publish({ source: 'published', ifChanged: true });
  assert.equal(again.unchanged, true);
  assert.ok(readFileSync(join(cfg.webRoot, 'index.html'), 'utf8').includes('Published right before the crash.'));
});

test('a pending build whose files never reached the web root is reverted', async () => {
  const { deps, cfg } = await setup({ password: null });
  const first = await publishDraft(deps);
  const ghost = '20991231T235959Z-r99';
  cpSync(join(cfg.buildsDir, first.buildId), join(cfg.buildsDir, ghost), { recursive: true });
  const m = JSON.parse(readFileSync(join(cfg.buildsDir, ghost, 'manifest.json'), 'utf8'));
  m.files['index.html'].sha256 = '0'.repeat(64); m.buildId = ghost;
  writeFileSync(join(cfg.buildsDir, ghost, 'manifest.json'), JSON.stringify(m));
  await deps.store.writePublishState((s) => ({ ...s, pending: { buildId: ghost, rev: 99, source: 'draft', draftEtag: null, startedAt: new Date().toISOString() } }));
  const rec = await deps.publisher.reconcile();
  assert.equal(rec.action, 'reverted');
  assert.equal((await deps.store.readState()).pending, null);
  assert.equal((await deps.store.getPublished()).buildId, first.buildId);
});

test('an autosave that lands during a publish keeps its text and gets only the new date', async () => {
  const clock = makeClock(Date.parse('2026-09-15T21:30:00Z')); // 01:30 on the 16th in Tbilisi
  const { deps } = await setup({ password: null, clock });
  await draftEdit(deps, (s) => { s.settings.autoUpdateDateOnPublish = true; s.hero.tagline.en = 'Text that is published.'; });
  pubHooks.afterSwap = async () => {
    const d = await deps.store.getDraft();
    const s = structuredClone(d.site); s.hero.tagline.en = 'Typed during the publish.';
    await deps.store.saveDraft(s, { ifMatch: d.etag });
  };
  let out;
  try { out = await publishDraft(deps); } finally { pubHooks.afterSwap = null; }
  assert.equal(out.updated, '2026-09-16', 'today in Asia/Tbilisi');
  const d = await deps.store.getDraft();
  assert.equal(d.site.hero.tagline.en, 'Typed during the publish.');
  assert.equal(d.site.settings.updated, '2026-09-16');
  assert.equal(out.draft.updated, '2026-09-16');
});

test('with autoUpdateDateOnPublish a palette-only publish keeps the date; a text edit sets today', async () => {
  const clock = makeClock(Date.parse('2026-09-15T10:00:00Z'));
  const { deps } = await setup({ password: null, clock });
  await draftEdit(deps, (s) => { s.settings.autoUpdateDateOnPublish = true; });
  await publishDraft(deps); // settings only
  assert.equal((await deps.store.getPublished()).site.settings.updated, seed().settings.updated);
  await draftEdit(deps, (s) => { s.settings.palette = 'emerald'; });
  await publishDraft(deps);
  assert.equal((await deps.store.getPublished()).site.settings.updated, seed().settings.updated, 'palette only: date kept');
  await draftEdit(deps, (s) => { s.hero.tagline.en = 'A text edit changes the date.'; });
  const out = await publishDraft(deps);
  assert.equal(out.updated, '2026-09-15');
  assert.equal((await deps.store.getDraft()).site.settings.updated, '2026-09-15', 'the draft adopts the new date');
});

test('GC keeps unknown files, .well-known/, fonts and anything younger than 24 h', async () => {
  const { cfg } = await setup({ password: null, init: false });
  const w = cfg.webRoot;
  mkdirSync(join(w, '.well-known'), { recursive: true }); mkdirSync(join(w, 'fonts'), { recursive: true });
  const old = new Date(Date.now() - 25 * 3600_000);
  const files = { 'google1234.html': 'x', '.well-known/security.txt': 'x', 'fonts/chivo.woff2': 'x', 'styles.deadbeef.css': 'old', 'main.cafebabe.js': 'young', 'og-en.12345678.png': 'kept by manifest' };
  for (const [f, v] of Object.entries(files)) writeFileSync(join(w, f), v);
  for (const f of ['google1234.html', '.well-known/security.txt', 'fonts/chivo.woff2', 'styles.deadbeef.css', 'og-en.12345678.png']) utimesSync(join(w, f), old, old);
  const removed = await gcWebRoot(w, [{ files: { 'og-en.12345678.png': {} } }]);
  assert.deepEqual(removed, ['styles.deadbeef.css']);
  for (const f of ['google1234.html', '.well-known/security.txt', 'fonts/chivo.woff2', 'main.cafebabe.js', 'og-en.12345678.png']) assert.ok(existsSync(join(w, f)), f);
});

test('rollback defaults to the build that was live before, even when build ids share a second', async () => {
  const clock = makeClock(); // frozen clock: every build id gets the same timestamp
  const { deps } = await setup({ password: null, clock });
  const a = await publishDraft(deps);
  const a2 = await publishDraft(deps); // same content, newer build of r1
  await draftEdit(deps, (s) => { s.settings.palette = 'lime'; });
  const b = await publishDraft(deps);
  assert.notEqual(a.buildId, a2.buildId);
  const rb = await deps.publisher.rollback({});
  assert.equal(rb.current, a2.buildId, 'the previously live build, not the lexically smaller id');
  assert.notEqual(rb.current, b.buildId);
});
