// Swap a staged build into the real web root, one file at a time (admin-ops.md §5.4–§5.5).
// Pass 1 decides and touches nothing; pass 2 hard-links each changed file from the build directory to a
// temp name next to its target and rename(2)s it, assets first and the English index last.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, link, rename, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, resolve, sep, relative } from 'node:path';

export class ImmutableChangedError extends Error {
  constructor(path) { super(`immutable file ${path} would change bytes under the same name`); this.name = 'ImmutableChangedError'; this.path = path; this.code = 'immutable_changed'; }
}

export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) throw new Error(`unsafe path ${JSON.stringify(rel)}`);
  const p = resolve(root, rel);
  if (p !== resolve(root) && !p.startsWith(resolve(root) + sep)) throw new Error(`path escapes the root: ${rel}`);
  return p;
}

export function sha256File(p) {
  return new Promise((ok, no) => {
    const h = createHash('sha256');
    createReadStream(p).on('error', no).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex')));
  });
}

const rank = ([p, f]) => (f.immutable ? 0 : p === 'index.html' ? 4 : p === '404.html' ? 2 : p.endsWith('.html') ? 3 : 1);

export const hooks = { beforeLink: null }; // test seam: simulate a failure in pass 2

export async function applyBuild(buildDir, webRoot, manifest, { dryRun = false } = {}) {
  const order = Object.entries(manifest.files).sort((a, b) => rank(a) - rank(b));
  const plan = [];
  for (const [rel, f] of order) {
    const dst = safeJoin(webRoot, rel);
    const cur = await sha256File(dst).catch(() => null);
    if (cur === f.sha256) continue;
    if (f.immutable && cur !== null) throw new ImmutableChangedError(rel);
    plan.push([rel, dst]);
  }
  if (dryRun) return { changed: plan.length, plan: plan.map(([rel]) => rel) };
  const done = [];
  try {
    for (const [rel, dst] of plan) {
      await mkdir(dirname(dst), { recursive: true, mode: 0o755 });
      const tmp = join(dirname(dst), `.${basename(dst)}.${manifest.buildId}.tmp`);
      await rm(tmp, { force: true });
      if (hooks.beforeLink) await hooks.beforeLink(rel, done.length);
      await link(safeJoin(buildDir, rel), tmp);
      await rename(tmp, dst);
      done.push(rel);
    }
  } catch (e) { e.partial = done; throw e; }
  return { changed: plan.length, plan: plan.map(([rel]) => rel) };
}

const HASHED = /^[a-z0-9-]+\.[0-9a-f]{8,}\.(css|js|png|webmanifest)$/;

/** Delete hashed files that no kept manifest lists and that are older than 24 h; stale .*.tmp older than 1 h. */
export async function gcWebRoot(webRoot, manifests, { now = Date.now() } = {}) {
  const keep = new Set(manifests.flatMap((m) => Object.keys(m.files)));
  const removed = [];
  const walk = async (dir) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      const rel = relative(webRoot, p).split(sep).join('/');
      if (e.isDirectory()) { if (e.name !== '.well-known' && !e.name.startsWith('.')) await walk(p); continue; }
      let s; try { s = await stat(p); } catch { continue; }
      if (e.name.startsWith('.') && e.name.endsWith('.tmp')) { if (now - s.mtimeMs > 3600_000) { await rm(p, { force: true }); removed.push(rel); } continue; }
      if (e.name.startsWith('.')) continue;
      if (!HASHED.test(e.name) || keep.has(rel)) continue;
      if (now - s.mtimeMs <= 24 * 3600_000) continue;
      await rm(p, { force: true });
      removed.push(rel);
    }
  };
  await walk(webRoot);
  return removed;
}
