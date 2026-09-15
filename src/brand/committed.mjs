// Interim brand provider (M2–M6): the committed cobalt icons and OG cards, renamed by content hash
// so Cloudflare can never serve a stale file under a fixed name. Replaced by the renderer in M7.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('../../', import.meta.url);
const SOURCES = {
  i32: 'src/brand/icon-32.png',
  i180: 'src/brand/icon-180.png',
  i192: 'src/brand/icon-192.png',
  i512: 'src/brand/icon-512.png',
  ogEn: 'src/og-en.png',
  ogKa: 'src/og-ka.png',
};
const STEMS = { i32: 'favicon-32', i180: 'apple-touch-icon', i192: 'icon-192', i512: 'icon-512', ogEn: 'og-en', ogKa: 'og-ka' };
const md5 = (b) => createHash('md5').update(b).digest('hex').slice(0, 8);

/**
 * @param {{ namesOnly?: boolean }} [opts] namesOnly: return the hashed names without the bytes (preview)
 * @returns {{ files: Map<string, Buffer>, og: { en: string, ka: string }, icons: { i32, i180, i192, i512 }, palette: 'cobalt' }}
 */
export function committedBrand({ namesOnly = false } = {}) {
  const files = new Map();
  const name = {};
  for (const [key, rel] of Object.entries(SOURCES)) {
    const bytes = readFileSync(new URL(rel, ROOT));
    name[key] = `${STEMS[key]}.${md5(bytes)}.png`;
    if (!namesOnly) files.set(name[key], bytes);
  }
  return {
    files,
    og: { en: name.ogEn, ka: name.ogKa },
    icons: { i32: name.i32, i180: name.i180, i192: name.i192, i512: name.i512 },
    palette: 'cobalt',
  };
}
