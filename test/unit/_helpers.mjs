// Shared helpers for the unit tests (not a test file: no .test. in the name).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { renderSite } from '../../src/render.mjs';

export const SEED_PATH = new URL('../../src/content/site.json', import.meta.url);
export const STRESS_PATH = new URL('../fixtures/site.stress.json', import.meta.url);
export const MINIMAL_PATH = new URL('../fixtures/site.minimal.json', import.meta.url);
export const seedText = () => readFileSync(SEED_PATH, 'utf8');
export const seed = () => JSON.parse(seedText());
export const stress = () => JSON.parse(readFileSync(STRESS_PATH, 'utf8'));
export const minimal = () => JSON.parse(readFileSync(MINIMAL_PATH, 'utf8'));

export const ASSETS = { cssHref: '/styles.test.css', jsHref: '/main.test.js', og: { en: '/og-en.png', ka: '/og-ka.png' } };
export const PALETTE = { id: 'cobalt', css: '', manifestTheme: '#1a4fd6' };
export const layoutIds = () => Object.keys(LAYOUTS);
export const renderArgs = (id) => ({ layout: LAYOUTS[id], palette: PALETTE, assets: ASSETS });

// Golden output of the seed: the published bytes of today's content must never change by accident.
// Regenerate deliberately with `node scripts/update-golden.mjs` (see test/unit/render-golden.test.mjs).
export const GOLDEN_FILES = ['index.html', 'ka/index.html', '404.html', 'site.webmanifest'];
export const goldenPath = (id) => new URL(`../fixtures/golden/${id}.json`, import.meta.url);
export function goldenHashes(id) {
  const out = renderSite(seed(), renderArgs(id));
  return Object.fromEntries(GOLDEN_FILES.map((f) => [f, createHash('sha256').update(out[f]).digest('hex')]));
}

// Walk every {en, ka} pair and apply fn(obj) — used to blank all Georgian strings.
export function eachLocalized(v, fn) {
  if (Array.isArray(v)) return v.forEach((x) => eachLocalized(x, fn));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 2 && keys.includes('en') && keys.includes('ka') && typeof v.en === 'string') return fn(v);
    for (const k of keys) eachLocalized(v[k], fn);
  }
}
