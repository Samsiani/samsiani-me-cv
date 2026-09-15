// sitemap.xml + robots.txt (moved from build.mjs). hreflang set comes from LOCALES.
import { LANGS, LOCALES, DEFAULT_LANG } from './localize.mjs';
import { esc } from './escape.mjs';

export function sitemapXml(site) {
  // escaped as defence in depth: the validator already restricts both to an origin and an ISO date
  const SITE = esc(site.settings.siteUrl);
  const updated = esc(site.settings.updated);
  const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${LOCALES[l].path}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map(
  (l) => `  <url>
    <loc>${SITE}${LOCALES[l].path}</loc>
    <lastmod>${updated}</lastmod>
${alts}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${LOCALES[DEFAULT_LANG].path}"/>
  </url>`
).join('\n')}
</urlset>
`;
}

export const robotsTxt = (site) => `User-agent: *\nAllow: /\n\nSitemap: ${site.settings.siteUrl}/sitemap.xml\n`;
