// Shared HTML document shell + <head> for every layout.
// A layout contributes only renderBody(c, ctx) and its meta (preload fonts, theme-color).
import { esc, jsonForScript } from './escape.mjs';
import { themeInitScript } from './theme-init.mjs';
import { personJsonLd } from './jsonld.mjs';

export function renderHead(c, ctx) {
  const { siteUrl: site, alt, assets, layout } = ctx;
  const url = site + c.path;
  const altUrl = site + c.altPath;
  const ogImage = site + assets.og[c.lang];
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.meta.title)}</title>
<meta name="description" content="${esc(c.meta.description)}">
<meta name="author" content="${esc(ctx.authorName)}">
<meta name="color-scheme" content="light dark">
${themeColorMeta(layout, ctx.defaultTheme)}
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="${c.lang}" href="${url}">
<link rel="alternate" hreflang="${alt.lang}" href="${altUrl}">
<link rel="alternate" hreflang="x-default" href="${site}/">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(c.meta.title)}">
<meta property="og:description" content="${esc(c.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${esc(ctx.host)}">
<meta property="og:locale" content="${c.meta.ogLocale}">
<meta property="og:locale:alternate" content="${alt.meta.ogLocale}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${esc(c.hero.name)} — ${esc(c.hero.role)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="profile:first_name" content="${esc(c.hero.givenName)}">
<meta property="profile:last_name" content="${esc(c.hero.familyName)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.meta.title)}">
<meta name="twitter:description" content="${esc(c.meta.description)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="${assets.icons.i32}" type="image/png" sizes="32x32">
<link rel="icon" href="${assets.icons.i192}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${assets.icons.i180}">
<link rel="manifest" href="${assets.manifestHref}">
${layout.preload[c.lang].map((f) => `<link rel="preload" href="${assets.base}fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
${layout.headExtra ? layout.headExtra(c, ctx) : ''}<link rel="stylesheet" href="${assets.cssHref}">
${themeInitScript(ctx.defaultTheme)}
<script type="application/ld+json">${jsonForScript(personJsonLd(c, ctx))}</script>`;
}

// One meta pair following the OS for "system"; one fixed meta when the effective theme is explicit,
// so a first-time visitor on a light-OS phone gets a browser bar that matches a dark-first page.
function themeColorMeta(layout, theme) {
  if (theme === 'light' || theme === 'dark') return `<meta name="theme-color" content="${layout.themeColor[theme]}">`;
  return `<meta name="theme-color" content="${layout.themeColor.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${layout.themeColor.dark}" media="(prefers-color-scheme: dark)">`;
}

export function renderDocument(c, ctx, body) {
  const theme = ctx.defaultTheme === 'light' || ctx.defaultTheme === 'dark' ? ` data-theme="${ctx.defaultTheme}"` : '';
  return `<!doctype html>
<html lang="${c.lang}" dir="${c.dir}" data-layout="${esc(ctx.layout.id)}" data-palette="${esc(ctx.paletteId)}"${theme}>
<head>
${renderHead(c, ctx)}
</head>
<body>
<a class="skip" href="#main">${esc(c.ui.skip)}</a>

${body}

<script src="${ctx.assets.jsHref}" defer></script>
</body>
</html>
`;
}
