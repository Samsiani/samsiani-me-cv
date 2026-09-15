// fetch wrapper for /admin/api (admin-ops.md §6.2, §4.5): the custom CSRF header on every call, JSON
// bodies, If-Match built from the JSON body's `etag` (the ETag header is never read: Cloudflare weakens it),
// typed errors, and 401 → the login modal → one retry of the same request, so nothing typed is lost.
const BASE = '/admin/api';

export class ApiError extends Error {
  constructor(status, body = {}) {
    super(body.message || (status ? `The server answered ${status}.` : 'The admin server could not be reached.'));
    this.name = 'ApiError';
    this.status = status; // 0 = no response (network error)
    this.code = body.error || (status ? `http_${status}` : 'network');
    this.body = body;
  }
  /** Worth retrying later with the same document: no response, lock contention, rate limit, server trouble. */
  get retryable() { return this.status === 0 || this.status === 423 || this.status === 429 || this.status >= 500; }
}

let authHandler = null;
/** The session state registers a function that opens the login modal and resolves after a successful login. */
export function onUnauthorized(fn) { authHandler = fn; }

/**
 * @param {string} method
 * @param {string} path  below /admin/api
 * @param {{ body?: object, etag?: string, auth?: boolean, raw?: boolean }} [opts]
 *   auth: false for the auth endpoints (a 401 there is a wrong password, not an expired session)
 *   raw: resolve with the Response (downloads, PNG previews)
 */
export async function api(method, path, { body, etag, auth = true, raw = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = { 'X-Requested-With': 'samsiani-admin', Accept: 'application/json' };
    const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    if (etag) headers['If-Match'] = `"${etag}"`;
    let res;
    try { res = await fetch(BASE + path, init); }
    catch { throw new ApiError(0, { error: 'network', message: 'The admin server could not be reached.' }); }
    if (res.status === 401 && auth && authHandler && attempt === 0) {
      await authHandler();
      continue;
    }
    if (raw && res.ok) return res;
    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new ApiError(res.status, data || {});
    return data;
  }
}

/** "attachment; filename="x.json"" → x.json */
export function filenameOf(res, fallback) {
  const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  return m ? m[1] : fallback;
}

/** Offer a Blob as a file download (a temporary object URL on an <a download>). */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Blob → data: URL (the SPA's CSP allows data: images but not blob: ones). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
