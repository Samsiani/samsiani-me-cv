import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, canonicalize, limitsTable } from '../../src/schema/validate.mjs';
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

// ---------------- settings.fonts (docs/plans/fonts.md §3.1) ----------------
// An optional key: absent means every layout keeps its own faces, so no stored document changes and
// canonicalize() still reproduces the seed byte for byte (the test above).
const withFonts = (fonts) => { const s = seed(); s.settings.fonts = fonts; return validate(s, { today: TODAY }); };

test('settings.fonts: absent, empty and well-formed ids all validate', () => {
  assert.deepEqual(validate(seed(), { today: TODAY }).errors, []);
  assert.deepEqual(withFonts({}).errors, []);
  assert.deepEqual(withFonts({ precision: { text: '3f2a1b9c0d4e5f60', label: null, georgian: null } }).errors, []);
  assert.deepEqual(withFonts({ studio: {}, ledger: { georgian: '0123456789abcdef' } }).errors, []);
});

for (const [name, fonts, code, path] of [
  ['an unknown layout', { nope: { text: null } }, 'UNKNOWN_KEY', '$.settings.fonts.nope'],
  ['an unknown role', { precision: { display: null } }, 'UNKNOWN_KEY', '$.settings.fonts.precision.display'],
  ['a path instead of an id', { precision: { text: '../../etc/pas' } }, 'PATTERN', '$.settings.fonts.precision.text'],
  ['uppercase hex', { precision: { text: '3F2A1B9C0D4E5F60' } }, 'PATTERN', '$.settings.fonts.precision.text'],
  ['a short id', { precision: { text: 'abc' } }, 'PATTERN', '$.settings.fonts.precision.text'],
  ['a number', { precision: { text: 7 } }, 'TYPE', '$.settings.fonts.precision.text'],
]) {
  test(`settings.fonts rejects ${name}`, () => {
    const r = withFonts(fonts);
    assert.ok(r.errors.some((e) => e.code === code && e.path === path), `expected ${code} at ${path}, got ${JSON.stringify(r.errors)}`);
  });
}

test('canonicalize() keeps a present fonts key and omits an absent one', () => {
  const s = seed();
  s.settings.fonts = { ledger: { georgian: '0123456789abcdef' }, precision: { text: null } };
  const out = JSON.parse(canonicalize(s));
  assert.deepEqual(Object.keys(out.settings.fonts), ['precision', 'ledger']); // schema order, not insertion order
  assert.deepEqual(out.settings.fonts.precision, { text: null });
  assert.equal(JSON.parse(canonicalize(seed())).settings.fonts, undefined);
});

test('the limits table has no settings.fonts row (the ids are not text fields)', () => {
  assert.deepEqual(limitsTable().filter((r) => r.path.startsWith('settings.fonts')), []);
  assert.ok(limitsTable().some((r) => r.path === 'settings.siteUrl'), 'the other settings rows are still there');
});
