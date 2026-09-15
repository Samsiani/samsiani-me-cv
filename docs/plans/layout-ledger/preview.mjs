// Layout C "Ledger" — preview harness. Builds a real dist/ through the data-model reference pipeline
// (docs/plans/data-model-ref) with the Ledger module in docs/plans/layout-ledger/src/layouts/ledger/,
// without touching the repository's src/ or build.mjs.
//
//   node docs/plans/layout-ledger/preview.mjs [--site docs/plans/site.example.json] [--palette cobalt] [--out <dir>]
//   node docs/plans/layout-ledger/verify.mjs <dir>          # acceptance checks on the result
//   node docs/plans/data-model-ref/scripts/check-layout-stress.mjs --dist <dir> --topnav .lg-nav
//
// Preview-only shortcuts (never in production):
//   * if the IBM Plex woff2 files are not in src/fonts/ yet, Plex is @imported from Google Fonts;
//   * the chosen palette block is appended to the layout CSS (the phase-1 reference build has no palette step);
//   * shared/document.mjs gets the one-line `headExtra` hook proposed in layout-ledger.md §9.2.
import { cp, mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const plans = join(here, '..');
const repo = join(plans, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = resolve(arg('--site', join(plans, 'site.example.json')));
const PALETTE = arg('--palette', 'cobalt');
const OUT = resolve(arg('--out', join(tmpdir(), 'ledger-dist')));

const ws = await mkdtemp(join(tmpdir(), 'ledger-ws-'));
await cp(join(plans, 'data-model-ref'), ws, { recursive: true });
await cp(join(here, 'src/layouts/ledger'), join(ws, 'src/layouts/ledger'), { recursive: true });
await mkdir(join(ws, 'src/fonts'), { recursive: true });
await cp(join(repo, 'src/fonts'), join(ws, 'src/fonts'), { recursive: true });
await cp(join(repo, 'src/main.js'), join(ws, 'src/main.js'));
for (const f of ['og-en.png', 'og-ka.png']) if (existsSync(join(repo, 'src', f))) await cp(join(repo, 'src', f), join(ws, 'src', f));
if (existsSync(join(repo, 'src/brand'))) await cp(join(repo, 'src/brand'), join(ws, 'src/brand'), { recursive: true });

// fonts: fall back to Google-hosted Plex when the self-hosted files are not in src/fonts yet
const meta = (await import(pathToFileURL(join(ws, 'src/layouts/ledger/layout.mjs')))).default;
const missing = meta.fonts.filter((f) => !existsSync(join(ws, 'src/fonts', `${f}.woff2`)));
if (missing.length) {
  const fontsCss = join(ws, 'src/layouts/ledger/fonts.css');
  const css = await readFile(fontsCss, 'utf8');
  const kept = css.split('@font-face').filter((block, i) => i === 0 || !missing.some((f) => block.includes(f))).join('@font-face');
  await writeFile(fontsCss, `@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100..700&family=IBM+Plex+Mono:wght@400;500&display=swap");\n${kept}`);
  console.warn(`preview: ${missing.join(', ')} not in src/fonts; using Google Fonts for IBM Plex`);
}

// register the layout (fonts filtered to the files that exist)
await writeFile(join(ws, 'src/layouts/index.mjs'), `import { existsSync } from 'node:fs';
import precision from './precision/layout.mjs';
import { renderBody as precisionBody } from './precision/template.mjs';
import ledgerMeta from './ledger/layout.mjs';
import { renderBody as ledgerBody } from './ledger/template.mjs';
const has = (f) => existsSync(new URL('../fonts/' + f + '.woff2', import.meta.url));
const ledger = { ...ledgerMeta, fonts: ledgerMeta.fonts.filter(has), preload: { en: ledgerMeta.preload.en.filter(has), ka: ledgerMeta.preload.ka.filter(has) } };
export const LAYOUTS = { precision: { meta: precision, renderBody: precisionBody }, ledger: { meta: ledger, renderBody: ledgerBody } };
`);

// the proposed one-line head hook
const docPath = join(ws, 'src/shared/document.mjs');
const doc = await readFile(docPath, 'utf8');
const hook = '<link rel="stylesheet" href="${assets.cssHref}">';
if (!doc.includes(hook)) throw new Error('document.mjs changed; update the headExtra hook patch');
await writeFile(docPath, doc.replace(hook, "${layout.headExtra ? layout.headExtra(c, ctx) : ''}\n" + hook));

// palette block from the palettes plan (appended after the layout CSS, as build.mjs will do in phase 2)
const { loadPalettes, paletteCss } = await import(pathToFileURL(join(plans, 'check-palettes.mjs')));
const palettes = loadPalettes();
const pal = palettes.palettes.find((p) => p.id === PALETTE);
if (!pal) throw new Error(`unknown palette ${PALETTE}; one of ${palettes.palettes.map((p) => p.id).join(', ')}`);
const stylesPath = join(ws, 'src/layouts/ledger/styles.css');
await writeFile(stylesPath, (await readFile(stylesPath, 'utf8')) + '\n' + paletteCss(pal, ':root', palettes.tokens));

await rm(OUT, { recursive: true, force: true });
execFileSync(process.execPath, ['build.mjs'], { cwd: ws, stdio: 'inherit', env: { ...process.env, LAYOUT: 'ledger', SITE_JSON: SITE, OUT_DIR: OUT } });
await rm(ws, { recursive: true, force: true });
console.log(`preview: ${OUT} (site ${SITE}, palette ${PALETTE})`);
