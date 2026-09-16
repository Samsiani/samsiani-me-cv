// Build the dependency set from a config (shared by index.mjs, the CLI and the tests).
import { createStore } from './lib/store.mjs';
import { createAuth } from './lib/auth.mjs';
import { createLimiter } from './lib/guard.mjs';
import { createAudit } from './lib/audit.mjs';
import { createPreviewStore } from './lib/preview.mjs';
import { createPublisher } from './lib/publish.mjs';
import { createFontStore } from './lib/fonts/store.mjs';
import { createGoogle } from './lib/fonts/google.mjs';
import { fixtureFetch, fixtureFrom } from './lib/fonts/fixture.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FONT_ID_RE } from '../../src/typography/roles.mjs';
import { renderBrand, RENDERER_ID } from '../../src/brand/render.mjs';
import { brandNames } from '../../src/shared/brand.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { loadPalettes } from '../../src/palettes.mjs';

export function createDeps(cfg, { clock = { now: () => Date.now() }, log, countRejected, fetchImpl } = {}) {
  const paletteIds = loadPalettes().palettes.map((p) => p.id);
  const layoutIds = Object.keys(LAYOUTS);
  const audit = createAudit(cfg.dataDir, { clock });
  const store = createStore({ dataDir: cfg.dataDir, siteUrl: cfg.siteUrl, paletteIds, layoutIds, clock, audit });
  const auth = createAuth({ dataDir: cfg.dataDir, secrets: cfg.sessionSecrets, clock, audit });
  const limiter = createLimiter({ clock });
  const previews = createPreviewStore({ clock, origin: cfg.publicOrigin });
  // Brand images: rendered from content at publish (cache in data/brand-cache, existing names reused from the
  // current build so a name always keeps its bytes); the preview only computes the names the publish will produce.
  const brand = (site, pal, layoutMeta, reuseDir) => renderBrand(site, pal, layoutMeta, { cacheDir: join(cfg.dataDir, 'brand-cache'), reuseDirs: reuseDir ? [reuseDir] : [] });
  const previewBrand = () => (site, pal, layoutMeta) => brandNames(site, pal, layoutMeta, RENDERER_ID);
  const publisher = createPublisher({ cfg, store, audit, clock, brand, paletteIds, layoutIds });
  // Which fonts may not be deleted: the draft, the live document and every build still on disk (a rollback
  // target must keep rendering). A build's manifest names them; one staged before this feature does not, so
  // its own copy of the document answers instead.
  const references = async () => {
    const out = [];
    const idsOf = (site) => Object.values(site?.settings?.fonts || {}).flatMap((r) => Object.values(r || {})).filter((v) => FONT_ID_RE.test(String(v)));
    for (const [source, read] of [['draft', () => store.getDraft()], ['published', () => store.getPublished()]]) {
      try { out.push({ source, ids: idsOf((await read()).site) }); } catch {}
    }
    for (const b of await publisher.listBuilds().catch(() => [])) {
      try {
        const m = await publisher.readManifest(b.buildId);
        const ids = m.fonts ? Object.values(m.fonts).filter((v) => FONT_ID_RE.test(String(v)))
          : idsOf(JSON.parse(await readFile(join(cfg.buildsDir, b.buildId, '.site.json'), 'utf8')));
        if (ids.length) out.push({ source: 'build', ids });
      } catch {}
    }
    return out;
  };
  const fonts = createFontStore({ dataDir: cfg.dataDir, audit, lock: store.lock, references });
  // Google is reached only through this fetch: the tests inject a fixture, and outside production
  // GOOGLE_FONTS_FIXTURE does the same for the e2e harness and local development.
  const fx = fetchImpl ? null : fixtureFrom(cfg);
  const google = createGoogle({ dataDir: cfg.dataDir, clock, fetchImpl: fetchImpl || (fx ? fixtureFetch(fx.dir, { offline: fx.offline }) : fetch) });
  return {
    cfg, clock, audit, store, auth, limiter, previews, publisher, previewBrand, fonts, google, paletteIds, layoutIds,
    reconcile: () => publisher.reconcile(),
    startedAt: new Date(clock.now()).toISOString(), log, countRejected,
  };
}
