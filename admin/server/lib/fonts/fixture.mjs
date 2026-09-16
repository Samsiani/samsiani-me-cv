// A fetch that answers from test/fixtures/google-fonts/ instead of the network, for the service tests, the
// e2e harness and local development (GOOGLE_FONTS_FIXTURE, never in production). A URL the fixture does not
// know answers 404, so a test that reached for the real Google would fail rather than quietly succeed.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const ROOT = resolve(new URL('../../../../', import.meta.url).pathname); // the repository root

/**
 * @param {string} dir the fixture directory (holding index.json)
 * @param {{ offline?: boolean, seen?: string[] }} opts offline: every request fails, as a Google outage does
 * @returns {(url: string, init?: object) => Promise<Response>} a fetch with the same contract
 */
export function fixtureFetch(dir, { offline = false, seen = [] } = {}) {
  const base = isAbsolute(dir) ? dir : join(ROOT, dir);
  const index = JSON.parse(readFileSync(join(base, 'index.json'), 'utf8'));
  const body = (name) => readFileSync(isAbsolute(name) ? name : join(ROOT, name));
  const ok = (bytes, type) => new Response(bytes, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(bytes.length) } });

  return async (url, init = {}) => {
    seen.push(String(url));
    if (offline) throw new TypeError('fetch failed');
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const u = String(url);
    if (u === (index.metadataUrl || 'https://fonts.google.com/metadata/fonts')) {
      return ok(Buffer.from((index.prefix ?? '') + JSON.stringify(index.metadata)), 'application/json');
    }
    // css2 answers a request without a User-Agent with static TTFs instead of subsetted WOFF2 files, and the
    // font fetcher relies on exactly that for the social cards; the fixture keeps the two answers apart.
    const ua = init.headers && (init.headers['User-Agent'] ?? init.headers['user-agent']);
    if (!ua && index.css2Static?.[u] !== undefined) return ok(Buffer.from(index.css2Static[u]), 'text/css');
    if (index.css2[u] !== undefined) return ok(Buffer.from(index.css2[u]), 'text/css');
    if (index.files[u] !== undefined) {
      const f = index.files[u];
      const type = u.endsWith('.ttf') ? 'font/ttf' : 'font/woff2';
      return ok(typeof f === 'object' ? Buffer.alloc(f.bytes, 0x41) : body(f), type);
    }
    return new Response('not found', { status: 404 });
  };
}

/** The fixture a config asks for, or null. loadConfig() drops it in production. */
export function fixtureFrom(cfg) {
  return cfg.googleFixture ? { dir: cfg.googleFixture, offline: Boolean(cfg.googleFixtureOffline) } : null;
}
