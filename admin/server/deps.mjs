// Build the dependency set from a config (shared by index.mjs, the CLI and the tests).
import { createStore } from './lib/store.mjs';
import { createAuth } from './lib/auth.mjs';
import { createLimiter } from './lib/guard.mjs';
import { createAudit } from './lib/audit.mjs';
import { createPreviewStore } from './lib/preview.mjs';
import { createPublisher } from './lib/publish.mjs';
import { join } from 'node:path';
import { renderBrand, RENDERER_ID } from '../../src/brand/render.mjs';
import { brandNames } from '../../src/shared/brand.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { loadPalettes } from '../../src/palettes.mjs';

export function createDeps(cfg, { clock = { now: () => Date.now() }, log, countRejected } = {}) {
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
  return {
    cfg, clock, audit, store, auth, limiter, previews, publisher, previewBrand, paletteIds, layoutIds,
    reconcile: () => publisher.reconcile(),
    startedAt: new Date(clock.now()).toISOString(), log, countRejected,
  };
}
