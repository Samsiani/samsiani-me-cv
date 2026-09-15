// Build the dependency set from a config (shared by index.mjs, the CLI and the tests).
import { createStore } from './lib/store.mjs';
import { createAuth } from './lib/auth.mjs';
import { createLimiter } from './lib/guard.mjs';
import { createAudit } from './lib/audit.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { loadPalettes } from '../../src/palettes.mjs';

export function createDeps(cfg, { clock = { now: () => Date.now() }, log, countRejected } = {}) {
  const paletteIds = loadPalettes().palettes.map((p) => p.id);
  const layoutIds = Object.keys(LAYOUTS);
  const audit = createAudit(cfg.dataDir, { clock });
  const store = createStore({ dataDir: cfg.dataDir, siteUrl: cfg.siteUrl, paletteIds, layoutIds, clock, audit });
  const auth = createAuth({ dataDir: cfg.dataDir, secrets: cfg.sessionSecrets, clock, audit });
  const limiter = createLimiter({ clock });
  return { cfg, clock, audit, store, auth, limiter, paletteIds, layoutIds, startedAt: new Date(clock.now()).toISOString(), log, countRejected };
}
