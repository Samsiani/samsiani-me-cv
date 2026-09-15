import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../src/schema/validate.mjs';
import { isBlocking, blockingErrors, softLimit } from '../shared/draft-rules.mjs';
import { seed } from './_helpers.mjs';

const V = (s) => validate(s, { mode: 'save', paletteIds: ['cobalt', 'lime', 'emerald', 'amber', 'crimson', 'graphite'], layoutIds: ['precision', 'studio', 'ledger'], today: '2026-09-15' });

test('the seed saves and publishes with 0 errors', () => {
  assert.deepEqual(V(seed()).errors, []);
});

test('a new item with an empty ka is stored in the draft but blocks publish', () => {
  const s = seed();
  s.sections.abilities.items.push({ id: 'newitem1', title: { en: 'New', ka: '' }, text: { en: 'Text', ka: '' } });
  const { errors } = V(s);
  assert.ok(errors.length > 0, 'publish is blocked');
  assert.deepEqual(blockingErrors(errors), [], 'the draft may still store it');
});

for (const [name, mutate] of [
  ['a ru key', (s) => { s.hero.role.ru = 'x'; }],
  ['an unknown key', (s) => { s.hero.nope = 1; }],
  ['a duplicate id', (s) => { s.sections.abilities.items[1].id = s.sections.abilities.items[0].id; }],
  ['a bad enum', (s) => { s.sections.skills.groups[0].items[0].level = 'expert'; }],
  ['a bad settings date', (s) => { s.settings.updated = '2026-02-30'; }],
  ['a settings URL with a path', (s) => { s.settings.siteUrl = 'https://samsiani.me/x'; }],
]) {
  test(`${name} is refused even for the draft`, () => {
    const s = seed(); mutate(s);
    assert.ok(blockingErrors(V(s).errors).length > 0);
  });
}

test('Russian words in text are content (draft ok), a ru key is structure (blocked)', () => {
  assert.equal(isBlocking({ code: 'RUSSIAN', path: '$.hero.role.ka' }), false);
  assert.equal(isBlocking({ code: 'RUSSIAN', path: '$.hero.role.ru' }), true);
});

test('an unknown future error code is treated as blocking', () => {
  assert.equal(isBlocking({ code: 'SOMETHING_NEW', path: '$.hero.role.en' }), true);
  assert.equal(isBlocking({ code: 'HREF_SCHEME', path: '$.contact.items[0].href' }), false);
});

test('counter soft threshold is floor(0.9 x max)', () => {
  assert.equal(softLimit(40), 36);
  assert.equal(softLimit(14), 12);
});
