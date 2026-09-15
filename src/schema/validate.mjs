// site.json validator. Zero dependencies. Used by build.mjs (errors abort the build) and by the
// admin API (errors block Save/Publish, warnings are shown but do not block).
// Target location after the refactor: src/schema/validate.mjs
import { LANGS, LEVELS, SECTIONS } from '../shared/localize.mjs';

export const LAYOUT_IDS = ['precision', 'studio', 'ledger'];
export const THEMES = ['system', 'light', 'dark'];
export const CONTACT_ICONS = ['mail', 'phone', 'github', 'globe']; // = Object.keys(CONTACT_ICONS) in src/shared/icons.mjs
export const DEFAULT_PALETTE_IDS = ['cobalt']; // real list = Object.keys(PALETTES) from src/palettes.mjs

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/; // 1–40 chars, lowercase slug
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGIN_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const cls = (...r) => new RegExp('[' + r.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']');
const CONTROL_RE = cls([0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029]);
const CYRILLIC_RE = cls([0x400, 0x52f], [0x1c80, 0x1c8f], [0x2de0, 0x2dff], [0xa640, 0xa69f]);
const RUSSIAN_RE = /\bRU\b|russian|რუსულ/i;
const GEORGIAN_RE = cls([0x10a0, 0x10ff], [0x1c90, 0x1cbf], [0x2d00, 0x2d2f]);
const MTAVRULI_RE = cls([0x1c90, 0x1cbf]); // Georgian Mtavruli capitals
// headings and names rendered at display sizes: a whitespace-free run longer than 24 breaks mid-word
const TOKEN_PATH_RE = /^\$\.(hero|sections)\.(?:.*\.)?(title|name|role|lead)\.(en|ka)$/;
// .en values that layouts render with text-transform (the --caps token is uppercase on / only)
const CAPS_PATHS = new Set(['$.hero.eyebrow', '$.hero.facts[].label', '$.contact.heading', '$.contact.items[].label',
  '$.ui.copy', '$.ui.copied', '$.ui.levels.core', '$.ui.levels.strong', '$.ui.levels.working', '$.ui.present', '$.ui.print',
  '$.ui.printShort', '$.ui.nav', '$.ui.colGroup', '$.ui.colSkill', '$.ui.colDepth', '$.sections.languages.items[].name',
  '$.sections.languages.items[].proficiency', '$.sections.contact.cta'].map((p) => p + '.en'));

// ---------------- schema DSL ----------------
const LS = (max, o = {}) => ({ t: 'lstr', max, ...o }); // localized string {en, ka}
const S = (max, o = {}) => ({ t: 'str', max, ...o });
const E = (values) => ({ t: 'enum', values });
const I = (min, max, o = {}) => ({ t: 'int', min, max, ...o });
const B = () => ({ t: 'bool' });
const O = (shape) => ({ t: 'obj', shape });
const A = (item, min, max) => ({ t: 'arr', item, min, max });
const ID = { t: 'id' };
const REF = { t: 'ref' };
const OPT = { optional: true };
const TEXT = { text: true }; // long prose: translation lints apply

const NAV = LS(28, OPT); // short label for top/side navs; null => title is used
const head = (leadMax = 200) => ({ nav: NAV, title: LS(40), lead: LS(leadMax, { ...OPT, ...TEXT }) });
const cardList = (max) => O({ ...head(), items: A(O({ id: ID, title: LS(64), text: LS(280, TEXT) }), 1, max) });

export function buildSchema({ paletteIds = DEFAULT_PALETTE_IDS, layoutIds = LAYOUT_IDS } = {}) {
  return O({
    schemaVersion: E([1]),
    settings: O({
      layout: E(layoutIds),
      palette: E(paletteIds),
      defaultTheme: E(THEMES),
      updated: S(10, { pattern: DATE_RE, date: true }),
      autoUpdateDateOnPublish: B(),
      siteUrl: S(100, { pattern: ORIGIN_RE }),
    }),
    person: O({
      givenName: LS(10), // Precision rail: 45px/38px display name, 263px box (measured)
      familyName: LS(10),
      alternateName: LS(40),
      monogram: S(3, { pattern: /^[A-Z0-9]{1,3}$/ }),
      address: O({ locality: S(40), country: S(2, { pattern: /^[A-Z]{2}$/ }) }),
      sameAs: A(S(200, { href: ['https:'] }), 0, 8),
    }),
    meta: O({ title: LS(90, { warnOver: 80 }), description: LS(260, { ...TEXT, warnOver: 220 }) }),
    ui: O({
      skip: LS(32), nav: LS(24), theme: LS(32), themeShort: LS(10),
      print: LS(16), printShort: LS(4), language: LS(16),
      langShort: LS(4), langSwitch: LS(16),
      copy: LS(8), copied: LS(12),
      legend: LS(24),
      levels: O(Object.fromEntries(LEVELS.map((l) => [l, LS(14)]))),
      levelHints: O(Object.fromEntries(LEVELS.map((l) => [l, LS(32)]))),
      colGroup: LS(14), colSkill: LS(14), colDepth: LS(14),
      present: LS(12),
      atAGlance: LS(24), updated: LS(24), builtWith: LS(48), top: LS(24),
    }),
    hero: O({
      eyebrow: LS(32),
      role: LS(40),
      subrole: LS(80),
      tagline: LS(180, TEXT),
      location: LS(32),
      availability: LS(48),
      facts: A(O({ id: ID, value: LS(10), label: LS(24) }), 4, 4),
    }),
    contact: O({
      heading: LS(16),
      items: A(O({ id: ID, label: LS(14), value: S(40), href: S(200, { href: ['https:', 'mailto:', 'tel:'] }), icon: E(CONTACT_ICONS), copy: B() }), 1, 6),
    }),
    sections: O({
      profile: O({ ...head(), paragraphs: A(O({ id: ID, text: LS(600, TEXT) }), 1, 6) }),
      skills: O({
        ...head(),
        groups: A(O({
          id: ID, title: LS(40), lead: LS(100),
          items: A(O({ id: ID, name: LS(60), detail: LS(90, OPT), level: E(LEVELS) }), 1, 16),
        }), 1, 10),
      }),
      abilities: cardList(12),
      workstyle: cardList(12),
      principles: cardList(12),
      experience: O({
        ...head(),
        items: A(O({
          id: ID, from: I(1970, 2100), to: I(1970, 2100, { nullable: true }),
          role: LS(48), org: LS(40), orgHref: S(200, { href: ['https:'], nullable: true }), text: LS(600, TEXT),
        }), 1, 10),
      }),
      languages: O({ ...head(), items: A(O({ id: ID, name: LS(24), proficiency: LS(32) }), 1, 6) }),
      contact: O({ ...head(160), cta: LS(24), primary: REF, buttons: A(REF, 0, 3) }),
    }),
  });
}

// ---------------- href ----------------
export function hrefError(h, allowed) {
  if (typeof h !== 'string' || h === '') return 'HREF_EMPTY';
  if (/[\s\x00-\x20\x7f-\x9f]/.test(h)) return 'HREF_WHITESPACE'; // also defeats "java<TAB>script:"
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(h);
  if (!m) return 'HREF_RELATIVE';
  const scheme = m[1] + ':';
  if (!allowed.includes(scheme)) return allowed.includes(scheme.toLowerCase()) ? 'HREF_SCHEME_CASE' : 'HREF_SCHEME';
  if (scheme === 'https:') {
    let u;
    try { u = new URL(h); } catch { return 'HREF_INVALID'; }
    if (u.username || u.password) return 'HREF_CREDENTIALS';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(u.hostname)) return 'HREF_HOST';
    if (!h.startsWith('https://')) return 'HREF_INVALID';
  }
  if (scheme === 'mailto:' && !/^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(h)) return 'HREF_MAILTO';
  if (scheme === 'tel:' && !/^tel:\+[1-9][0-9]{6,14}$/.test(h)) return 'HREF_TEL';
  return null;
}

// ---------------- walker ----------------
export function validate(site, { paletteIds, layoutIds, mode = 'save', today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [], warnings = [];
  const err = (path, code, msg) => errors.push({ path, code, msg });
  const warn = (path, code, msg) => warnings.push({ path, code, msg });
  const len = (s) => [...s].length;

  const checkText = (path, s, spec, lang) => {
    if (typeof s !== 'string') return err(path, 'TYPE', 'expected a string');
    if (s === '') return err(path, 'EMPTY', 'must not be empty');
    if (s !== s.trim()) err(path, 'WHITESPACE', 'leading/trailing whitespace');
    if (CONTROL_RE.test(s)) err(path, 'CONTROL_CHAR', 'no line breaks or control characters');
    if (CYRILLIC_RE.test(s)) err(path, 'CYRILLIC', 'Cyrillic text is not allowed (no Russian anywhere)');
    if (RUSSIAN_RE.test(s)) err(path, 'RUSSIAN', 'Russian is not offered anywhere on the site');
    if (spec.max && len(s) > spec.max) err(path, 'TOO_LONG', `${len(s)} > ${spec.max} characters`);
    if (spec.warnOver && len(s) > spec.warnOver) warn(path, 'LONG', `${len(s)} characters; search engines truncate after ~${spec.warnOver}`);
    if (/ {2}/.test(s)) warn(path, 'DOUBLE_SPACE', 'double space');
    if (MTAVRULI_RE.test(s)) warn(path, 'MTAVRULI', 'Mtavruli capitals; write Georgian in Mkhedruli');
    if (TOKEN_PATH_RE.test(path)) { const t = s.split(/\s+/).find((w) => len(w) > 24); if (t) warn(path, 'LONG_TOKEN', `"${t}" has no break opportunity for ${len(t)} characters; it will break mid-word`); }
    if (lang === 'en' && CAPS_PATHS.has(path.replace(/\[\d+\]/g, '[]')) && GEORGIAN_RE.test(s)) err(path, 'GEORGIAN_IN_CAPS', 'this label is shown in capitals on the English page; Georgian letters would turn into Mtavruli');
    if (spec.text && lang === 'ka' && !GEORGIAN_RE.test(s)) warn(path, 'UNTRANSLATED', 'Georgian text contains no Georgian letters');
    if (spec.text && lang === 'en' && GEORGIAN_RE.test(s)) warn(path, 'WRONG_LANGUAGE', 'English text contains Georgian letters');
    if (spec.pattern && !spec.pattern.test(s)) err(path, 'PATTERN', `does not match ${spec.pattern}`);
    if (spec.href) { const e = hrefError(s, spec.href); if (e) err(path, e, `allowed schemes: ${spec.href.join(' ')}`); }
    if (spec.date) {
      const [y, m, d] = s.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!DATE_RE.test(s) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) err(path, 'DATE', 'not a real calendar date');
      else if (s > today) warn(path, 'FUTURE_DATE', `after today (${today})`);
    }
  };

  const walk = (v, spec, path) => {
    switch (spec.t) {
      case 'obj': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return err(path, 'TYPE', 'expected an object');
        for (const k of Object.keys(v)) if (!(k in spec.shape)) err(`${path}.${k}`, 'UNKNOWN_KEY', 'unknown field');
        for (const [k, sub] of Object.entries(spec.shape)) {
          if (!(k in v)) { if (!sub.optional && !sub.nullable) err(`${path}.${k}`, 'MISSING', 'required'); continue; }
          walk(v[k], sub, `${path}.${k}`);
        }
        return;
      }
      case 'lstr': {
        if (v === null && spec.optional) return;
        if (!v || typeof v !== 'object' || Array.isArray(v)) return err(path, 'TYPE', 'expected {"en": "…", "ka": "…"}');
        for (const k of Object.keys(v)) if (!LANGS.includes(k)) err(`${path}.${k}`, k === 'ru' ? 'RUSSIAN' : 'LANG_KEY', `only ${LANGS.join(' and ')} are allowed`);
        for (const lang of LANGS) {
          if (!(lang in v)) err(`${path}.${lang}`, 'MISSING_LANG', `${lang} translation missing`);
          else checkText(`${path}.${lang}`, v[lang], spec, lang);
        }
        return;
      }
      case 'str':
        if (v === null && spec.nullable) return;
        return checkText(path, v, spec, null);
      case 'enum':
        if (!spec.values.includes(v)) err(path, 'ENUM', `one of: ${spec.values.join(', ')}`);
        return;
      case 'int':
        if (v === null && spec.nullable) return;
        if (!Number.isInteger(v) || v < spec.min || v > spec.max) err(path, 'INT', `integer ${spec.min}–${spec.max}`);
        return;
      case 'bool':
        if (typeof v !== 'boolean') err(path, 'TYPE', 'expected true/false');
        return;
      case 'id':
      case 'ref':
        if (typeof v !== 'string' || !ID_RE.test(v)) err(path, 'ID', 'lowercase letters, digits and "-", 1–40 chars');
        return;
      case 'arr': {
        if (!Array.isArray(v)) return err(path, 'TYPE', 'expected a list');
        if (v.length < spec.min || v.length > spec.max) err(path, 'COUNT', spec.min === spec.max ? `exactly ${spec.min} items` : `${spec.min}–${spec.max} items`);
        const seen = new Set();
        v.forEach((item, i) => {
          walk(item, spec.item, `${path}[${i}]`);
          const id = item && typeof item === 'object' ? item.id : undefined;
          if (id !== undefined) { if (seen.has(id)) err(`${path}[${i}].id`, 'DUPLICATE_ID', `"${id}" is used twice in this list`); seen.add(id); }
        });
        return;
      }
    }
  };

  walk(site, buildSchema({ paletteIds, layoutIds }), '$');
  // build mode: a palette id that no longer exists falls back to the default (palettes plan §5.3)
  if (mode === 'build') {
    const i = errors.findIndex((e) => e.path === '$.settings.palette' && e.code === 'ENUM');
    if (i >= 0) { const [e] = errors.splice(i, 1); warn(e.path, 'PALETTE_FALLBACK', `unknown palette "${site.settings.palette}"; the default palette is used`); }
  }
  if (errors.some((e) => e.code === 'TYPE' && e.path.split('.').length <= 2)) return { errors, warnings }; // too broken for cross-checks

  // ---------------- cross-field rules ----------------
  const s = site.sections || {};
  const updatedYear = Number(String(site.settings?.updated).slice(0, 4));

  // nav labels: effective label = nav ?? title; per-label <= 28, per-language total <= 100
  for (const lang of LANGS) {
    let total = 0;
    for (const { key } of SECTIONS) {
      const sec = s[key]; if (!sec?.title) continue;
      const label = (sec.nav || sec.title)[lang] || '';
      total += len(label);
      if (!sec.nav && len(label) > 28) err(`$.sections.${key}.title.${lang}`, 'NAV_LABEL', `title is also the nav label (${len(label)} > 28); shorten it or set sections.${key}.nav`);
    }
    if (total > 100) err(`$.sections`, 'NAV_BUDGET', `${lang}: nav labels total ${total} characters (max 100); set shorter nav labels`);
  }

  // experience periods
  (s.experience?.items || []).forEach((e, i) => {
    const p = `$.sections.experience.items[${i}]`;
    if (Number.isInteger(e.to) && Number.isInteger(e.from) && e.to < e.from) err(`${p}.to`, 'PERIOD_ORDER', '"to" is before "from"');
    if (Number.isInteger(e.from) && e.from > updatedYear) warn(`${p}.from`, 'FUTURE_YEAR', `after the "updated" year ${updatedYear}`);
    if (Number.isInteger(e.to) && e.to > updatedYear) warn(`${p}.to`, 'FUTURE_YEAR', `after the "updated" year ${updatedYear}`);
  });

  // contact references and value/href consistency
  const items = site.contact?.items || [];
  const byId = Object.fromEntries(items.map((c) => [c.id, c]));
  const c = s.contact || {};
  if (!byId[c.primary]) err('$.sections.contact.primary', 'REF', `no contact item with id "${c.primary}"`);
  else if (!String(byId[c.primary].href).startsWith('mailto:')) err('$.sections.contact.primary', 'REF_PRIMARY', 'must point to an email (mailto:) item');
  (c.buttons || []).forEach((id, i) => {
    if (!byId[id]) err(`$.sections.contact.buttons[${i}]`, 'REF', `no contact item with id "${id}"`);
    if ((c.buttons || []).indexOf(id) !== i) err(`$.sections.contact.buttons[${i}]`, 'DUPLICATE_ID', 'listed twice');
    if (id === c.primary) warn(`$.sections.contact.buttons[${i}]`, 'REDUNDANT', 'the primary email already has the main button');
  });
  items.forEach((it, i) => {
    const h = String(it.href || ''), v = String(it.value || ''), p = `$.contact.items[${i}].value`;
    if (h.startsWith('mailto:') && v !== h.slice(7)) warn(p, 'VALUE_HREF', 'shown address differs from the mailto: address');
    if (h.startsWith('tel:') && v.replace(/[\s().-]/g, '') !== h.slice(4)) warn(p, 'VALUE_HREF', 'shown number differs from the tel: number');
    if (h.startsWith('https://') && !h.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '').startsWith(v.replace(/^www\./, ''))) warn(p, 'VALUE_HREF', 'shown text is not the start of the link');
  });

  // fact values render at 30–34px in 4 narrow cells: long unbreakable words break mid-word
  (site.hero?.facts || []).forEach((f, i) => {
    for (const lang of LANGS) {
      const words = String(f?.value?.[lang] || '').split(/\s+/);
      const bad = words.find((w) => (GEORGIAN_RE.test(w) ? len(w) > 4 : len(w) > 7));
      if (bad) warn(`$.hero.facts[${i}].value.${lang}`, 'LONG_WORD', `"${bad}" is too long for one line in the facts strip; it will break mid-word (max 7 Latin / 4 Georgian letters per word)`);
    }
  });

  // eyebrow year
  for (const lang of LANGS) {
    const m = /\b(19|20)\d{2}\b/.exec(site.hero?.eyebrow?.[lang] || '');
    if (m && Number(m[0]) !== updatedYear) warn(`$.hero.eyebrow.${lang}`, 'EYEBROW_YEAR', `says ${m[0]}, "updated" is ${updatedYear}`);
  }

  (site.person?.sameAs || []).forEach((u, i, arr) => { if (arr.indexOf(u) !== i) warn(`$.person.sameAs[${i}]`, 'DUPLICATE', 'listed twice'); });

  return { errors, warnings };
}

// Flat limits table for the admin (maxlength counters) — generated from the schema.
export function limitsTable(schema = buildSchema()) {
  const rows = [];
  const walk = (spec, path) => {
    if (spec.t === 'obj') for (const [k, sub] of Object.entries(spec.shape)) walk(sub, path ? `${path}.${k}` : k);
    else if (spec.t === 'arr') walk(spec.item, `${path}[]`);
    else if ((spec.t === 'lstr' || spec.t === 'str') && spec.max) rows.push({ path, max: spec.max, localized: spec.t === 'lstr' });
  };
  walk(schema, '');
  return rows;
}

// Canonical serialisation: keys in schema order, unknown keys dropped, 2-space JSON + "\n".
// The admin writes site.json only through this, so git diffs stay minimal and stable.
export function canonicalize(site, schema = buildSchema()) {
  const walk = (v, spec) => {
    if (v === null || v === undefined) return v ?? null;
    if (spec.t === 'obj') return Object.fromEntries(Object.entries(spec.shape).filter(([k]) => k in v).map(([k, sub]) => [k, walk(v[k], sub)]));
    if (spec.t === 'arr') return v.map((x) => walk(x, spec.item));
    if (spec.t === 'lstr') return { en: v.en, ka: v.ka };
    return v;
  };
  return JSON.stringify(walk(site, schema), null, 2) + '\n';
}
