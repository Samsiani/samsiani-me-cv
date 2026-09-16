import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, canonicalize } from '../../src/schema/validate.mjs';
import { seed, seedText, stress } from './_helpers.mjs';

const TODAY = '2026-09-14';
const codes = (r) => [...new Set(r.errors.map((e) => e.code))];

test('the seed validates with no errors and no warnings', () => {
  const r = validate(seed(), { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

const MUTATIONS = [
  ['javascript: href', (s) => { s.contact.items[2].href = 'javascript:alert(1)'; }],
  ['JavaScript: mixed case', (s) => { s.contact.items[2].href = 'JavaScript:alert(1)'; }],
  ['tab inside scheme', (s) => { s.contact.items[2].href = 'java\tscript:alert(1)'; }],
  ['http: href', (s) => { s.contact.items[3].href = 'http://samsiani.com'; }],
  ['data: href', (s) => { s.contact.items[3].href = 'data:text/html,hi'; }],
  ['mailto with ?bcc', (s) => { s.contact.items[0].href = 'mailto:a@b.com?bcc=x@y.com'; }],
  ['orgHref mailto (https only)', (s) => { s.sections.experience.items[0].orgHref = 'mailto:a@b.com'; }],
  ['ru key', (s) => { s.hero.role.ru = 'Веб-разработчик'; }],
  ['Cyrillic in ka', (s) => { s.hero.role.ka = 'Веб-разработчик'; }],
  ['"RU" token', (s) => { s.hero.facts[3].value.en = 'KA · EN · RU'; }],
  ['missing ka', (s) => { delete s.hero.tagline.ka; }],
  ['empty ka', (s) => { s.hero.tagline.ka = ''; }],
  ['duplicate id', (s) => { s.sections.abilities.items[1].id = s.sections.abilities.items[0].id; }],
  ['bad level', (s) => { s.sections.skills.groups[0].items[0].level = 'expert'; }],
  ['to < from', (s) => { s.sections.experience.items[0].to = 2010; }],
  ['nav label too long', (s) => { s.sections.abilities.title.en = 'Everything I can own end to end, in production'; }],
  ['5 facts', (s) => { s.hero.facts.push({ ...s.hero.facts[0], id: 'fifth' }); }, 'COUNT'],
  ['unknown layout', (s) => { s.settings.layout = 'brutalist'; }],
  ['unknown key', (s) => { s.sections.education = { title: { en: 'Education', ka: 'განათლება' } }; }],
  ['newline in title', (s) => { s.sections.principles.items[0].title.en = 'Line one\nline two'; }],
  ['contact.primary not mailto', (s) => { s.sections.contact.primary = 'github'; }],
  ['siteUrl with path', (s) => { s.settings.siteUrl = 'https://samsiani.me/cv'; }],
  ['bad date', (s) => { s.settings.updated = '2026-02-30'; }],
  ['schemaVersion 1', (s) => { s.schemaVersion = 1; }, 'ENUM'],
  ['sectionOrder missing a key', (s) => { s.settings.sectionOrder = s.settings.sectionOrder.slice(0, 7); }, 'SECTION_ORDER'],
  ['sectionOrder with a duplicate', (s) => { s.settings.sectionOrder[1] = s.settings.sectionOrder[0]; }, 'SECTION_ORDER'],
  ['sectionOrder with an unknown key', (s) => { s.settings.sectionOrder[0] = 'education'; }, 'SECTION_ORDER'],
  ['every section hidden', (s) => { for (const sec of Object.values(s.sections)) sec.hidden = true; }, 'NO_SECTIONS'],
  ['hero.role removed', (s) => { s.hero.role = null; }, 'TYPE'],
];

for (const [name, mutate, code] of MUTATIONS) {
  test(`rejects: ${name}`, () => {
    const s = seed();
    mutate(s);
    const r = validate(s, { today: TODAY });
    assert.ok(r.errors.length > 0, `expected an error, got none (${name})`);
    if (code) assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r).join(', ')}`);
  });
}
test('there are 29 mutation cases', () => assert.equal(MUTATIONS.length, 29));

test('accepts a document with every optional line removed and no facts', () => {
  const s = seed();
  s.hero.facts = [];
  for (const k of ['eyebrow', 'subrole', 'tagline', 'location', 'availability']) s.hero[k] = null;
  for (const g of s.sections.skills.groups) g.lead = null;
  s.sections.contact.cta = null;
  s.ui.builtWith = null;
  const r = validate(s, { today: TODAY });
  assert.deepEqual(r.errors, []);
});

test('a hidden section is out of the nav budget; the same title shown is a NAV_LABEL error', () => {
  const long = { en: 'Everything I own, end to end in prod', ka: 'ყველაფერი, რასაც ვფლობ თავიდან ბოლომდე' };
  const hidden = seed();
  hidden.sections.abilities.title = { ...long };
  hidden.sections.abilities.hidden = true;
  assert.deepEqual(codes(validate(hidden, { today: TODAY })), []);
  const shown = seed();
  shown.sections.abilities.title = { ...long };
  assert.ok(codes(validate(shown, { today: TODAY })).includes('NAV_LABEL'));
});

test('GEORGIAN_IN_CAPS on an English label shown in capitals', () => {
  const s = seed();
  s.hero.eyebrow.en = 'რეზიუმე · 2026';
  assert.ok(codes(validate(s, { today: TODAY })).includes('GEORGIAN_IN_CAPS'));
});

test('LONG_TOKEN warns on a 30-letter skill group title', () => {
  const s = seed();
  s.sections.skills.groups[0].title.en = 'Supercalifragilisticexpialidoc';
  const r = validate(s, { today: TODAY });
  assert.ok(r.warnings.some((w) => w.code === 'LONG_TOKEN'), JSON.stringify(r.warnings));
});

test('the stress fixture has no errors and exactly the expected warnings', () => {
  const r = validate(stress(), { today: TODAY });
  assert.deepEqual(r.errors, []);
  const count = (c) => r.warnings.filter((w) => w.code === c).length;
  assert.equal(count('LONG'), 4);
  assert.equal(count('LONG_TOKEN'), 3);
  assert.equal(count('LONG_WORD'), 3);
  assert.equal(r.warnings.length, 10);
});

test('canonicalize() reproduces the seed byte for byte', () => {
  assert.equal(canonicalize(seed()), seedText());
});

test('canonicalize() restores key order and drops junk keys', () => {
  const shuffle = (v) => {
    if (Array.isArray(v)) return v.map(shuffle);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, shuffle(v[k])]));
    return v;
  };
  const s = shuffle(seed());
  s.junk = 1;
  s.hero.junk = { a: 1 };
  s.sections.skills.groups[0].junk = 'x';
  assert.equal(canonicalize(s), seedText());
});
