import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize } from '../../src/schema/validate.mjs';
import { setup, seed, makeClock } from './_helpers.mjs';

const edit = (site, text) => { const s = structuredClone(site); s.hero.tagline.en = text; return s; };

test('412 on a stale If-Match', async () => {
  const { deps } = await setup({ password: null });
  await assert.rejects(() => deps.store.saveDraft(edit(seed(), 'x'), { ifMatch: 'stale' }), (e) => e.status === 412);
});

test('force overwrites and first keeps the replaced draft as pre-overwrite (even inside 20 min)', async () => {
  const { deps } = await setup({ password: null });
  const d0 = await deps.store.getDraft();
  const d1 = await deps.store.saveDraft(edit(d0.site, 'device A text'), { ifMatch: d0.etag });
  await deps.store.saveDraft(edit(d0.site, 'device B text'), { force: true });
  const revs = await deps.store.listRevisions();
  const pre = revs.find((r) => r.reason === 'pre-overwrite');
  assert.ok(pre, 'pre-overwrite revision exists');
  const doc = await deps.store.getRevision(pre.id);
  assert.equal(doc.site.hero.tagline.en, 'device A text');
  assert.equal(doc.etag, d1.etag);
});

test('saveDraft stores settings.siteUrl = SITE_URL whatever was posted', async () => {
  const { deps } = await setup({ password: null });
  const d0 = await deps.store.getDraft();
  const s = edit(d0.site, 'y'); s.settings.siteUrl = 'https://evil.example';
  await deps.store.saveDraft(s, { ifMatch: d0.etag });
  assert.equal((await deps.store.getDraft()).site.settings.siteUrl, 'https://samsiani.me');
});

test('stored files are canonical', async () => {
  const { deps, cfg } = await setup({ password: null });
  const d0 = await deps.store.getDraft();
  await deps.store.saveDraft(edit(d0.site, 'canonical check'), { ifMatch: d0.etag });
  const parsed = JSON.parse(readFileSync(join(cfg.dataDir, 'draft.json'), 'utf8'));
  assert.equal(canonicalize(parsed.site), JSON.stringify(parsed.site, null, 2) + '\n');
});

test('autosave snapshots the previous draft once the newest revision is older than 20 min', async () => {
  const clock = makeClock();
  const { deps } = await setup({ password: null, clock });
  let d = await deps.store.getDraft();
  d = await deps.store.saveDraft(edit(d.site, 'one'), { ifMatch: d.etag }); // first save: no revision yet -> snapshot
  const n1 = (await deps.store.listRevisions()).length;
  d = await deps.store.saveDraft(edit(d.site, 'two'), { ifMatch: d.etag });
  assert.equal((await deps.store.listRevisions()).length, n1, 'within 20 min: no new snapshot');
  clock.advance(21 * 60_000);
  d = await deps.store.saveDraft(edit(d.site, 'three'), { ifMatch: d.etag });
  const revs = await deps.store.listRevisions();
  assert.equal(revs.length, n1 + 1);
  assert.equal((await deps.store.getRevision(revs[0].id)).site.hero.tagline.en, 'two');
});

test('retention keeps 30 and never prunes the live publish revision', async () => {
  const clock = makeClock();
  const { deps } = await setup({ password: null, clock });
  const pub = await deps.store.getPublished();
  await deps.store.commitPublished({ rev: 1, site: pub.site, buildId: '20260915T100000Z-r1' });
  for (let i = 0; i < 40; i++) { clock.advance(1000); await deps.store.snapshot('checkpoint', edit(seed(), `c${i}`), { rev: 1 + i }); }
  const revs = await deps.store.listRevisions();
  assert.ok(revs.length <= 31);
  assert.ok(revs.some((r) => r.reason === 'publish' && r.live), 'the live publish revision survives');
});

test('identical content is not snapshotted twice', async () => {
  const { deps } = await setup({ password: null });
  const a = await deps.store.snapshot('checkpoint', edit(seed(), 'same'), { rev: 1 });
  const b = await deps.store.snapshot('checkpoint', edit(seed(), 'same'), { rev: 1 });
  assert.equal(b.skipped, true);
  assert.equal(b.id, a.id);
});

test('a corrupt draft.json recovers from the newest revision', async () => {
  const { deps, cfg } = await setup({ password: null });
  await deps.store.snapshot('checkpoint', edit(seed(), 'from revision'), { rev: 3 });
  writeFileSync(join(cfg.dataDir, 'draft.json'), '{ broken');
  const d = await deps.store.getDraft();
  assert.equal(d.site.hero.tagline.en, 'from revision');
  assert.equal(JSON.parse(readFileSync(join(cfg.dataDir, 'draft.json'), 'utf8')).kind, 'draft');
});

test('revision ids are checked before any file access', async () => {
  const { deps } = await setup({ password: null });
  for (const id of ['../x', '../../etc/passwd', '20260915T100000000Z-publish-r1/../../x', '']) {
    await assert.rejects(() => deps.store.getRevision(id), (e) => e.status === 404);
  }
});

test('discard makes the draft the published document and snapshots the old draft', async () => {
  const { deps } = await setup({ password: null });
  let d = await deps.store.getDraft();
  d = await deps.store.saveDraft(edit(d.site, 'to be discarded'), { ifMatch: d.etag });
  const out = await deps.store.discardDraft({ ifMatch: d.etag });
  assert.equal(out.site.hero.tagline.en, seed().hero.tagline.en);
  assert.ok((await deps.store.listRevisions()).some((r) => r.reason === 'pre-discard'));
});
