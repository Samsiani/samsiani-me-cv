import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, readdirSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic, hooks, cleanupTemp, readJson, CorruptFileError } from '../server/lib/fsx.mjs';
import { tempHome } from './_helpers.mjs';

const tmps = (dir) => readdirSync(dir).filter((n) => n.endsWith('.tmp'));

test('a throw between sync and rename leaves the old file and no .tmp', async () => {
  const dir = tempHome(); const f = join(dir, 'data', 'x.json');
  writeFileSync(f, 'old');
  hooks.beforeRename = () => { throw new Error('crash'); };
  try { await assert.rejects(() => writeFileAtomic(f, 'new'), /crash/); }
  finally { hooks.beforeRename = null; }
  assert.equal(readFileSync(f, 'utf8'), 'old');
  assert.deepEqual(tmps(join(dir, 'data')), []);
});

test('a simulated ENOSPC in writeFile leaves the old file and no .tmp', async () => {
  const dir = tempHome(); const f = join(dir, 'data', 'y.json');
  writeFileSync(f, 'old');
  hooks.writeData = async () => { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; };
  try { await assert.rejects(() => writeFileAtomic(f, 'new'), (e) => e.code === 'ENOSPC'); }
  finally { hooks.writeData = null; }
  assert.equal(readFileSync(f, 'utf8'), 'old');
  assert.deepEqual(tmps(join(dir, 'data')), []);
});

test('atomic write replaces content and sets mode 600', async () => {
  const dir = tempHome(); const f = join(dir, 'data', 'z.json');
  await writeFileAtomic(f, 'hello');
  assert.equal(readFileSync(f, 'utf8'), 'hello');
});

test('boot cleanup walks data/ recursively and removes builds/.tmp-*', async () => {
  const home = tempHome();
  const deep = join(home, 'data', 'revisions');
  mkdirSync(deep, { recursive: true });
  const old = join(deep, '.a.json.1.abc.tmp');
  writeFileSync(old, 'x');
  const past = new Date(Date.now() - 2 * 3600_000);
  utimesSync(old, past, past);
  const fresh = join(home, 'data', '.b.json.1.def.tmp'); writeFileSync(fresh, 'x');
  mkdirSync(join(home, 'builds', '.tmp-20260915T100000Z-r3'), { recursive: true });
  await cleanupTemp({ dataDir: join(home, 'data'), buildsDir: join(home, 'builds') });
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true, 'younger than an hour: kept');
  assert.equal(existsSync(join(home, 'builds', '.tmp-20260915T100000Z-r3')), false);
});

test('a parse error surfaces as CorruptFileError', async () => {
  const dir = tempHome(); const f = join(dir, 'data', 'bad.json');
  writeFileSync(f, '{ nope');
  await assert.rejects(() => readJson(f), CorruptFileError);
});
