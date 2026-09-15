// Build the dependency set from a config (shared by index.mjs, the CLI and the tests).
import { createStore } from './lib/store.mjs';
import { createAuth } from './lib/auth.mjs';
import { createLimiter } from './lib/guard.mjs';
import { createAudit } from './lib/audit.mjs';
import { createPreviewStore } from './lib/preview.mjs';
import { createPublisher } from './lib/publish.mjs';
import { committedBrand } from '../../src/brand/committed.mjs';
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
  // M6: the committed cobalt icons and OG cards; M7 swaps in the renderer (names computed from content)
  const brand = async () => committedBrand();
  const previewBrand = () => committedBrand({ namesOnly: true });
  const publisher = createPublisher({ cfg, store, audit, clock, brand, paletteIds, layoutIds });
  return {
    cfg, clock, audit, store, auth, limiter, previews, publisher, previewBrand, paletteIds, layoutIds,
    reconcile: () => publisher.reconcile(),
    startedAt: new Date(clock.now()).toISOString(), log, countRejected,
  };
}
