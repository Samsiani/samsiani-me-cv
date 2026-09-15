// Brand image renderer: satori (flexbox -> SVG) + resvg-wasm (SVG -> PNG). Pure JS/WASM, no native code.
// RENDERER_ID changes with the renderer versions, the card templates and the font bytes, so a change there
// produces new file names (the swap refuses new bytes under an old immutable name).
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { brandPlan, CARD_TEMPLATE_VERSION, ICON_TEMPLATE_VERSION } from '../shared/brand.mjs';

const require = createRequire(import.meta.url);
const FONT_DIR = new URL('./fonts/', import.meta.url);
const FONT_FILES = [
  ['Chivo', 'Chivo-Regular.ttf', 400], ['Chivo', 'Chivo-SemiBold.ttf', 600],
  ['JetBrains Mono', 'JetBrainsMono-Regular.ttf', 400], ['JetBrains Mono', 'JetBrainsMono-Medium.ttf', 500],
  ['Noto Sans Georgian', 'NotoSansGeorgian-Regular.ttf', 400], ['Noto Sans Georgian', 'NotoSansGeorgian-SemiBold.ttf', 600],
];
const FONTS = FONT_FILES.map(([name, file, weight]) => ({ name, weight, style: 'normal', data: readFileSync(new URL(file, FONT_DIR)) }));
const ROOT = new URL('../../', import.meta.url);
// read the installed version from the package directory (resvg-wasm does not export its package.json)
const version = (pkg) => JSON.parse(readFileSync(new URL(`node_modules/${pkg}/package.json`, ROOT), 'utf8')).version;
const fontsSha = createHash('sha256').update(Buffer.concat(FONTS.map((f) => f.data))).digest('hex').slice(0, 16);
export const RENDERER_ID = `satori@${version('satori')}+resvg-wasm@${version('@resvg/resvg-wasm')}+card${CARD_TEMPLATE_VERSION}+icon${ICON_TEMPLATE_VERSION}+fonts:${fontsSha}`;

let engine = null; // satori and the WASM load lazily, once
async function load() {
  if (!engine) {
    engine = (async () => {
      const [{ default: satori }, wasm, { ogCard, iconCard }] = await Promise.all([import('satori'), import('@resvg/resvg-wasm'), import('./cards.mjs')]);
      await wasm.initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      return { satori, Resvg: wasm.Resvg, ogCard, iconCard };
    })();
  }
  return engine;
}

export const stats = { renders: 0 }; // tests: proves a cache hit skips rendering

export async function renderPng(item) {
  const { satori, Resvg, ogCard, iconCard } = await load();
  const [w, h] = item.kind === 'og' ? [1200, 630] : [item.size, item.size];
  const tree = item.kind === 'og' ? ogCard(item.inputs) : iconCard(item.inputs, item.size);
  const svg = await satori(tree, { width: w, height: h, fonts: FONTS });
  stats.renders++;
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}

/**
 * Render (or reuse) every brand image for a site. A name found in the cache or in one of reuseDirs keeps
 * its existing bytes; only missing names are rendered, then written to the cache.
 * @returns {{ files: Map<string, Buffer>, og: { en, ka }, icons: { i32, i180, i192, i512 }, palette: string }}
 */
export async function renderBrand(site, palette, layoutMeta, { cacheDir, reuseDirs = [] } = {}) {
  const plan = brandPlan(site, palette, layoutMeta, RENDERER_ID);
  const files = new Map();
  if (cacheDir) await mkdir(cacheDir, { recursive: true });
  for (const item of plan) {
    let bytes = null;
    for (const d of [cacheDir, ...reuseDirs].filter(Boolean)) {
      try { bytes = await readFile(join(d, item.name)); break; } catch {}
    }
    if (!bytes) {
      bytes = await renderPng(item);
      if (cacheDir) await writeFile(join(cacheDir, item.name), bytes, { mode: 0o644 });
    }
    files.set(item.name, bytes);
  }
  return {
    files,
    og: Object.fromEntries(plan.filter((p) => p.kind === 'og').map((p) => [p.key, p.name])),
    icons: Object.fromEntries(plan.filter((p) => p.kind === 'icon').map((p) => [p.key, p.name])),
    palette: palette.id,
  };
}
