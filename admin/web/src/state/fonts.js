// Fonts state (fonts plan §6): the store the server holds, the Google catalogue it caches for the picker,
// the specimen faces the dialog draws with, and the report line under the Fonts fieldset.
//
// Two rules hold this module together. Every request goes through api()/apiUpload(), so an expired session
// opens the login modal and the call is retried instead of failing; and a specimen is loaded as *bytes*
// (api(..., { raw: true }) → ArrayBuffer → FontFace), never as a URL the font loader would fetch without the
// admin's CSRF header. The SPA therefore never asks any origin but its own for a font — least of all Google.
import { shallowReactive, markRaw, toRaw } from 'vue';
import { api, apiUpload, asciiHeader } from '../api.js';
import { GEORGIAN_RANGE_CSS } from '@src/typography/roles.mjs';
import { draft } from './draft.js';

export const fonts = shallowReactive({
  loaded: false,
  items: [], // FontRecord[] (metrics trimmed to the means by the route)
  usage: {}, // <id>: ["draft", "published", "build"]
  bytes: 0,
  limit: 0,
  catalogue: null, // trimmed Google families, most popular first, or null before the first load
  catalogueAt: null,
  catalogueStale: false,
  googleAvailable: true,
  googleMessage: '',
  report: null, // POST /fonts/report
  reportError: '',
});

export const byId = (id) => fonts.items.find((f) => f.id === id) || null;

// ------------------------------------------------------------------ the store
let loading = null;
/** GET /fonts once per session; `force` after every add, rename and delete. */
export function loadFonts({ force = false } = {}) {
  if (!force && (fonts.loaded || loading)) return loading ?? Promise.resolve(fonts);
  loading = api('GET', '/fonts').then((r) => {
    Object.assign(fonts, { items: markRaw(r.items || []), usage: markRaw(r.usage || {}), bytes: r.bytes || 0, limit: r.limit || 0, loaded: true });
    return fonts;
  }).finally(() => { loading = null; });
  return loading;
}

export async function addGoogle(family) {
  const record = await api('POST', '/fonts/google', { body: { family } });
  await loadFonts({ force: true });
  return record;
}

export async function upload(file) {
  const record = await apiUpload('/fonts/upload', file, {
    'X-Font-Filename': asciiHeader(file.name || 'font'),
    'X-Font-Licence': 'attested', // the checkbox is the attestation; the server refuses the upload without it
  });
  await loadFonts({ force: true });
  return record;
}

export async function rename(id, displayName) {
  const record = await api('PATCH', `/fonts/${encodeURIComponent(id)}`, { body: { displayName } });
  await loadFonts({ force: true });
  return record;
}

export async function remove(id) {
  await api('DELETE', `/fonts/${encodeURIComponent(id)}`);
  releaseSpecimen(specimenAlias(id));
  await loadFonts({ force: true });
}

// ------------------------------------------------------------------ the Google catalogue
let catalogueLoading = null;
/** The catalogue the picker filters. The server caches it for a day; `refresh` is rate limited to 1/10 min. */
export function loadCatalogue({ refresh = false } = {}) {
  if (!refresh && (fonts.catalogue || catalogueLoading)) return catalogueLoading ?? Promise.resolve(fonts.catalogue);
  catalogueLoading = api('GET', `/fonts/catalogue${refresh ? '?refresh=1' : ''}`).then((r) => {
    Object.assign(fonts, {
      catalogue: markRaw(r.families || []),
      catalogueAt: r.fetchedAt || null,
      catalogueStale: Boolean(r.stale),
      googleAvailable: true,
      googleMessage: '',
    });
    return fonts.catalogue;
  }).catch((e) => {
    if (e.status === 503) {
      fonts.googleAvailable = false;
      fonts.googleMessage = e.message;
    }
    throw e;
  }).finally(() => { catalogueLoading = null; });
  return catalogueLoading;
}

// ------------------------------------------------------------------ specimens
// One alias per stored font (and one per layout default), added to document.fonts while the dialog is open
// and removed when it closes: the admin's own interface never changes font.
const loaded = new Map(); // alias -> { promise, faces: FontFace[] }

export const specimenAlias = (id) => `sm-spec-${id}`;
export const defaultAlias = (layout, role) => `sm-spec-${layout}-${role}`;

const weightDescriptor = (w) => (Array.isArray(w) ? (w[0] === w[1] ? String(w[0]) : `${w[0]} ${w[1]}`) : String(w ?? 400));

async function addFace(alias, entry, path, descriptors) {
  const res = await api('GET', path, { raw: true });
  const bytes = await res.arrayBuffer();
  const face = new FontFace(alias, bytes, { style: 'normal', display: 'swap', ...descriptors });
  await face.load();
  document.fonts.add(face);
  entry.faces.push(face);
  return bytes;
}

/** `{ alias, load() }` for one stored font: every web face, each fenced to the range the record records. */
export function specimenFace(record) {
  const alias = specimenAlias(record.id);
  if (!loaded.has(alias)) {
    const entry = { faces: [], promise: null };
    entry.promise = (async () => {
      const web = (record.faces || []).map((face, index) => ({ face, index })).filter((f) => f.face.kind === 'web');
      const seen = new Map(); // one download per source file: an upload's latin and georgian faces share one
      for (const { face, index } of web) {
        const descriptors = { unicodeRange: face.unicodeRange || undefined, weight: weightDescriptor(face.weight) };
        if (seen.has(face.file)) {
          const ff = new FontFace(alias, seen.get(face.file), { style: 'normal', display: 'swap', ...descriptors });
          await ff.load();
          document.fonts.add(ff);
          entry.faces.push(ff);
        } else {
          seen.set(face.file, await addFace(alias, entry, `/fonts/${record.id}/files/${index}`, descriptors));
        }
      }
    })();
    loaded.set(alias, entry);
  }
  return { alias, load: () => loaded.get(alias).promise };
}

/** The same for a role that still uses the layout's committed face. */
export function defaultSpecimenFace(layout, role) {
  const alias = defaultAlias(layout, role);
  if (!loaded.has(alias)) {
    const entry = { faces: [], promise: null };
    entry.promise = addFace(alias, entry, `/fonts/default/${layout}/${role}`, {
      weight: '100 900',
      ...(role === 'georgian' ? { unicodeRange: GEORGIAN_RANGE_CSS } : {}),
    });
    loaded.set(alias, entry);
  }
  return { alias, load: () => loaded.get(alias).promise };
}

function releaseSpecimen(alias) {
  const entry = loaded.get(alias);
  if (!entry) return;
  loaded.delete(alias);
  Promise.resolve(entry.promise).catch(() => {}).then(() => { for (const f of entry.faces) document.fonts.delete(f); });
}

/** Called when the dialog closes: the admin goes back to system-ui + Noto everywhere. */
export function releaseSpecimens() {
  for (const alias of [...loaded.keys()]) releaseSpecimen(alias);
}

// ------------------------------------------------------------------ the report line
let reportSeq = 0;
let reportTimer = null;

/** POST /fonts/report for the working document; a stale answer is dropped by sequence number. */
export async function loadReport() {
  clearTimeout(reportTimer);
  reportTimer = null;
  const site = toRaw(draft.site);
  if (!site) return null;
  const mine = ++reportSeq;
  try {
    const r = await api('POST', '/fonts/report', { body: { site: JSON.parse(JSON.stringify(site)) } });
    if (mine !== reportSeq) return null;
    fonts.report = markRaw(r);
    fonts.reportError = '';
    return r;
  } catch (e) {
    if (mine !== reportSeq) return null;
    fonts.report = null;
    fonts.reportError = e.message;
    return null;
  }
}

/** Debounced by 600 ms, like the preview's own re-render. */
export function scheduleReport(delay = 600) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(loadReport, delay);
}

// ------------------------------------------------------------------ the document
export const roleValue = (layout, role) => draft.site?.settings?.fonts?.[layout]?.[role] ?? null;

/**
 * Write one role of one layout. The objects are created when they are absent and the three role keys are
 * always written together (the schema has no optional role), and a reset stores null rather than removing a
 * key: a document without `settings.fonts` renders exactly what it rendered before this feature existed.
 */
export function setRole(layout, role, id) {
  const settings = draft.site?.settings;
  if (!settings) return;
  if (!settings.fonts || typeof settings.fonts !== 'object') settings.fonts = {};
  const cur = settings.fonts[layout];
  if (!cur || typeof cur !== 'object') settings.fonts[layout] = { text: null, label: null, georgian: null };
  settings.fonts[layout][role] = id ?? null;
}
