// buildSite(site, opts) -> Map<path, { body, type, immutable }>: every file of a deployable site, in memory.
// Used by build.mjs (writes dist/), the admin publish pipeline and the admin preview (serves from memory).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validate, hrefError } from './schema/validate.mjs';
import { renderSite } from './render.mjs';
import { LAYOUTS } from './layouts/index.mjs';
import { loadPalettes, checkPalettes, paletteCss, parseColor } from './palettes.mjs';

const SRC = new URL('./', import.meta.url);
const md5 = (b) => createHash('md5').update(b).digest('hex').slice(0, 8);

export class BuildValidationError extends Error {
  constructor(errors) {
    super(`${errors.length} validation error(s)`);
    this.name = 'BuildValidationError';
    this.errors = errors;
  }
}

const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', png: 'image/png',
  woff2: 'font/woff2', webmanifest: 'application/manifest+json', htaccess: 'text/plain', svg: 'image/svg+xml',
};
const typeOf = (path) => TYPES[path.slice(path.lastIndexOf('.') + 1)] || 'application/octet-stream';

// Replace every link that fails the href rules with "#invalid-link" (preview of a draft with errors).
function neutraliseHrefs(site) {
  const s = structuredClone(site);
  const allow = ['https:', 'mailto:', 'tel:'];
  for (const it of s.contact?.items || []) if (hrefError(it.href, allow)) it.href = '#invalid-link';
  for (const it of s.sections?.experience?.items || []) if (it.orgHref && hrefError(it.orgHref, ['https:'])) it.orgHref = '#invalid-link';
  s.person.sameAs = (s.person?.sameAs || []).filter((h) => !hrefError(h, ['https:']));
  return s;
}

// Prefix root-relative href/src attributes with the preview base, except the language links "/" and "/ka/".
function rebase(html, base) {
  if (base === '/') return html;
  return html.replace(/(\s(?:href|src)=")\/(?!\/)([^"]*)"/g, (m, attr, rest) =>
    rest === '' || rest === 'ka/' || ('/' + rest).startsWith(base) ? m : `${attr}${base}${rest}"`);
}

/**
 * @param {object} site canonical site.json object
 * @param {{ mode?: 'publish'|'preview', base?: string, brand: object, today?: string, palettes?: object,
 *           after?: { siteUrl?: string, updated?: string } }} opts
 *   after: local-preview overrides applied to a copy AFTER validation (CLI only: SITE_URL, BUILD_DATE)
 */
export async function buildSite(site, { mode = 'publish', base = '/', brand, today, palettes = loadPalettes(), after } = {}) {
  if (!brand) throw new Error('buildSite: opts.brand is required');
  const warnings = [];
  const paletteIds = palettes.palettes.map((p) => p.id);

  // 1. validation
  if (mode === 'publish') {
    const { errors, warnings: w } = validate(site, { mode: 'build', layoutIds: Object.keys(LAYOUTS), paletteIds, today });
    warnings.push(...w);
    if (errors.length) throw new BuildValidationError(errors);
  } else {
    site = neutraliseHrefs(site);
  }
  if (after && (after.siteUrl || after.updated)) {
    site = structuredClone(site);
    if (after.siteUrl) site.settings.siteUrl = after.siteUrl;
    if (after.updated) site.settings.updated = after.updated;
  }

  // 2. layout and palette (unknown palette id falls back to the default with a warning)
  const layout = LAYOUTS[site.settings.layout] || LAYOUTS.precision;
  let pal = palettes.palettes.find((p) => p.id === site.settings.palette);
  if (!pal) {
    if (!warnings.some((w) => w.code === 'PALETTE_FALLBACK')) warnings.push({ code: 'PALETTE_FALLBACK', path: '$.settings.palette', msg: `unknown palette "${site.settings.palette}"; using "${palettes.default}"` });
    pal = palettes.palettes.find((p) => p.id === palettes.default);
  }
  const gate = checkPalettes(palettes);
  if (gate.failed > 0) throw new Error(`palette contrast gate failed: ${gate.failed} check(s)`);
  if (brand.palette && brand.palette !== pal.id) {
    warnings.push({ code: 'BRAND_STALE', path: '$.settings.palette', msg: `icons and OG cards stay ${brand.palette} until the brand renderer lands (M7)` });
  }

  const files = new Map();
  const put = (path, body, immutable) => files.set(path, { body, type: typeOf(path), immutable });

  // 3. CSS (layout files + the one active palette), script, fonts
  const cssParts = layout.meta.css.map((f) => readFileSync(new URL(`layouts/${layout.meta.id}/${f}`, SRC), 'utf8'));
  const css = cssParts.join('\n') + '\n' + paletteCss(pal, ':root', palettes.tokens) + '\n';
  const js = readFileSync(new URL('main.js', SRC), 'utf8');
  const cssName = `styles.${md5(css)}.css`;
  const jsName = `main.${md5(js)}.js`;
  put(cssName, css, true);
  put(jsName, js, true);
  for (const f of layout.meta.fonts) put(`fonts/${f}.woff2`, readFileSync(new URL(`fonts/${f}.woff2`, SRC)), true);

  // 4. brand files (already hash-named by the provider) and the manifest
  for (const [name, bytes] of brand.files) put(name, bytes, true);
  const icons = Object.fromEntries(Object.entries(brand.icons).map(([k, n]) => [k, base + n]));
  const palette = { id: pal.id, manifestTheme: parseColor(pal.light['--accent']).hex };
  const assets0 = { base, cssHref: base + cssName, jsHref: base + jsName, icons, og: { en: '/' + brand.og.en, ka: '/' + brand.og.ka } };

  // 5. pages. The manifest is rendered first so its hashed name can go into every <head>.
  const probe = renderSite(site, { layout, palette, assets: { ...assets0, manifestHref: '' } });
  const manifestName = `site.${md5(probe['site.webmanifest'])}.webmanifest`;
  const assets = { ...assets0, manifestHref: base + manifestName };
  const out = renderSite(site, { layout, palette, assets });
  put(manifestName, out['site.webmanifest'], true);
  for (const page of ['index.html', 'ka/index.html', '404.html']) put(page, rebase(out[page], base), false);
  if (mode === 'publish') {
    put('sitemap.xml', out['sitemap.xml'], false);
    put('robots.txt', out['robots.txt'], false);
    put('.htaccess', HTACCESS, false);
    put('_headers', HEADERS, false);
  }
  return Object.assign(files, { warnings, layoutId: layout.meta.id, paletteId: pal.id, cssName, jsName });
}

// Kept for parity with other hosts. OpenLiteSpeed reads only rewrite rules from .htaccess;
// the real headers, caching and 404 live in the vhost.
const HTACCESS = `ErrorDocument 404 /404.html

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
`;
const HEADERS = `/*
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
`;
