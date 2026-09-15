// Layout robustness gate: serve a built dist/ and fail on horizontal overflow or a wrapping top nav.
// Usage:
//   SITE_JSON=docs/plans/site.stress.json OUT_DIR=/tmp/dist-stress node build.mjs
//   node scripts/check-layout-stress.mjs --dist /tmp/dist-stress [--topnav ".topnav"]
// Playwright is not a project dependency: PLAYWRIGHT=/path/to/playwright/index.mjs (default: the owner's Mac path).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = resolve(arg('--dist', 'dist'));
const TOPNAV = arg('--topnav', '.topnav');
const PORT = Number(arg('--port', 4196));
const WIDTHS = [320, 360, 400, 600, 720, 1080, 1280, 1360, 1440, 1600, 1680, 1920];
const { chromium } = await import(process.env.PLAYWRIGHT || '/Users/george/Documents/codeon/node_modules/playwright/index.mjs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { const f = join(ROOT, p); await stat(f); res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); }
  catch { res.writeHead(404); res.end(); }
}).listen(PORT);

const browser = await chromium.launch();
const failures = [];
for (const lang of ['en', 'ka']) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}${lang === 'ka' ? '/ka/' : '/'}`);
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate((TOPNAV) => {
      const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; };
      const overX = document.documentElement.scrollWidth - innerWidth;
      const offenders = overX > 0 ? [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(-3).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`) : [];
      const nav = document.querySelector(TOPNAV);
      const shown = nav && getComputedStyle(nav).display !== 'none' && nav.offsetParent !== null;
      const wrapped = shown ? [...nav.querySelectorAll('a')].filter((a) => lines(a) > 1).map((a) => a.textContent.trim()) : [];
      const clipped = shown && nav.scrollWidth > nav.clientWidth + 1;
      return { overX, offenders, wrapped, clipped };
    }, TOPNAV);
    if (r.overX > 0) failures.push(`${lang} ${w}px: page scrolls horizontally by ${r.overX}px (${r.offenders.join(', ')})`);
    if (r.wrapped.length) failures.push(`${lang} ${w}px: top nav links wrap: ${r.wrapped.join(' | ')}`);
    if (r.clipped) failures.push(`${lang} ${w}px: top nav overflows its box`);
    await ctx.close();
  }
}
await browser.close();
srv.close();
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exit(1); }
console.log(`PASS: ${WIDTHS.length * 2} viewport checks, no horizontal overflow, top nav never wraps (${ROOT})`);
