// Regenerate test/fixtures/golden/<layout>.json from the current renderer: node scripts/update-golden.mjs
// The goldens pin the published bytes of the seed. Run this only for a deliberate output change and commit
// the new files with the change that caused it (render-golden.test.mjs fails until then).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutIds, goldenHashes, goldenPath } from '../test/unit/_helpers.mjs';

mkdirSync(fileURLToPath(new URL('../test/fixtures/golden/', import.meta.url)), { recursive: true });
for (const id of layoutIds()) {
  const file = fileURLToPath(goldenPath(id));
  writeFileSync(file, JSON.stringify(goldenHashes(id), null, 2) + '\n');
  console.log(`wrote ${file}`);
}
