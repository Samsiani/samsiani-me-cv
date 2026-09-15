// Passwords, sessions and the device cookie (admin-ops.md §4.2–§4.4).
// auth.json and sessions.json are the only authority: they are re-read whenever their mtime or inode
// changes (checked on every request) and changed only by read-modify-write under the "write" lock.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readJson, writeJsonAtomic, exists } from './fsx.mjs';
import { withLock } from './lock.mjs';
import { AppError } from './errors.mjs';

const scrypt = promisify(scryptCb);
export const SCRYPT = { N: 65536, r: 8, p: 2, keylen: 64, maxmem: 134217728 };
export const IDLE_S = 12 * 3600, ABSOLUTE_S = 7 * 24 * 3600, SLIDE_S = 300, MAX_SESSIONS = 10;
export const DEVICE_MAX_AGE = 34_560_000;

/**
 * Test-only: SESSION_IDLE_S (seconds) shortens the 12 h idle window so the e2e suite can let a session expire.
 * Ignored whenever NODE_ENV=production, so a stray variable can never weaken a production session.
 */
export function idleWindowS(env = process.env) {
  if (env.NODE_ENV === 'production') return IDLE_S;
  const n = Number(env.SESSION_IDLE_S);
  return Number.isInteger(n) && n > 0 && n < IDLE_S ? n : IDLE_S;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha = (v) => createHash('sha256').update(String(v)).digest();
const eq = (a, b) => a.length === b.length && timingSafeEqual(a, b);

// ---------------------------------------------------------------- password hashing
// One derivation at a time, three queued; a fifth concurrent login gets 429 busy.
let running = 0;
const queue = [];
async function derive(password, salt, { N, r, p, keylen }) {
  if (running >= 1) {
    if (queue.length >= 3) throw new AppError(429, 'busy', 'The server is busy; try again in a few seconds.');
    await new Promise((ok) => queue.push(ok));
  }
  running++;
  try { return await scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }); }
  finally { running--; queue.shift()?.(); }
}

export const normalisePassword = (pw) => String(pw ?? '').normalize('NFKC');

export async function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16);
  const key = await derive(normalisePassword(password), salt, params);
  return `scrypt$1$${params.N}$${params.r}$${params.p}$${b64u(salt)}$${b64u(key)}`;
}

export function parseHash(stored) {
  const m = /^scrypt\$1\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored || '');
  if (!m) return null;
  const key = Buffer.from(m[5], 'base64url');
  return { N: +m[1], r: +m[2], p: +m[3], salt: Buffer.from(m[4], 'base64url'), key, keylen: key.length };
}

/** true when the password matches; always costs one scrypt. */
export async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (!h) return false;
  const got = await derive(normalisePassword(password), h.salt, h);
  return eq(got, h.key);
}

export const needsRehash = (stored) => { const h = parseHash(stored); return !h || h.N !== SCRYPT.N || h.r !== SCRYPT.r || h.p !== SCRYPT.p || h.keylen !== SCRYPT.keylen; };

/** NIST-style rules: 12–128 code points after NFKC, not the username, not the current password. */
export function passwordProblem(pw, { username, current } = {}) {
  const n = [...normalisePassword(pw)].length;
  if (n < 12 || n > 128) return 'length';
  if (username && normalisePassword(pw).toLowerCase() === String(username).toLowerCase()) return 'username';
  if (current !== undefined && normalisePassword(pw) === normalisePassword(current)) return 'same';
  return null;
}

// ---------------------------------------------------------------- cookie signing
export function sign(payloadObj, secret) {
  const payload = b64u(JSON.stringify(payloadObj));
  const mac = createHmac('sha256', secret).update('v1.' + payload).digest();
  return `v1.${payload}.${b64u(mac)}`;
}

/** Returns the payload when the MAC verifies with the current or previous secret, else null. */
export function unsign(value, secrets) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let mac;
  try { mac = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (mac.length !== 32) return null;
  const ok = secrets.filter(Boolean).some((s) => eq(createHmac('sha256', s).update('v1.' + parts[1]).digest(), mac));
  if (!ok) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}

// device cookie: v1.<id>.<HMAC('dev.' + id)>
export function makeDevice(secret, id = b64u(randomBytes(16))) {
  return { id, value: `v1.${id}.${b64u(createHmac('sha256', secret).update('dev.' + id).digest())}` };
}
export function readDevice(value, secrets) {
  if (typeof value !== 'string') return null;
  const [v, id, macS] = value.split('.');
  if (v !== 'v1' || !id || !macS || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const mac = Buffer.from(macS, 'base64url');
  if (mac.length !== 32) return null;
  return secrets.filter(Boolean).some((s) => eq(createHmac('sha256', s).update('dev.' + id).digest(), mac)) ? id : null;
}

// ---------------------------------------------------------------- the auth + session files
export function createAuth({ dataDir, secrets, clock = { now: () => Date.now() }, audit, env = process.env }) {
  const F = { auth: join(dataDir, 'auth.json'), sessions: join(dataDir, 'sessions.json'), locks: join(dataDir, 'locks') };
  const idleS = idleWindowS(env);
  const slideS = Math.min(SLIDE_S, Math.max(1, Math.floor(idleS / 2))); // = SLIDE_S unless the test override is set
  const cache = new Map(); // path -> { mtimeMs, ino, doc }  (a cache, invalidated by stat on every read)
  const nowS = () => Math.floor(clock.now() / 1000);
  let dummyHash = null;

  async function readFresh(path, fallback) {
    let s;
    try { s = await stat(path); } catch (e) { if (e.code === 'ENOENT') { cache.delete(path); return fallback; } throw e; }
    const c = cache.get(path);
    if (c && c.mtimeMs === s.mtimeMs && c.ino === s.ino && c.size === s.size) return structuredClone(c.doc);
    const doc = await readJson(path);
    cache.set(path, { mtimeMs: s.mtimeMs, ino: s.ino, size: s.size, doc });
    return structuredClone(doc);
  }
  const lock = (fn) => withLock(F.locks, 'write', fn, { op: 'auth' });
  const readAuth = () => readFresh(F.auth, null);
  const readSessions = () => readFresh(F.sessions, { v: 1, sessions: [] });
  const writeSessions = (doc) => writeJsonAtomic(F.sessions, doc);

  const api = {
    files: F,
    async ready() { if (!dummyHash) dummyHash = await hashPassword(randomBytes(18).toString('base64')); },
    readAuth,
    readSessions,

    /** Create auth.json (first boot / CLI); resets sessions by bumping the epoch. */
    async setPassword(password, { username, mustChangePassword = false } = {}) {
      const hash = await hashPassword(password);
      return lock(async () => {
        const cur = await readAuth();
        const doc = { v: 1, username: username || cur?.username || 'admin', hash, mustChangePassword, epoch: (cur?.epoch ?? 0) + 1, updatedAt: new Date(clock.now()).toISOString() };
        await writeJsonAtomic(F.auth, doc);
        await writeSessions({ v: 1, sessions: [] });
        return doc;
      });
    },

    async hasAuth() { return exists(F.auth); },

    /** Verify username + password. Always runs exactly one scrypt (dummy for an unknown user). */
    async checkCredentials(username, password) {
      await api.ready();
      const auth = await readAuth();
      if (!auth) return { ok: false, notInitialised: true };
      const userOk = eq(sha(username), sha(auth.username));
      const pwOk = await verifyPassword(password, userOk ? auth.hash : dummyHash);
      return { ok: userOk && pwOk, auth };
    },

    /** Re-hash with current params after a successful login, only if the stored hash is still the one verified. */
    async upgradeHashIfNeeded(password, verifiedHash) {
      if (!needsRehash(verifiedHash)) return false;
      const fresh = await hashPassword(password);
      return lock(async () => {
        const cur = await readAuth();
        if (!cur || cur.hash !== verifiedHash) return false; // the CLI changed it meanwhile
        await writeJsonAtomic(F.auth, { ...cur, hash: fresh, updatedAt: new Date(clock.now()).toISOString() });
        return true;
      });
    },

    /** New session: new sid, registry capped at 10 (oldest lastSeenAt evicted). Returns the cookie value. */
    async createSession({ ip, ua }) {
      const sid = b64u(randomBytes(16));
      return lock(async () => {
        const auth = await readAuth();
        const reg = await readSessions();
        const t = new Date(clock.now()).toISOString();
        reg.sessions = reg.sessions.filter((s) => nowS() - Date.parse(s.lastSeenAt) / 1000 <= idleS);
        reg.sessions.push({ sid, createdAt: t, lastSeenAt: t, ip: ip || '', ua: String(ua || '').slice(0, 160) });
        reg.sessions.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
        reg.sessions = reg.sessions.slice(0, MAX_SESSIONS);
        await writeSessions(reg);
        const iat = nowS();
        return { sid, value: sign({ sid, iat, lat: iat, ep: auth.epoch }, secrets[0]), iat };
      });
    },

    /**
     * Verify a session cookie against disk. Returns { sid, iat, lat, auth, reissue? } or null.
     * reissue carries a new cookie value when the sliding window moved (at most every 5 min).
     */
    async verifySession(value) {
      const p = unsign(value, secrets);
      if (!p || typeof p.sid !== 'string' || !Number.isInteger(p.iat) || !Number.isInteger(p.lat) || !Number.isInteger(p.ep)) return null;
      const now = nowS();
      if (now - p.lat > idleS || now - p.iat > ABSOLUTE_S || p.lat > now + 60 || p.iat > now + 60) return null;
      const auth = await readAuth();
      if (!auth || p.ep !== auth.epoch) return null;
      const reg = await readSessions();
      if (!reg.sessions.some((s) => s.sid === p.sid)) return null;
      const out = { sid: p.sid, iat: p.iat, lat: p.lat, auth };
      if (now - p.lat > slideS) {
        const updated = await lock(async () => {
          const r2 = await readSessions();
          const a2 = await readAuth();
          const s = r2.sessions.find((x) => x.sid === p.sid);
          if (!s || !a2 || a2.epoch !== p.ep) return false; // revoked meanwhile: never written back
          s.lastSeenAt = new Date(clock.now()).toISOString();
          await writeSessions(r2);
          return true;
        });
        if (!updated) return null;
        out.reissue = sign({ sid: p.sid, iat: p.iat, lat: now, ep: p.ep }, secrets[0]);
      }
      return out;
    },

    async deleteSession(sid) {
      return lock(async () => { const r = await readSessions(); r.sessions = r.sessions.filter((s) => s.sid !== sid); await writeSessions(r); });
    },

    async revokeOthers(sid) {
      return lock(async () => { const r = await readSessions(); r.sessions = r.sessions.filter((s) => s.sid === sid); await writeSessions(r); });
    },

    /** Change password from the API: epoch + 1, registry reduced to the current session, cookie re-issued. */
    async changePassword(sid, iat, newPassword) {
      const hash = await hashPassword(newPassword);
      return lock(async () => {
        const cur = await readAuth();
        const doc = { ...cur, hash, mustChangePassword: false, epoch: cur.epoch + 1, updatedAt: new Date(clock.now()).toISOString() };
        await writeJsonAtomic(F.auth, doc);
        const r = await readSessions();
        r.sessions = r.sessions.filter((s) => s.sid === sid);
        await writeSessions(r);
        return { value: sign({ sid, iat, lat: nowS(), ep: doc.epoch }, secrets[0]) };
      });
    },

    async pruneSessions() {
      return lock(async () => {
        const r = await readSessions();
        const before = r.sessions.length;
        r.sessions = r.sessions.filter((s) => nowS() - Date.parse(s.lastSeenAt) / 1000 <= idleS && nowS() - Date.parse(s.createdAt) / 1000 <= ABSOLUTE_S);
        if (r.sessions.length !== before) await writeSessions(r);
      });
    },

    expiry(sess) {
      return { idleExpiresAt: new Date((sess.lat + idleS) * 1000).toISOString(), absoluteExpiresAt: new Date((sess.iat + ABSOLUTE_S) * 1000).toISOString() };
    },
  };
  return api;
}
