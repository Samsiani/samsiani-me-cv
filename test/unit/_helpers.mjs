// Shared helpers for the unit tests (not a test file: no .test. in the name).
import { readFileSync } from 'node:fs';
import { LAYOUTS } from '../../src/layouts/index.mjs';

export const SEED_PATH = new URL('../../src/content/site.json', import.meta.url);
export const STRESS_PATH = new URL('../fixtures/site.stress.json', import.meta.url);
export const seedText = () => readFileSync(SEED_PATH, 'utf8');
export const seed = () => JSON.parse(seedText());
export const stress = () => JSON.parse(readFileSync(STRESS_PATH, 'utf8'));

export const ASSETS = { cssHref: '/styles.test.css', jsHref: '/main.test.js', og: { en: '/og-en.png', ka: '/og-ka.png' } };
export const PALETTE = { id: 'cobalt', css: '', manifestTheme: '#1a4fd6' };
export const layoutIds = () => Object.keys(LAYOUTS);
export const renderArgs = (id) => ({ layout: LAYOUTS[id], palette: PALETTE, assets: ASSETS });

// Walk every {en, ka} pair and apply fn(obj) — used to blank all Georgian strings.
export function eachLocalized(v, fn) {
  if (Array.isArray(v)) return v.forEach((x) => eachLocalized(x, fn));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 2 && keys.includes('en') && keys.includes('ka') && typeof v.en === 'string') return fn(v);
    for (const k of keys) eachLocalized(v[k], fn);
  }
}
