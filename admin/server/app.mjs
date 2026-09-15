// createApp(cfg, deps): the admin HTTP app, pure (no listen, no timers). Wiring per admin-ops.md §4.1.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { headersFor } from './lib/headers.mjs';
import { digest, edgeOk, originAllowed, allValues } from './lib/guard.mjs';
import { AppError, NotInitialisedError } from './lib/errors.mjs';
import { LockTimeoutError } from './lib/lock.mjs';
import { requestId, clearCookie } from './lib/http.mjs';
import { authRoutes, sessionInfo, currentSession, sessionCookie } from './routes/auth.mjs';
import { accountRoutes } from './routes/account.mjs';
import { registryRoute } from './routes/registry.mjs';
import { draftRoutes } from './routes/draft.mjs';
import { ioRoutes } from './routes/io.mjs';
import { publishRoutes, previewFiles } from './routes/publish.mjs';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createApp(cfg, deps) {
  const app = new Hono();
  const edgeDigest = cfg.edgeSecret ? digest(cfg.edgeSecret) : null;
  const log = deps.log || (() => {});
  const count = deps.countRejected || (() => {});

  // request id + one log line per mutating API call; 401/403/413/429 are only counted (a flood cannot fill the disk)
  app.use('*', async (c, next) => {
    c.set('rid', requestId());
    const t0 = Date.now();
    await next();
    const st = c.res.status;
    if ([401, 403, 413, 429].includes(st)) count(st);
    else if (UNSAFE.has(c.req.method) && c.req.path.startsWith('/admin/api/')) log(`${c.req.method} ${c.req.path} ${st} ${Date.now() - t0}ms ${c.get('rid')}`);
  });
  app.use('/admin/*', headersFor(cfg));
  app.use('/admin', headersFor(cfg));

  app.get('/admin/api/health', async (c) => {
    const authState = (await deps.auth.hasAuth()) ? 'ok' : 'missing';
    let data = 'ok';
    try { await deps.store.getPublished(); } catch { data = 'degraded'; }
    return c.json({ ok: true, release: cfg.release, startedAt: deps.startedAt, auth: authState, data });
  });

  // guard 0: the Cloudflare edge secret (production). Every /admin path, SPA and preview included.
  if (edgeDigest) {
    const edge = async (c, next) => {
      if (!edgeOk(c.req.header('x-sm-edge'), edgeDigest)) return c.json({ error: 'edge', message: 'Forbidden.' }, 403);
      return next();
    };
    app.use('/admin/*', edge);
    app.use('/admin', edge);
  }

  // guards 1–5 on the API
  app.use('/admin/api/*', async (c, next) => {
    if (!allValues(c.req.header('x-requested-with'), (v) => v === 'samsiani-admin')) return c.json({ error: 'csrf', message: 'Missing request header.' }, 403);
    const sfs = c.req.header('sec-fetch-site');
    if (sfs !== undefined && !allValues(sfs, (v) => v === 'same-origin')) return c.json({ error: 'csrf_site', message: 'Cross-site request refused.' }, 403);
    if (UNSAFE.has(c.req.method)) {
      if (!originAllowed(c.req.header('origin'), cfg.allowedOrigins)) return c.json({ error: 'csrf_origin', message: 'Origin not allowed.' }, 403);
      const ct = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
      if (ct !== 'application/json') return c.json({ error: 'unsupported_media_type', message: 'Send JSON.' }, 415);
    }
    return next();
  });
  const small = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'too_large', message: 'The request body is too large.' }, 413) });
  const large = bodyLimit({ maxSize: 320 * 1024, onError: (c) => c.json({ error: 'too_large', message: 'The request body is too large.' }, 413) });
  app.use('/admin/api/*', (c, next) => (c.req.path === '/admin/api/import' ? large : small)(c, next));

  app.get('/admin/api/session', sessionInfo(cfg, deps));
  app.route('/admin/api/auth', authRoutes(cfg, deps));

  // everything below needs a session; while the first password is not changed, only the auth routes above work
  app.use('/admin/api/*', async (c, next) => {
    const sess = await currentSession(c, cfg, deps);
    if (!sess) { clearCookie(c, cfg.cookieName, sessionCookie(cfg)); return c.json({ error: 'unauthenticated', message: 'Sign in again.' }, 401); }
    const lim = deps.limiter.hit('any:' + sess.sid, 600, 60_000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); return c.json({ error: 'rate_limited', message: 'Too many requests.', retryAfterS: lim.retryAfterS }, 429); }
    if (sess.auth.mustChangePassword) return c.json({ error: 'password_change_required', message: 'Change the initial password first.' }, 403);
    c.set('session', sess);
    return next();
  });
  app.get('/admin/api/registry', registryRoute());
  app.route('/admin/api', draftRoutes(cfg, deps));
  app.route('/admin/api', ioRoutes(cfg, deps));
  app.route('/admin/api/account', accountRoutes(cfg, deps));
  app.route('/admin/api', publishRoutes(cfg, deps));
  app.get('/admin/preview/:token/*', previewFiles(deps));
  app.get('/admin/preview/:token', (c) => c.redirect(`/admin/preview/${c.req.param('token')}/`, 302));

  // SPA
  app.use('/admin/assets/*', serveStatic({ root: cfg.webDist, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }));
  app.get('/admin/', async (c) => {
    const html = await readFile(join(cfg.webDist, 'index.html'), 'utf8').catch(() => null);
    return c.html(html ?? '<!doctype html><meta charset="utf-8"><title>samsiani.me admin</title><p>The admin interface has not been built yet (npm run build:admin).</p>');
  });
  app.get('/admin', (c) => c.redirect('/admin/', 301));
  app.all('*', (c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    const rid = c.get('rid');
    if (err instanceof AppError) return c.json({ error: err.code, message: err.message, ...err.details, requestId: rid }, err.status);
    if (err instanceof LockTimeoutError) return c.json({ error: 'locked', message: 'Another publish or save is in progress; try again.', requestId: rid }, 423);
    if (err?.name === 'CorruptFileError') return c.json({ error: 'degraded', message: 'A stored file is unreadable.', requestId: rid }, 503);
    process.stderr.write(`[${rid}] ${err?.stack || err}\n`);
    return c.json({ error: 'internal', message: 'Something went wrong.', requestId: rid }, 500);
  });
  return app;
}

export { NotInitialisedError };
