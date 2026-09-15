// The working document, the autosave queue, the ETag, conflicts, the offline copy and the issues found by
// the browser-side validator (admin-ops.md §6.6, §6.8; master plan §8.2, §8.7).
//
// Invariants:
// - The ETag always comes from a JSON body (`etag`) and goes out as If-Match: "<etag>".
// - One PUT in flight at most; the newest local state is sent when it returns.
// - Documents applied from a server response never trigger a save (`savedJson` equals them).
// - A copy that could not be saved stays in localStorage until a save that contains it succeeds or the
//   owner discards it, so nothing typed is lost (network error, 5xx, 401 while the login modal is open).
import { reactive, watch, computed, toRaw } from 'vue';
import { validate, canonicalize } from '@schema/validate.mjs';
import { diffPaths } from '@admin-shared/diff.mjs';
import { isBlocking } from '@admin-shared/draft-rules.mjs';
import { api, ApiError, saveBlob } from '../api.js';
import { registry } from './registry.js';
import { session } from './session.js';

export const PENDING_KEY = 'sm-admin:pending';
const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 10_000;
const RETRY_S = [2, 4, 8, 16, 30];

export const todayTbilisi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date());

export const draft = reactive({
  loaded: false,
  site: null, // the working copy (deep reactive); the form binds to it with v-model
  version: 0, // bumps on every local change and every applied server document
  etag: null,
  rev: null,
  savedAt: null,
  published: null, // { rev, etag, publishedAt, buildId }
  publishedSite: null, // the live document (for "differs from live in N fields")
  status: 'saved', // saved | pending | saving | retrying | offline | rejected | conflict | error
  retryInS: 0,
  lastError: '',
  rejected: [], // structural errors of a 400 draft_rejected
  conflict: null, // { rev, etag, savedAt } of the newer server draft after a 412
  offerPending: null, // an offline copy found at boot: { etag, rev, site, at, sameBase }
  issues: { errors: [], warnings: [] },
  inert: false, // publish, discard, restore or import is running
});

let savedJson = null; // JSON of the document the server holds (in local key order)
let timer = null;
let firstChangeAt = 0;
let inFlight = null;
let queued = false;
let retryTimer = null;
let retryTick = null;
let retryIndex = 0;
let stopUntilEdit = false; // after a 400 draft_rejected: no autosave until the next edit
let forceNext = false; // "Keep mine" / "Use mine": the next PUT carries force: true

const localJson = () => JSON.stringify(toRaw(draft.site));

/** The server's ETag of a document: sha256 of canonicalize(site), hex (null when SubtleCrypto is unavailable). */
async function etagOf(json) {
  try {
    const bytes = new TextEncoder().encode(canonicalize(JSON.parse(json)));
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
export const hasUnsaved = () => !!draft.site && localJson() !== savedJson;
export const saveInFlight = () => !!inFlight;

// ------------------------------------------------------------------ offline copy
export function readPendingCopy() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return v && typeof v === 'object' && v.site && typeof v.site === 'object' ? v : null;
  } catch { return null; }
}
function writePendingCopy() {
  if (!draft.site) return;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ etag: draft.etag, rev: draft.rev, site: toRaw(draft.site), at: new Date().toISOString() }));
  } catch { /* storage full or blocked: the beforeunload warning still protects the tab */ }
}
function removePendingCopy() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* blocked storage */ }
}
const keepingCopy = () => ['retrying', 'offline', 'rejected', 'conflict', 'error'].includes(draft.status) || session.modal;

// ------------------------------------------------------------------ issues (browser-side validation)
let validateTimer = null;
function runValidate() {
  clearTimeout(validateTimer);
  validateTimer = null;
  if (!draft.site || !registry.loaded) return;
  const v = validate(toRaw(draft.site), { mode: 'save', paletteIds: registry.paletteIds, layoutIds: registry.layoutIds, today: todayTbilisi() });
  draft.issues = { errors: v.errors, warnings: v.warnings };
}
function scheduleValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 250);
}
export const validateNow = runValidate;

const issueIndex = computed(() => {
  const m = new Map();
  const add = (i, level) => {
    const list = m.get(i.path) || [];
    list.push({ ...i, level });
    m.set(i.path, list);
  };
  for (const e of draft.issues.errors) add(e, 'error');
  for (const w of draft.issues.warnings) add(w, 'warning');
  return m;
});
/** Issues whose $.path is exactly `path`. */
export const issuesAt = (path) => issueIndex.value.get(path) || [];
/** Issues under any of the given $.path prefixes. */
export function issuesUnder(prefixes) {
  const hit = (p) => prefixes.some((x) => p === x || p.startsWith(x + '.') || p.startsWith(x + '['));
  return {
    errors: draft.issues.errors.filter((e) => hit(e.path)),
    warnings: draft.issues.warnings.filter((w) => hit(w.path)),
  };
}

/** Number of leaf fields where the working copy differs from the live document. */
export const diffCount = computed(() => {
  void draft.version;
  if (!draft.site || !draft.publishedSite) return 0;
  return diffPaths(toRaw(draft.publishedSite), toRaw(draft.site)).length;
});

// ------------------------------------------------------------------ status
function setStatus(s) {
  draft.status = s;
  if (s !== 'retrying' && s !== 'offline') {
    clearInterval(retryTick);
    retryTick = null;
    draft.retryInS = 0;
  }
}

function cancelScheduled() {
  clearTimeout(timer);
  timer = null;
  firstChangeAt = 0;
  clearTimeout(retryTimer);
  retryTimer = null;
  queued = false;
}

/** Replace the working copy with a document from the server (no save follows). */
function adopt(site, meta = {}) {
  cancelScheduled();
  stopUntilEdit = false;
  forceNext = false;
  draft.site = site;
  savedJson = localJson();
  if (meta.etag) draft.etag = meta.etag;
  if (meta.rev !== undefined) draft.rev = meta.rev;
  if (meta.savedAt) draft.savedAt = meta.savedAt;
  draft.rejected = [];
  draft.conflict = null;
  draft.lastError = '';
  draft.version++;
  setStatus('saved');
  runValidate();
}

// ------------------------------------------------------------------ autosave
function schedule() {
  const now = Date.now();
  if (!firstChangeAt) firstChangeAt = now;
  clearTimeout(timer);
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstChangeAt + MAX_WAIT_MS - now));
  timer = setTimeout(() => { flush(); }, wait);
}

function scheduleRetry(e) {
  const s = e.status === 429 && e.body.retryAfterS ? Math.min(60, e.body.retryAfterS) : RETRY_S[Math.min(retryIndex, RETRY_S.length - 1)];
  retryIndex++;
  setStatus(e.status === 0 ? 'offline' : 'retrying');
  draft.retryInS = s;
  clearInterval(retryTick);
  retryTick = setInterval(() => { draft.retryInS = Math.max(0, draft.retryInS - 1); }, 1000);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; flush(); }, s * 1000);
}

/**
 * Send the newest local state now. Resolves true when the server holds it, false when it could not be
 * saved (the reason is in draft.status), undefined when there was nothing to send.
 */
export function flush() {
  clearTimeout(timer);
  timer = null;
  if (inFlight) { queued = true; return inFlight; }
  if (!draft.site || draft.status === 'conflict' || stopUntilEdit) return Promise.resolve(stopUntilEdit || draft.status === 'conflict' ? false : undefined);
  const json = localJson();
  if (json === savedJson && !forceNext) {
    if (draft.status !== 'saved') setStatus('saved');
    return Promise.resolve(undefined);
  }
  clearTimeout(retryTimer);
  retryTimer = null;
  firstChangeAt = 0;
  const force = forceNext;
  const body = { site: JSON.parse(json), ...(force ? { force: true } : {}) };
  setStatus('saving');
  inFlight = (async () => {
    try {
      const r = await api('PUT', '/draft', { body, etag: draft.etag });
      forceNext = false;
      savedJson = json;
      draft.etag = r.etag;
      draft.rev = r.rev;
      draft.savedAt = r.savedAt;
      draft.lastError = '';
      retryIndex = 0;
      if (localJson() === json) {
        removePendingCopy();
        setStatus('saved');
      } else {
        setStatus('pending');
        queued = true;
      }
      return true;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      // a save that reached the server but whose response was lost: the retry meets our own version
      if (e.status === 412 && e.body.current?.etag && e.body.current.etag === (await etagOf(json))) {
        forceNext = false;
        savedJson = json;
        draft.etag = e.body.current.etag;
        draft.rev = e.body.current.rev;
        draft.savedAt = e.body.current.savedAt;
        retryIndex = 0;
        if (localJson() === json) { removePendingCopy(); setStatus('saved'); } else { setStatus('pending'); queued = true; }
        return true;
      }
      writePendingCopy();
      if (e.status === 412) {
        draft.conflict = e.body.current || { rev: null, etag: null, savedAt: null };
        setStatus('conflict');
      } else if (e.status === 400 && e.code === 'draft_rejected') {
        draft.rejected = e.body.errors || [];
        stopUntilEdit = true;
        setStatus('rejected');
      } else if (e.retryable) {
        scheduleRetry(e);
      } else {
        draft.lastError = e.message;
        setStatus('error');
      }
      return false;
    } finally {
      inFlight = null;
      if (queued) {
        queued = false;
        if (draft.status === 'saved' || draft.status === 'pending') schedule();
      }
    }
  })();
  return inFlight;
}

/**
 * Settle the autosave queue: wait for the PUT in flight, send the pending state. True when the server holds
 * exactly the working copy afterwards (publish, discard, restore and import run only then).
 */
export async function settle() {
  clearTimeout(timer);
  timer = null;
  for (let i = 0; i < 6; i++) {
    if (inFlight) { await inFlight; continue; }
    if (!hasUnsaved() && !forceNext) return true;
    if (draft.status === 'conflict' || stopUntilEdit) return false;
    if (draft.status === 'retrying' || draft.status === 'offline') {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const ok = await flush();
    if (ok === false) return false;
  }
  return !hasUnsaved();
}

// local edits → autosave, validation, offline copy. The default (pre-flush) timing batches the mutations of
// one tick, and a document applied from a server response already equals savedJson when this runs.
watch(() => draft.site, () => {
  if (!draft.site) return;
  draft.version++;
  scheduleValidate();
  const json = localJson();
  if (json === savedJson && !forceNext) {
    if (!inFlight && !['conflict', 'rejected'].includes(draft.status)) setStatus('saved');
    return;
  }
  if (keepingCopy()) writePendingCopy();
  if (stopUntilEdit) { stopUntilEdit = false; draft.rejected = []; setStatus('pending'); }
  if (draft.status === 'conflict') return; // the conflict dialog decides
  if (draft.status === 'retrying' || draft.status === 'offline') return; // the retry timer sends the newest state
  if (!inFlight) setStatus('pending');
  schedule();
}, { deep: true });

// a request waiting for the login modal: keep what was typed on this device meanwhile
watch(() => session.modal, (open) => { if (open && hasUnsaved()) writePendingCopy(); });

// ------------------------------------------------------------------ loading
async function refreshPublishedSite() {
  const env = await api('GET', '/export?source=published');
  draft.publishedSite = env.site;
  draft.version++;
}

export async function load() {
  const d = await api('GET', '/draft');
  adopt(d.site, d);
  draft.published = d.published;
  await refreshPublishedSite();
  const p = readPendingCopy();
  if (p) {
    let same = false;
    try { same = canonicalize(p.site) === canonicalize(d.site); } catch { same = false; }
    if (same) removePendingCopy();
    else draft.offerPending = { ...p, sameBase: p.etag === d.etag };
  }
  draft.loaded = true;
}

/** After a rollback: the live site changed, the draft did not. */
export async function refreshLive() {
  const d = await api('GET', '/draft');
  draft.published = d.published;
  await refreshPublishedSite();
}

/** GET /draft and replace the working copy (after discard, restore, import, publish). */
export async function reload() {
  const d = await api('GET', '/draft');
  adopt(d.site, d);
  draft.published = d.published;
  await refreshPublishedSite();
}

// ------------------------------------------------------------------ the offline copy found at boot
export function restorePendingCopy() {
  const p = draft.offerPending;
  if (!p) return;
  draft.offerPending = null;
  if (!p.sameBase) forceNext = true; // "Use mine": the server draft is kept as pre-overwrite
  draft.site = p.site; // a local edit: the watcher schedules the save
  flush();
}
export function discardPendingCopy() {
  removePendingCopy();
  draft.offerPending = null;
}
export function downloadPendingCopy() {
  const p = draft.offerPending;
  if (!p) return;
  const doc = { format: 'samsiani.me/site', schemaVersion: 1, source: 'device', rev: p.rev, exportedAt: p.at, site: p.site };
  saveBlob(new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' }), `samsiani-site-this-device-r${p.rev ?? 'x'}.json`);
}

// ------------------------------------------------------------------ conflicts (412)
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
export const conflictLabel = () => {
  const c = draft.conflict || {};
  return `r${c.rev ?? '?'}${c.savedAt ? `, ${hhmm(c.savedAt)}` : ''}`;
};

/** "Load the newer draft": keep the local copy as a checkpoint first, then load the server draft. */
export async function conflictLoadNewer() {
  const c = draft.conflict || {};
  await api('POST', '/draft/checkpoint', { body: { note: `Local edits replaced by r${c.rev ?? '?'}${c.savedAt ? ` (${hhmm(c.savedAt)})` : ''}`, site: JSON.parse(localJson()) } });
  await reload();
  removePendingCopy();
}

/** "Keep mine and overwrite": PUT with force; the server keeps its draft as pre-overwrite. */
export async function conflictKeepMine() {
  draft.conflict = null;
  forceNext = true;
  setStatus('pending');
  return flush();
}

// ------------------------------------------------------------------ operations that replace the draft
async function guarded(fn) {
  draft.inert = true;
  try {
    if (!(await settle())) throw new Error(settleMessage());
    return await fn();
  } finally {
    draft.inert = false;
  }
}
export function settleMessage() {
  if (draft.status === 'conflict') return 'The draft was changed elsewhere. Choose a version first.';
  if (draft.status === 'rejected') return 'The latest changes could not be saved (structural errors).';
  return 'The latest changes are not saved yet. Try again when the draft shows "Saved".';
}

export const discard = () => guarded(async () => {
  await api('POST', '/draft/discard', { etag: draft.etag });
  await reload();
  removePendingCopy();
});

export const restoreRevision = (id) => guarded(async () => {
  await api('POST', `/revisions/${encodeURIComponent(id)}/restore`);
  await reload();
});

export const importDocument = (doc) => guarded(async () => {
  const r = await api('POST', '/import', { body: doc });
  await reload();
  return r;
});

export const checkpoint = (note) => guarded(() => api('POST', '/draft/checkpoint', { body: { note } }));

/** Publish the settled draft (the caller settled it and ran /validate first). */
export async function publish({ acknowledgeWarnings, note }) {
  draft.inert = true;
  try {
    if (!(await settle())) throw new Error(settleMessage());
    const r = await api('POST', '/publish', { body: { acknowledgeWarnings, note }, etag: draft.etag });
    if (r.draft) {
      // copy the published date into the document before adopting the new ETag, so no save follows
      cancelScheduled();
      if (draft.site.settings.updated !== r.draft.updated) draft.site.settings.updated = r.draft.updated;
      savedJson = localJson();
      draft.etag = r.draft.etag;
      draft.rev = r.draft.rev;
      setStatus('saved');
      removePendingCopy();
    }
    await reload(); // the server draft is authoritative (an autosave from another device may have landed)
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 412) await reload().catch(() => {});
    throw e;
  } finally {
    draft.inert = false;
  }
}

/** Blocking = would stop a draft save; anything else is a content error that only blocks publish. */
export const structural = (errors) => errors.filter(isBlocking);

// ------------------------------------------------------------------ page lifecycle
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved() || inFlight) {
      if (hasUnsaved()) writePendingCopy(); // offered at the next boot if the owner leaves anyway
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => { if (hasUnsaved()) writePendingCopy(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && draft.loaded && hasUnsaved()) {
      writePendingCopy();
      if (!['conflict', 'rejected'].includes(draft.status) && !session.modal) flush();
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (draft.loaded && !draft.inert) flush();
    }
  });
}
