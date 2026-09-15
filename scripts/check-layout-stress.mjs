// Layout robustness gate: serve a built site and fail on horizontal overflow, a wrapping top nav,
// or a header row that runs past the viewport edge.
//   SITE_JSON=test/fixtures/site.stress.json OUT_DIR=/tmp/dist-stress node build.mjs
//   node scripts/check-layout-stress.mjs --dist /tmp/dist-stress [--topnav ".topnav"]
import { chromium } from 'playwright';
import { openTarget, gotoChecked, argOf } from './lib/serve-dir.mjs';

const DIST = argOf('--dist', 'dist');
const TOPNAV = argOf('--topnav', '.topnav, .st-nav, .lg-nav');
const WIDTHS = [320, 360, 400, 600, 720, 1080, 1280, 1360, 1440, 1600, 1680, 1920];

const target = await openTarget(DIST).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
const browser = await chromium.launch();
const failures = [];
try {
  for (const lang of ['en', 'ka']) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      await gotoChecked(page, `${target.url}${lang === 'ka' ? '/ka/' : '/'}`);
      const r = await page.evaluate((TOPNAV) => {
        const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; };
        const overX = document.documentElement.scrollWidth - innerWidth;
        const offenders = overX > 0 ? [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(-3).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`) : [];
        const nav = [...document.querySelectorAll(TOPNAV)].find((n) => getComputedStyle(n).display !== 'none' && n.offsetParent !== null);
        const wrapped = nav ? [...nav.querySelectorAll('a')].filter((a) => lines(a) > 1).map((a) => a.textContent.trim()) : [];
        const clipped = !!nav && nav.scrollWidth > nav.clientWidth + 1;
        // header row: the last visible child of the header's inner row must end inside the viewport
        const row = document.querySelector('header > :first-child');
        let rowEnd = null;
        if (row) {
          const kids = [...row.children].filter((k) => { const cs = getComputedStyle(k); return cs.display !== 'none' && cs.visibility !== 'hidden' && k.getBoundingClientRect().width > 0; });
          if (kids.length) rowEnd = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        }
        return { overX, offenders, wrapped, clipped, rowEnd, iw: innerWidth };
      }, TOPNAV);
      if (r.overX > 0) failures.push(`${lang} ${w}px: page scrolls horizontally by ${r.overX}px (${r.offenders.join(', ')})`);
      if (r.wrapped.length) failures.push(`${lang} ${w}px: top nav links wrap: ${r.wrapped.join(' | ')}`);
      if (r.clipped) failures.push(`${lang} ${w}px: top nav overflows its box`);
      if (r.rowEnd !== null && r.rowEnd > r.iw - 8) failures.push(`${lang} ${w}px: header row ends at ${Math.round(r.rowEnd)} of ${r.iw}px`);
      await ctx.close();
    }
  }
} catch (e) {
  failures.push(e.message);
} finally {
  await browser.close();
  await target.close();
}
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exit(1); }
console.log(`PASS: ${WIDTHS.length * 2} viewport checks, no horizontal overflow, top nav never wraps, header row inside the viewport (${DIST})`);
