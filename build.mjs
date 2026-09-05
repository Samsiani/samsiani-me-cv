// Zero-dependency static build: node build.mjs  ->  dist/
import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { render } from './src/template.mjs';
import en from './src/content/en.mjs';
import ka from './src/content/ka.mjs';

const SITE = process.env.SITE_URL || 'https://samsiani.me';
const updated = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const hash = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

await rm('dist', { recursive: true, force: true });
await mkdir('dist/ka', { recursive: true });

const css = (await readFile('src/fonts.css', 'utf8')) + '\n' + (await readFile('src/styles.css', 'utf8'));
const js = await readFile('src/main.js', 'utf8');
const cssName = `styles.${hash(css)}.css`;
const jsName = `main.${hash(js)}.js`;
await writeFile(`dist/${cssName}`, css);
await writeFile(`dist/${jsName}`, js);
await cp('src/fonts', 'dist/fonts', { recursive: true });
await cp('src/favicon.svg', 'dist/favicon.svg');
for (const f of ['og-en.png', 'og-ka.png', 'apple-touch-icon.png']) {
  try { await cp(`src/${f}`, `dist/${f}`); } catch {}
}

const ctx = { site: SITE, cssHref: `/${cssName}`, jsHref: `/${jsName}`, updated };
await writeFile('dist/index.html', render(en, { ...ctx, alt: ka }));
await writeFile('dist/ka/index.html', render(ka, { ...ctx, alt: en }));
await writeFile('dist/404.html', render(en, { ...ctx, alt: ka }));

await writeFile(
  'dist/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[en, ka]
  .map(
    (c) => `  <url>
    <loc>${SITE}${c.path}</loc>
    <lastmod>${updated}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/"/>
    <xhtml:link rel="alternate" hreflang="ka" href="${SITE}/ka/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>
  </url>`
  )
  .join('\n')}
</urlset>
`
);
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// OpenLiteSpeed / Apache: caching + security headers + 404
await writeFile(
  'dist/.htaccess',
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
  'dist/_headers',
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
console.log(`built dist/ (${cssName}, ${jsName}) · updated ${updated}`);
