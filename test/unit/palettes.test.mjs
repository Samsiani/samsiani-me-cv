import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPalettes, checkPalettes, paletteCss } from '../../src/palettes.mjs';

test('the contrast gate passes 432/432', () => {
  const r = checkPalettes(loadPalettes());
  assert.equal(r.total, 432);
  assert.equal(r.failed, 0);
});

test('malformed palette data is rejected', () => {
  const data = loadPalettes();
  const dir = mkdtempSync(join(tmpdir(), 'pal-'));
  const bad = structuredClone(data);
  delete bad.palettes[0].light['--focus'];
  writeFileSync(join(dir, 'a.json'), JSON.stringify(bad));
  assert.throws(() => loadPalettes(join(dir, 'a.json')), /missing --focus/);
  const bad2 = structuredClone(data);
  bad2.palettes[1].id = bad2.palettes[0].id;
  writeFileSync(join(dir, 'b.json'), JSON.stringify(bad2));
  assert.throws(() => loadPalettes(join(dir, 'b.json')), /duplicate palette id/);
});

test('lime with its fill colour used as text fails the gate', () => {
  const data = structuredClone(loadPalettes());
  const lime = data.palettes.find((p) => p.id === 'lime');
  lime.light['--accent-ink'] = lime.light['--accent'];
  assert.ok(checkPalettes(data).failed > 0);
});

test('palette CSS keeps dark values on screen only (print gets light values)', () => {
  const data = loadPalettes();
  const css = paletteCss(data.palettes[0], ':root', data.tokens);
  assert.match(css, /@media screen and \(prefers-color-scheme: dark\)/);
  assert.match(css, /@media screen \{\n {2}:root\[data-theme="dark"\]/);
  for (const t of data.tokens) assert.ok(css.includes(`${t}:`), `${t} missing`);
});
