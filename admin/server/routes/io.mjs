// Export and import (admin-ops.md §4.7 rows 24–25).
import { Hono } from 'hono';
import { SCHEMA_VERSION } from '../../../src/schema/migrate.mjs';
import { jsonBody, fail } from '../lib/http.mjs';

export function ioRoutes(cfg, deps) {
  const r = new Hono();
  const { store, limiter } = deps;

  r.get('/export', async (c) => {
    const source = c.req.query('source') || 'draft';
    if (source !== 'draft' && source !== 'published') fail(400, 'bad_request', 'source must be draft or published.');
    const doc = source === 'draft' ? await store.getDraft() : await store.getPublished();
    const day = store.today();
    c.header('Content-Disposition', `attachment; filename="samsiani-site-${source}-r${doc.rev}-${day}.json"`);
    return c.json({ format: 'samsiani.me/site', schemaVersion: SCHEMA_VERSION, source, rev: doc.rev, exportedAt: new Date(deps.clock.now()).toISOString(), site: doc.site });
  });

  r.post('/import', async (c) => {
    const lim = limiter.hit('import:' + c.get('session').sid, 10, 3600_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many imports this hour.', { retryAfterS: lim.retryAfterS }); }
    const body = await jsonBody(c);
    const site = body.format === 'samsiani.me/site' ? body.site : body;
    const out = await store.importDraft(site, { actor: 'admin' });
    return c.json({ rev: out.rev, etag: out.etag, validation: { errors: out.validation.errors, warnings: out.validation.warnings } });
  });

  return r;
}
