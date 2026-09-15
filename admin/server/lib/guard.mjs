// Client identity, header guards and rate limits (admin-ops.md §4.4–§4.5).
// Values that cross the Cloudflare + OLS chain can arrive doubled ("a, a"): every guard splits on
// commas, accepts 1–4 values and requires EVERY value to pass, so a mixed pair always fails.
import { isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const digest = (v) => createHash('sha256').update(v).digest();

export const splitValues = (header) => (header == null ? [] : String(header).split(',').map((s) => s.trim()));

/** every comma-separated value satisfies pred (1–4 values, none empty) */
export function allValues(header, pred) {
  const v = splitValues(header);
  return v.length > 0 && v.length <= 4 && v.every((x) => x !== '' && pred(x));
}

/** Guard 0: Cloudflare's x-sm-edge secret. secretDigest = digest(EDGE_SECRET) computed at boot. */
export const edgeOk = (header, secretDigest) => !!header && allValues(header, (v) => timingSafeEqual(digest(v), secretDigest));

export const originAllowed = (header, allowed) => !!header && allValues(header, (v) => allowed.has(v));

/** If-Match: optional W/ and quotes stripped per value; every value must equal the ETag. */
export function ifMatchOk(header, etag) {
  if (!header || !etag) return false;
  return allValues(header, (v) => v.replace(/^W\//, '').replace(/^"(.*)"$/, '$1') === etag);
}

/** Client key: CF-Connecting-IP only when the peer is loopback (the local proxy); IPv6 keyed per /64. */
export function clientKey(remoteAddress, headers) {
  let ip = remoteAddress || 'unknown';
  if (LOOPBACK.has(ip)) {
    const cf = (headers.get('cf-connecting-ip') || '').split(',')[0].trim();
    if (isIP(cf)) ip = cf;
  }
  if (isIP(ip) === 6) {
    const full = expand6(ip);
    return full ? full.slice(0, 4).join(':') + '::/64' : ip;
  }
  return ip;
}
function expand6(ip) {
  if (ip.includes('.')) return null; // v4-mapped: leave as is
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const mid = Array(8 - h.length - t.length).fill('0');
  return [...h, ...mid, ...t].map((x) => x.toLowerCase().replace(/^0+(?=.)/, ''));
}

// ---------------------------------------------------------------- rate limiting (in memory; a restart clears it)
export function createLimiter({ clock = { now: () => Date.now() } } = {}) {
  const fails = new Map(); // key -> [timestamps]
  const hits = new Map(); // bucket -> [timestamps]
  let globalFails = [];
  const MIN15 = 15 * 60 * 1000, HOUR = 3600 * 1000, MIN = 60 * 1000;
  const prune = (arr, win) => { const t = clock.now() - win; while (arr.length && arr[0] <= t) arr.shift(); return arr; };
  const cap = (m) => { if (m.size > 10_000) m.delete(m.keys().next().value); };

  const lim = {
    /** Before hashing: { ok } or { ok: false, retryAfterS }. device = valid device id or null. */
    loginAllowed({ client, device }) {
      if (device) {
        const a = prune(fails.get('dev:' + device) || [], MIN15);
        if (a.length >= 5) return { ok: false, retryAfterS: Math.ceil((a[0] + MIN15 - clock.now()) / 1000) };
        return { ok: true };
      }
      const a = prune(fails.get('ip:' + client) || [], MIN15);
      if (a.length >= 5) return { ok: false, retryAfterS: Math.ceil((a[0] + MIN15 - clock.now()) / 1000) };
      prune(globalFails, HOUR);
      if (globalFails.length >= 60) return { ok: false, retryAfterS: Math.ceil((globalFails[0] + HOUR - clock.now()) / 1000), global: true };
      return { ok: true };
    },
    loginFailed({ client, device }) {
      const key = device ? 'dev:' + device : 'ip:' + client;
      const a = prune(fails.get(key) || [], MIN15);
      a.push(clock.now());
      fails.set(key, a); cap(fails);
      if (!device) { globalFails.push(clock.now()); prune(globalFails, HOUR); }
      return { globalLocked: !device && globalFails.length >= 60 };
    },
    loginSucceeded({ client, device }) { fails.delete(device ? 'dev:' + device : 'ip:' + client); },
    /** Generic sliding-window counter: hit('publish:' + sid, 10, 60_000) */
    hit(bucket, max, windowMs = MIN) {
      const a = prune(hits.get(bucket) || [], windowMs);
      if (a.length >= max) return { ok: false, retryAfterS: Math.ceil((a[0] + windowMs - clock.now()) / 1000) };
      a.push(clock.now());
      hits.set(bucket, a); cap(hits);
      return { ok: true };
    },
    sweep() {
      for (const [k, a] of fails) if (!prune(a, MIN15).length) fails.delete(k);
      for (const [k, a] of hits) if (!prune(a, HOUR).length) hits.delete(k);
      prune(globalFails, HOUR);
    },
    reset() { fails.clear(); hits.clear(); globalFails = []; },
  };
  return lim;
}
