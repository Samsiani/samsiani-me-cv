// Generic page gate for any layout:
//   node scripts/check-pages.mjs --dist <dir|url> [--only overflow,contrast,casing,focus,names,motion,print] [--max-pages en=5,ka=6]
// Exits 1 on any failure; a missing or unbuilt --dist is a failure, never a PASS.
import { chromium } from 'playwright';
import { openTarget, gotoChecked, argOf } from './lib/serve-dir.mjs';
import { overflowProbe, contrastProbe, focusProbe, motionProbe, printColoursProbe } from './lib/dom-checks.mjs';

const dist = argOf('--dist');
if (!dist) { console.error('usage: --dist <dir|url> [--only ...] [--max-pages en=5,ka=6]'); process.exit(2); }
const ALL = ['overflow', 'contrast', 'casing', 'focus', 'names', 'motion', 'print'];
const only = new Set((argOf('--only', ALL.join(','))).split(','));
const maxPages = Object.fromEntries(argOf('--max-pages', 'en=5,ka=6').split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, +v]));
const PAGES = [{ lang: 'en', path: '/' }, { lang: 'ka', path: '/ka/' }];
const THEMES = ['light', 'dark'];

const fails = [];
let passes = 0;
const fail = (m) => { fails.push(m); console.log('FAIL', m); };
const pass = (m) => { passes++; if (process.env.VERBOSE) console.log('ok  ', m); };

const target = await openTarget(dist).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
const browser = await chromium.launch();
const open = async (w, h, pg, theme, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...extra });
  const page = await ctx.newPage();
  await gotoChecked(page, `${target.url}${pg.path}${theme ? `?theme=${theme}` : ''}`);
  return { ctx, page };
};

try {
  if (only.has('overflow')) for (const pg of PAGES) for (const theme of THEMES) {
    const { ctx, page } = await open(1600, 900, pg, theme);
    const bad = [];
    for (let w = 320; w <= 1600; w += 10) {
      await page.setViewportSize({ width: w, height: 900 });
      const r = await page.evaluate(overflowProbe);
      if (r.sw > r.cw || r.over.length) bad.push(`${w}px sw=${r.sw} cw=${r.cw} ${r.over.join(' | ')}`);
    }
    bad.length ? fail(`overflow ${pg.lang}/${theme}: ${bad.slice(0, 4).join('; ')}`) : pass(`no overflow 320-1600 ${pg.lang}/${theme}`);
    await ctx.close();
  }

  if (only.has('contrast') || only.has('casing')) for (const pg of PAGES) for (const theme of THEMES) for (const w of [1440, 390]) {
    const { ctx, page } = await open(w, 900, pg, theme);
    const r = await page.evaluate(contrastProbe);
    if (only.has('contrast')) r.low.length ? fail(`contrast ${pg.lang}/${theme}/${w}: ${r.low.slice(0, 5).join('; ')}`) : pass(`contrast ${pg.lang}/${theme}/${w}`);
    if (only.has('casing') && pg.lang === 'ka') r.caps.length ? fail(`uppercase Georgian ${theme}/${w}: ${r.caps.slice(0, 5).join('; ')}`) : pass(`casing ${theme}/${w}`);
    await ctx.close();
  }

  if (only.has('focus')) for (const pg of PAGES) for (const theme of THEMES) {
    const { ctx, page } = await open(1440, 900, pg, theme);
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(focusProbe);
      if (r.none) break;
      if (r.style === 'none' || r.width < 2) fail(`focus ${pg.lang}/${theme}: ${r.label} has no 2px ring (${r.style} ${r.width}px)`);
      else if (r.clippedBy) fail(`focus ${pg.lang}/${theme}: focus ring clipped by ${r.clippedBy} (${r.label})`);
      seen.push(r.label);
    }
    seen.length ? pass(`focus ${pg.lang}/${theme}: ${seen.length} stops`) : fail(`focus ${pg.lang}/${theme}: nothing focusable`);
    await ctx.close();
  }

  if (only.has('names')) for (const pg of PAGES) for (const w of [390, 1440]) {
    const { ctx, page } = await open(w, 900, pg, 'light');
    const cdp = await ctx.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const unnamed = nodes.filter((n) => !n.ignored && ['link', 'button'].includes(n.role?.value) && !(n.name?.value || '').trim());
    unnamed.length ? fail(`names ${pg.lang}/${w}: ${unnamed.length} link/button without an accessible name`) : pass(`names ${pg.lang}/${w}`);
    await ctx.close();
  }

  if (only.has('motion')) for (const pg of PAGES) {
    const { ctx, page } = await open(1440, 900, pg, 'light');
    const r = await page.evaluate(motionProbe);
    r.bad.length || r.scroll !== 'auto' ? fail(`motion ${pg.lang}: scroll-behavior=${r.scroll} ${r.bad.join('; ')}`) : pass(`motion ${pg.lang}`);
    await ctx.close();
  }

  if (only.has('print')) for (const pg of PAGES) {
    const { ctx, page } = await open(1440, 900, pg, 'dark');
    await page.emulateMedia({ media: 'print' });
    const c = await page.evaluate(printColoursProbe);
    c.ink > 0.2 || c.paper < 0.9 ? fail(`print ${pg.lang}: body ink L=${c.ink.toFixed(3)} on paper L=${c.paper.toFixed(3)} (dark text on white expected)`) : pass(`print colours ${pg.lang}`);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const s = pdf.toString('latin1');
    const count = (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
    count > (maxPages[pg.lang] ?? 99) ? fail(`print ${pg.lang}: ${count} pages > ${maxPages[pg.lang]}`) : pass(`print ${pg.lang}: ${count} pages`);
    await ctx.close();
  }
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  await target.close();
}
console.log(fails.length ? `FAIL: ${fails.length} failure(s), ${passes} passed` : `PASS: ${passes} checks`);
process.exit(fails.length ? 1 : 0);
