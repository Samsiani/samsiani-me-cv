// The three font roles and the constants that describe them. Pure and browser-safe: no node: imports, no
// file system, no clock — src/schema/validate.mjs imports it for settings.fonts, sfnt.mjs for the Georgian
// range, and the admin SPA can import it as it is.
//
// The aliases are the only family names the generated CSS ever writes (fonts plan D11): a font's own name
// reaches the admin and data/fonts/index.json, never a stylesheet and never a file path.

/** Role order is the order the picker shows and the order the CSS block is written in. */
export const FONT_ROLES = ['text', 'label', 'georgian'];

/** A font id: the first 16 hex characters of a sha256. Checked before any id touches the file system. */
export const FONT_ID_RE = /^[0-9a-f]{16}$/;

/** role -> the font-family name the generated CSS uses. Constants, never derived from a font file. */
export const ALIASES = { text: 'sm-text', label: 'sm-label', georgian: 'sm-georgian' };

/** The Georgian subset of the css2 API, as [first, last] pairs. Every layout's fonts.css declares it. */
export const GEORGIAN_RANGE = [[0x0589, 0x0589], [0x10a0, 0x10ff], [0x1c90, 0x1cba], [0x1cbd, 0x1cbf], [0x205a, 0x205a], [0x2d00, 0x2d2f], [0x2e31, 0x2e31]];

/** The same range as a `unicode-range` value. */
export const GEORGIAN_RANGE_CSS = 'U+0589, U+10A0-10FF, U+1C90-1CBA, U+1CBD-1CBF, U+205A, U+2D00-2D2F, U+2E31';

/** The css2 `latin` subset range, character for character the one in every layout's fonts.css. */
export const LATIN_RANGE_CSS = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

export const isGeorgianCodePoint = (cp) => GEORGIAN_RANGE.some(([a, b]) => cp >= a && cp <= b);

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');
const fmt = ([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`);

/** "U+10A0-10FF" | "U+0589" -> [first, last]; anything else -> null. */
export function parseRange(entry) {
  const m = /^U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?$/.exec(String(entry).trim());
  if (!m) return null;
  const a = parseInt(m[1], 16), b = m[2] === undefined ? a : parseInt(m[2], 16);
  return b < a || b > 0x10ffff ? null : [a, b];
}

/**
 * Remove every Georgian code point from a `unicode-range` list, so a text or label face can never be asked
 * to draw Georgian text (fonts plan D6). Accepts the list as a string or as an array of entries and returns
 * an array of entries; unparsable entries are dropped rather than passed through.
 */
export function subtractGeorgian(ranges) {
  const list = (Array.isArray(ranges) ? ranges : String(ranges).split(',')).map(parseRange).filter(Boolean);
  const out = [];
  for (let [a, b] of list) {
    let parts = [[a, b]];
    for (const [ga, gb] of GEORGIAN_RANGE) {
      const next = [];
      for (const [x, y] of parts) {
        if (gb < x || ga > y) { next.push([x, y]); continue; }
        if (ga > x) next.push([x, ga - 1]);
        if (gb < y) next.push([gb + 1, y]);
      }
      parts = next;
    }
    out.push(...parts);
  }
  return out.map(fmt);
}
