// CLI over buildSite(): node build.mjs  ->  dist/
// Content: src/content/site.json (SITE_JSON=path overrides; a server envelope { kind, ..., site } is accepted).
// Test overrides validated like any value: LAYOUT=studio PALETTE=lime node build.mjs
// Local-preview overrides applied after validation: SITE_URL=http://localhost:4173 BUILD_DATE=2026-06-07
// Chosen fonts: FONTS_DIR=<a font store: index.json + files/> node build.mjs (the admin passes its own store)
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildSite, BuildValidationError } from './src/build-site.mjs';
import { upgrade } from './src/schema/migrate.mjs';
import { renderBrand } from './src/brand/render.mjs';
import { fileLoader } from './src/typography/resolve.mjs';

const SITE_JSON = process.env.SITE_JSON || 'src/content/site.json';
const OUT = process.env.OUT_DIR || 'dist';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date());

const raw = JSON.parse(await readFile(SITE_JSON, 'utf8'));
const site = upgrade(raw && raw.kind && raw.site ? raw.site : raw); // a build directory's .site.json may be older
if (process.env.LAYOUT) site.settings.layout = process.env.LAYOUT;
if (process.env.PALETTE) site.settings.palette = process.env.PALETTE;

let files;
try {
  files = await buildSite(site, {
    mode: 'publish',
    brand: (s, pal, layoutMeta) => renderBrand(s, pal, layoutMeta, { cacheDir: '.cache/brand' }),
    fonts: process.env.FONTS_DIR ? fileLoader(process.env.FONTS_DIR) : null,
    today,
    after: { siteUrl: process.env.SITE_URL, updated: process.env.BUILD_DATE },
  });
} catch (e) {
  if (e instanceof BuildValidationError) {
    for (const x of e.errors) console.error(`error ${x.code} ${x.path}: ${x.msg}`);
    console.error(`${SITE_JSON}: ${e.errors.length} error(s); nothing was built`);
  } else console.error(e.message);
  process.exit(1);
}
for (const w of files.warnings) console.warn(`warning ${w.code} ${w.path}: ${w.msg}`);

await rm(OUT, { recursive: true, force: true });
for (const [name, f] of files) {
  await mkdir(dirname(join(OUT, name)), { recursive: true });
  await writeFile(join(OUT, name), f.body);
}
console.log(`built ${OUT}/ (${files.layoutId}, ${files.paletteId}, ${files.cssName}, ${files.jsName}) · updated ${site.settings.updated}`);
