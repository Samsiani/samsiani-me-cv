// In-page check functions shared by the page gates and the admin e2e tests.
// Each export is a plain function passed to page.evaluate(), so it must not close over module scope.

/** Horizontal overflow: page scroll width and the first offending elements. */
export function overflowProbe() {
  const de = document.documentElement;
  const over = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('.sr-only, details:not([open]) > nav, details:not([open]) > div')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.right > innerWidth + 0.5;
  }).slice(0, 3).map((el) => (typeof el.className === 'string' && el.className) || el.tagName);
  return { sw: de.scrollWidth, cw: de.clientWidth, over };
}

/** WCAG 2.1 AA text contrast for every visible text node, plus uppercase Georgian detection. */
export function contrastProbe() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = ([r, gg, bb]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb);
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c; }
    return rgba(getComputedStyle(document.documentElement).backgroundColor);
  };
  const KA = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;
  const low = [], caps = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement;
    if (el.closest('.sr-only, script, style, [hidden], details:not([open]) > nav, details:not([open]) > div')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const fg = rgba(cs.color), bg = bgOf(el);
    const a = L(fg), b = L(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) low.push(`${ratio.toFixed(2)} "${t.slice(0, 30)}" ${el.tagName.toLowerCase()}.${el.className}`);
    if (KA.test(t) && (cs.textTransform !== 'none' || cs.fontVariantCaps !== 'normal')) caps.push(`"${t.slice(0, 30)}" ${cs.textTransform}`);
  }
  return { low, caps };
}

/** The focused element's ring: width, and the first ancestor whose overflow clips it (or null). */
export function focusProbe() {
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const cs = getComputedStyle(el);
  const width = parseFloat(cs.outlineWidth) || 0;
  const style = cs.outlineStyle;
  const off = parseFloat(cs.outlineOffset) || 0;
  const r = el.getBoundingClientRect();
  const grow = off + width;
  const ring = { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow };
  let clippedBy = null;
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const acs = getComputedStyle(a);
    if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
    const ar = a.getBoundingClientRect();
    const bl = parseFloat(acs.borderLeftWidth), bt = parseFloat(acs.borderTopWidth);
    const pad = { left: ar.left + bl, top: ar.top + bt, right: ar.left + bl + a.clientWidth, bottom: ar.top + bt + a.clientHeight };
    if (ring.left < pad.left - 0.5 || ring.top < pad.top - 0.5 || ring.right > pad.right + 0.5 || ring.bottom > pad.bottom + 0.5) {
      clippedBy = a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className ? '.' + a.className.split(' ').join('.') : '');
      break;
    }
  }
  const label = el.tagName.toLowerCase() + (el.getAttribute('href') ? `[href="${el.getAttribute('href')}"]` : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '');
  return { width, style, clippedBy, label };
}

/** Reduced motion: revealed blocks must be fully visible and untranslated, smooth scrolling off. */
export function motionProbe() {
  const bad = [];
  for (const el of document.querySelectorAll('.sec, .intro, [data-reveal]')) {
    const cs = getComputedStyle(el);
    if (+cs.opacity !== 1 || (cs.translate !== 'none' && cs.translate !== '0px') || (cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)')) {
      bad.push(`${el.tagName.toLowerCase()}#${el.id || ''} opacity=${cs.opacity} translate=${cs.translate}`);
    }
  }
  return { bad: bad.slice(0, 5), scroll: getComputedStyle(document.documentElement).scrollBehavior };
}

/** Printed body colours (call after page.emulateMedia({ media: 'print' })). */
export function printColoursProbe() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = ([r, gg, b]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const body = getComputedStyle(document.body);
  let bg = body.backgroundColor;
  if (bg === 'rgba(0, 0, 0, 0)') bg = getComputedStyle(document.documentElement).backgroundColor;
  if (bg === 'rgba(0, 0, 0, 0)') bg = '#fff';
  return { ink: L(rgb(body.color)), paper: L(rgb(bg)) };
}
