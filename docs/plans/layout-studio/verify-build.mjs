// Builds the Studio reference (this folder) through the shared shell, for review before and after
// the refactor. Zero dependencies. Spec: docs/plans/layout-studio.md §8.
//
//   node docs/plans/layout-studio/verify-build.mjs <site.json> <outDir> [palette=lime] [--serve <port>]
//
// Resolves, in order: shared modules  <repo>/src/shared  else  docs/plans/data-model-ref/src/shared
//                     palette module  <repo>/src/palettes.mjs  else  docs/plans/check-palettes.mjs
//                     fonts           $FONTS_DIR  else  <repo>/src/fonts   (must hold archivo-latin-wdth-wght.woff2, §7)
// The document wrapper below is the proposed shared-shell change of §0.3 (data-theme default + html data attributes).
import { mkdir, writeFile, readFile, cp, rm, mkdtemp, symlink, access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const exists = (p) => access(p).then(() => true, () => false);
const args = process.argv.slice(2);
const serveAt = args.includes('--serve') ? Number(args[args.indexOf('--serve') + 1]) : 0;
const [siteFile, outDir, palId = 'lime'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--serve');
if (!siteFile || !outDir) throw new Error('usage: verify-build.mjs <site.json> <outDir> [palette] [--serve <port>]');

const sharedDir = (await exists(join(REPO, 'src/shared/document.mjs'))) ? join(REPO, 'src/shared') : join(REPO, 'docs/plans/data-model-ref/src/shared');
const paletteMod = (await exists(join(REPO, 'src/palettes.mjs'))) ? join(REPO, 'src/palettes.mjs') : join(REPO, 'docs/plans/check-palettes.mjs');
const fontsDir = process.env.FONTS_DIR || join(REPO, 'src/fonts');

// target layout: <tmp>/src/layouts/studio/* + <tmp>/src/shared -> the real shared modules
const tmp = await mkdtemp(join(tmpdir(), 'studio-verify-'));
await mkdir(join(tmp, 'src/layouts/studio'), { recursive: true });
for (const f of ['layout.mjs', 'template.mjs', 'fonts.css', 'styles.css']) await cp(join(HERE, f), join(tmp, 'src/layouts/studio', f));
await symlink(sharedDir, join(tmp, 'src/shared'));

const { LANGS, altOf, localize, siteContext } = await import(join(tmp, 'src/shared/localize.mjs'));
const { renderHead } = await import(join(tmp, 'src/shared/document.mjs'));
const { esc } = await import(join(tmp, 'src/shared/escape.mjs'));
const { loadPalettes, paletteCss } = await import(paletteMod);
const meta = (await import(join(tmp, 'src/layouts/studio/layout.mjs'))).default;
const { renderBody } = await import(join(tmp, 'src/layouts/studio/template.mjs'));

const site = JSON.parse(await readFile(resolve(siteFile), 'utf8'));
site.settings.layout = 'studio';
site.settings.palette = palId;
const palettes = loadPalettes();
const pal = palettes.palettes.find((p) => p.id === palId);
if (!pal) throw new Error(`unknown palette ${palId}`);
const hash = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);
const css = (await Promise.all(meta.css.map((f) => readFile(join(HERE, f), 'utf8')))).join('\n') + '\n' + paletteCss(pal, ':root', palettes.tokens);
const js = await readFile(join(REPO, 'src/main.js'), 'utf8');
const cssName = `styles.${hash(css)}.css`;
const jsName = `main.${hash(js)}.js`;

const out = resolve(outDir);
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'ka'), { recursive: true });
await mkdir(join(out, 'fonts'), { recursive: true });
await writeFile(join(out, cssName), css);
await writeFile(join(out, jsName), js);
for (const f of meta.fonts) {
  const src = join(fontsDir, `${f}.woff2`);
  if (!(await exists(src))) throw new Error(`missing font ${src} (see docs/plans/layout-studio.md §7)`);
  await cp(src, join(out, 'fonts', `${f}.woff2`));
}

// proposed shared-shell change (§0.3): effective default theme = settings.defaultTheme unless "system",
// then the layout's defaultTheme; emitted both into the init script and as <html data-theme> for no-JS visitors
const renderDocument = (c, ctx, body) => {
  const theme = ctx.defaultTheme === 'system' && ctx.layout.defaultTheme ? ctx.layout.defaultTheme : ctx.defaultTheme;
  const themeAttr = theme === 'light' || theme === 'dark' ? ` data-theme="${theme}"` : '';
  return `<!doctype html>
<html lang="${c.lang}" dir="${c.dir}" data-layout="${ctx.layout.id}" data-palette="${esc(ctx.palette)}"${themeAttr}>
<head>
${renderHead(c, { ...ctx, defaultTheme: theme })}
</head>
<body>
<a class="skip" href="#main">${esc(c.ui.skip)}</a>

${body}

<script src="${ctx.assets.jsHref}" defer></script>
</body>
</html>
`;
};
const base = siteContext(site);
const tree = Object.fromEntries(LANGS.map((l) => [l, localize(site, l)]));
const assets = { cssHref: `/${cssName}`, jsHref: `/${jsName}`, og: { en: '/og-en.png', ka: '/og-ka.png' } };
for (const lang of LANGS) {
  const c = tree[lang];
  const ctx = { ...base, palette: palId, alt: tree[altOf(lang)], assets, layout: meta };
  await writeFile(join(out, lang === 'en' ? 'index.html' : 'ka/index.html'), renderDocument(c, ctx, renderBody(c, ctx)));
}
await rm(tmp, { recursive: true, force: true });
console.log(`built ${out} (studio, ${palId}, ${cssName}, ${(css.length / 1024).toFixed(1)} KB CSS)`);

if (serveAt) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(out, p);
    try { await stat(f); res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); }
    catch { res.writeHead(404); res.end('404'); }
  }).listen(serveAt, () => console.log(`serving http://localhost:${serveAt}`));
}
