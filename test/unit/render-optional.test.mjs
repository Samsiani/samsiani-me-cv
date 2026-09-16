// Removed lines, hidden sections and a reordered page, in every layout and both languages: what is gone
// must leave no element, no orphan separator and no dangling id behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../../src/render.mjs';
import { LANGS, SECTIONS } from '../../src/shared/localize.mjs';
import { seed, renderArgs } from './_helpers.mjs';

// Layouts join this list as their milestone lands (C3 Precision, C4 Studio, C5 Ledger).
const LAYOUTS_UNDER_TEST = ['precision', 'studio'];

const PAGE = { en: 'index.html', ka: 'ka/index.html' };
const OPTIONAL_LINES = ['eyebrow', 'subrole', 'tagline', 'location', 'availability'];
const KEYS = SECTIONS.map((s) => s.key);
const ANCHOR = Object.fromEntries(SECTIONS.map((s) => [s.key, s.anchor]));

/** Every optional line removed: no facts, no buttons, no leads, no footer tagline. */
function strip() {
  const s = seed();
  for (const k of OPTIONAL_LINES) s.hero[k] = null;
  s.hero.facts = [];
  s.ui.builtWith = null;
  s.sections.contact.cta = null;
  s.sections.contact.buttons = [];
  for (const sec of Object.values(s.sections)) { sec.nav = null; sec.lead = null; }
  for (const g of s.sections.skills.groups) { g.lead = null; for (const i of g.items) i.detail = null; }
  return s;
}
function hide(...keys) {
  const s = seed();
  for (const k of keys) s.sections[k].hidden = true;
  return s;
}
const hideAllBut = (key) => hide(...KEYS.filter((k) => k !== key));
function reverseOrder() {
  const s = seed();
  s.settings.sectionOrder = [...s.settings.sectionOrder].reverse();
  return s;
}

const CASES = {
  'every optional line removed': strip,
  'only the profile section': () => hideAllBut('profile'),
  'the section order reversed': reverseOrder,
  'experience, languages and skills hidden': () => hide('experience', 'languages', 'skills'),
};

// An empty element is a mistake unless it is decoration (a dot, a separator) that carries no text.
const EMPTY_RE = /<(p|span|div|ul|ol|dl|h[1-6]|section)\b([^>]*)>\s*<\/\1>/g;
const DECORATION = new Set(['dot', 'st-dot', 'lg-bsep']);
const decorative = (attrs) => /aria-hidden="true"/.test(attrs) || (attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).some((c) => DECORATION.has(c));

/** The navigations that list sections, as their inner HTML. */
const sectionNavs = (html) => [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => m[1]).filter((b) => b.includes('data-spy='));

function checkDocument(html, label) {
  for (const m of html.matchAll(EMPTY_RE)) assert.ok(decorative(m[2]), `${label}: empty <${m[1]}${m[2]}>`);
  assert.equal(html.includes('>null<'), false, `${label}: a removed line reached the page as "null"`);
  // an orphan separator: one that lost the value on either side of it. ("> · " on its own would also
  // match the footer's own "</time> · Built with…", which is correct output, so it is "> · <" here.)
  for (const orphan of [' · </', '> · <', '·  ', ' — </']) {
    assert.equal(html.includes(orphan), false, `${label}: orphan separator "${orphan}"`);
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)) {
    for (const ref of m[1].split(/\s+/)) assert.ok(ids.has(ref), `${label}: aria reference "${ref}" has no element`);
  }
}

for (const id of LAYOUTS_UNDER_TEST) {
  for (const [name, make] of Object.entries(CASES)) {
    test(`${id}: ${name}`, () => {
      const site = make();
      site.settings.layout = id;
      const out = renderSite(site, renderArgs(id));
      const shown = site.settings.sectionOrder.filter((k) => !site.sections[k].hidden);
      const numbers = shown.map((_, i) => String(i + 1).padStart(2, '0'));
      for (const lang of LANGS) {
        const html = out[PAGE[lang]];
        const label = `${id} ${lang} (${name})`;
        checkDocument(html, label);
        const navs = sectionNavs(html);
        assert.ok(navs.length > 0, `${label}: no section navigation`);
        for (const nav of navs) {
          assert.deepEqual([...nav.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]), shown.map((k) => ANCHOR[k]), `${label}: nav links`);
          const shownNumbers = [...nav.matchAll(/data-spy="[a-z-]+"><span class="(?:idx|st-menu-idx|n)"[^>]*>(\d+)</g)].map((m) => m[1]);
          if (shownNumbers.length) assert.deepEqual(shownNumbers, numbers, `${label}: nav numbering`);
        }
        // section numbers on the page itself follow the shown order too
        const onPage = [...html.matchAll(/class="(?:sec-idx|st-idx|lg-n)"[^>]*>(\d+)</g)].map((m) => m[1]).filter((n) => n !== '00');
        assert.deepEqual(onPage, numbers, `${label}: section numbering`);
        for (const k of KEYS) assert.equal(html.includes(`id="${ANCHOR[k]}"`), shown.includes(k), `${label}: section ${k} on the page`);
        const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
        assert.equal('worksFor' in ld, shown.includes('experience'), `${label}: worksFor`);
        assert.equal('knowsLanguage' in ld, shown.includes('languages'), `${label}: knowsLanguage`);
        assert.equal('knowsAbout' in ld, shown.includes('skills'), `${label}: knowsAbout`);
        if (make === strip) {
          for (const cls of ['facts', 'st-facts', 'lg-facts']) assert.equal(html.includes(`"${cls}"`), false, `${label}: ${cls} without facts`);
          for (const cls of ['cta-row', 'st-cta-row', 'lg-cta']) assert.equal(html.includes(`"${cls}"`), false, `${label}: ${cls} without a button`);
        }
      }
    });
  }

  test(`${id}: the facts strip is drawn for 1 to 4 facts and omitted at 0`, () => {
    for (let n = 0; n <= 4; n++) {
      const site = seed();
      site.settings.layout = id;
      site.hero.facts = seed().hero.facts.slice(0, n);
      const html = renderSite(site, renderArgs(id))['index.html'];
      const label = `${id}: ${n} facts`;
      checkDocument(html, label);
      const list = html.match(/<ul class="(?:facts|st-facts|lg-facts)"([^>]*)>([\s\S]*?)<\/ul>/);
      assert.equal(!!list, n > 0, `${label}: strip present`);
      if (!list) continue;
      assert.equal([...list[2].matchAll(/<li\b/g)].length, n, `${label}: cells`);
      if (n !== 4) assert.match(list[1], new RegExp(`--n:${n}`), `${label}: the cell count reaches the CSS`);
    }
  });
}
