// Brand image inputs and names (pure: no file system, no clock). Master plan §8.8.
// A name is <stem>.<md5-8 of { inputs, rendererId }>.png, so any change to what a card shows, or to the
// renderer and its fonts, produces a new file name instead of new bytes under an old one.
import { createHash } from 'node:crypto';
import { localize } from './localize.mjs';
import { parseColor } from '../palettes.mjs';
import { FONT_ROLES } from '../typography/roles.mjs';

export const CARD_TEMPLATE_VERSION = 1;
export const ICON_TEMPLATE_VERSION = 1;
export const ICONS = { i32: ['favicon-32', 32], i180: ['apple-touch-icon', 180], i192: ['icon-192', 192], i512: ['icon-512', 512] };
const hex = (v) => parseColor(v).hex;

/**
 * Which face drew each role of the card, for the name (fonts plan §5.6). The key is absent whenever every
 * role keeps the built-in face — so a site without chosen fonts, and a site whose fonts satori cannot read,
 * both produce exactly the names they produced before this feature.
 */
function ogFontKeys(og) {
  if (!og) return null;
  const map = Object.fromEntries(FONT_ROLES.map((r) => [r, og[r]?.key || 'default']));
  return Object.values(map).some((v) => v !== 'default') ? map : null;
}

/** Exactly the fields the social card shows (plus which faces draw them). */
export function ogInputs(site, lang, palette, layoutMeta = {}, og = null) {
  const c = localize(site, lang);
  const fonts = ogFontKeys(og);
  return {
    v: CARD_TEMPLATE_VERSION, lang, card: layoutMeta.og ? layoutMeta.id : 'default',
    monogram: site.person.monogram,
    eyebrow: c.hero.eyebrow, given: c.hero.givenName, family: c.hero.familyName,
    role: c.hero.role, subrole: c.hero.subrole,
    facts: c.hero.facts.map((f) => [f.value, f.label]),
    host: new URL(site.settings.siteUrl).host,
    accent: hex(palette.dark['--accent']), accentInk: hex(palette.dark['--accent-ink']),
    ...(fonts ? { fonts } : {}),
  };
}

/** Exactly the fields an icon shows. */
export function iconInputs(site, palette) {
  return { v: ICON_TEMPLATE_VERSION, monogram: site.person.monogram, fill: hex(palette.light['--accent']), glyph: hex(palette.light['--on-accent']) };
}

export const brandName = (stem, inputs, rendererId) =>
  `${stem}.${createHash('md5').update(JSON.stringify({ inputs, rendererId })).digest('hex').slice(0, 8)}.png`;

/**
 * Every brand input with its target name: [{ name, kind: 'og'|'icon', key, size?, inputs, faces? }].
 * `og` is the resolved fonts' card faces (or null); it rides on the og items so the renderer can register
 * them, and never touches the icons — their monogram always stays in the built-in face.
 */
export function brandPlan(site, palette, layoutMeta, rendererId, og = null) {
  const plan = [];
  for (const lang of ['en', 'ka']) {
    const inputs = ogInputs(site, lang, palette, layoutMeta, og);
    plan.push({ name: brandName(`og-${lang}`, inputs, rendererId), kind: 'og', key: lang, inputs, faces: og });
  }
  const icon = iconInputs(site, palette);
  for (const [key, [stem, size]] of Object.entries(ICONS)) plan.push({ name: brandName(stem, { ...icon, size }, rendererId), kind: 'icon', key, size, inputs: icon });
  return plan;
}

/** Names only (the preview): what the next publish will produce, without rendering anything. */
export function brandNames(site, palette, layoutMeta, rendererId, og = null) {
  const plan = brandPlan(site, palette, layoutMeta, rendererId, og);
  return {
    files: new Map(),
    og: Object.fromEntries(plan.filter((p) => p.kind === 'og').map((p) => [p.key, p.name])),
    icons: Object.fromEntries(plan.filter((p) => p.kind === 'icon').map((p) => [p.key, p.name])),
    palette: palette.id,
  };
}
