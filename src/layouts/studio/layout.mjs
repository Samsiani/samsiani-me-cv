// B · Studio — layout manifest. Fields = data-model plan §layout meta (id, css, fonts, preload,
// themeColor, manifestBackground) + admin plan §5.1 registry (label, description, thumbnail)
// + defaultTheme (Studio is dark-first; see docs/plans/layout-studio.md §4.2).
import { LANGS, localize } from '../../shared/localize.mjs';

const SANS_TAIL = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;
const FIT_HEADROOM = 1.08; // the display tiles fit the longest word; this is their margin (fonts plan §5.4)
const words = (s) => String(s).split(/\s+/).filter(Boolean);
/**
 * --st-name-em and --st-fact-em are "average advance of one letter, in em, at this element's weight": the
 * CSS sizes the value at 100cqi / (len * em), where len is the tile's own data-len clamped to [lo, hi]. So
 * the value that makes every tile fit is the largest, over tiles, of (longest word's width) / (that tile's
 * len). Null when there is nothing to measure — the layout's own constant then stands.
 */
const tileEm = (width, tiles, px, weight, lo, hi) => {
  let em = 0;
  for (const tile of tiles) {
    if (!tile.length) continue;
    const len = Math.min(hi, Math.max(lo, ...tile.map((w) => [...w].length)));
    for (const w of tile) em = Math.max(em, width('text', w, px, { weight, headroom: FIT_HEADROOM }) / (len * px));
  }
  return em ? Math.round(Math.min(1.4, Math.max(0.3, em)) * 1000) / 1000 : null;
};

export default {
  id: 'studio',
  label: 'B · Studio',
  description: 'Dark-first. Bento hero, wide Archivo headings, hairline bands, skills as a three-column table.',
  thumbnail: 'admin-thumbs/studio.svg',
  // concatenated in this order (joined with "\n") into dist/styles.<hash>.css, then the palette block
  css: ['fonts.css', 'styles.css'],
  // woff2 basenames under src/fonts/ that this layout uses; the build copies only these
  fonts: ['archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500', 'noto-sans-georgian-georgian-normal-400-700'],
  preload: {
    en: ['archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500'],
    ka: ['noto-sans-georgian-georgian-normal-400-700', 'archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500'],
  },
  themeColor: { light: '#f5f7f9', dark: '#101419' }, // <meta name="theme-color"> = --st-bg per mode
  manifestBackground: '#101419',
  defaultTheme: 'dark', // used when settings.defaultTheme is "system" (plan §4.2)
  // The three faces the owner may replace (fonts plan §5.1). `files` names this role's basenames in `fonts`
  // above, `var`/`tail` reproduce the stack styles.css declares, and `weights` is what the layout asks for.
  fontRoles: {
    text: {
      var: '--st-sans', label: 'Text', help: 'Headings, the display name and body text.',
      defaultFamily: 'Archivo', files: ['archivo-latin-wdth-wght'], weights: [400, 500, 600, 700],
      tail: SANS_TAIL, kaTail: SANS_TAIL,
    },
    label: {
      var: '--st-mono', label: 'Labels', help: 'Indices, legends and small labels on the English page.',
      defaultFamily: 'JetBrains Mono', files: ['jetbrains-mono-latin-normal-400-500'], weights: [400, 500],
      tail: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', georgianInStack: true,
    },
    georgian: {
      var: null, label: 'Georgian', help: 'Every Georgian letter, on both pages.',
      defaultFamily: 'Noto Sans Georgian', files: ['noto-sans-georgian-georgian-normal-400-700'], weights: [400, 700],
      extraSelectors: ['.st-lang > [lang="ka"]'],
    },
  },
  // Override mode only: the name and the fact tiles shrink to fit their longest word, and the two constants
  // that drive that fit were measured in Archivo and Noto. Re-measure them in the chosen faces instead.
  overrideCss: ({ site, width }) => {
    const out = [];
    for (const lang of LANGS) {
      const c = localize(site, lang);
      // the display name is one tile whose data-len is the longer of the two name lines, clamped to 4–12
      const name = tileEm(width, [[c.hero.givenName, c.hero.familyName]], 100, 700, 4, 12);
      if (name) out.push(`html[lang="${lang}"] { --st-name-em: ${name}; }`);
      // the .st-fact tiles: the hero facts and the language values (localize's legacy "education" key),
      // one tile each, data-len 6–12, Georgian ones carrying their own constant
      const values = [...c.hero.facts.map((f) => f.value), ...(c.sections.education?.langs || []).map((l) => l.name)];
      for (const [geo, sel] of [[false, '.st-fact'], [true, '.st-fact[data-geo]']]) {
        const em = tileEm(width, values.filter((v) => GEORGIAN.test(v) === geo).map(words), 100, 700, 6, 12);
        if (em) out.push(`html[lang="${lang}"] ${sel} { --st-fact-em: ${em}; }`);
      }
    }
    return out;
  },
};
