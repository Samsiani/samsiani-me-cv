// A real font store for the CI fonts gate (fonts plan §7.4):
//   node scripts/lib/fonts-fixture.mjs [dir]        (default .cache/fonts)
//   import { makeFontsFixture } from './lib/fonts-fixture.mjs'
//
// The repository's own faces are run through the upload pipeline, so the gate exercises exactly the records
// the admin writes — one of them a TTF that had to be converted to WOFF2 — and then two documents that hand
// those fonts to the three layouts. Nothing is downloaded and nothing is committed: the store is rebuilt
// from files this release already ships.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectUpload } from '../../admin/server/lib/fonts/upload.mjs';
import { ALIASES, FONT_ROLES } from '../../src/typography/roles.mjs';

const ROOT = resolve(new URL('../../', import.meta.url).pathname);
const ADDED_AT = Date.UTC(2026, 8, 16); // fixed, so a rebuilt store is byte-identical

// key -> the file the owner would have uploaded
const SOURCES = {
  plexSans: 'src/fonts/ibm-plex-sans-latin-wght-100-700.woff2',
  plexMono: 'src/fonts/ibm-plex-mono-latin-400.woff2',
  chivo: 'src/fonts/chivo-latin-normal-400-700.woff2',
  archivo: 'src/fonts/archivo-latin-wdth-wght.woff2',
  noto: 'src/brand/fonts/NotoSansGeorgian-SemiBold.ttf', // TTF -> WOFF2 on the way in
};

// Every layout gets a face it was not designed around: another sans for the text, another mono for the
// labels, and a static Georgian face at a weight the layouts do not ask for.
const ROLES = (id) => ({
  precision: { text: id.plexSans, label: id.plexMono, georgian: id.noto },
  studio: { text: id.chivo, label: null, georgian: null },
  ledger: { text: id.archivo, label: null, georgian: id.noto },
});

/**
 * Build the store and the two documents that use it.
 * @param {string} dir  the store directory (index.json + files/)
 * @returns {Promise<{ dir, ids, fonts, expect, seed, stress }>}
 *   expect: layout -> the CSS aliases that layout's build must carry
 *   seed / stress: paths of the documents to build with SITE_JSON
 */
export async function makeFontsFixture(dir = '.cache/fonts') {
  const store = resolve(ROOT, dir);
  await rm(store, { recursive: true, force: true });
  await mkdir(join(store, 'files'), { recursive: true });

  const ids = {};
  const fonts = {};
  for (const [key, rel] of Object.entries(SOURCES)) {
    const bytes = await readFile(join(ROOT, rel));
    const { record, files } = inspectUpload(bytes, { filename: rel.split('/').pop(), now: ADDED_AT });
    for (const [name, buf] of files) await writeFile(join(store, 'files', name), buf);
    ids[key] = record.id;
    fonts[record.id] = record;
  }
  await writeFile(join(store, 'index.json'), JSON.stringify({ v: 1, fonts }, null, 2) + '\n');

  const byLayout = ROLES(ids);
  const documents = {};
  for (const [name, source] of [['seed', 'src/content/site.json'], ['stress', 'test/fixtures/site.stress.json']]) {
    const site = JSON.parse(await readFile(join(ROOT, source), 'utf8'));
    site.settings.fonts = Object.fromEntries(Object.entries(byLayout)
      .map(([layout, roles]) => [layout, Object.fromEntries(FONT_ROLES.map((r) => [r, roles[r] ?? null]))]));
    documents[name] = join(store, `site.${name}.json`);
    await writeFile(documents[name], JSON.stringify(site, null, 2) + '\n');
  }

  return {
    dir: store,
    ids,
    fonts: byLayout,
    expect: Object.fromEntries(Object.entries(byLayout).map(([layout, roles]) => [layout, FONT_ROLES.filter((r) => roles[r]).map((r) => ALIASES[r])])),
    seed: documents.seed,
    stress: documents.stress,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const out = await makeFontsFixture(process.argv[2]);
  console.log(`font store ${out.dir}: ${Object.keys(out.ids).length} fonts`);
  for (const [layout, aliases] of Object.entries(out.expect)) console.log(`  ${layout}: ${aliases.join(', ') || 'layout defaults'}`);
}
