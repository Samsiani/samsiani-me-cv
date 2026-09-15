// Atomic, durable file writes and safe reads (admin-ops.md §3.5).
import { open, rename, rm, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export class CorruptFileError extends Error {
  constructor(path, cause) { super(`corrupt file ${path}`); this.name = 'CorruptFileError'; this.path = path; this.cause = cause; }
}

// Test seam: tests replace these to simulate a full disk or a crash between sync and rename.
export const hooks = { beforeRename: null, writeData: null };

export async function writeFileAtomic(file, data, { mode = 0o600 } = {}) {
  const dir = dirname(file);
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fh;
  try {
    fh = await open(tmp, 'wx', mode); // O_CREAT|O_EXCL: never follows an existing path
    if (hooks.writeData) await hooks.writeData(fh, data);
    else await fh.writeFile(data);
    await fh.sync(); // data on disk before the name flips
    await fh.close();
    fh = null;
    if (hooks.beforeRename) await hooks.beforeRename(tmp, file);
    await rename(tmp, file); // atomic replace on the same filesystem
  } catch (e) {
    await fh?.close().catch(() => {});
    await rm(tmp, { force: true });
    throw e;
  }
  await fsyncDir(dir);
}

export async function fsyncDir(dir) {
  let fh;
  try { fh = await open(dir, 'r'); await fh.sync(); }
  catch (e) { if (!['EISDIR', 'EINVAL', 'EPERM', 'EBADF'].includes(e.code)) throw e; } // macOS dev
  finally { await fh?.close(); }
}

export const writeJsonAtomic = (file, doc, opts) => writeFileAtomic(file, JSON.stringify(doc, null, 2) + '\n', opts);

export async function readJson(file) {
  const text = await readFile(file, 'utf8');
  try { return JSON.parse(text); } catch (e) { throw new CorruptFileError(file, e); }
}

export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** Boot cleanup: stale ".*.tmp" files anywhere under dataDir (older than maxAgeMs) and every buildsDir/.tmp-* directory. */
export async function cleanupTemp({ dataDir, buildsDir, maxAgeMs = 3600_000, now = Date.now() }) {
  const removed = [];
  const walk = async (dir) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name.startsWith('.restore-')) { await rm(p, { recursive: true, force: true }); removed.push(p); } else await walk(p); }
      else if (e.name.startsWith('.') && e.name.endsWith('.tmp')) {
        try { const s = await stat(p); if (now - s.mtimeMs > maxAgeMs) { await rm(p, { force: true }); removed.push(p); } } catch {}
      }
    }
  };
  if (dataDir) await walk(dataDir);
  if (buildsDir) {
    try {
      for (const e of await readdir(buildsDir, { withFileTypes: true })) {
        if (e.isDirectory() && e.name.startsWith('.tmp-')) { await rm(join(buildsDir, e.name), { recursive: true, force: true }); removed.push(join(buildsDir, e.name)); }
      }
    } catch {}
  }
  return removed;
}
