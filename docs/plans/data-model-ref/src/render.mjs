// Pure site renderer shared by build.mjs (writes dist/) and the admin preview (serves from memory).
// renderSite(site, { layout, palette, assets }) -> { 'index.html': string, ... } — no fs, no env.
import { LANGS, altOf, localize, siteContext } from './shared/localize.mjs';
import { renderDocument } from './shared/document.mjs';
import { sitemapXml, robotsTxt } from './shared/sitemap.mjs';
import { webmanifest } from './shared/manifest.mjs';

export function renderSite(site, { layout, palette, assets }) {
  const base = siteContext(site);
  const tree = Object.fromEntries(LANGS.map((l) => [l, localize(site, l)]));
  const page = (lang) => {
    const c = tree[lang];
    const ctx = { ...base, alt: tree[altOf(lang)], assets, layout: layout.meta };
    return renderDocument(c, ctx, layout.renderBody(c, ctx));
  };
  return {
    'index.html': page('en'),
    'ka/index.html': page('ka'),
    '404.html': page('en'),
    'sitemap.xml': sitemapXml(site),
    'robots.txt': robotsTxt(site),
    'site.webmanifest': webmanifest(site, layout.meta, palette),
  };
}
