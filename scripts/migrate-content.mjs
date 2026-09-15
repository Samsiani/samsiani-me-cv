import { existsSync } from 'node:fs';
// One-time migration: legacy src/content/{en,ka}.mjs -> site.json.
// Target location after the refactor: scripts/migrate-content.mjs (run once, then delete en.mjs/ka.mjs).
import { LEVELS, DETAIL_SEP, PERIOD_SEP } from '../src/shared/localize.mjs';

export const slug = (s, max = 32) => {
  let t = String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (t.length > max) {
    t = t.slice(0, max);
    const cut = t.lastIndexOf('-');
    if (cut >= 12) t = t.slice(0, cut);
    t = t.replace(/-+$/g, '');
  }
  return t || 'item';
};

// Unique ids within one list, derived from English text; "-2", "-3" on collision.
const idsFor = (texts) => {
  const seen = new Map();
  return texts.map((t) => {
    const base = slug(t);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
};

const splitDetail = (s) => {
  const i = s.indexOf(DETAIL_SEP);
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + DETAIL_SEP.length)];
};

export function migrate(en, ka, { updated = '2026-06-07', siteUrl = 'https://samsiani.me' } = {}) {
  const conflicts = []; // fields stored once whose en/ka values differ
  const notes = [];
  const same = (path, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) conflicts.push({ path, en: a, ka: b });
    return a;
  };
  const L = (a, b) => ({ en: a, ka: b });
  const zip = (path, A, B, fn) => {
    same(`${path}.length`, A.length, B.length);
    return A.map((a, i) => fn(a, B[i], i));
  };

  // --- structural constants must agree with LOCALES (not stored) ---
  same('dir', en.dir, ka.dir);
  if (en.path !== '/' || ka.path !== '/ka/' || en.altPath !== ka.path || ka.altPath !== en.path)
    conflicts.push({ path: 'path/altPath', en: [en.path, en.altPath], ka: [ka.path, ka.altPath] });
  if (en.selfLabel !== ka.altLabel || ka.selfLabel !== en.altLabel)
    conflicts.push({ path: 'selfLabel/altLabel', en: [en.selfLabel, en.altLabel], ka: [ka.selfLabel, ka.altLabel] });

  // --- person (name split, hardcoded template values lifted into data) ---
  const nameParts = (n) => {
    const p = n.trim().split(' ');
    return [p.slice(0, -1).join(' '), p[p.length - 1]];
  };
  const [enGiven, enFamily] = nameParts(en.hero.name);
  const [kaGiven, kaFamily] = nameParts(ka.hero.name);

  // --- experience periods ---
  const presentWord = { en: null, ka: null };
  const parsePeriod = (p, lang, path) => {
    const m = /^(\d{4})(?: — (.+))?$/.exec(p);
    if (!m) {
      conflicts.push({ path, [lang]: p, reason: 'unparseable period' });
      return { from: null, to: null };
    }
    const from = Number(m[1]);
    if (m[2] === undefined) return { from, to: from };
    if (/^\d{4}$/.test(m[2])) return { from, to: Number(m[2]) };
    if (presentWord[lang] && presentWord[lang] !== m[2])
      conflicts.push({ path, [lang]: m[2], reason: `inconsistent "present" word (${presentWord[lang]})` });
    presentWord[lang] = m[2];
    return { from, to: null };
  };

  const expIds = idsFor(en.sections.experience.items.map((e) => e.org));
  const experienceItems = zip('sections.experience.items', en.sections.experience.items, ka.sections.experience.items, (a, b, i) => {
    const pa = parsePeriod(a.period, 'en', `sections.experience.items[${i}].period`);
    const pb = parsePeriod(b.period, 'ka', `sections.experience.items[${i}].period`);
    same(`sections.experience.items[${i}].period(years)`, pa, pb);
    return {
      id: expIds[i],
      from: pa.from,
      to: pa.to,
      role: L(a.role, b.role),
      org: L(a.org, b.org),
      orgHref: same(`sections.experience.items[${i}].orgHref`, a.orgHref ?? null, b.orgHref ?? null),
      text: L(a.text, b.text),
    };
  });

  // --- skills ---
  const es = en.sections.skills, ks = ka.sections.skills;
  const groupIds = idsFor(es.groups.map((g) => g.title));
  const groups = zip('sections.skills.groups', es.groups, ks.groups, (ga, gb, gi) => {
    const itemIds = idsFor(ga.items.map((it) => splitDetail(it.name)[0]));
    return {
      id: groupIds[gi],
      title: L(ga.title, gb.title),
      lead: L(ga.lead, gb.lead),
      items: zip(`sections.skills.groups[${gi}].items`, ga.items, gb.items, (ia, ib, ii) => {
        const [na, da] = splitDetail(ia.name);
        const [nb, db] = splitDetail(ib.name);
        if ((da === null) !== (db === null))
          conflicts.push({ path: `sections.skills.groups[${gi}].items[${ii}].detail`, en: da, ka: db, reason: 'detail present in one language only' });
        if (!LEVELS.includes(ia.level)) conflicts.push({ path: `…items[${ii}].level`, en: ia.level, reason: 'unknown level' });
        return {
          id: itemIds[ii],
          name: L(na, nb),
          detail: da === null && db === null ? null : L(da ?? '', db ?? ''),
          level: same(`sections.skills.groups[${gi}].items[${ii}].level`, ia.level, ib.level),
        };
      }),
    };
  });

  const cards = (key) => {
    const A = en.sections[key], B = ka.sections[key];
    same(`sections.${key}.id`, A.id, B.id);
    const ids = idsFor(A.items.map((it) => it.title));
    return {
      nav: null,
      title: L(A.title, B.title),
      lead: A.lead || B.lead ? L(A.lead, B.lead) : null,
      items: zip(`sections.${key}.items`, A.items, B.items, (a, b, i) => ({ id: ids[i], title: L(a.title, b.title), text: L(a.text, b.text) })),
    };
  };

  // --- contact items ---
  const contactIds = idsFor(en.contact.items.map((c) => c.label));
  const contactItems = zip('contact.items', en.contact.items, ka.contact.items, (a, b, i) => ({
    id: contactIds[i],
    label: L(a.label, b.label),
    value: same(`contact.items[${i}].value`, a.value, b.value),
    href: same(`contact.items[${i}].href`, a.href, b.href),
    icon: same(`contact.items[${i}].icon`, a.icon, b.icon),
    copy: same(`contact.items[${i}].copy`, !!a.copy, !!b.copy),
  }));
  const emailItem = contactItems.find((c) => c.href.startsWith('mailto:'));
  const githubItem = contactItems.find((c) => c.icon === 'github');
  const phoneItem = contactItems.find((c) => c.href.startsWith('tel:'));

  // --- languages (legacy key "education"; langsTitle is a duplicate of title) ---
  const ea = en.sections.education, kb = ka.sections.education;
  if (ea.langsTitle !== ea.title || kb.langsTitle !== kb.title)
    conflicts.push({ path: 'sections.education.langsTitle', en: ea.langsTitle, ka: kb.langsTitle, reason: 'langsTitle differs from title; it would be dropped' });
  else notes.push('sections.education.langsTitle dropped (equals title in both languages); localize() re-derives it.');
  const langIds = idsFor(ea.langs.map((l) => l.name));

  const paraIds = ['intro', 'stack', 'integrations', 'plugins'];
  const profileParas = zip('sections.profile.paragraphs', en.sections.profile.paragraphs, ka.sections.profile.paragraphs, (a, b, i) => ({
    id: paraIds[i] || `p${i + 1}`,
    text: L(a, b),
  }));

  const factIds = idsFor(en.hero.facts.map((f) => f.label));

  const site = {
    schemaVersion: 1,
    settings: {
      layout: 'precision',
      palette: 'cobalt',
      defaultTheme: 'system',
      updated,
      autoUpdateDateOnPublish: false,
      siteUrl,
    },
    person: {
      givenName: L(enGiven, kaGiven),
      familyName: L(enFamily, kaFamily),
      // lifted from src/template.mjs (hardcoded there today)
      alternateName: L('George Samsiani', 'Giorgi Samsiani'),
      monogram: 'GS',
      address: { locality: 'Tbilisi', country: 'GE' },
      sameAs: ['https://github.com/Samsiani', 'https://samsiani.com', 'https://codeon.ge'],
    },
    meta: {
      title: L(en.meta.title, ka.meta.title),
      description: L(en.meta.description, ka.meta.description),
    },
    ui: {
      skip: L(en.ui.skip, ka.ui.skip),
      nav: L(en.ui.nav, ka.ui.nav),
      theme: L(en.ui.theme, ka.ui.theme),
      themeShort: L('Theme', 'თემა'), // NEW (Ledger topbar text label) — needs owner review
      print: L(en.ui.print, ka.ui.print),
      printShort: L(en.ui.printShort, ka.ui.printShort),
      language: L(en.ui.language, ka.ui.language),
      langShort: L(en.selfLabel, ka.selfLabel),
      langSwitch: L(ka.altTitle, en.altTitle), // "In English" lives on the ka page, "ქართულად" on the en page
      copy: L(en.ui.copy, ka.ui.copy),
      copied: L(en.ui.copied, ka.ui.copied),
      legend: L(en.ui.legend, ka.ui.legend),
      levels: Object.fromEntries(LEVELS.map((l) => [l, L(en.ui.levels[l], ka.ui.levels[l])])),
      levelHints: Object.fromEntries(LEVELS.map((l) => [l, L(en.ui.levelHints[l], ka.ui.levelHints[l])])),
      colGroup: L('Group', 'ჯგუფი'), // NEW (Ledger skills table header) — needs owner review
      colSkill: L('Skill', 'უნარი'), // NEW
      colDepth: L('Depth', 'დონე'), // NEW
      present: L(presentWord.en, presentWord.ka),
      atAGlance: L(en.ui.atAGlance, ka.ui.atAGlance),
      updated: L(en.ui.updated, ka.ui.updated),
      builtWith: L(en.ui.builtWith, ka.ui.builtWith),
      top: L(en.ui.top, ka.ui.top),
    },
    hero: {
      eyebrow: L(en.hero.eyebrow, ka.hero.eyebrow),
      role: L(en.hero.role, ka.hero.role),
      subrole: L(en.hero.subrole, ka.hero.subrole),
      tagline: L(en.hero.tagline, ka.hero.tagline),
      location: L(en.hero.location, ka.hero.location),
      availability: L(en.hero.availability, ka.hero.availability),
      facts: zip('hero.facts', en.hero.facts, ka.hero.facts, (a, b, i) => ({ id: factIds[i], value: L(a.value, b.value), label: L(a.label, b.label) })),
    },
    contact: {
      heading: L(en.contact.heading, ka.contact.heading),
      items: contactItems,
    },
    sections: {
      profile: { nav: null, title: L(en.sections.profile.title, ka.sections.profile.title), lead: null, paragraphs: profileParas },
      skills: { nav: null, title: L(es.title, ks.title), lead: L(es.lead, ks.lead), groups },
      abilities: cards('abilities'),
      workstyle: cards('workstyle'),
      principles: cards('principles'),
      experience: {
        nav: null,
        title: L(en.sections.experience.title, ka.sections.experience.title),
        lead: en.sections.experience.lead ? L(en.sections.experience.lead, ka.sections.experience.lead) : null,
        items: experienceItems,
      },
      languages: {
        nav: null,
        title: L(ea.title, kb.title),
        lead: null,
        items: zip('sections.education.langs', ea.langs, kb.langs, (a, b, i) => ({ id: langIds[i], name: L(a.name, b.name), proficiency: L(a.level, b.level) })),
      },
      contact: {
        nav: null,
        title: L(en.sections.contact.title, ka.sections.contact.title),
        lead: L(en.sections.contact.lead, ka.sections.contact.lead),
        cta: L(en.sections.contact.cta, ka.sections.contact.cta),
        primary: emailItem ? emailItem.id : null,
        buttons: [githubItem, phoneItem].filter(Boolean).map((c) => c.id),
      },
    },
  };

  // section anchors must match the fixed SECTIONS table
  for (const [k, anchor] of [['profile', 'profile'], ['skills', 'skills'], ['abilities', 'abilities'], ['workstyle', 'work-style'], ['principles', 'principles'], ['experience', 'experience'], ['education', 'languages'], ['contact', 'contact']]) {
    if (en.sections[k].id !== anchor || ka.sections[k].id !== anchor) conflicts.push({ path: `sections.${k}.id`, en: en.sections[k].id, ka: ka.sections[k].id, reason: `expected "${anchor}"` });
  }
  return { site, conflicts, notes };
}

// ---------------- CLI ----------------
// node scripts/migrate-content.mjs            -> writes src/content/site.json after proving the round trip
// Exit 1 (and write nothing) on any conflict, round-trip difference or validation error.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFile } = await import('node:fs/promises');
  const { localize } = await import('../src/shared/localize.mjs');
  const { validate } = await import('../src/schema/validate.mjs');
  if (!existsSync(new URL('../src/content/en.mjs', import.meta.url))) {
    console.log('The legacy src/content/en.mjs and ka.mjs were removed in M1 after this migration ran; src/content/site.json is the content now.');
    console.log('To re-run it, restore them first: git show 96e784e:src/content/en.mjs > src/content/en.mjs (and the same for ka.mjs).');
    process.exit(0);
  }
  const en = (await import('../src/content/en.mjs')).default;
  const ka = (await import('../src/content/ka.mjs')).default;
  const { site, conflicts, notes } = migrate(en, ka);
  const json = JSON.stringify(site, null, 2) + '\n';
  const parsed = JSON.parse(json);
  const problems = [...conflicts.map((c) => `conflict ${c.path}: ${JSON.stringify(c)}`)];
  // every legacy leaf must come back identical from localize(); extra keys are allowed
  const check = (orig, loc, path) => {
    if (orig && typeof orig === 'object') {
      if (!loc || typeof loc !== 'object') return problems.push(`${path}: type differs`);
      if (Array.isArray(orig) && orig.length !== loc.length) problems.push(`${path}: length ${orig.length} vs ${loc.length}`);
      for (const k of Object.keys(orig)) check(orig[k], loc[k], `${path}.${k}`);
    } else if (orig !== loc) problems.push(`${path}: ${JSON.stringify(orig)} vs ${JSON.stringify(loc)}`);
  };
  check(en, localize(parsed, 'en'), 'en');
  check(ka, localize(parsed, 'ka'), 'ka');
  const { errors } = validate(parsed, { mode: 'save' });
  errors.forEach((e) => problems.push(`invalid ${e.path} ${e.code}: ${e.msg}`));
  notes.forEach((n) => console.log('note:', n));
  if (problems.length) { problems.forEach((p) => console.error(p)); process.exit(1); }
  await writeFile(new URL('../src/content/site.json', import.meta.url), json);
  console.log(`wrote src/content/site.json (${Buffer.byteLength(json)} bytes); round trip exact for en and ka`);
}
