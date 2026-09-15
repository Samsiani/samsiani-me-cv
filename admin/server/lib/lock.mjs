// Serialising writes (admin-ops.md §3.6): an in-process mutex AND a cross-process lockfile,
// because the service and the CLI can both write. Lock order is always publish -> write.
import { open, readFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class LockTimeoutError extends Error {
  constructor(name, holder) { super(`lock "${name}" is held${holder ? ` by pid ${holder.pid} (${holder.op})` : ''}`); this.name = 'LockTimeoutError'; this.lock = name; this.holder = holder; }
}

export const LOCKS = {
  write: { timeoutMs: 5000, staleMs: 30_000 },
  publish: { timeoutMs: 3000, staleMs: 300_000 },
};

// In-process lock with timed waiters (one per lock dir + name). A waiter that times out leaves the queue.
const inproc = new Map();
function getInproc(key) {
  let l = inproc.get(key);
  if (!l) { l = { held: false, q: [] }; inproc.set(key, l); }
  return l;
}
function acquireInproc(key, name, timeoutMs) {
  const l = getInproc(key);
  if (!l.held) { l.held = true; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const w = { resolve };
    w.timer = setTimeout(() => { l.q = l.q.filter((x) => x !== w); reject(new LockTimeoutError(name, { pid: process.pid, op: 'in-process' })); }, timeoutMs);
    l.q.push(w);
  });
}
function releaseInproc(key) {
  const l = getInproc(key);
  const w = l.q.shift();
  if (w) { clearTimeout(w.timer); w.resolve(); } else l.held = false;
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cross-process lockfile data/locks/<name>.lock; stale when the holder is dead or older than staleMs. */
export async function withFileLock(lockDir, name, fn, { timeoutMs = LOCKS[name]?.timeoutMs ?? 5000, staleMs = LOCKS[name]?.staleMs ?? 30_000, op = '' } = {}) {
  await mkdir(lockDir, { recursive: true, mode: 0o700 });
  const file = join(lockDir, `${name}.lock`);
  const start = Date.now();
  for (;;) {
    let fh;
    try {
      fh = await open(file, 'wx', 0o600);
      await fh.writeFile(JSON.stringify({ pid: process.pid, since: new Date().toISOString(), op }));
      await fh.close();
      break;
    } catch (e) {
      await fh?.close().catch(() => {});
      if (e.code !== 'EEXIST') throw e;
      let holder = null;
      try { holder = JSON.parse(await readFile(file, 'utf8')); } catch {}
      const stale = !holder || Date.now() - Date.parse(holder.since) > staleMs || !alive(holder.pid);
      if (stale) { await unlink(file).catch(() => {}); continue; }
      if (Date.now() - start >= timeoutMs) throw new LockTimeoutError(name, holder);
      await sleep(100);
    }
  }
  try { return await fn(); } finally { await unlink(file).catch(() => {}); }
}

/** In-process lock + lockfile. In-process waiters get at least 10 s for "write" (many autosaves may queue). */
export async function withLock(lockDir, name, fn, opts = {}) {
  const key = `${lockDir}::${name}`;
  const base = opts.timeoutMs ?? LOCKS[name]?.timeoutMs ?? 5000;
  await acquireInproc(key, name, name === 'write' ? Math.max(base, 10_000) : base);
  try { return await withFileLock(lockDir, name, fn, opts); } finally { releaseInproc(key); }
}
