// Studio acceptance checks (plan: docs/plans/layout-studio.md section 8).
// Usage:  PLAYWRIGHT_MJS=/path/to/node_modules/playwright/index.mjs node check-studio.mjs [baseUrl]
// baseUrl defaults to http://localhost:4173 (npm run dev). The page under test must render the Studio layout.
// Writes studio-print-en.pdf / studio-print-ka.pdf to $OUT_DIR (default: the OS temp dir). Exits 1 on any failure.
const { chromium } = await import(process.env.PLAYWRIGHT_MJS || 'playwright');

const BASE = process.argv[2] || 'http://localhost:4173';
const PAGES = [{ lang: 'en', path: '/' }, { lang: 'ka', path: '/ka/' }];
const THEMES = ['dark', 'light'];
const fails = [];
const fail = (m) => { fails.push(m); console.log('FAIL', m); };
const pass = (m) => console.log('ok  ', m);

const b = await chromium.launch();
const open = async (w, h, pg, theme, extra = {}) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...extra });
  const p = await ctx.newPage();
  await p.goto(`${BASE}${pg.path}${theme ? `?theme=${theme}` : ''}`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  return { ctx, p };
};

// 1. no horizontal overflow 320..1600
for (const pg of PAGES) for (const theme of THEMES) {
  const { ctx, p } = await open(1600, 900, pg, theme);
  const bad = [];
  for (let w = 320; w <= 1600; w += 10) {
    await p.setViewportSize({ width: w, height: 900 });
    const r = await p.evaluate(() => {
      const de = document.documentElement;
      const over = [...document.querySelectorAll('body *')].filter((el) => {
        if (el.closest('.sr-only, details:not([open]) > nav')) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 0.5;
      }).slice(0, 3).map((el) => el.className || el.tagName);
      return { sw: de.scrollWidth, cw: de.clientWidth, over };
    });
    if (r.sw > r.cw || r.over.length) bad.push(`${w}px sw=${r.sw} cw=${r.cw} ${r.over.join(' | ')}`);
  }
  bad.length ? fail(`overflow ${pg.lang}/${theme}: ${bad.slice(0, 5).join('; ')}`) : pass(`no overflow 320-1600 ${pg.lang}/${theme}`);
  await ctx.close();
}

// 2. contrast (WCAG 2.1 AA) for every visible text node, 3. no uppercase Georgian
for (const pg of PAGES) for (const theme of THEMES) for (const w of [1440, 390]) {
  const { ctx, p } = await open(w, 900, pg, theme);
  const r = await p.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = ([r, gg, bb]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb);
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c; }
      return rgba(getComputedStyle(document.documentElement).backgroundColor);
    };
    const KA = /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/;
    const low = [], caps = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const t = n.nodeValue.trim(); if (!t) continue;
      const el = n.parentElement;
      if (el.closest('.sr-only, script, style, [hidden], details:not([open]) > nav')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const fg = rgba(cs.color), bg = bgOf(el);
      const a = L(fg), bb = L(bg), ratio = (Math.max(a, bb) + 0.05) / (Math.min(a, bb) + 0.05);
      const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) low.push(`${ratio.toFixed(2)} "${t.slice(0, 30)}" .${el.className}`);
      if (KA.test(t) && (cs.textTransform !== 'none' || cs.fontVariantCaps !== 'normal')) caps.push(`"${t.slice(0, 30)}" ${cs.textTransform}`);
    }
    return { low, caps };
  });
  r.low.length ? fail(`contrast ${pg.lang}/${theme}/${w}: ${r.low.slice(0, 6).join('; ')}`) : pass(`contrast AA ${pg.lang}/${theme}/${w}`);
  if (pg.lang === 'ka') r.caps.length ? fail(`uppercase Georgian ${theme}/${w}: ${r.caps.slice(0, 5).join('; ')}`) : pass(`no uppercase Georgian ${theme}/${w}`);
  await ctx.close();
}

// 4. header, nav visibility, hero bento geometry
const geo = async (pg, w) => {
  const { ctx, p } = await open(w, 900, pg, 'dark');
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s), R = (s) => q(s).getBoundingClientRect();
    const vis = (s) => getComputedStyle(q(s)).display !== 'none';
    const nav = q('.st-nav');
    const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; };
    const h1 = q('.st-name');
    return {
      tier: q('.st-top').dataset.nav,
      navWrap: [...nav.querySelectorAll('a')].some((a) => getComputedStyle(nav).display !== 'none' && lines(a) > 1),
      nameLines: [...h1.childNodes].filter((n) => n.nodeType === 3).map((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; }),
      nameFits: h1.scrollWidth <= h1.clientWidth + 1,
      topH: R('.st-top').height, sticky: getComputedStyle(q('.st-top')).position,
      nav: vis('.st-nav'), menu: vis('.st-menu'), navFits: nav.scrollWidth <= nav.clientWidth + 1,
      bento: R('.st-bento'), pad: parseFloat(getComputedStyle(q('.st-bento')).paddingLeft),
      name: R('.st-t-name'), role: R('.st-t-role'), contact: R('.st-t-contact'), facts: R('.st-facts'),
      h1: parseFloat(getComputedStyle(q('.st-name')).fontSize),
      cols: getComputedStyle(q('.st-group .st-cells')).gridTemplateColumns.split(' ').length,
    };
  });
  await ctx.close();
  return r;
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
for (const pg of PAGES) {
  for (const w of [1920, 1600, 1440, 1280, 1279, 1080, 768, 390, 320]) {
    const r = await geo(pg, w);
    const navOn = r.tier !== 'menu' && w >= Number(r.tier);
    const inner = { x: r.bento.x + r.pad, right: r.bento.right - r.pad, w: r.bento.width - 2 * r.pad };
    const col = (inner.w - 11 * 12) / 12, span = (n) => n * col + (n - 1) * 12;
    let ok = r.topH === 64 && r.sticky === 'sticky' && r.nav === navOn && r.menu === !navOn && (!r.nav || (r.navFits && !r.navWrap)) && r.nameFits && r.nameLines.every((n) => n === 1);
    let spans;
    if (w >= 1080) spans = [near(r.name.width, span(7)), near(r.role.width, span(5)), near(r.contact.width, span(5)), near(r.facts.width, span(7)), near(r.role.right, inner.right), near(r.facts.right, inner.right)];
    else if (w >= 768) spans = [near(r.name.width, inner.w), near(r.role.width, span(6)), near(r.contact.width, span(6)), near(r.facts.width, inner.w)];
    else spans = [r.name, r.role, r.contact, r.facts].map((t) => near(t.width, inner.w));
    ok = ok && spans.every(Boolean);
    (ok ? pass : fail)(`geometry ${pg.lang} ${w}: tier=${r.tier} top=${r.topH} ${r.sticky} nav=${r.nav} menu=${r.menu} fits=${r.navFits} wrap=${r.navWrap} name=${r.nameLines.join('+')}lines spans=${spans.map(Number).join('')} h1=${r.h1}px cells=${r.cols}col`);
  }
}

// 5. raw HTML carries the dark-first default for no-JS visitors; fonts, default theme, toggle, reduced motion, focus ring
for (const pg of PAGES) {
  const html = await (await fetch(BASE + pg.path)).text();
  const tag = html.match(/<html[^>]*>/)[0];
  (/data-theme="dark"/.test(tag) && /data-layout="studio"/.test(tag) ? pass : fail)(`raw html ${pg.lang}: ${tag}`);
}
for (const pg of PAGES) {
  const { ctx, p } = await open(1440, 900, pg, null);
  const r = await p.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    archivo: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Archivo' && f.status === 'loaded'),
    noto: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Noto Sans Georgian' && f.status === 'loaded'),
    secOpacity: getComputedStyle(document.querySelector('.sec')).opacity,
  }));
  await p.click('[data-theme-toggle]');
  const after = await p.evaluate(() => [document.documentElement.dataset.theme, document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed')]);
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth}`; });
  const ok = r.theme === 'dark' && r.archivo && (pg.lang === 'en' || r.noto) && after[0] === 'light' && after[1] === 'false' && r.secOpacity === '1' && ring.startsWith('solid 2');
  (ok ? pass : fail)(`runtime ${pg.lang}: default=${r.theme} archivo=${r.archivo} noto=${r.noto} toggle->${after.join('/')} reducedMotionOpacity=${r.secOpacity} focus=${ring}`);
  await ctx.close();
}

// 6. print: A4 page count
for (const [pg, max] of [[PAGES[0], 5], [PAGES[1], 6]]) {
  const { ctx, p } = await open(1440, 900, pg, 'dark');
  await p.emulateMedia({ media: 'print' });
  const pdf = await p.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: false });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  (pages <= max ? pass : fail)(`print ${pg.lang}: ${pages} A4 pages (max ${max})`);
  const pdfPath = (await import('node:path')).join(process.env.OUT_DIR || (await import('node:os')).tmpdir(), `studio-print-${pg.lang}.pdf`);
  (await import('node:fs')).writeFileSync(pdfPath, pdf);
  console.log('     ', pdfPath);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
