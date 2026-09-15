// Layout C "Ledger" — acceptance checks (layout-ledger.md §8).
//   Built preview:  node docs/plans/layout-ledger/preview.mjs --out /tmp/ledger-dist
//                   node docs/plans/layout-ledger/verify.mjs /tmp/ledger-dist
//   Real build:     LAYOUT=ledger OUT_DIR=/tmp/dist-ledger node build.mjs && node docs/plans/layout-ledger/verify.mjs /tmp/dist-ledger
//   Running site:   node docs/plans/layout-ledger/verify.mjs http://localhost:4173
// A directory argument is served on a local port (like scripts/check-layout-stress.mjs).
// Playwright is not a project dependency; point PLAYWRIGHT at any local install
// (default: the same install src/brand/make.mjs uses).
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
const PW = process.env.PLAYWRIGHT || '/Users/george/Documents/codeon/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const target = process.argv[2] || join(tmpdir(), 'ledger-dist');
let base = target.replace(/\/$/, ''), srv = null;
if (!/^https?:/.test(target)) {
  const ROOT = resolve(target), PORT = Number(process.env.PORT || 4197);
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
  srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try { const f = join(ROOT, p); await stat(f); res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); }
    catch { res.writeHead(404); res.end(); }
  }).listen(PORT);
  base = `http://localhost:${PORT}`;
}
const pageUrl = (lang) => `${base}${lang === 'ka' ? '/ka/' : '/'}`;

// ---- colour maths: CSS colour string -> WCAG relative luminance ----
const toLinSrgb = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const oklabToLin = (L, a, b) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
function lin(str) {
  let m = str.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/); if (m) return [toLinSrgb(+m[1]), toLinSrgb(+m[2]), toLinSrgb(+m[3])];
  m = str.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/); if (m) { const L = m[2] ? m[1] / 100 : +m[1], h = (m[4] * Math.PI) / 180; return oklabToLin(L, m[3] * Math.cos(h), m[3] * Math.sin(h)); }
  m = str.match(/^oklab\(\s*([\d.]+)(%?)\s+([-\d.e]+)\s+([-\d.e]+)/); if (m) return oklabToLin(m[2] ? m[1] / 100 : +m[1], +m[3], +m[4]);
  throw new Error('unparsed colour ' + str);
}
const Y = (c) => { const [r, g, b] = lin(c).map((x) => Math.min(1, Math.max(0, x))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = Y(a), y = Y(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

let fails = 0;
const fail = (m) => { fails++; console.log('FAIL', m); };
const ok = (m) => console.log('ok  ', m);
const b = await chromium.launch();

for (const lang of ['en', 'ka']) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(pageUrl(lang), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);

  // A1 — no horizontal overflow from 320 to 1600 px
  let worst = 0;
  for (let w = 320; w <= 1600; w += 10) {
    await p.setViewportSize({ width: w, height: 900 });
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) { worst = Math.max(worst, o); fail(`${lang} horizontal overflow ${o}px at ${w}px`); }
  }
  if (!worst) ok(`${lang} no horizontal overflow 320–1600`);

  // A2 — header never overflows; inline nav appears exactly at the nav-fit class breakpoint
  const navBp = await p.evaluate(() => (document.querySelector('.lg-top').className.match(/nav-(\d+|never)/) || [])[1]);
  for (const w of [390, 768, 1080, 1279, 1280, 1359, 1360, 1439, 1440, 1600, 1920]) {
    await p.setViewportSize({ width: w, height: 900 });
    const h = await p.evaluate(() => { const i = document.querySelector('.lg-top-in'); const n = document.querySelector('.lg-nav'); return { over: i.scrollWidth - i.clientWidth, nav: getComputedStyle(n).display }; });
    if (h.over > 0) fail(`${lang} header overflows ${h.over}px at ${w}`);
    const expectNav = navBp !== 'never' && w >= +navBp;
    if ((h.nav !== 'none') !== expectNav) fail(`${lang} inline nav display=${h.nav} at ${w} (nav-${navBp})`);
  }
  ok(`${lang} header fits; nav-${navBp}`);

  // A3 — WCAG AA: every visible text vs its background >= 4.5, both themes; accent/on-accent; depth marks >= 3
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.evaluate(() => document.querySelectorAll('[hidden]').forEach((e) => (e.hidden = false)));
  for (const theme of ['light', 'dark']) {
    await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await p.waitForTimeout(400);
    const pairs = await p.evaluate(() => {
      const out = new Map(); const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const bgOf = (e) => { for (let a = e; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return getComputedStyle(document.body).backgroundColor; };
      while (walker.nextNode()) { const n = walker.currentNode; if (!n.textContent.trim()) continue; const e = n.parentElement;
        if (e.closest('.sr-only, .skip, .lg-menu-list') || !e.getClientRects().length) continue;
        const key = getComputedStyle(e).color + '|' + bgOf(e); if (!out.has(key)) out.set(key, (e.className || e.tagName) + ' "' + n.textContent.trim().slice(0, 24) + '"'); }
      const cs = getComputedStyle(document.documentElement);
      const probe = (v) => { const d = document.createElement('i'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      return { text: [...out.entries()], paper: probe('--paper'), hover: probe('--hover'), accent: probe('--accent'), accentInk: probe('--accent-ink'), onAccent: probe('--on-accent'), focus: probe('--focus'), ink: probe('--ink'), working: probe('--muted-2') };
    });
    let low = 0;
    for (const [key, where] of pairs.text) { const [c, bg] = key.split('|'); const r = ratio(c, bg); if (r < 4.5) { low++; fail(`${lang}/${theme} text contrast ${r.toFixed(2)} ${where}`); } }
    for (const [n, bg] of [['paper', pairs.paper], ['hover', pairs.hover]]) if (ratio(pairs.accentInk, bg) < 4.5) fail(`${lang}/${theme} --accent-ink on ${n} ${ratio(pairs.accentInk, bg).toFixed(2)}`);
    if (ratio(pairs.focus, pairs.paper) < 3) fail(`${lang}/${theme} --focus ring on paper ${ratio(pairs.focus, pairs.paper).toFixed(2)}`);
    if (ratio(pairs.onAccent, pairs.accent) < 4.5) fail(`${lang}/${theme} on-accent on accent ${ratio(pairs.onAccent, pairs.accent).toFixed(2)}`);
    for (const [n, c] of [['core/strong mark', pairs.ink], ['working mark', pairs.working]]) if (ratio(c, pairs.paper) < 3) fail(`${lang}/${theme} ${n} non-text contrast`);
    if (!low) ok(`${lang}/${theme} ${pairs.text.length} text colour pairs >= 4.5:1`);
  }
  await p.evaluate(() => { delete document.documentElement.dataset.theme; });

  // A4 — Georgian never uppercased; Latin display faces only where intended
  const up = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).textTransform === 'uppercase' && /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/.test(e.textContent)).map((e) => e.className));
  if (up.length) fail(`${lang} uppercase applied to Georgian text: ${up.slice(0, 6).join(', ')}`); else ok(`${lang} no uppercase on Georgian`);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')));
  for (const f of ['IBM Plex Sans', 'IBM Plex Mono', ...(lang === 'ka' ? ['Noto Sans Georgian'] : [])]) if (!fonts.includes(f)) fail(`${lang} font not loaded: ${f}`);
  if (fonts.some((f) => /Chivo|JetBrains|Archivo/.test(f))) fail(`${lang} another layout's font is loaded: ${fonts.join(', ')}`);
  const h1w = await p.evaluate(() => getComputedStyle(document.querySelector('h1')).fontWeight);
  if (h1w !== (lang === 'ka' ? '350' : '300')) fail(`${lang} h1 weight ${h1w}`); else ok(`${lang} fonts + h1 weight ${h1w}`);

  // A5 — spine numbers share the h2 baseline; hanging sub-numbers share the h3 baseline (±1px)
  for (const w of [1440, 1080, 768]) {
    await p.setViewportSize({ width: w, height: 900 });
    const d = await p.evaluate(() => {
      const base = (el) => { const s = document.createElement('span'); s.style.cssText = 'display:inline-block;width:0;height:0'; el.prepend(s); const y = s.getBoundingClientRect().top; s.remove(); return y; };
      return [...document.querySelectorAll('.lg-sec')].map((s) => Math.abs(base(s.querySelector('.lg-n')) - base(s.querySelector('h2'))))
        .concat([...document.querySelectorAll('.lg-hang')].map((h) => Math.abs(base(h) - base(h.parentElement.querySelector('h3')))));
    });
    if (Math.max(...d) > 1) fail(`${lang} ${w}px spine misaligned by ${Math.max(...d).toFixed(1)}px`);
  }
  ok(`${lang} spine alignment`);

  // A6 — grid geometry per tier
  const geo = { 1440: { body: 1215, g: 226, d: 150 }, 1080: { body: 895, g: 200, d: 136 }, 768: { body: 651, g: 160, d: 112 }, 390: { body: 358 } };
  for (const [w, e] of Object.entries(geo)) {
    await p.setViewportSize({ width: +w, height: 900 });
    const m = await p.evaluate(() => ({ body: Math.round(document.querySelector('.lg-hero h1').getBoundingClientRect().width), th: [...document.querySelectorAll('.lg-skills thead th')].map((t) => Math.round(t.getBoundingClientRect().width)), depthOverflow: [...document.querySelectorAll('.lg-depth')].filter((t) => t.scrollWidth > t.clientWidth + 1).length }));
    if (Math.abs(m.body - e.body) > 1) fail(`${lang} ${w}px content width ${m.body}, expected ${e.body}`);
    if (e.g && (Math.abs(m.th[0] - e.g) > 1 || Math.abs(m.th[2] - e.d) > 1)) fail(`${lang} ${w}px skills columns ${m.th}`);
    if (m.depthOverflow) fail(`${lang} ${w}px ${m.depthOverflow} depth labels overflow`);
  }
  ok(`${lang} grid geometry`);

  // A7 — print: A4, page budget, light colours even from dark theme, controls hidden
  for (const theme of ['light', 'dark']) {
    await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await p.emulateMedia({ media: 'print' });
    const pr = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, top: getComputedStyle(document.querySelector('.lg-top')).display, cta: getComputedStyle(document.querySelector('.lg-cta')).display }));
    if (pr.bg !== 'rgb(255, 255, 255)') fail(`${lang}/${theme} print background ${pr.bg}`);
    if (pr.top !== 'none' || pr.cta !== 'none') fail(`${lang}/${theme} print shows header or CTA`);
    const file = join(tmpdir(), `ledger-${lang}-${theme}.pdf`);
    await p.pdf({ path: file, preferCSSPageSize: true });
    const pdf = (await readFile(file)).toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const budget = lang === 'ka' ? 6 : 5;
    if (pages > budget) fail(`${lang}/${theme} print ${pages} pages > ${budget}`); else ok(`${lang}/${theme} print ${pages} A4 pages (budget ${budget}) → ${file}`);
    await p.emulateMedia({ media: 'screen' });
  }
  await p.close();
}
await b.close();
if (srv) srv.close();
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL LEDGER CHECKS PASS');
process.exit(fails ? 1 : 0);
