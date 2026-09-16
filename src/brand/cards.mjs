// Satori element trees for the social card (1200x630) and the icons. Ports the former og.html / icon.html.
// Satori lays out with flexbox only: every element with several children is display:flex.
import { parseColor } from '../palettes.mjs';

const hex = (v) => parseColor(v).hex;
// fixed dark card neutrals (from the former og.html)
const N = {
  bg: hex('oklch(18.5% 0.012 258)'), ink: hex('oklch(96% 0.004 250)'), muted: hex('oklch(75.5% 0.008 250)'),
  role: hex('oklch(88% 0.006 250)'), rule1: hex('oklch(29.5% 0.01 258)'), rule2: hex('oklch(52% 0.012 258)'),
};
// satori requires an explicit display on every element with children; flex is the default here
const el = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const LATIN = 'Chivo', MONO = 'JetBrains Mono', KA = 'Noto Sans Georgian';

export function ogCard(i) {
  const ka = i.lang === 'ka';
  const text = ka ? `${KA}, ${LATIN}` : `${LATIN}, ${KA}`;
  const label = ka
    ? { fontFamily: KA, fontSize: 14, letterSpacing: 0.14, textTransform: 'none' }
    : { fontFamily: `${MONO}, ${KA}`, fontSize: 12, letterSpacing: 0.54, textTransform: 'uppercase' };
  const facts = i.facts.map(([v, l], n) => el('div', {
    display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 24, marginRight: n < i.facts.length - 1 ? 24 : 0,
    borderRight: n < i.facts.length - 1 ? `1px solid ${N.rule1}` : 'none',
  }, [
    el('div', { fontFamily: `${LATIN}, ${KA}`, fontSize: 30, fontWeight: 600, lineHeight: 1, letterSpacing: -0.75, color: N.ink }, v),
    el('div', { marginTop: 10, lineHeight: 1.4, color: N.muted, ...label }, l),
  ]));
  // A removed line draws no element at all: satori never receives a null child.
  const column = [
    i.eyebrow ? el('div', ka
      ? { fontFamily: KA, fontSize: 16, fontWeight: 400, letterSpacing: 0.64, color: N.muted }
      : { fontFamily: `${MONO}, ${KA}`, fontSize: 15, fontWeight: 500, letterSpacing: 2.7, textTransform: 'uppercase', color: N.muted }, i.eyebrow) : null,
    el('div', { display: 'flex', flexDirection: 'column', marginTop: 34, fontFamily: text, fontWeight: 600, fontSize: ka ? 64 : 82, lineHeight: ka ? 1.06 : 0.98, letterSpacing: ka ? -0.96 : -2.46 }, [
      el('div', {}, i.given), el('div', {}, i.family),
    ]),
    el('div', { marginTop: 22, fontSize: ka ? 27 : 32, lineHeight: 1.25, fontWeight: 400, color: N.role, letterSpacing: -0.32 }, i.role),
    i.subrole ? el('div', { marginTop: 14, fontSize: 21, lineHeight: 1.4, color: N.muted }, i.subrole) : null,
    el('div', { flex: 1 }, []),
    facts.length ? el('div', { display: 'flex', borderTop: `1px solid ${N.rule2}`, paddingTop: 24 }, facts) : null,
  ].filter(Boolean);
  return el('div', { width: 1200, height: 630, display: 'flex', position: 'relative', background: N.bg, color: N.ink, fontFamily: text }, [
    el('div', { position: 'absolute', left: 0, top: 0, width: 6, height: 630, background: i.accent }, []),
    el('div', { width: 86, height: 630, display: 'flex', justifyContent: 'center', paddingTop: 64, borderRight: `1px solid ${N.rule1}` }, [
      el('div', { width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', background: N.ink, color: N.bg, fontFamily: LATIN, fontSize: i.monogram.length > 2 ? 16 : 20, fontWeight: 600, letterSpacing: 1 }, i.monogram),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', flex: 1, height: 630, padding: '64px 72px 56px 56px' }, column),
    el('div', { position: 'absolute', right: 72, top: 64, fontFamily: MONO, fontSize: 19, fontWeight: 500, letterSpacing: 0.38, color: i.accentInk }, i.host),
  ]);
}

export function iconCard(i, size) {
  const n = [...i.monogram].length;
  const scale = n <= 1 ? 0.6 : n === 2 ? 0.453 : 0.34; // three letters shrink so nothing clips at 32 px
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(i.glyph.slice(k, k + 2), 16));
  return el('div', { width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: i.fill }, [
    el('div', { color: i.glyph, fontFamily: LATIN, fontWeight: 600, fontSize: Math.round(size * scale), lineHeight: 1, letterSpacing: -0.02 * size * scale, position: 'relative', top: -Math.round(size * 0.012) }, i.monogram),
    el('div', { position: 'absolute', left: 0, bottom: 0, width: size, height: Math.max(2, Math.round(size * 0.066)), background: `rgba(${r}, ${g}, ${b}, 0.16)` }, []),
  ]);
}
