// Pure site renderer shared by buildSite() (build.mjs, publish) and the admin preview.
// renderSite(site, { layout, palette, assets }) -> { 'index.html': string, ... } — no fs, no env, no clock.
import { LANGS, altOf, localize, siteContext } from './shared/localize.mjs';
import { renderDocument } from './shared/document.mjs';
import { sitemapXml, robotsTxt } from './shared/sitemap.mjs';
import { webmanifest } from './shared/manifest.mjs';
import { effectiveTheme } from './shared/theme-init.mjs';

// Defaults keep the renderer usable on its own (tests, tools) without a full asset set.
const DEFAULT_ASSETS = {
  base: '/',
  cssHref: '/styles.css',
  jsHref: '/main.js',
  manifestHref: '/site.webmanifest',
  icons: { i32: '/favicon-32.png', i180: '/apple-touch-icon.png', i192: '/icon-192.png', i512: '/icon-512.png' },
  og: { en: '/og-en.png', ka: '/og-ka.png' },
};

export function renderSite(site, { layout, palette, assets = {} }) {
  const a = { ...DEFAULT_ASSETS, ...assets, icons: { ...DEFAULT_ASSETS.icons, ...(assets.icons || {}) } };
  const base = siteContext(site);
  const tree = Object.fromEntries(LANGS.map((l) => [l, localize(site, l)]));
  const ctx0 = {
    ...base,
    assets: a,
    layout: layout.meta,
    paletteId: palette.id,
    defaultTheme: effectiveTheme(site.settings.defaultTheme, layout.meta),
  };
  const page = (lang) => {
    const c = tree[lang];
    const ctx = { ...ctx0, alt: tree[altOf(lang)] };
    return renderDocument(c, ctx, layout.renderBody(c, ctx));
  };
  return {
    'index.html': page('en'),
    'ka/index.html': page('ka'),
    '404.html': page('en'),
    'sitemap.xml': sitemapXml(site),
    'robots.txt': robotsTxt(site),
    'site.webmanifest': webmanifest(site, layout.meta, palette, a),
  };
}
