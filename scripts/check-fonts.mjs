// Fonts gate: the faces the owner chose really reach the page (fonts plan §7.4).
//   node scripts/check-fonts.mjs --dist <dir|url> [--expect sm-text,sm-georgian]
// Exits 1 on any failure; a missing or unbuilt --dist is a failure, never a PASS.
//
// It checks four things per page, in a real browser: every @font-face the stylesheet declares answers 200;
// each expected role alias is declared; the browser actually loaded at least one of its faces; and Georgian
// text on /ka/ is drawn by the Georgian role's face rather than by a system fallback.
import { chromium } from 'playwright';
import { openTarget, gotoChecked, argOf } from './lib/serve-dir.mjs';

const dist = argOf('--dist');
if (!dist) { console.error('usage: --dist <dir|url> [--expect sm-text,sm-label,sm-georgian]'); process.exit(2); }
const expect = argOf('--expect', 'sm-text').split(',').map((s) => s.trim()).filter(Boolean);
const PAGES = [{ lang: 'en', path: '/' }, { lang: 'ka', path: '/ka/' }];

const fails = [];
let passes = 0;
const fail = (m) => { fails.push(m); console.log('FAIL', m); };
const pass = (m) => { passes++; if (process.env.VERBOSE) console.log('ok  ', m); };

/** Every @font-face of every same-origin stylesheet: its family, and each absolute url() it names. */
function faceRulesProbe() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // a cross-origin sheet is not ours to read
    for (const rule of rules) {
      if (rule.constructor.name !== 'CSSFontFaceRule') continue;
      const src = rule.style.getPropertyValue('src');
      const urls = [...src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => new URL(m[2], sheet.href || location.href).href);
      out.push({ family: rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, ''), urls });
    }
  }
  return out;
}

/** What the browser did with each expected alias, and how Georgian text is actually drawn. */
async function fontStateProbe(aliases) {
  await document.fonts.ready;
  const faces = [...document.fonts];
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  const sample = 'გიორგი სამსიანი';
  const measure = (family) => { g.font = `16px ${family}`; return g.measureText(sample).width; };
  const georgianEl = [...document.querySelectorAll('body *')]
    .find((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /[ა-ჰ]/.test(n.nodeValue)));
  return {
    aliases: aliases.map((alias) => ({
      alias,
      declared: faces.filter((f) => f.family === alias).length,
      loaded: faces.filter((f) => f.family === alias && f.status === 'loaded').length,
      check: document.fonts.check(`13px "${alias}"`),
    })),
    georgian: georgianEl ? {
      stack: getComputedStyle(georgianEl).fontFamily,
      withFace: measure('"sm-georgian", monospace'),
      fallback: measure('monospace'),
    } : null,
  };
}

const target = await openTarget(dist).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
const browser = await chromium.launch();
const seen = new Map(); // alias -> did any page load it

try {
  for (const pg of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await gotoChecked(page, `${target.url}${pg.path}`);

    // 1. every declared face is fetchable
    const rules = await page.evaluate(faceRulesProbe);
    if (!rules.length) fail(`${pg.lang}: the stylesheet declares no @font-face at all`);
    for (const rule of rules) {
      for (const url of rule.urls) {
        const res = await page.request.get(url);
        if (res.status() === 200) pass(`${pg.lang}: ${rule.family} ${url.split('/').pop()} 200`);
        else fail(`${pg.lang}: ${rule.family} ${url} answered ${res.status()}`);
      }
    }

    // 2. the role aliases are declared, and the browser used them
    const state = await page.evaluate(fontStateProbe, expect);
    for (const a of state.aliases) {
      if (!a.declared) fail(`${pg.lang}: no @font-face for the role alias "${a.alias}"`);
      else if (!a.check) fail(`${pg.lang}: document.fonts.check('13px "${a.alias}"') is false`);
      else pass(`${pg.lang}: ${a.alias} declared (${a.declared}) and ready`);
      seen.set(a.alias, (seen.get(a.alias) || 0) + a.loaded);
    }

    // 3. Georgian text is drawn by the Georgian role's face, not by a system fallback
    if (expect.includes('sm-georgian')) {
      const ka = state.georgian;
      if (!ka) fail(`${pg.lang}: no Georgian text node to check`);
      else if (!ka.stack.includes('sm-georgian')) fail(`${pg.lang}: Georgian text resolves to ${ka.stack}`);
      else if (Math.abs(ka.withFace - ka.fallback) < 0.5) fail(`${pg.lang}: Georgian text measures the same as the system fallback (${ka.withFace} px); the face did not load`);
      else pass(`${pg.lang}: Georgian drawn by sm-georgian (${ka.withFace.toFixed(1)} vs ${ka.fallback.toFixed(1)} px)`);
    }
    await ctx.close();
  }

  for (const alias of expect) {
    if (!seen.get(alias)) fail(`${alias}: no page ever loaded one of its faces`);
    else pass(`${alias}: loaded`);
  }
} finally {
  await browser.close();
  await target.close();
}

console.log(fails.length ? `\nFONTS: ${fails.length} FAILED, ${passes} passed` : `\nFONTS PASS (${passes} checks, ${expect.join(', ')})`);
process.exit(fails.length ? 1 : 0);
