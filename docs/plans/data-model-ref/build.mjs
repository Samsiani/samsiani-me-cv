// Zero-dependency static build: node build.mjs  ->  dist/
// Content: src/content/site.json (SITE_JSON=path overrides). Layout and palette come from site.json settings.
import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { validate } from './src/schema/validate.mjs';
import { renderSite } from './src/render.mjs';
import { LAYOUTS } from './src/layouts/index.mjs';

const SITE_JSON = process.env.SITE_JSON || 'src/content/site.json';
const OUT = process.env.OUT_DIR || 'dist';
const hash = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

// Phase 1: one palette, still baked into precision/styles.css. Phase 2 replaces this with
// src/palettes.json + src/palettes.mjs (docs/plans/palettes.md §5).
const PALETTES = { cobalt: { id: 'cobalt', css: '', manifestTheme: '#1a4fd6' } };

const site = JSON.parse(await readFile(SITE_JSON, 'utf8'));
// Test overrides (validated like any other value): LAYOUT=studio PALETTE=lime node build.mjs
if (process.env.LAYOUT) site.settings.layout = process.env.LAYOUT;
if (process.env.PALETTE) site.settings.palette = process.env.PALETTE;
const { errors, warnings } = validate(site, { mode: 'build', layoutIds: Object.keys(LAYOUTS), paletteIds: Object.keys(PALETTES) });
for (const w of warnings) console.warn(`warning ${w.code} ${w.path}: ${w.msg}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e.code} ${e.path}: ${e.msg}`);
  console.error(`${SITE_JSON}: ${errors.length} error(s); nothing was built`);
  process.exit(1);
}
// Local-preview overrides, applied after validation. CI never sets these.
if (process.env.SITE_URL) site.settings.siteUrl = process.env.SITE_URL;
if (process.env.BUILD_DATE) site.settings.updated = process.env.BUILD_DATE;

const layout = LAYOUTS[site.settings.layout];
const palette = PALETTES[site.settings.palette] || PALETTES.cobalt;

const css = (await Promise.all(layout.meta.css.map((f) => readFile(join('src/layouts', layout.meta.id, f), 'utf8')))).join('\n') + palette.css;
const js = await readFile('src/main.js', 'utf8');
const cssName = `styles.${hash(css)}.css`;
const jsName = `main.${hash(js)}.js`;
const assets = { cssHref: `/${cssName}`, jsHref: `/${jsName}`, og: { en: '/og-en.png', ka: '/og-ka.png' } };

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/ka`, { recursive: true });
await writeFile(`${OUT}/${cssName}`, css);
await writeFile(`${OUT}/${jsName}`, js);
await mkdir(`${OUT}/fonts`, { recursive: true });
for (const f of layout.meta.fonts) await cp(`src/fonts/${f}.woff2`, `${OUT}/fonts/${f}.woff2`);
for (const [from, to] of [
  ['src/og-en.png', 'og-en.png'],
  ['src/og-ka.png', 'og-ka.png'],
  ['src/brand/icon-32.png', 'favicon-32.png'],
  ['src/brand/icon-180.png', 'apple-touch-icon.png'],
  ['src/brand/icon-192.png', 'icon-192.png'],
  ['src/brand/icon-512.png', 'icon-512.png'],
]) {
  try { await cp(from, `${OUT}/${to}`); } catch (e) { console.warn('missing asset', from); }
}

for (const [name, body] of Object.entries(renderSite(site, { layout, palette, assets }))) {
  await mkdir(dirname(join(OUT, name)), { recursive: true });
  await writeFile(join(OUT, name), body);
}

// OpenLiteSpeed / Apache: caching + security headers + 404
await writeFile(
  `${OUT}/.htaccess`,
  `ErrorDocument 404 /404.html

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  <FilesMatch "\\.(woff2|css|js|svg|png|jpg|webp)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html|xml|txt)$">
    Header set Cache-Control "public, max-age=0, must-revalidate"
  </FilesMatch>
</IfModule>

<IfModule mod_mime.c>
  AddType font/woff2 .woff2
  AddType image/svg+xml .svg
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript image/svg+xml application/xml text/plain
</IfModule>
`
);
await writeFile(
  `${OUT}/_headers`,
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/styles.*.css
  Cache-Control: public, max-age=31536000, immutable
/main.*.js
  Cache-Control: public, max-age=31536000, immutable
`
);
console.log(`built ${OUT}/ (${layout.meta.id}, ${palette.id}, ${cssName}, ${jsName}) · updated ${site.settings.updated}`);
