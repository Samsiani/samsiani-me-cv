import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateSite, upgrade, SCHEMA_VERSION } from '../../src/schema/migrate.mjs';
import { validate, canonicalize } from '../../src/schema/validate.mjs';
import { seed, seedText, stress } from './_helpers.mjs';

const TODAY = '2026-09-14';
const example = () => JSON.parse(readFileSync(new URL('../../docs/plans/site.example.json', import.meta.url), 'utf8'));

test('the v1 design record migrates to exactly the committed seed', () => {
  const v1 = example();
  assert.equal(v1.schemaVersion, 1, 'site.example.json is the v1 design record');
  const r = migrateSite(v1);
  assert.equal(r.from, 1);
  assert.equal(r.to, SCHEMA_VERSION);
  assert.equal(canonicalize(r.site), seedText());
});

test('migrateSite does not touch its argument', () => {
  const v1 = example();
  migrateSite(v1);
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.settings.sectionOrder, undefined);
});

test('migrating is idempotent at the current version', () => {
  const s = seed();
  const once = migrateSite(s);
  assert.equal(once.from, SCHEMA_VERSION);
  assert.equal(canonicalize(once.site), seedText());
  assert.equal(canonicalize(migrateSite(once.site).site), seedText());
});

test('an unknown or newer version throws; upgrade() passes it through', () => {
  for (const v of [SCHEMA_VERSION + 1, 0, '2', undefined, null]) {
    const s = { ...seed(), schemaVersion: v };
    assert.throws(() => migrateSite(s), /unknown schemaVersion/);
    assert.equal(upgrade(s), s);
  }
  assert.equal(upgrade(null), null);
});

test('the migrated stress fixture validates as it does today', () => {
  const r = validate(stress(), { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 10);
});
