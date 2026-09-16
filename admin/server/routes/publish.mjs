// Preview, publish, builds (admin-ops.md §4.7 rows 15, 16, 18–20).
import { Hono } from 'hono';
import { jsonBody, ifMatchValue, fail } from '../lib/http.mjs';
import { buildSite } from '../../../src/build-site.mjs';
import { LAYOUTS } from '../../../src/layouts/index.mjs';
import { loadPalettes } from '../../../src/palettes.mjs';
import { brandPlan } from '../../../src/shared/brand.mjs';
import { fontNamer } from '../lib/fonts/check.mjs';
import { renderPng, RENDERER_ID } from '../../../src/brand/render.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const EXPIRED = '<!doctype html><meta charset="utf-8"><title>Preview expired</title><p style="font:14px system-ui;padding:24px">Preview expired, refresh it from the dashboard.</p>';

export function publishRoutes(cfg, deps) {
  const r = new Hono();
  const { store, limiter, previews, publisher } = deps;

  r.post('/preview', async (c) => {
    const lim = limiter.hit('preview:' + c.get('session').sid, 60, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many previews.', { retryAfterS: lim.retryAfterS }); }
    const body = await jsonBody(c, { optional: true });
    let site;
    if (body.site !== undefined) site = body.site;
    else if (typeof body.revisionId === 'string') site = (await store.getRevision(body.revisionId)).site;
    else site = (await store.getDraft()).site;
    site = structuredClone(site);
    if (site && typeof site === 'object' && site.settings) {
      if (typeof body.layout === 'string') site.settings.layout = body.layout;
      if (typeof body.palette === 'string') site.settings.palette = body.palette;
    }
    const checked = store.checkDraft(site); // structural and settings errors -> 400; content errors render
    const token = previews.newToken();
    let files;
    try {
      files = await buildSite(checked.site, { mode: 'preview', base: `/admin/preview/${token}/`, brand: deps.previewBrand(checked.site), today: store.today(), fonts: deps.fonts.loader() });
    } catch (e) {
      fail(422, 'preview_render_failed', `Preview cannot render this draft: ${e.message}`);
    }
    return c.json(previews.put(token, files), 201);
  });

  r.post('/publish', async (c) => {
    const lim = limiter.hit('publish:' + c.get('session').sid, 10, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many publishes.', { retryAfterS: lim.retryAfterS }); }
    const body = await jsonBody(c, { optional: true });
    const out = await publisher.publish({ source: 'draft', reason: 'admin', ifMatch: ifMatchValue(c.req.header('if-match')), acknowledgeWarnings: body.acknowledgeWarnings === true, note: typeof body.note === 'string' ? body.note : '' });
    return c.json(out);
  });

  // PNG social card for the SEO screen: { lang, site? }; uses the same names and cache as publish
  r.post('/og-preview', async (c) => {
    const lim = limiter.hit('og:' + c.get('session').sid, 20, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many card previews.', { retryAfterS: lim.retryAfterS }); }
    const body = await jsonBody(c, { optional: true });
    const lang = body.lang === 'ka' ? 'ka' : 'en';
    const checked = store.checkDraft(body.site ?? (await store.getDraft()).site);
    const pals = loadPalettes();
    const pal = pals.palettes.find((p) => p.id === checked.site.settings.palette) || pals.palettes.find((p) => p.id === pals.default);
    const meta = (LAYOUTS[checked.site.settings.layout] || LAYOUTS.precision).meta;
    const item = brandPlan(checked.site, pal, meta, RENDERER_ID).find((p) => p.kind === 'og' && p.key === lang);
    const cache = join(cfg.dataDir, 'brand-cache');
    let png = await readFile(join(cache, item.name)).catch(() => null);
    if (!png) { png = await renderPng(item); await mkdir(cache, { recursive: true }); await writeFile(join(cache, item.name), png, { mode: 0o644 }); }
    return c.body(png, 200, { 'Content-Type': 'image/png' });
  });

  r.get('/builds', async (c) => {
    const items = await publisher.listBuilds();
    const name = await fontNamer(deps.fonts);
    return c.json({ items: items.map((b) => ({ ...b, fontsSummary: name(b.fonts) })) });
  });

  r.post('/builds/rollback', async (c) => {
    const lim = limiter.hit('publish:' + c.get('session').sid, 10, 60_000);
    if (!lim.ok) fail(429, 'rate_limited', 'Too many requests.', { retryAfterS: lim.retryAfterS });
    const body = await jsonBody(c, { optional: true });
    return c.json(await publisher.rollback({ buildId: typeof body.buildId === 'string' ? body.buildId : undefined }));
  });

  return r;
}

/** GET /admin/preview/:token/* — only the token's in-memory map, never the file system. */
export function previewFiles(deps) {
  return (c) => {
    const token = c.req.param('token');
    const prefix = `/admin/preview/${token}/`;
    let rest = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    try { rest = decodeURIComponent(rest); } catch { return c.html(EXPIRED, 404); }
    if (rest.includes('..') || rest.includes('//') || rest.includes('\0') || rest.startsWith('/')) return c.html(EXPIRED, 404);
    if (rest === '' || rest.endsWith('/')) rest += 'index.html';
    const f = deps.previews.get(token, rest);
    if (!f) return c.html(EXPIRED, 404);
    return c.body(f.body, 200, { 'Content-Type': f.type });
  };
}

export { LAYOUTS };
