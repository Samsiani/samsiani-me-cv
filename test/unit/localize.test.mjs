// The per-language tree: removed lines are null (never the string "null"), and the page order lists the
// sections that are shown, in settings.sectionOrder, as legacy keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, LANGS, SECTIONS } from '../../src/shared/localize.mjs';
import { orderedSections, SECTION_ORDER } from '../../src/shared/fragments.mjs';
import { seed, minimal } from './_helpers.mjs';

const OPTIONAL_LINES = ['eyebrow', 'subrole', 'tagline', 'location', 'availability'];

test('the seed keeps every line and lists all eight sections in the legacy order', () => {
  for (const lang of LANGS) {
    const c = localize(seed(), lang);
    for (const k of OPTIONAL_LINES) assert.equal(typeof c.hero[k], 'string', k);
    assert.deepEqual(c.sectionOrder, SECTION_ORDER);
    assert.deepEqual(orderedSections(c).map((s) => s.id), ['profile', 'skills', 'abilities', 'work-style', 'principles', 'experience', 'languages', 'contact']);
  }
});

test('a removed line is null in both languages, never a string', () => {
  const s = seed();
  for (const k of OPTIONAL_LINES) s.hero[k] = null;
  s.ui.builtWith = null;
  s.sections.contact.cta = null;
  s.sections.skills.groups[0].lead = null;
  s.hero.facts = [];
  for (const lang of LANGS) {
    const c = localize(s, lang);
    for (const k of OPTIONAL_LINES) assert.equal(c.hero[k], null, k);
    assert.equal(c.ui.builtWith, null);
    assert.equal(c.sections.contact.cta, null);
    assert.equal(c.sections.skills.groups[0].lead, null);
    assert.deepEqual(c.hero.facts, []);
    assert.equal(JSON.stringify(c).includes('"null"'), false, 'no line became the string "null"');
  }
});

test('the page order follows settings.sectionOrder and drops hidden sections', () => {
  const s = seed();
  s.settings.sectionOrder = ['contact', 'languages', 'experience', 'principles', 'workstyle', 'abilities', 'skills', 'profile'];
  s.sections.abilities.hidden = true;
  s.sections.languages.hidden = true;
  const c = localize(s, 'en');
  assert.deepEqual(c.sectionOrder, ['contact', 'experience', 'principles', 'workstyle', 'skills', 'profile']);
  assert.deepEqual(orderedSections(c).map((x) => x.id), ['contact', 'experience', 'principles', 'work-style', 'skills', 'profile']);
  for (const { legacy } of SECTIONS) assert.ok(c.sections[legacy], `${legacy} is still in the tree`);
});

test('the minimal fixture shows four sections in its own order', () => {
  const c = localize(minimal(), 'ka');
  assert.deepEqual(c.sectionOrder, ['profile', 'experience', 'skills', 'contact']);
  assert.deepEqual(orderedSections(c).map((x) => x.title), c.sectionOrder.map((k) => c.sections[k].title));
});
