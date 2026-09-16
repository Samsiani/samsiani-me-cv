// Fonts: the store, uploads, face bytes and the dashboard report (fonts plan §4.7). Every route sits behind
// the session, CSRF and edge guards of app.mjs; ids are checked against FONT_ID_RE before any I/O, and a face
// is always addressed by its index in the record, never by a name that came out of a font file.
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FONT_ID_RE, FONT_ROLES } from '../../../src/typography/roles.mjs';
import { LAYOUTS } from '../../../src/layouts/index.mjs';
import { fontReport } from '../lib/fonts/check.mjs';
import { inspectUpload } from '../lib/fonts/upload.mjs';
import { LIMITS } from '../lib/fonts/store.mjs';
import { jsonBody, fail } from '../lib/http.mjs';

const TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const FACE_HEADERS = { 'Cache-Control': 'private, max-age=86400, immutable', 'Cross-Origin-Resource-Policy': 'same-origin' };
// metrics.adv is ~130 numbers per script and the picker never reads it; the means stay.
const slim = (r) => ({ ...r, metrics: { ...r.metrics, latin: mean(r.metrics?.latin), georgian: mean(r.metrics?.georgian) } });
const mean = (m) => (m ? { mean: m.mean } : null);

export function fontRoutes(cfg, deps) {
  const r = new Hono();
  const { fonts, google, limiter, store } = deps;
  const idParam = (c) => {
    const id = c.req.param('id');
    if (!FONT_ID_RE.test(String(id))) fail(404, 'not_found', 'Unknown font.');
    return id;
  };

  r.get('/fonts', async (c) => c.json({
    items: (await fonts.list()).map(slim),
    usage: await fonts.usage(),
    bytes: await fonts.bytes(),
    limit: LIMITS.store,
  }));

  // The catalogue the picker filters. Cached on the server for a day; the SPA never talks to Google.
  r.get('/fonts/catalogue', async (c) => {
    if (!google) fail(503, 'google_unavailable', 'Google Fonts is not configured on this server. Uploads still work.');
    const refresh = c.req.query('refresh') === '1';
    const out = await google.catalogue({ refresh });
    return c.json({ fetchedAt: out.fetchedAt, stale: Boolean(out.stale), families: out.families });
  });

  // Download one family's web faces, server-side, on the owner's action.
  r.post('/fonts/google', async (c) => {
    if (!google) fail(503, 'google_unavailable', 'Google Fonts is not configured on this server. Uploads still work.');
    const lim = limiter.hit('fonts:' + c.get('session').sid, 10, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many fonts in a minute.', { retryAfterS: lim.retryAfterS }); }
    const body = await jsonBody(c);
    const family = typeof body.family === 'string' ? body.family.trim() : '';
    if (!family || family.length > 80) fail(400, 'bad_request', 'family must be a name of at most 80 characters.');
    const { record, files, existing } = await google.fetchFamily(family, { lookup: (id) => fonts.get(id) });
    if (existing) return c.json(slim(record), 200);
    const { record: stored, created } = await fonts.add(record, files);
    return c.json(slim(stored), created ? 201 : 200);
  });

  // The body is the font file itself: the only octet-stream route in the API (app.mjs exempts this path).
  r.post('/fonts/upload', async (c) => {
    const lim = limiter.hit('fonts:' + c.get('session').sid, 10, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many fonts in a minute.', { retryAfterS: lim.retryAfterS }); }
    if (c.req.header('x-font-licence') !== 'attested') fail(400, 'licence_required', 'Confirm that you may embed this font on the site.');
    const filename = String(c.req.header('x-font-filename') || '').slice(0, 120);
    const body = Buffer.from(await c.req.arrayBuffer());
    const { record, files } = inspectUpload(body, { filename, now: deps.clock.now() });
    const { record: stored, created } = await fonts.add(record, files);
    return c.json(slim(stored), created ? 201 : 200);
  });

  r.patch('/fonts/:id', async (c) => {
    const id = idParam(c);
    const body = await jsonBody(c);
    if (typeof body.displayName !== 'string') fail(400, 'bad_request', 'displayName must be a string.');
    return c.json(slim(await fonts.rename(id, body.displayName)));
  });

  r.delete('/fonts/:id', async (c) => {
    const id = idParam(c);
    const usedBy = (await fonts.usage())[id];
    if (usedBy?.length) fail(409, 'font_in_use', 'This font is still in use; reset the roles that use it first.', { usedBy });
    await fonts.remove(id);
    return c.body(null, 204);
  });

  // The picker's specimen: one face of one stored font, by its index in the record.
  r.get('/fonts/:id/files/:face', async (c) => {
    const id = idParam(c);
    const record = await fonts.get(id);
    const i = Number(c.req.param('face'));
    const face = Number.isInteger(i) && i >= 0 ? record?.faces?.[i] : null;
    if (!face) fail(404, 'not_found', 'Unknown font face.');
    return c.body(await fonts.readFace(record, face), 200, { ...FACE_HEADERS, 'Content-Type': TYPES[face.file.split('.').pop()] || 'application/octet-stream' });
  });

  // The specimen for a role that is still on the layout's own face: read from src/fonts by the manifest,
  // never from the path, so the route can only ever serve a file this release ships.
  r.get('/fonts/default/:layout/:role', async (c) => {
    const layout = LAYOUTS[c.req.param('layout')];
    const role = c.req.param('role');
    if (!layout || !FONT_ROLES.includes(role)) fail(404, 'not_found', 'Unknown layout or role.');
    const name = layout.meta.fontRoles[role].files[0];
    const bytes = await readFile(join(cfg.root, 'src/fonts', `${name}.woff2`)).catch(() => null);
    if (!bytes) fail(404, 'not_found', 'That face is not in this release.');
    return c.body(bytes, 200, { ...FACE_HEADERS, 'Content-Type': TYPES.woff2 });
  });

  r.post('/fonts/report', async (c) => {
    const body = await jsonBody(c, { optional: true });
    const checked = store.checkDraft(body.site ?? (await store.getDraft()).site);
    return c.json(await fontReport(checked.site, fonts));
  });

  return r;
}
