// Pure site renderer shared by buildSite() (build.mjs, publish) and the admin preview.
// renderSite(site, { layout, palette, assets, fonts }) -> { 'index.html': string, ... } — no fs, no env, no clock.
import { LANGS, altOf, localize, siteContext } from './shared/localize.mjs';
import { NO_FONTS } from './typography/resolve.mjs';
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
  icons: { i32: '/unbuilt/icon-32', i180: '/unbuilt/icon-180', i192: '/unbuilt/icon-192', i512: '/unbuilt/icon-512' },
  og: { en: '/unbuilt/card-en', ka: '/unbuilt/card-ka' }, // real names always come from buildSite()
};

export function renderSite(site, { layout, palette, assets = {}, fonts = NO_FONTS }) {
  const a = { ...DEFAULT_ASSETS, ...assets, icons: { ...DEFAULT_ASSETS.icons, ...(assets.icons || {}) } };
  const base = siteContext(site);
  const tree = Object.fromEntries(LANGS.map((l) => [l, localize(site, l)]));
  const ctx0 = {
    ...base,
    assets: a,
    fonts,
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
