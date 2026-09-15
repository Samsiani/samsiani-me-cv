// Daily gzip backups and validated restore (admin-ops.md §3.8). Never includes auth.json, sessions.json or the audit log.
import { gzipSync, gunzipSync } from 'node:zlib';
import { readdir, readFile, rm, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalize, validate } from '../../../src/schema/validate.mjs';
import { blockingErrors } from '../../shared/draft-rules.mjs';
import { writeFileAtomic, writeJsonAtomic, exists } from './fsx.mjs';
import { REVISION_ID_RE, sha256 } from './store.mjs';
import { AppError } from './errors.mjs';

export const KEEP_BACKUPS = 30;
const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function createBackup({ dataDir, store, release = 'dev', clock = { now: () => Date.now() }, paletteIds, layoutIds, audit }) {
  const dir = join(dataDir, 'backups');
  const utcDay = () => new Date(clock.now()).toISOString().slice(0, 10);

  async function collect() {
    return store.lock('write', async () => {
      const read = async (f) => { try { return JSON.parse(await readFile(join(dataDir, f), 'utf8')); } catch { return null; } };
      const revisions = await store.listRevisionsRaw();
      return { createdAt: new Date(clock.now()).toISOString(), release, published: await read('site.json'), draft: await read('draft.json'), publishState: await read('publish-state.json'), revisions };
    }, { op: 'backup' });
  }

  async function prune() {
    const files = [];
    for (const n of await readdir(dir).catch(() => [])) if (n.endsWith('.json.gz')) files.push({ n, t: (await stat(join(dir, n))).mtimeMs });
    files.sort((a, b) => b.t - a.t);
    for (const f of files.slice(KEEP_BACKUPS)) await rm(join(dir, f.n), { force: true });
  }

  const api = {
    dir,
    async write(name) {
      if (name !== undefined && !NAME_RE.test(name)) throw new AppError(400, 'bad_request', 'backup name: letters, digits, . _ - only');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${name ?? utcDay()}.json.gz`);
      const doc = await collect();
      await writeFileAtomic(file, gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }));
      await prune();
      return file;
    },
    /** Once per UTC day. */
    async daily() {
      const file = join(dir, `${utcDay()}.json.gz`);
      if (await exists(file)) return null;
      return api.write();
    },
    /**
     * Restore from a backup file. Checks the whole file first; any failure rejects it and writes nothing.
     * part: 'draft' | 'published' | 'all'. Returns { restored: [...] }.
     */
    async restore(file, part = 'all', { actor = 'cli' } = {}) {
      if (!['draft', 'published', 'all'].includes(part)) throw new AppError(400, 'bad_request', 'part must be draft, published or all');
      let doc;
      try { doc = JSON.parse(gunzipSync(await readFile(file)).toString('utf8')); }
      catch (e) { throw new AppError(400, 'invalid', `backup is unreadable: ${e.message}`); }
      const today = store.today();
      const vo = { mode: 'save', paletteIds, layoutIds, today };
      const problems = [];
      if (!doc || typeof doc !== 'object') problems.push('not an object');
      const revs = Array.isArray(doc?.revisions) ? doc.revisions : [];
      for (const r of revs) {
        if (typeof r?.id !== 'string' || !REVISION_ID_RE.test(r.id)) problems.push(`revision id ${JSON.stringify(r?.id)} is not allowed`);
        else if (blockingErrors(validate(r.site, vo).errors).length) problems.push(`revision ${r.id} is structurally invalid`);
      }
      if (part !== 'published' && (!doc?.draft?.site || blockingErrors(validate(doc.draft.site, vo).errors).length)) problems.push('draft is missing or structurally invalid');
      if (part !== 'draft') {
        if (!doc?.published?.site) problems.push('published document is missing');
        else { const v = validate(doc.published.site, { ...vo, mode: 'build' }); if (v.errors.length) problems.push(`published document is invalid: ${v.errors.slice(0, 3).map((e) => e.code + ' ' + e.path).join(', ')}`); }
      }
      if (problems.length) throw new AppError(400, 'invalid', `backup rejected: ${problems.join('; ')}`);

      const env = (meta, site) => ({ ...meta, site: JSON.parse(canonicalize(site)), etag: sha256(canonicalize(site)) });
      const stage = join(dataDir, `.restore-${Date.now()}`);
      await mkdir(join(stage, 'revisions'), { recursive: true, mode: 0o700 });
      const restored = [];
      try {
        if (part !== 'published') { await writeJsonAtomic(join(stage, 'draft.json'), env({ ...doc.draft, kind: 'draft' }, doc.draft.site)); restored.push('draft.json'); }
        if (part !== 'draft') { await writeJsonAtomic(join(stage, 'site.json'), env({ ...doc.published, kind: 'published' }, doc.published.site)); restored.push('site.json'); }
        if (part === 'all') for (const r of revs) await writeJsonAtomic(join(stage, 'revisions', r.id + '.json'), env({ ...r, kind: 'revision' }, r.site));
        await store.lock('write', async () => {
          const cur = await store.getDraft().catch(() => null);
          if (cur) await store.snapshotUnlocked('pre-restore', cur.site, { actor, rev: cur.rev });
          for (const f of ['draft.json', 'site.json']) if (await exists(join(stage, f))) await rename(join(stage, f), join(dataDir, f));
          if (part === 'all') { await mkdir(join(dataDir, 'revisions'), { recursive: true, mode: 0o700 }); for (const r of revs) await rename(join(stage, 'revisions', r.id + '.json'), join(dataDir, 'revisions', r.id + '.json')); }
        }, { op: 'restore-backup' });
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
      await audit?.log('revision_restored', { detail: `backup ${part}` });
      return { restored };
    },
  };
  return api;
}
