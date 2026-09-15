// /admin/api/account/* (admin-ops.md §4.7 rows 6–8)
import { Hono } from 'hono';
import { remoteOf } from '../lib/http.mjs';
import { clientKey } from '../lib/guard.mjs';

export function accountRoutes(cfg, deps) {
  const r = new Hono();
  r.get('/sessions', async (c) => {
    const me = c.get('session').sid;
    const reg = await deps.auth.readSessions();
    return c.json({ items: reg.sessions.map((s) => ({ id: s.sid.slice(0, 6), current: s.sid === me, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, ua: s.ua })) });
  });
  r.post('/sessions/revoke-others', async (c) => {
    await deps.auth.revokeOthers(c.get('session').sid);
    await deps.audit.log('sessions_revoked', { ip: clientKey(remoteOf(c), c.req.raw.headers) });
    return c.body(null, 204);
  });
  r.get('/audit', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    return c.json({ items: (await deps.audit.tail(limit)).map(({ t, event, ip, detail }) => ({ t, event, ip, detail })) });
  });
  return r;
}
