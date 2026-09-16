// Google Fonts, fetched by the server and only on the owner's action (fonts plan §4.2, §4.3). The public
// site never talks to Google, the admin SPA never talks to Google, and nothing here runs during a publish or
// a preview: the files are downloaded once, checked, and stored like an upload.
//
// Every request goes through the injected `fetchImpl`, so the tests serve a fixture and a test that reached
// the network would fail. Every response is capped and timed out, every URL is checked against the two hosts
// this module is allowed to talk to, and a font file is parsed before it is believed.
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { GEORGIAN_RANGE_CSS, subtractGeorgian } from '../../../../src/typography/roles.mjs';
import { FontParseError, coverageOf, metricsOf, parseFont } from '../../../../src/typography/sfnt.mjs';
import { writeJsonAtomic, readJson } from '../fsx.mjs';
import { AppError } from '../errors.mjs';

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const CSS2 = 'https://fonts.googleapis.com/css2';
const GSTATIC = 'https://fonts.gstatic.com/';
// css2 answers with WOFF2 to a browser and with unhinted static TTFs to anything else (M7 relies on that).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000; // after a failure, and between forced refreshes
const CAP = { metadata: 8 * 1024 * 1024, css: 512 * 1024, font: 2 * 1024 * 1024 };
const TIMEOUT = { metadata: 15_000, css: 15_000, font: 20_000 };
const BUDGET_MS = 90_000; // one family, downloads included
const MAX_FILES = 8;
const RETRIES = [1000, 3000];
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const unavailable = (detail) => new AppError(502, 'google_unavailable', `Google Fonts could not be reached: ${detail}`);
const unexpected = (detail) => new AppError(502, 'google_unexpected', `Google Fonts answered something this release cannot read: ${detail}`);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms).unref?.());

/** Read a response body with a hard cap; a body that runs past it is an error, not a truncated file. */
async function readCapped(res, max, what) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new AppError(413, 'too_large', `${what} is ${declared} bytes; the limit is ${max}.`);
  const chunks = [];
  let n = 0;
  for await (const chunk of res.body) {
    n += chunk.length;
    if (n > max) throw new AppError(413, 'too_large', `${what} is larger than ${max} bytes.`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createGoogle({ dataDir, fetchImpl = fetch, clock = { now: () => Date.now() } }) {
  const file = join(dataDir, 'fonts', 'catalogue.json');
  let failedAt = 0, refreshedAt = 0;
  let chain = Promise.resolve(); // one family at a time per process
  const inflight = new Map(); // family -> promise, so two requests for the same family are one fetch

  async function get(url, { timeout, max, what, headers = {}, familyRequest = false }) {
    let res;
    try { res = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeout) }); }
    catch (e) { throw unavailable(`${what}: ${e.message}`); }
    if (!res.ok) {
      // css2 answers 400 for a family (or a weight) it does not have; anything else is an outage
      if (familyRequest && (res.status === 400 || res.status === 404)) throw new AppError(404, 'unknown_family', 'Google Fonts does not have that family.');
      throw unavailable(`${what}: HTTP ${res.status}`);
    }
    return readCapped(res, max, what);
  }

  // ---------------------------------------------------------------- catalogue
  /** Keep only what the picker needs: 2.7 MB of metadata becomes ~250 KB. */
  const trim = (f) => ({
    family: String(f.family),
    category: String(f.category || ''),
    weights: [...new Set(Object.keys(f.fonts || {}).filter((k) => /^\d+$/.test(k)).map(Number))].sort((a, b) => a - b),
    italic: Object.keys(f.fonts || {}).some((k) => k.endsWith('i')),
    axes: (f.axes || []).map((a) => String(a.tag)),
    wght: (f.axes || []).filter((a) => a.tag === 'wght').map((a) => [a.min, a.max])[0] || null,
    latin: (f.subsets || []).includes('latin'),
    georgian: (f.subsets || []).includes('georgian'),
    popularity: Number(f.popularity) || 0,
    lastModified: String(f.lastModified || ''),
  });

  async function fetchCatalogue() {
    const body = await get(METADATA_URL, { timeout: TIMEOUT.metadata, max: CAP.metadata, what: 'the Google Fonts catalogue' });
    let doc;
    try { doc = JSON.parse(body.toString('utf8').replace(/^\)\]\}'\s*/, '')); } // the historical anti-JSON prefix
    catch (e) { throw unexpected(`the catalogue is not JSON (${e.message})`); }
    const list = doc?.familyMetadataList;
    if (!Array.isArray(list) || !list.length) throw unexpected('the catalogue has no familyMetadataList');
    return list.filter((f) => f && f.family && f.isOpenSource !== false).map(trim).sort((a, b) => a.popularity - b.popularity);
  }

  const cached = async () => { try { return await readJson(file); } catch { return null; } };

  /**
   * @param {{ refresh?: boolean }} opts
   * @returns {Promise<{ fetchedAt: string, stale: boolean, families: object[] }>}
   */
  async function catalogue({ refresh = false } = {}) {
    const now = clock.now();
    const have = await cached();
    if (refresh && now - refreshedAt < RETRY_MS) {
      const retryAfterS = Math.ceil((RETRY_MS - (now - refreshedAt)) / 1000);
      throw new AppError(429, 'rate_limited', 'The catalogue was refreshed a moment ago.', { retryAfterS });
    }
    if (have && !refresh && now - Date.parse(have.fetchedAt) < DAY_MS) return { ...have, stale: false };
    if (!refresh && now - failedAt < RETRY_MS) {
      if (have) return { ...have, stale: true };
      throw new AppError(503, 'google_unavailable', 'Google Fonts is unreachable from the server. Uploads still work.');
    }
    if (refresh) refreshedAt = now;
    try {
      const doc = { fetchedAt: new Date(now).toISOString(), etag: null, families: await fetchCatalogue() };
      await mkdir(join(dataDir, 'fonts'), { recursive: true, mode: 0o700 });
      await writeJsonAtomic(file, doc, { mode: 0o600 });
      failedAt = 0;
      return { ...doc, stale: false };
    } catch (e) {
      failedAt = now;
      if (have) return { ...have, stale: true };
      throw new AppError(503, 'google_unavailable', `Google Fonts is unreachable from the server (${e.message}). Uploads still work.`);
    }
  }

  // ---------------------------------------------------------------- one family
  // One @font-face block per subset, the subset named by the comment css2 writes above it.
  const BLOCK = /\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g;
  const decl = (body, name) => { const m = new RegExp(`${name}:\\s*([^;]+);`).exec(body); return m ? m[1].trim() : null; };

  function parseCss2(css) {
    const blocks = [];
    for (const m of css.matchAll(BLOCK)) {
      const [, subset, body] = m;
      const src = /url\((https:\/\/[^)\s]+)\)\s*format\('woff2'\)/.exec(body);
      if (!src) continue;
      if (!src[1].startsWith(GSTATIC)) throw unexpected('a font file is served from somewhere other than fonts.gstatic.com');
      blocks.push({
        subset,
        url: src[1],
        weight: decl(body, 'font-weight') || '400',
        stretch: decl(body, 'font-stretch'),
        unicodeRange: decl(body, 'unicode-range') || '',
      });
    }
    if (!blocks.length) throw unexpected('no WOFF2 @font-face block in the css2 answer');
    return blocks;
  }

  const weightPair = (s) => {
    const n = String(s).trim().split(/\s+/).map(Number).filter((x) => Number.isFinite(x));
    return n.length === 2 ? n : n.length === 1 ? [n[0], n[0]] : [400, 400];
  };
  // https://fonts.gstatic.com/s/inter/v20/<hash>.woff2 -> "v20"
  const versionOf = (url) => (/\/s\/[^/]+\/(v\d+)\//.exec(url) || [])[1] || 'v0';

  async function download(url, deadline) {
    for (let attempt = 0; ; attempt++) {
      if (clock.now() > deadline) throw unavailable('the download took too long');
      try { return await get(url, { timeout: TIMEOUT.font, max: CAP.font, what: 'a font file' }); }
      catch (e) {
        if (e.code === 'too_large' || attempt >= RETRIES.length) throw e;
        await sleep(RETRIES[attempt]);
      }
    }
  }

  /**
   * Download one family's web faces and build a store record. `lookup(id)` short-circuits a family that is
   * already stored: the css2 answer names the version, so the id is known before any font file is fetched.
   * @returns {Promise<{ record: object, files: Map<string, Buffer>, existing: boolean }>}
   */
  async function fetchOne(family, { lookup }) {
    const list = (await catalogue()).families;
    const meta = list.find((f) => f.family === family);
    if (!meta) throw new AppError(404, 'unknown_family', `Google Fonts has no family called "${family}".`);
    const deadline = clock.now() + BUDGET_MS;

    // A variable family answers any weight inside its axis with one file per subset; a static one needs the
    // weights it actually has, or css2 answers 400 with an HTML body.
    const spec = meta.wght ? `wght@${meta.wght[0]}..${meta.wght[1]}` : `wght@${(meta.weights.length ? meta.weights : [400]).join(';')}`;
    const url = `${CSS2}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${spec}&display=swap`;
    const css = (await get(url, { timeout: TIMEOUT.css, max: CAP.css, what: 'the css2 answer', headers: { 'User-Agent': UA }, familyRequest: true })).toString('utf8');
    const blocks = parseCss2(css).filter((b) => b.subset === 'latin' || b.subset === 'georgian').slice(0, MAX_FILES);
    if (!blocks.length) throw unexpected(`"${family}" has no latin or georgian subset`);

    const version = versionOf(blocks[0].url);
    const id = createHash('sha256').update(`google\0${family}\0${version}`).digest('hex').slice(0, 16);
    const known = await lookup(id);
    if (known) return { record: known, files: new Map(), existing: true };

    const files = new Map();
    const faces = [];
    let latin = null, georgian = null;
    for (const b of blocks) {
      const bytes = await download(b.url, deadline);
      let font;
      try { font = parseFont(bytes); }
      catch (e) { throw e instanceof FontParseError ? unexpected(`the ${b.subset} file is not a readable font (${e.reason})`) : e; }
      const cov = coverageOf(font);
      // the subset must hold what its name claims, or the role it serves would silently fall through
      if (b.subset === 'georgian' && !cov.georgian) throw unexpected('the georgian subset does not cover the Georgian alphabet');
      if (b.subset === 'latin' && !cov.latin) throw unexpected('the latin subset does not cover the Latin alphabet');
      if (b.subset === 'georgian') georgian = font; else latin = font;
      const name = `${createHash('sha256').update(bytes).digest('hex')}.woff2`;
      files.set(name, bytes);
      faces.push({
        kind: 'web', subset: b.subset, style: 'normal', weight: weightPair(b.weight), file: name, bytes: bytes.length,
        ...(b.stretch ? { stretch: b.stretch } : {}),
        // Google's latin range carries no Georgian, but the fence is what guarantees it (D6).
        unicodeRange: (b.subset === 'georgian' ? GEORGIAN_RANGE_CSS : subtractGeorgian(b.unicodeRange).join(', ')) || b.unicodeRange,
      });
    }
    const face = latin || georgian;
    const metrics = { ...metricsOf(face), ...(georgian ? { georgian: metricsOf(georgian).georgian } : {}) };
    return {
      existing: false,
      files,
      record: {
        id,
        source: 'google',
        family,
        displayName: family, // the file's own name table holds the instance ("Chivo Medium"), never the family
        category: meta.category || 'Sans Serif',
        version,
        licence: { kind: 'google', url: `https://fonts.google.com/specimen/${encodeURIComponent(family).replace(/%20/g, '+')}/license` },
        addedAt: new Date(clock.now()).toISOString(),
        coverage: { latin: Boolean(latin && coverageOf(latin).latin), georgian: Boolean(georgian && coverageOf(georgian).georgian) },
        variable: Boolean(meta.wght),
        axes: meta.wght ? { wght: meta.wght } : {},
        weights: meta.wght ? STEPS.filter((w) => w >= meta.wght[0] && w <= meta.wght[1]) : meta.weights,
        metrics,
        faces,
        origin: { css2: url },
      },
    };
  }

  return {
    catalogue,
    /** Serialised: one family at a time, and a second request for the same family joins the first. */
    fetchFamily(family, opts) {
      if (inflight.has(family)) return inflight.get(family);
      const p = (chain = chain.then(() => fetchOne(family, opts), () => fetchOne(family, opts))).finally(() => inflight.delete(family));
      inflight.set(family, p);
      return p;
    },
  };
}
