// GET /admin/api/registry (admin-ops.md §4.7 row 9): static per release.
import { LAYOUTS } from '../../../src/layouts/index.mjs';
import { loadPalettes, checkPalettes, parseColor } from '../../../src/palettes.mjs';
import { buildSchema, limitsTable } from '../../../src/schema/validate.mjs';
import { SCHEMA_VERSION } from '../../../src/schema/migrate.mjs';
import { FONT_ROLES } from '../../../src/typography/roles.mjs';
import { LIMITS } from '../lib/fonts/store.mjs';

export function buildRegistry() {
  const palettes = loadPalettes();
  const checks = checkPalettes(palettes);
  const paletteHex = Object.fromEntries(palettes.palettes.map((p) => [p.id, {
    light: Object.fromEntries(Object.entries(p.light).map(([k, v]) => [k, parseColor(v).hex])),
    dark: Object.fromEntries(Object.entries(p.dark).map(([k, v]) => [k, parseColor(v).hex])),
  }]));
  const paletteMin = {};
  for (const row of checks.rows) {
    if (!LAYOUTS[row.layout]) continue;
    const m = Math.min(row.results['ink/bg'].ratio, row.results['ink/surf'].ratio);
    paletteMin[row.palette] ??= {};
    paletteMin[row.palette][row.layout] = Math.round(Math.min(paletteMin[row.palette][row.layout] ?? Infinity, m) * 100) / 100;
  }
  const paletteIds = palettes.palettes.map((p) => p.id);
  return {
    schemaVersion: SCHEMA_VERSION,
    layouts: Object.values(LAYOUTS).map(({ meta }) => ({ id: meta.id, label: meta.label, description: meta.description, thumbnail: meta.thumbnail ?? null, defaultTheme: meta.defaultTheme ?? null })),
    palettes,
    paletteChecks: checks.rows,
    paletteHex,
    paletteMin,
    // What the font picker shows per layout, and the sizes the upload form must state before it tries.
    fontRoles: Object.fromEntries(Object.values(LAYOUTS).map(({ meta }) => [meta.id, Object.fromEntries(
      FONT_ROLES.map((role) => {
        const r = meta.fontRoles[role];
        return [role, { label: r.label, help: r.help, defaultFamily: r.defaultFamily, weights: r.weights }];
      }),
    )])),
    fontLimits: { file: LIMITS.file, family: LIMITS.family, faces: LIMITS.faces, store: LIMITS.store, displayName: LIMITS.displayName, formats: ['woff2', 'woff', 'ttf', 'otf'] },
    limits: limitsTable(buildSchema({ paletteIds, layoutIds: Object.keys(LAYOUTS) })),
    schema: buildSchema({ paletteIds, layoutIds: Object.keys(LAYOUTS) }),
  };
}

export function registryRoute() {
  let cached = null;
  return (c) => c.json((cached ??= buildRegistry()));
}
