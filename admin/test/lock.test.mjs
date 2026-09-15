import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { withFileLock, withLock, LockTimeoutError } from '../server/lib/lock.mjs';
import { setup, seed, tempHome } from './_helpers.mjs';

test('100 chained saveDraft calls lose nothing', async () => {
  const { deps } = await setup({ password: null });
  let etag = (await deps.store.getDraft()).etag;
  for (let i = 0; i < 100; i++) {
    const s = (await deps.store.getDraft()).site;
    s.hero.tagline.en = `tagline number ${i}`;
    const out = await deps.store.saveDraft(s, { ifMatch: etag });
    etag = out.etag;
  }
  const d = await deps.store.getDraft();
  assert.equal(d.site.hero.tagline.en, 'tagline number 99');
  assert.equal(d.rev, 101);
});

test('100 parallel saves with the same ETag: exactly one wins, the rest get 412', async () => {
  const { deps } = await setup({ password: null });
  const etag = (await deps.store.getDraft()).etag;
  const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => {
    const s = seed(); s.hero.tagline.en = `parallel ${i}`;
    return deps.store.saveDraft(s, { ifMatch: etag });
  }));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 412));
});

test('a lockfile with a dead pid is taken over', async () => {
  const dir = join(tempHome(), 'locks'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'write.lock'), JSON.stringify({ pid: 999999, since: new Date().toISOString(), op: 'x' }));
  assert.equal(await withFileLock(dir, 'write', async () => 'got it', { timeoutMs: 500 }), 'got it');
});

test('a lockfile older than staleMs is taken over', async () => {
  const dir = join(tempHome(), 'locks'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'write.lock'), JSON.stringify({ pid: process.pid, since: new Date(Date.now() - 60_000).toISOString(), op: 'x' }));
  assert.equal(await withFileLock(dir, 'write', async () => 'ok', { timeoutMs: 500, staleMs: 30_000 }), 'ok');
});

test('a live lock times out', async () => {
  const dir = join(tempHome(), 'locks'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'publish.lock'), JSON.stringify({ pid: process.pid, since: new Date().toISOString(), op: 'held' }));
  await assert.rejects(() => withFileLock(dir, 'publish', async () => {}, { timeoutMs: 300 }), LockTimeoutError);
});

test('two processes never hold "publish" together', async () => {
  const dir = join(tempHome(), 'locks'); mkdirSync(dir, { recursive: true });
  const log = join(dir, '..', 'log.txt'); writeFileSync(log, '');
  const script = `
    import { withFileLock } from ${JSON.stringify(new URL('../server/lib/lock.mjs', import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    for (let i = 0; i < 5; i++) await withFileLock(${JSON.stringify(dir)}, 'publish', async () => {
      appendFileSync(${JSON.stringify(log)}, 'in ' + process.pid + '\\n');
      await new Promise((r) => setTimeout(r, 20));
      appendFileSync(${JSON.stringify(log)}, 'out ' + process.pid + '\\n');
    }, { timeoutMs: 20000 });`;
  const run = () => new Promise((ok, no) => { const p = spawn(process.execPath, ['--input-type=module', '-e', script]); p.on('exit', (c) => (c === 0 ? ok() : no(new Error('exit ' + c)))); });
  await Promise.all([run(), run()]);
  const lines = (await import('node:fs')).readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 20);
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i], /^in /); assert.match(lines[i + 1], /^out /);
    assert.equal(lines[i].split(' ')[1], lines[i + 1].split(' ')[1], 'no interleaving');
  }
});

test('in-process waiters on "publish" time out instead of queueing forever', async () => {
  const dir = join(tempHome(), 'locks');
  let release;
  const held = withLock(dir, 'publish', () => new Promise((r) => (release = r)));
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(() => withLock(dir, 'publish', async () => {}, { timeoutMs: 200 }), LockTimeoutError);
  release(); await held;
});
