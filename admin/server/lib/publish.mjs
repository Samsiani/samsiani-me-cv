// Publish pipeline, rollback and crash reconciliation (admin-ops.md §5.2, §5.7; master plan §8.7).
// Lock order is always publish -> write. Every staged build is complete on disk, so rollback is instant.
import { mkdir, writeFile, open, rename, rm, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { validate, canonicalize } from '../../../src/schema/validate.mjs';
import { upgrade } from '../../../src/schema/migrate.mjs';
import { buildSite, BuildValidationError } from '../../../src/build-site.mjs';
import { LAYOUTS } from '../../../src/layouts/index.mjs';
import { loadPalettes } from '../../../src/palettes.mjs';
import { withLock } from './lock.mjs';
import { fsyncDir, readJson } from './fsx.mjs';
import { applyBuild, ImmutableChangedError, sha256File, gcWebRoot, safeJoin } from './swap.mjs';
import { AppError, PreconditionError, NotFoundError } from './errors.mjs';
import { BUILD_ID_RE } from './store.mjs';
import { fontIssues } from './fonts/check.mjs';
import { purgeFixedUrls } from './cloudflare.mjs';

export const KEEP_BUILDS = 10;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const buildStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // 20260914T101502Z
// What counts as a content change for the publish date rule; the section order is content, the layout is not.
const CONTENT_KEYS = ['person', 'meta', 'ui', 'hero', 'contact', 'sections'];
const contentOf = (site) => JSON.stringify([...CONTENT_KEYS.map((k) => site[k]), site.settings?.sectionOrder]);

export class PublishError extends AppError {
  constructor(stage, message, details = {}) { super(500, 'publish_failed', message, { stage, ...details }); }
}

export const hooks = { afterSwap: null }; // test seam: simulate a crash between swap and commit

/**
 * @param {{ cfg, store, audit, clock, brand: (site) => Promise<{files, og, icons}>|object, fonts, paletteIds, layoutIds }} opts
 *   fonts: the font store, or null; without it every layout keeps its committed faces
 */
export function createPublisher({ cfg, store, audit, clock = { now: () => Date.now() }, brand, fonts = null, paletteIds, layoutIds }) {
  const locks = join(cfg.dataDir, 'locks');
  const buildsDir = cfg.buildsDir;
  const webRoot = cfg.webRoot;
  const palettes = loadPalettes();
  const dirOf = (id) => join(buildsDir, id);
  const readManifest = async (id) => {
    if (!BUILD_ID_RE.test(id)) throw new NotFoundError('build');
    try { return await readJson(join(dirOf(id), 'manifest.json')); } catch (e) { if (e.code === 'ENOENT') throw new AppError(404, 'unknown_build', `Unknown build ${id}.`); throw e; }
  };

  async function stageBuild(files, { buildId, rev, reason, site }) {
    await mkdir(buildsDir, { recursive: true, mode: 0o755 });
    const tmp = join(buildsDir, `.tmp-${buildId}`);
    await rm(tmp, { recursive: true, force: true });
    const manifest = {
      buildId, rev, createdAt: new Date(clock.now()).toISOString(), reason, release: cfg.release,
      layout: files.layoutId, palette: files.paletteId, fonts: files.fonts ?? null, updated: site.settings.updated, files: {},
    };
    try {
      const dirs = new Set([tmp]);
      for (const [rel, f] of files) {
        const p = safeJoin(tmp, rel);
        await mkdir(dirname(p), { recursive: true, mode: 0o755 });
        dirs.add(dirname(p));
        const body = typeof f.body === 'string' ? Buffer.from(f.body) : f.body;
        const fh = await open(p, 'wx', 0o644);
        try { await fh.writeFile(body); await fh.sync(); } finally { await fh.close(); }
        manifest.files[rel] = { sha256: sha256(body), bytes: body.length, immutable: !!f.immutable, type: f.type };
      }
      await writeFile(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
      await writeFile(join(tmp, '.site.json'), canonicalize(site), { mode: 0o644 });
      for (const d of dirs) await fsyncDir(d);
      await rename(tmp, dirOf(buildId));
      await fsyncDir(buildsDir);
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw new PublishError('stage', `Could not stage the build: ${e.message}`);
    }
    return manifest;
  }

  /** Every local href/src/url() resolves inside the build; both languages present; size limits. */
  async function verifyBuild(dir, manifest) {
    const missing = [];
    const has = (p) => Object.prototype.hasOwnProperty.call(manifest.files, p);
    const en = await readFile(join(dir, 'index.html'), 'utf8').catch(() => '');
    const ka = await readFile(join(dir, 'ka/index.html'), 'utf8').catch(() => '');
    if (!en.includes('<html lang="en"')) missing.push('index.html (lang=en)');
    if (!ka.includes('<html lang="ka"')) missing.push('ka/index.html (lang=ka)');
    if (!has('404.html')) missing.push('404.html');
    for (const page of ['index.html', 'ka/index.html', '404.html']) {
      const html = await readFile(join(dir, page), 'utf8').catch(() => '');
      for (const m of html.matchAll(/\s(?:href|src)="(\/[^"#?]*)[^"]*"/g)) {
        const ref = m[1];
        if (ref === '/' || ref === '/ka/' || ref.startsWith('//')) continue;
        if (!has(ref.slice(1))) missing.push(`${page} -> ${ref}`);
      }
      for (const m of html.matchAll(/<meta property="og:image" content="https?:\/\/[^/]+\/([^"]+)"/g)) if (!has(m[1])) missing.push(`${page} og:image -> /${m[1]}`);
    }
    for (const rel of Object.keys(manifest.files).filter((p) => p.endsWith('.css'))) {
      const css = await readFile(join(dir, rel), 'utf8');
      for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const u = m[2];
        if (/^(data:|https?:|#)/.test(u)) continue;
        const target = posix.normalize(posix.join(posix.dirname(rel), u.split(/[?#]/)[0]));
        if (!has(target)) missing.push(`${rel} -> ${u}`);
      }
    }
    const count = Object.keys(manifest.files).length;
    const bytes = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
    if (count >= 200) missing.push(`too many files (${count})`);
    if (bytes >= 10 * 1024 * 1024) missing.push(`too large (${bytes} bytes)`);
    return missing;
  }

  async function newBuildId(rev) {
    let ms = clock.now();
    for (;;) {
      const id = `${buildStamp(ms)}-r${rev}`;
      if (!existsSync(dirOf(id)) && !existsSync(join(buildsDir, `.tmp-${id}`))) return id;
      ms += 1000;
    }
  }

  async function keptManifests(state) {
    const ids = (state?.history || []).slice(0, 3);
    const out = [];
    for (const id of ids) { try { out.push(await readManifest(id)); } catch {} }
    return out;
  }

  async function pruneBuilds(state) {
    let names = [];
    try { names = (await readdir(buildsDir)).filter((n) => BUILD_ID_RE.test(n)).sort().reverse(); } catch { return; }
    // the newest builds, the live one and every build the publish history still names (rollback targets;
    // after a rollback to an old build, that build is history[1] of the next publish, whatever its age)
    const keep = new Set([...names.slice(0, KEEP_BUILDS), state?.current, ...(state?.history || [])].filter(Boolean));
    for (const n of names) if (!keep.has(n)) await rm(dirOf(n), { recursive: true, force: true });
  }

  async function listBuilds() {
    const state = await store.readState();
    let names = [];
    try { names = (await readdir(buildsDir)).filter((n) => BUILD_ID_RE.test(n)).sort().reverse(); } catch { return []; }
    const items = [];
    for (const n of names) {
      try {
        const m = await readManifest(n);
        items.push({ buildId: n, rev: m.rev, createdAt: m.createdAt, layout: m.layout, palette: m.palette, fonts: m.fonts ?? null, current: state?.current === n, files: Object.keys(m.files).length, bytes: Object.values(m.files).reduce((a, f) => a + f.bytes, 0) });
      } catch {}
    }
    return items;
  }

  /** Keep brand-cache files referenced by kept builds plus the newest 20. */
  async function pruneBrandCache() {
    const dir = join(cfg.dataDir, 'brand-cache');
    let names = [];
    try { names = await readdir(dir); } catch { return; }
    const keep = new Set();
    for (const b of await listBuilds()) { try { Object.keys((await readManifest(b.buildId)).files).forEach((f) => keep.add(f)); } catch {} }
    const withTime = [];
    for (const n of names) { try { withTime.push([n, (await stat(join(dir, n))).mtimeMs]); } catch {} }
    withTime.sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([n]) => keep.add(n));
    for (const [n] of withTime) if (!keep.has(n)) await rm(join(dir, n), { force: true });
  }

  async function clearPending() { await store.writePublishState((s) => ({ ...s, pending: null })); }

  async function publishLocked({ source = 'draft', reason = 'admin', ifMatch = null, acknowledgeWarnings = false, note = '', ifChanged = false }) {
    const t0 = Date.now();
    const today = store.today();
    // 2. load the source document
    let site, draftEnv = null, live = null;
    live = await store.getPublished();
    if (source === 'draft') {
      draftEnv = await store.getDraft();
      if (ifMatch !== draftEnv.etag) throw new PreconditionError(draftEnv);
      site = structuredClone(draftEnv.site);
    } else site = structuredClone(live.site);
    site.settings.siteUrl = cfg.siteUrl;
    // 3. full validation, plus the checks that need this machine's font store
    const v = validate(site, { mode: 'save', paletteIds, layoutIds, today });
    if (fonts) {
      const fi = await fontIssues(site, fonts);
      v.errors.push(...fi.errors);
      v.warnings.push(...fi.warnings);
    }
    if (v.errors.length) throw new AppError(400, 'invalid', 'The draft has errors; fix them before publishing.', { errors: v.errors });
    if (source === 'draft' && v.warnings.length && acknowledgeWarnings !== true) throw new AppError(409, 'warnings_unacknowledged', 'Review the warnings, then publish again.', { warnings: v.warnings });
    // 4. date rule: content changes set today's date; layout, palette or theme changes alone keep it
    let dateChanged = false;
    if (source === 'draft' && site.settings.autoUpdateDateOnPublish && contentOf(site) !== contentOf(live.site) && site.settings.updated !== today) {
      site.settings.updated = today;
      dateChanged = true;
    }
    const rev = source === 'draft' ? draftEnv.rev : live.rev;
    // 5. brand images: cache -> the current build (an existing name keeps its bytes) -> render.
    //    If rendering fails, the current build's images are reused and the publish carries og_stale.
    const warnings = [];
    const state0 = await store.readState();
    const reuseDir = state0?.current ? dirOf(state0.current) : null;
    const provider = async (s, pal, meta) => {
      try { return await brand(s, pal, meta, reuseDir); }
      catch (e) {
        if (!reuseDir) throw new PublishError('og', `Brand images failed: ${e.message}`);
        const m = await readManifest(state0.current);
        const pick = (re) => Object.keys(m.files).find((f) => re.test(f));
        const og = { en: pick(/^og-en\./), ka: pick(/^og-ka\./) };
        const icons = { i32: pick(/^favicon-32\./), i180: pick(/^apple-touch-icon\./), i192: pick(/^icon-192\./), i512: pick(/^icon-512\./) };
        const files = new Map();
        for (const n of [...Object.values(og), ...Object.values(icons)]) files.set(n, await readFile(join(reuseDir, n)));
        return { files, og, icons, palette: pal.id, warning: 'og_stale' };
      }
    };
    // 6. render
    let files;
    try { files = await buildSite(site, { mode: 'publish', base: '/', brand: provider, today, palettes, fonts: fonts?.loader() ?? null }); }
    catch (e) {
      if (e instanceof BuildValidationError) throw new AppError(400, 'invalid', 'The draft has errors.', { errors: e.errors });
      if (e instanceof PublishError) throw e;
      throw new PublishError('render', `Rendering failed: ${e.message}`);
    }
    if (files.warnings.some((w) => w.code === 'og_stale')) warnings.push('og_stale');
    // 7. stage
    const buildId = await newBuildId(rev);
    const manifest = await stageBuild(files, { buildId, rev, reason, site });
    const dir = dirOf(buildId);
    // 8. verify
    const missing = await verifyBuild(dir, manifest);
    if (missing.length) { await rm(dir, { recursive: true, force: true }); throw new PublishError('verify', 'The build references files it does not contain.', { missing }); }
    // 9. --if-changed: compare with the real web root, not the last manifest (repairs drift too)
    if (ifChanged) {
      let plan;
      try { plan = await applyBuild(dir, webRoot, manifest, { dryRun: true }); }
      catch (e) { await rm(dir, { recursive: true, force: true }); if (e instanceof ImmutableChangedError) throw new PublishError('swap', e.message, { code: e.code, path: e.path }); throw e; }
      if (!plan.changed) { await rm(dir, { recursive: true, force: true }); return { unchanged: true, publishedRev: rev, buildId: live.buildId, changedFiles: 0 }; }
    }
    // 10. write-ahead record
    const startedAt = new Date(clock.now()).toISOString();
    const prevState = await store.writePublishState((s) => ({ ...s, pending: { buildId, rev, source, draftEtag: ifMatch ?? null, startedAt } }));
    // 11. swap
    let swap;
    try { swap = await applyBuild(dir, webRoot, manifest); }
    catch (e) {
      if (e instanceof ImmutableChangedError) {
        await clearPending(); await rm(dir, { recursive: true, force: true });
        await audit.log('publish_failed', { rev, buildId, detail: `swap: ${e.message}` });
        throw new PublishError('swap', e.message, { code: e.code, path: e.path });
      }
      if (prevState.current) { try { await applyBuild(dirOf(prevState.current), webRoot, await readManifest(prevState.current)); } catch (e2) { process.stderr.write(`auto-rollback failed: ${e2.message}\n`); } }
      await clearPending();
      await audit.log('publish_failed', { rev, buildId, detail: `swap: ${e.message}; previous build re-applied` });
      throw new PublishError('swap', `The swap failed and the previous build was re-applied: ${e.message}`);
    }
    if (hooks.afterSwap) await hooks.afterSwap({ buildId });
    // 12. commit
    const publishedAt = new Date(clock.now()).toISOString();
    let draftOut = null;
    try {
      if (source === 'draft') {
        await store.commitPublished({ rev, site, buildId, publishedAt });
        const d = dateChanged ? await store.adoptPublishedDate({ ifMatch, site }) : await store.getDraft();
        draftOut = { rev: d.rev, etag: d.etag, updated: d.site.settings.updated };
      } else {
        await store.commitSite({ rev, site: live.site, buildId, publishedAt: live.publishedAt || publishedAt });
      }
    } catch (e) {
      throw new PublishError('commit', `The new build is live but recording it failed (${e.message}); it will be reconciled at the next start.`);
    }
    await audit.log('publish', { rev, buildId, detail: `${swap.changed} files changed in ${Date.now() - t0} ms${note ? `; ${String(note).slice(0, 200)}` : ''}` });
    // 13. purge, prune, GC
    const purge = await purgeFixedUrls(cfg);
    if (purge.warning) warnings.push(purge.warning);
    const state = await store.readState();
    await pruneBuilds(state);
    await gcWebRoot(webRoot, await keptManifests(state), { now: clock.now() }).catch(() => {});
    await pruneBrandCache().catch(() => {});
    return {
      publishedRev: rev, buildId, publishedAt, durationMs: Date.now() - t0, changedFiles: swap.changed,
      og: { en: files.brand.og.en, ka: files.brand.og.ka }, updated: site.settings.updated, draft: draftOut, warnings: [...warnings, ...v.warnings],
    };
  }

  const api = {
    listBuilds,
    readManifest,

    publish(opts = {}) {
      return withLock(locks, 'publish', () => publishLocked(opts), { timeoutMs: opts.lockTimeoutMs ?? 3000, op: 'publish' });
    },

    rollback({ buildId, lockTimeoutMs = 3000 } = {}) {
      return withLock(locks, 'publish', async () => {
        const state = await store.readState();
        if (!state?.current) throw new AppError(404, 'unknown_build', 'Nothing has been published yet.');
        // default: the build that was live before the current one (publish history, newest first)
        const target = buildId ?? (state.history || []).find((id) => id !== state.current && existsSync(join(dirOf(id), 'manifest.json')));
        if (!target || !BUILD_ID_RE.test(target)) throw new AppError(404, 'unknown_build', 'There is no earlier build to roll back to.');
        const manifest = await readManifest(target);
        const site = upgrade(JSON.parse(await readFile(join(dirOf(target), '.site.json'), 'utf8')));
        const pub = await store.getPublished();
        await store.snapshot('pre-rollback', pub.site, { actor: 'admin', rev: pub.rev });
        await store.writePublishState((s) => ({ ...s, pending: { buildId: target, rev: manifest.rev, source: 'rollback', draftEtag: null, startedAt: new Date(clock.now()).toISOString() } }));
        const t0 = Date.now();
        await applyBuild(dirOf(target), webRoot, manifest);
        await store.commitSite({ rev: manifest.rev, site, buildId: target });
        await audit.log('rollback', { rev: manifest.rev, buildId: target, detail: `${Date.now() - t0} ms` });
        return { current: target, rev: manifest.rev };
      }, { timeoutMs: lockTimeoutMs, op: 'rollback' });
    },

    /** Finish or revert an interrupted publish/rollback. Called at boot and by every writing CLI command. */
    reconcile({ lockTimeoutMs = 120_000 } = {}) {
      return withLock(locks, 'publish', async () => {
        const state = await store.readState();
        const p = state?.pending;
        if (!p) return { action: 'none' };
        let live = false, manifest = null;
        try {
          manifest = await readManifest(p.buildId);
          const [en, ka] = await Promise.all(['index.html', 'ka/index.html'].map((f) => sha256File(join(webRoot, f)).catch(() => null)));
          live = en === manifest.files['index.html']?.sha256 && ka === manifest.files['ka/index.html']?.sha256;
        } catch {}
        if (live && existsSync(join(dirOf(p.buildId), '.site.json'))) {
          const site = upgrade(JSON.parse(await readFile(join(dirOf(p.buildId), '.site.json'), 'utf8')));
          if (p.source === 'draft') {
            await store.commitPublished({ rev: p.rev, site, buildId: p.buildId });
            const d = await store.getDraft();
            if (d.site.settings.updated !== site.settings.updated) await store.adoptPublishedDate({ ifMatch: p.draftEtag, site });
          } else {
            await store.commitSite({ rev: manifest.rev ?? p.rev, site, buildId: p.buildId });
          }
          await audit.log('publish_recovered', { rev: p.rev, buildId: p.buildId });
          return { action: 'recovered', buildId: p.buildId };
        }
        if (state.current) { try { await applyBuild(dirOf(state.current), webRoot, await readManifest(state.current)); } catch (e) { process.stderr.write(`reconcile: re-applying ${state.current} failed: ${e.message}\n`); } }
        await clearPending();
        await audit.log('publish_reverted', { rev: p.rev, buildId: p.buildId });
        return { action: 'reverted', buildId: p.buildId };
      }, { timeoutMs: lockTimeoutMs, op: 'reconcile' });
    },

    /** Files in the web root that differ from the current manifest (drift check). */
    async verifyWebRoot() {
      const state = await store.readState();
      if (!state?.current) return { current: null, differ: [] };
      const m = await readManifest(state.current);
      const differ = [];
      for (const [rel, f] of Object.entries(m.files)) {
        const cur = await sha256File(join(webRoot, rel)).catch(() => null);
        if (cur !== f.sha256) differ.push(rel);
      }
      return { current: state.current, differ };
    },
  };
  return api;
}

export { stat };
