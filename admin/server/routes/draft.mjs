// Draft, validation and revisions (admin-ops.md §4.7 rows 10–14, 21–23).
import { Hono } from 'hono';
import { validate } from '../../../src/schema/validate.mjs';
import { diffPaths } from '../../shared/diff.mjs';
import { jsonBody, ifMatchValue, fail } from '../lib/http.mjs';

export function draftRoutes(cfg, deps) {
  const r = new Hono();
  const { store } = deps;
  const published = async () => { const p = await store.getPublished(); return { rev: p.rev, etag: p.etag, publishedAt: p.publishedAt, buildId: p.buildId }; };

  r.get('/draft', async (c) => {
    const d = await store.getDraft();
    const pub = await published();
    c.header('ETag', `"${d.etag}"`);
    return c.json({ rev: d.rev, etag: d.etag, savedAt: d.savedAt, site: d.site, issues: d.issues, published: pub, dirty: d.etag !== pub.etag });
  });

  r.put('/draft', async (c) => {
    const body = await jsonBody(c);
    const force = body.force === true;
    const header = c.req.header('if-match');
    if (!force && !header) fail(428, 'precondition_required', 'Send If-Match with the ETag of the draft you edited.');
    const out = await store.saveDraft(body.site, { ifMatch: ifMatchValue(header), force, actor: 'admin' });
    const pub = await published();
    c.header('ETag', `"${out.etag}"`);
    return c.json({ rev: out.rev, etag: out.etag, savedAt: out.savedAt, dirty: out.etag !== pub.etag, validation: { errors: out.validation.errors, warnings: out.validation.warnings } });
  });

  r.post('/draft/discard', async (c) => {
    await jsonBody(c, { optional: true });
    const out = await store.discardDraft({ ifMatch: ifMatchValue(c.req.header('if-match')), actor: 'admin' });
    c.header('ETag', `"${out.etag}"`);
    return c.json({ rev: out.rev, etag: out.etag, savedAt: out.savedAt, site: out.site });
  });

  r.post('/draft/checkpoint', async (c) => {
    const body = await jsonBody(c, { optional: true });
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : '';
    const res = await store.checkpoint({ note, site: body.site, actor: 'admin' });
    return c.json({ id: res.id }, 201);
  });

  r.post('/validate', async (c) => {
    const body = await jsonBody(c, { optional: true });
    const site = body.site ?? (await store.getDraft()).site;
    if (!site || typeof site !== 'object') fail(400, 'bad_request', 'site must be an object.');
    const s = structuredClone(site);
    if (s.settings && typeof s.settings === 'object') s.settings.siteUrl = cfg.siteUrl;
    const v = validate(s, { mode: 'save', paletteIds: deps.paletteIds, layoutIds: deps.layoutIds, today: store.today() });
    return c.json({ errors: v.errors, warnings: v.warnings });
  });

  r.get('/revisions', async (c) => c.json({ items: await store.listRevisions(), keep: 30 }));

  r.get('/revisions/:id', async (c) => {
    const rev = await store.getRevision(c.req.param('id'));
    const draft = await store.getDraft();
    return c.json({ id: rev.id, rev: rev.rev, reason: rev.reason, createdAt: rev.createdAt, note: rev.note, site: rev.site, changes: diffPaths(draft.site, rev.site) });
  });

  r.post('/revisions/:id/restore', async (c) => {
    const out = await store.restoreRevision(c.req.param('id'), { actor: 'admin' });
    return c.json({ rev: out.rev, etag: out.etag, savedAt: out.savedAt });
  });

  return r;
}
