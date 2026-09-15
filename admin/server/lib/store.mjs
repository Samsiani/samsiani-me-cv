// Content store (admin-ops.md §3.4, §3.7): draft, published document, revisions, publish state.
// Every stored document goes through canonicalize(); its ETag is sha256 of that canonical string.
import { mkdir, readdir, rm, rename, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validate, canonicalize } from '../../../src/schema/validate.mjs';
import { blockingErrors } from '../../shared/draft-rules.mjs';
import { writeJsonAtomic, readJson, exists, CorruptFileError } from './fsx.mjs';
import { withLock } from './lock.mjs';
import { DraftRejectedError, PreconditionError, NotInitialisedError, DegradedError, NotFoundError, AppError } from './errors.mjs';
import { nullAudit } from './audit.mjs';

export const REVISION_ID_RE = /^\d{8}T\d{9}Z-[a-z-]+-r\d+$/;
export const BUILD_ID_RE = /^\d{8}T\d{6}Z-r\d+$/;
export const KEEP_REVISIONS = 30;
const AUTOSAVE_SNAPSHOT_MS = 20 * 60 * 1000;
const REASONS = new Set(['publish', 'autosave', 'checkpoint', 'pre-restore', 'pre-import', 'pre-discard', 'pre-rollback', 'pre-overwrite', 'pre-migrate']);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const todayTbilisi = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date(ms));
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, ''); // 20260914T101502004Z

export function createStore({ dataDir, siteUrl, paletteIds, layoutIds, clock = { now: () => Date.now() }, audit = nullAudit }) {
  const F = {
    draft: join(dataDir, 'draft.json'),
    site: join(dataDir, 'site.json'),
    state: join(dataDir, 'publish-state.json'),
    revisions: join(dataDir, 'revisions'),
    locks: join(dataDir, 'locks'),
  };
  const iso = () => new Date(clock.now()).toISOString();
  const today = () => todayTbilisi(clock.now());
  const vopts = (mode = 'save') => ({ mode, paletteIds, layoutIds, today: today() });
  const lock = (name, fn, opts) => withLock(F.locks, name, fn, opts);
  const withSiteUrl = (site) => {
    const s = structuredClone(site);
    if (s && typeof s === 'object' && s.settings && typeof s.settings === 'object') s.settings.siteUrl = siteUrl;
    return s;
  };
  const envelope = (meta, site) => ({ ...meta, site: JSON.parse(canonicalize(site)) });

  /** Apply the draft rules: returns { site (siteUrl fixed), validation, canonical, etag } or throws DraftRejectedError. */
  function checkDraft(site) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) throw new DraftRejectedError([{ path: '$', code: 'TYPE', msg: 'expected an object' }]);
    const s = withSiteUrl(site);
    const validation = validate(s, vopts('save'));
    const blocking = blockingErrors(validation.errors);
    if (blocking.length) throw new DraftRejectedError(blocking);
    const canonical = canonicalize(s);
    return { site: s, validation, canonical, etag: sha256(canonical) };
  }

  async function readPublished() {
    try { return await readJson(F.site); }
    catch (e) {
      if (e.code === 'ENOENT') throw new NotInitialisedError('content');
      if (e instanceof CorruptFileError) throw new DegradedError();
      throw e;
    }
  }

  async function listRevisionsRaw() {
    let names = [];
    try { names = (await readdir(F.revisions)).filter((n) => n.endsWith('.json') && REVISION_ID_RE.test(n.slice(0, -5))); } catch { return []; }
    const docs = [];
    for (const n of names) { try { docs.push(await readJson(join(F.revisions, n))); } catch {} }
    return docs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async function readState() {
    try { return await readJson(F.state); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  // unlocked internals (callers hold the write lock)
  async function draftUnlocked() {
    try {
      const d = await readJson(F.draft);
      if (!d || d.kind !== 'draft' || !d.site) throw new CorruptFileError(F.draft);
      return d;
    } catch (e) {
      if (e.code === 'ENOENT' && !(await exists(F.site))) throw new NotInitialisedError('content');
      // recover: newest revision, else the published document
      const newest = (await listRevisionsRaw())[0];
      const src = newest?.site ?? (await readPublished()).site;
      const canonical = canonicalize(src);
      const v = validate(src, vopts());
      const env = envelope({ kind: 'draft', rev: (newest?.rev ?? 0) + 1, etag: sha256(canonical), savedAt: iso(), issues: { errors: v.errors.length, warnings: v.warnings.length } }, src);
      await writeJsonAtomic(F.draft, env);
      await audit.log('draft_recovered', { detail: newest ? `from revision ${newest.id}` : 'from the published document' });
      return env;
    }
  }

  async function snapshotUnlocked(reason, site, { note = '', actor = 'admin', rev } = {}) {
    if (!REASONS.has(reason)) throw new Error(`unknown revision reason ${reason}`);
    const canonical = canonicalize(site);
    const etag = sha256(canonical);
    const all = await listRevisionsRaw();
    if (all[0] && all[0].etag === etag) return { id: all[0].id, skipped: true };
    await mkdir(F.revisions, { recursive: true, mode: 0o700 });
    let ms = clock.now(), id;
    for (;;) { id = `${stamp(ms)}-${reason}-r${rev}`; if (!(await exists(join(F.revisions, id + '.json')))) break; ms += 1; }
    const doc = envelope({ kind: 'revision', id, rev, etag, reason, actor, createdAt: new Date(ms).toISOString(), note: String(note).slice(0, 200) }, site);
    await writeJsonAtomic(join(F.revisions, id + '.json'), doc);
    await pruneUnlocked();
    return { id, skipped: false };
  }

  async function pruneUnlocked() {
    const all = await listRevisionsRaw();
    const state = await readState();
    const keep = new Set(all.slice(0, KEEP_REVISIONS).map((r) => r.id));
    for (const r of all) {
      if (keep.has(r.id)) continue;
      if (r.reason === 'publish' && state && r.rev === state.publishedRev) continue; // the live one is never pruned
      await rm(join(F.revisions, r.id + '.json'), { force: true });
    }
  }

  async function writeDraftUnlocked(prev, site, validation) {
    const canonical = canonicalize(site);
    const env = envelope({ kind: 'draft', rev: prev.rev + 1, etag: sha256(canonical), savedAt: iso(), issues: { errors: validation.errors.length, warnings: validation.warnings.length } }, site);
    await writeJsonAtomic(F.draft, env);
    return env;
  }

  const store = {
    files: F,
    lock,
    today,
    checkDraft,

    async getDraft() { return draftUnlocked(); },
    async getPublished() { return readPublished(); },
    async getPublishState() { return readState(); },
    async isDirty() { const [d, p] = await Promise.all([draftUnlocked(), readPublished()]); return d.etag !== p.etag; },

    async saveDraft(site, { ifMatch, force = false, actor = 'admin' } = {}) {
      const checked = checkDraft(site); // before the lock: pure
      return lock('write', async () => {
        const cur = await draftUnlocked();
        if (!force && ifMatch !== cur.etag) throw new PreconditionError(cur);
        if (checked.etag === cur.etag) return { ...cur, validation: checked.validation, noop: true };
        if (force) await snapshotUnlocked('pre-overwrite', cur.site, { actor, rev: cur.rev });
        else {
          const newest = (await listRevisionsRaw())[0];
          if (!newest || clock.now() - Date.parse(newest.createdAt) > AUTOSAVE_SNAPSHOT_MS) await snapshotUnlocked('autosave', cur.site, { actor, rev: cur.rev });
        }
        const env = await writeDraftUnlocked(cur, checked.site, checked.validation);
        return { ...env, validation: checked.validation };
      }, { op: 'saveDraft' });
    },

    async discardDraft({ ifMatch, actor = 'admin' } = {}) {
      return lock('write', async () => {
        const cur = await draftUnlocked();
        if (ifMatch !== cur.etag) throw new PreconditionError(cur);
        const pub = await readPublished();
        await snapshotUnlocked('pre-discard', cur.site, { actor, rev: cur.rev });
        const env = await writeDraftUnlocked(cur, pub.site, validate(pub.site, vopts()));
        await audit.log('draft_discarded', { rev: env.rev });
        return env;
      }, { op: 'discardDraft' });
    },

    async importDraft(site, { actor = 'admin' } = {}) {
      const checked = checkDraft(site);
      return lock('write', async () => {
        const cur = await draftUnlocked();
        await snapshotUnlocked('pre-import', cur.site, { actor, rev: cur.rev });
        const env = await writeDraftUnlocked(cur, checked.site, checked.validation);
        await audit.log('import', { rev: env.rev });
        return { ...env, validation: checked.validation };
      }, { op: 'importDraft' });
    },

    async checkpoint({ note = '', site, actor = 'admin' } = {}) {
      const checked = site === undefined ? null : checkDraft(site);
      return lock('write', async () => {
        const cur = await draftUnlocked();
        const r = await snapshotUnlocked('checkpoint', checked ? checked.site : cur.site, { note, actor, rev: cur.rev });
        await audit.log('checkpoint', { rev: cur.rev, detail: r.id });
        return r;
      }, { op: 'checkpoint' });
    },

    async snapshot(reason, site, opts = {}) {
      return lock('write', async () => snapshotUnlocked(reason, site, opts), { op: 'snapshot' });
    },
    snapshotUnlocked,

    async listRevisions() {
      const all = await listRevisionsRaw();
      const state = await readState();
      return all.map(({ site, ...meta }) => ({
        ...meta, layout: site?.settings?.layout, palette: site?.settings?.palette,
        live: !!state && meta.reason === 'publish' && meta.rev === state.publishedRev,
      }));
    },

    async getRevision(id) {
      if (typeof id !== 'string' || !REVISION_ID_RE.test(id)) throw new NotFoundError('revision');
      try { return await readJson(join(F.revisions, id + '.json')); }
      catch (e) { if (e.code === 'ENOENT') throw new NotFoundError('revision'); throw e; }
    },

    async restoreRevision(id, { actor = 'admin' } = {}) {
      const rev = await store.getRevision(id);
      return lock('write', async () => {
        const cur = await draftUnlocked();
        await snapshotUnlocked('pre-restore', cur.site, { actor, rev: cur.rev });
        const env = await writeDraftUnlocked(cur, rev.site, validate(rev.site, vopts()));
        await audit.log('revision_restored', { rev: env.rev, detail: id });
        return env;
      }, { op: 'restoreRevision' });
    },

    /** Called by the publish pipeline under the publish lock (it takes the write lock itself). */
    async commitPublished({ rev, site, buildId, publishedAt = iso(), history, pendingCleared = true }) {
      return lock('write', async () => {
        const canonical = canonicalize(site);
        const etag = sha256(canonical);
        await writeJsonAtomic(F.site, envelope({ kind: 'published', rev, etag, publishedAt, buildId }, site));
        await snapshotUnlocked('publish', site, { actor: 'admin', rev });
        const prev = (await readState()) || { history: [] };
        const state = {
          current: buildId,
          history: history || [buildId, ...prev.history.filter((b) => b !== buildId)].slice(0, 10),
          publishedRev: rev, publishedEtag: etag, publishedAt,
          pending: pendingCleared ? null : prev.pending ?? null,
        };
        await writeJsonAtomic(F.state, state);
        await pruneUnlocked();
        return { etag, state };
      }, { op: 'commitPublished' });
    },

    /** Re-render or rollback commit: site.json (no new publish revision) + publish-state current/history, pending cleared. */
    async commitSite({ rev, site, buildId, publishedAt = iso() }) {
      return lock('write', async () => {
        const canonical = canonicalize(site);
        const etag = sha256(canonical);
        await writeJsonAtomic(F.site, envelope({ kind: 'published', rev, etag, publishedAt, buildId }, site));
        const prev = (await readState()) || { history: [] };
        const state = { current: buildId, history: [buildId, ...(prev.history || []).filter((b) => b !== buildId)].slice(0, 10), publishedRev: rev, publishedEtag: etag, publishedAt, pending: null };
        await writeJsonAtomic(F.state, state);
        return { etag, state };
      }, { op: 'commitSite' });
    },

    /**
     * After a publish that changed settings.updated: if the draft is still the one published, it becomes the
     * published document; if an autosave landed meanwhile, only settings.updated is copied onto it.
     */
    async adoptPublishedDate({ ifMatch, site }) {
      return lock('write', async () => {
        const cur = await draftUnlocked();
        const updated = site.settings.updated;
        if (cur.etag === ifMatch) {
          if (sha256(canonicalize(site)) === cur.etag) return cur;
          return writeDraftUnlocked(cur, site, validate(site, vopts()));
        }
        if (cur.site?.settings?.updated === updated) return cur;
        const s = structuredClone(cur.site);
        s.settings.updated = updated;
        return writeDraftUnlocked(cur, s, validate(s, vopts()));
      }, { op: 'adoptPublishedDate' });
    },

    async writePublishState(mutator) {
      return lock('write', async () => {
        const cur = (await readState()) || { current: null, history: [], publishedRev: null, publishedEtag: null, publishedAt: null, pending: null };
        const next = await mutator(structuredClone(cur));
        await writeJsonAtomic(F.state, next);
        return next;
      }, { op: 'writePublishState' });
    },

    /** First-boot content: site.json + draft.json at rev 1 from a document (seed or a build's .site.json). */
    async init(site, { source = 'seed' } = {}) {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await chmod(dataDir, 0o700).catch(() => {});
      for (const d of [F.revisions, F.locks, join(dataDir, 'backups')]) await mkdir(d, { recursive: true, mode: 0o700 });
      return lock('write', async () => {
        const haveSite = await exists(F.site), haveDraft = await exists(F.draft);
        if (haveSite && haveDraft) return { created: false };
        const s = withSiteUrl(site);
        const v = validate(s, vopts('build'));
        if (v.errors.length) throw new AppError(400, 'invalid', `${source} document is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`);
        const canonical = canonicalize(s), etag = sha256(canonical);
        if (!haveSite) await writeJsonAtomic(F.site, envelope({ kind: 'published', rev: 1, etag, publishedAt: null, buildId: null, source }, s));
        if (!haveDraft) {
          const pub = await readJson(F.site);
          await writeJsonAtomic(F.draft, envelope({ kind: 'draft', rev: pub.rev, etag: pub.etag, savedAt: iso(), issues: { errors: 0, warnings: v.warnings.length } }, pub.site));
        }
        return { created: true };
      }, { op: 'init' });
    },

    listRevisionsRaw,
    readState,
  };
  return store;
}
