// Static per-release data from GET /registry (admin-ops.md §4.7 row 9): layouts, palettes.json, palette
// check rows, paletteHex, paletteMin, limitsTable() and buildSchema(). The SPA never imports src/palettes.mjs
// (it needs node:fs) and never converts colours itself.
import { shallowReactive, markRaw } from 'vue';
import { api } from '../api.js';

export const registry = shallowReactive({
  loaded: false,
  layouts: [],
  palettes: null, // palettes.json: { default, tokens, layouts: { <id>: { light: { bg, surface, ink }, dark } }, palettes: [...] }
  paletteHex: {},
  paletteMin: {},
  paletteChecks: [],
  limits: [],
  schema: null, // buildSchema() as JSON (patterns do not survive JSON; the validator keeps them)
  layoutIds: [],
  paletteIds: [],
  fontRoles: {}, // <layoutId>: { text: { label, help, defaultFamily, weights }, label, georgian }
  fontLimits: null, // { file, family, faces, store, displayName, formats }
});

const limitByPath = new Map();
let loading = null;

export function loadRegistry() {
  loading ??= api('GET', '/registry').then((r) => {
    for (const row of r.limits) limitByPath.set(row.path, row.max);
    Object.assign(registry, {
      layouts: markRaw(r.layouts),
      palettes: markRaw(r.palettes),
      paletteHex: markRaw(r.paletteHex),
      paletteMin: markRaw(r.paletteMin),
      paletteChecks: markRaw(r.paletteChecks),
      limits: markRaw(r.limits),
      schema: markRaw(r.schema),
      fontRoles: markRaw(r.fontRoles || {}),
      fontLimits: markRaw(r.fontLimits || null),
      layoutIds: r.layouts.map((l) => l.id),
      paletteIds: r.palettes.palettes.map((p) => p.id),
      loaded: true,
    });
    return registry;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

/** Max length for a generic schema path such as "sections.skills.groups[].items[].name". */
export const maxFor = (genericPath) => limitByPath.get(genericPath);
export const layoutById = (id) => registry.layouts.find((l) => l.id === id) || null;
export const paletteById = (id) => registry.palettes?.palettes.find((p) => p.id === id) || null;
