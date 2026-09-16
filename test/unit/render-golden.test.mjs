// Byte identity of today's content: the seed must render to exactly the bytes it renders today, in every
// layout. Generated from the pre-change renderer; `node scripts/update-golden.mjs` regenerates them for a
// deliberate output change (commit the new goldens with that change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOLDEN_FILES, goldenHashes, goldenPath, layoutIds } from './_helpers.mjs';

for (const id of layoutIds()) {
  test(`${id}: the seed renders the golden bytes`, () => {
    const want = JSON.parse(readFileSync(goldenPath(id), 'utf8'));
    const got = goldenHashes(id);
    for (const f of GOLDEN_FILES) {
      assert.equal(got[f], want[f], `${id} ${f} changed; if that is deliberate, run node scripts/update-golden.mjs`);
    }
  });
}
