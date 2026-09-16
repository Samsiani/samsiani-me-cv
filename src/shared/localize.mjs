// site.json -> per-language tree the templates consume.
// Target location after the refactor: src/shared/localize.mjs
// Zero dependencies. Pure functions only.

export const LANGS = ['en', 'ka'];
export const DEFAULT_LANG = 'en';

// Structural per-locale constants. Not editable in the admin: changing them breaks URLs,
// hreflang, the sitemap and the deploy layout.
export const LOCALES = {
  en: { lang: 'en', dir: 'ltr', path: '/', ogLocale: 'en_US' },
  ka: { lang: 'ka', dir: 'ltr', path: '/ka/', ogLocale: 'ka_GE' },
};

// Fixed section set, fixed order, fixed anchors (anchors are public URLs: /#work-style).
// key = key in site.json `sections`; anchor = HTML id; legacy = key in the legacy tree.
export const SECTIONS = [
  { key: 'profile', anchor: 'profile', legacy: 'profile' },
  { key: 'skills', anchor: 'skills', legacy: 'skills' },
  { key: 'abilities', anchor: 'abilities', legacy: 'abilities' },
  { key: 'workstyle', anchor: 'work-style', legacy: 'workstyle' },
  { key: 'principles', anchor: 'principles', legacy: 'principles' },
  { key: 'experience', anchor: 'experience', legacy: 'experience' },
  { key: 'languages', anchor: 'languages', legacy: 'education' },
  { key: 'contact', anchor: 'contact', legacy: 'contact' },
];
export const ANCHOR = Object.fromEntries(SECTIONS.map((s) => [s.key, s.anchor]));
export const LEGACY = Object.fromEntries(SECTIONS.map((s) => [s.key, s.legacy]));

export const LEVELS = ['core', 'strong', 'working'];
export const DETAIL_SEP = ' · '; // "Name · detail" (U+00B7 with spaces)
export const PERIOD_SEP = ' — '; // "2018 — present" (U+2014 with spaces)

export const altOf = (lang) => (lang === 'en' ? 'ka' : 'en');
export const joinName = (name, detail) => (detail ? `${name}${DETAIL_SEP}${detail}` : name);
export const formatPeriod = (from, to, presentWord) =>
  to === from ? String(from) : `${from}${PERIOD_SEP}${to == null ? presentWord : to}`;
export const displayName = (person, lang) => `${person.givenName[lang]} ${person.familyName[lang]}`;
export const hrefKind = (href) =>
  href.startsWith('mailto:') ? 'email' : href.startsWith('tel:') ? 'phone' : 'link';

/**
 * localize(site, lang) -> the per-language tree the pre-refactor template read (exactly the shape of
 * the old per-language content module en.mjs / ka.mjs: same keys, same values, same key order), plus a small set of ADDITIVE
 * keys (list-item ids, split skill names, raw years, nav labels, resolved contact refs, new ui
 * strings). See docs/plans/data-model.md §5.
 */
export function localize(site, lang) {
  if (!LANGS.includes(lang)) throw new Error(`localize: unknown lang "${lang}"`);
  const alt = altOf(lang);
  const T = (v) => v[lang];
  const T0 = (v) => (v == null ? null : v[lang]); // an optional line: null, never the string "null"
  const { ui, hero, person, contact, meta } = site;
  const s = site.sections;

  const head = (key) => ({
    id: ANCHOR[key],
    title: T(s[key].title),
    ...(s[key].lead ? { lead: T(s[key].lead) } : {}),
    navLabel: T(s[key].nav || s[key].title), // additive: short nav label, falls back to title
  });
  const cards = (key) => ({
    ...head(key),
    items: s[key].items.map((it) => ({ title: T(it.title), text: T(it.text), id: it.id })),
  });

  const contactOut = contact.items.map((i) => ({
    label: T(i.label),
    value: i.value,
    href: i.href,
    icon: i.icon,
    ...(i.copy ? { copy: true } : {}),
    id: i.id,
  }));

  return {
    lang,
    dir: LOCALES[lang].dir,
    path: LOCALES[lang].path,
    altPath: LOCALES[alt].path,
    altLabel: ui.langShort[alt],
    altTitle: ui.langSwitch[alt],
    selfLabel: ui.langShort[lang],
    meta: { title: T(meta.title), description: T(meta.description), ogLocale: LOCALES[lang].ogLocale },
    ui: {
      skip: T(ui.skip),
      nav: T(ui.nav),
      theme: T(ui.theme),
      print: T(ui.print),
      printShort: T(ui.printShort),
      language: T(ui.language),
      copy: T(ui.copy),
      copied: T(ui.copied),
      legend: T(ui.legend),
      levels: Object.fromEntries(LEVELS.map((l) => [l, T(ui.levels[l])])),
      levelHints: Object.fromEntries(LEVELS.map((l) => [l, T(ui.levelHints[l])])),
      updated: T(ui.updated),
      builtWith: T0(ui.builtWith),
      top: T(ui.top),
      atAGlance: T(ui.atAGlance),
      // additive (new layouts / new features)
      present: T(ui.present),
      themeShort: T(ui.themeShort),
      colGroup: T(ui.colGroup),
      colSkill: T(ui.colSkill),
      colDepth: T(ui.colDepth),
    },
    hero: {
      eyebrow: T0(hero.eyebrow),
      name: displayName(person, lang),
      role: T(hero.role),
      subrole: T0(hero.subrole),
      tagline: T0(hero.tagline),
      location: T0(hero.location),
      availability: T0(hero.availability),
      facts: hero.facts.map((f) => ({ value: T(f.value), label: T(f.label), id: f.id })),
      // additive
      givenName: T(person.givenName),
      familyName: T(person.familyName),
    },
    contact: {
      heading: T(contact.heading),
      items: contactOut,
    },
    sections: {
      profile: { ...head('profile'), paragraphs: s.profile.paragraphs.map((p) => T(p.text)) },
      skills: {
        ...head('skills'),
        groups: s.skills.groups.map((g) => ({
          title: T(g.title),
          lead: T0(g.lead),
          items: g.items.map((i) => ({
            name: joinName(T(i.name), i.detail ? T(i.detail) : null),
            level: i.level,
            id: i.id,
            label: T(i.name),
            detail: i.detail ? T(i.detail) : null,
          })),
          id: g.id,
        })),
      },
      abilities: cards('abilities'),
      workstyle: cards('workstyle'),
      principles: cards('principles'),
      experience: {
        ...head('experience'),
        items: s.experience.items.map((e) => ({
          period: formatPeriod(e.from, e.to, T(ui.present)),
          role: T(e.role),
          org: T(e.org),
          ...(e.orgHref ? { orgHref: e.orgHref } : {}),
          text: T(e.text),
          id: e.id,
          from: e.from,
          to: e.to,
        })),
      },
      // Legacy key "education" holds the Languages section (anchor #languages).
      education: {
        ...head('languages'),
        langsTitle: T(s.languages.title), // legacy duplicate of title; unused by the template
        langs: s.languages.items.map((l) => ({ name: T(l.name), level: T(l.proficiency), id: l.id })),
      },
      contact: {
        ...head('contact'),
        cta: T0(s.contact.cta),
        // additive: resolved references into contact.items (localized items, same shape as contact.items[])
        primary: contactOut.find((i) => i.id === s.contact.primary) || null,
        buttons: s.contact.buttons.map((id) => contactOut.find((i) => i.id === id)).filter(Boolean),
      },
    },
    // additive: the sections the page shows, in order, as legacy keys ("education" is Languages).
    // `sections` above still holds every section; hidden ones are simply not listed here.
    sectionOrder: site.settings.sectionOrder.filter((k) => s[k] && s[k].hidden !== true).map((k) => LEGACY[k]),
  };
}

// Everything a template needs that is not per-language text. Passed as ctx.* by the build.
export function siteContext(site) {
  const items = site.contact.items;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const primary = byId[site.sections.contact.primary];
  const tel = items.find((i) => i.href.startsWith('tel:'));
  return {
    siteUrl: site.settings.siteUrl,
    host: new URL(site.settings.siteUrl).host,
    updated: site.settings.updated,
    layoutId: site.settings.layout, // ctx.layout is the layout manifest object (set by render.mjs)
    paletteId: site.settings.palette,
    defaultTheme: site.settings.defaultTheme,
    person: site.person,
    authorName: displayName(site.person, 'en'), // <meta name="author">, same on both pages
    email: primary ? primary.href : null, // JSON-LD "email" keeps the mailto: form (as today)
    telephone: tel ? tel.href.slice(4) : null,
  };
}
