// Server-side font checks (fonts plan §4.5) and the dashboard report (§4.6). These need the store, so they
// live here and not in the pure validator: whether an id exists is a fact about this machine, not about the
// document. Errors block a publish of the layout that is live; the other layouts only warn, so a font that
// was deleted for Studio never stops a Precision publish.
import { LAYOUTS } from '../../../../src/layouts/index.mjs';
import { renderSite } from '../../../../src/render.mjs';
import { FONT_ID_RE, FONT_ROLES } from '../../../../src/typography/roles.mjs';
import { defaultFonts, pageBytes, resolveFonts } from '../../../../src/typography/resolve.mjs';

const HEAVY_KA = 400 * 1024; // fonts on /ka/ (today 108-164 KB)
const WIDE = 1.12; // a role's mean advance against the layout default's

// How each layout says "the inline nav does not fit at any width"; the report reads the rendered page, so a
// markup change degrades the report to null and never breaks a publish.
// Precision stamps nothing with its own fonts: its stylesheet shows the inline nav from 1440 px in English
// and from 1680 px in Georgian, which is what `fallback` records.
const NAV = {
  precision: { re: /<header class="topbar" data-navfit="([^"]+)"/, never: 'never', fallback: { en: '1440', ka: '1680' } },
  studio: { re: /<header class="st-top" data-nav="([^"]+)"/, never: 'menu' },
  ledger: { re: /<header class="lg-top nav-([a-z0-9]+)"/, never: 'never' },
};

const layoutOf = (site) => LAYOUTS[site?.settings?.layout] || LAYOUTS.precision;
const roleIds = (site, id) => site?.settings?.fonts?.[id] || null;
const path = (layout, role) => `$.settings.fonts.${layout}.${role}`;
const pct = (x) => `${Math.round((x - 1) * 100)} %`;

/** Nav tier per language for a rendered layout, or null when the markup no longer carries one. */
function navFitOf(site, layout, fonts) {
  const spec = NAV[layout.meta.id];
  if (!spec) return null;
  const out = renderSite(site, { layout, palette: { id: site.settings.palette }, fonts });
  const tier = (page, lang) => {
    const m = spec.re.exec(out[page]);
    return m ? (m[1] === spec.never ? 'never' : m[1]) : spec.fallback?.[lang] ?? null;
  };
  return { en: tier('index.html', 'en'), ka: tier('ka/index.html', 'ka') };
}

/**
 * @param {object} site a canonical document
 * @param {{ get(id): Promise<object|null> }} fontStore
 * @param {{ layoutIds?: string[], activeOnly?: boolean }} opts
 * @returns {Promise<{ errors: {path, code, msg}[], warnings: {path, code, msg}[] }>}
 */
export async function fontIssues(site, fontStore, { layoutIds = Object.keys(LAYOUTS), activeOnly = false } = {}) {
  const errors = [], warnings = [];
  const cfg = site?.settings?.fonts;
  if (!cfg || typeof cfg !== 'object') return { errors, warnings };
  const active = site.settings.layout;

  for (const id of layoutIds) {
    const roles = roleIds(site, id);
    if (!roles || typeof roles !== 'object') continue;
    if (activeOnly && id !== active) continue;
    const meta = LAYOUTS[id]?.meta;
    // a font missing under the live layout blocks the publish; under another layout it is only a warning
    const push = (code, role, msg) => (id === active ? errors : warnings).push({ path: path(id, role), code, msg });
    for (const role of FONT_ROLES) {
      const fontId = roles[role];
      if (typeof fontId !== 'string' || !fontId) continue;
      const record = await fontStore.get(fontId);
      if (!record) { push('FONT_UNKNOWN', role, `this machine has no font ${fontId}; add it again or reset the role`); continue; }
      if (role === 'georgian' && record.coverage?.georgian !== true) {
        push('FONT_NO_GEORGIAN', role, `"${record.displayName || record.family}" has no Georgian letters and cannot serve the Georgian role`);
        continue;
      }
      const want = meta?.fontRoles?.[role]?.weights || [];
      if (record.variable !== true) {
        const missing = want.filter((w) => !(record.weights || []).includes(w));
        if (missing.length) warnings.push({ path: path(id, role), code: 'FONT_WEIGHTS', msg: `this layout uses ${missing.join(', ')}; the browser will synthesise ${missing.length === 1 ? 'that weight' : 'those weights'}` });
      }
    }
  }

  // Page weight, width and nav fit are properties of the layout that is actually rendered.
  const layout = layoutOf(site);
  if (layoutIds.includes(layout.meta.id)) {
    const fonts = await resolveFonts(site, layout.meta, fontStore.loader ? fontStore.loader() : fontStore);
    if (fonts.overridden) {
      const bytes = pageBytes(layout.meta, fonts);
      if (bytes.ka > HEAVY_KA) warnings.push({ path: `$.settings.fonts.${layout.meta.id}`, code: 'FONT_HEAVY', msg: `the Georgian page carries ${Math.round(bytes.ka / 1024)} KB of fonts; over 400 KB is a slow first paint` });
      const base = defaultFonts(layout.meta);
      for (const role of FONT_ROLES) {
        const script = role === 'georgian' ? 'georgian' : 'latin';
        const mine = fonts.metrics[role]?.[script]?.mean, theirs = base[role]?.[script]?.mean;
        if (!mine || !theirs || mine < theirs * WIDE) continue;
        warnings.push({ path: path(layout.meta.id, role), code: 'FONT_WIDE', msg: `about ${pct(mine / theirs)} wider than ${layout.meta.fontRoles[role].defaultFamily}: long names and print may need a look` });
      }
      const fit = navFitOf(site, layout, fonts);
      if (fit && fit.en === 'never' && fit.ka === 'never') warnings.push({ path: `$.settings.fonts.${layout.meta.id}`, code: 'FONT_NAV_MENU', msg: 'with these fonts the inline header nav never fits; both pages show the Sections menu instead' });
      else if (fit && (fit.en === 'never' || fit.ka === 'never')) warnings.push({ path: `$.settings.fonts.${layout.meta.id}`, code: 'FONT_NAV_MENU', msg: `with these fonts the inline header nav never fits on ${fit.en === 'never' ? 'the English page' : '/ka/'}; it shows the Sections menu instead` });
    }
  }
  return { errors, warnings };
}

/**
 * One display string for a build's or a revision's `{ role: id | "default" }` map, for the tables that list
 * them: "Inter · Noto Sans Georgian", or null when that document used the layout's own faces.
 */
export async function fontNamer(fontStore) {
  const by = new Map((await fontStore.list()).map((r) => [r.id, r.displayName || r.family]));
  return (map) => {
    if (!map || typeof map !== 'object') return null;
    const names = FONT_ROLES.map((r) => map[r]).filter((id) => typeof id === 'string' && FONT_ID_RE.test(id)).map((id) => by.get(id) || id);
    return names.length ? [...new Set(names)].join(' · ') : null;
  };
}

/** The dashboard panel's figures for the layout this document renders (fonts plan §4.6). */
export async function fontReport(site, fontStore) {
  const layout = layoutOf(site);
  const meta = layout.meta;
  const fonts = await resolveFonts(site, meta, fontStore.loader ? fontStore.loader() : fontStore);
  const base = defaultFonts(meta);
  const roles = {};
  const widthFactor = {};
  for (const role of FONT_ROLES) {
    const r = fonts.roles?.[role] || null;
    roles[role] = r
      ? { id: r.id, family: r.record.displayName || r.record.family, source: r.record.source, default: false }
      : { id: null, family: meta.fontRoles[role].defaultFamily, source: 'layout', default: true };
    const script = role === 'georgian' ? 'georgian' : 'latin';
    const mine = (fonts.metrics?.[role] || base[role])?.[script]?.mean, theirs = base[role]?.[script]?.mean;
    widthFactor[role] = mine && theirs ? Math.round((mine / theirs) * 100) / 100 : 1;
  }
  return {
    layout: meta.id,
    roles,
    bytes: pageBytes(meta, fonts),
    navFit: navFitOf(site, layout, fonts),
    widthFactor,
    issues: await fontIssues(site, fontStore),
  };
}
