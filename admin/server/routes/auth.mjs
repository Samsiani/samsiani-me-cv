// /admin/api/session and /admin/api/auth/* (admin-ops.md §4.2–§4.4, §4.7 rows 2–5)
import { Hono } from 'hono';
import { readCookie, setCookie, clearCookie, jsonBody, remoteOf, fail } from '../lib/http.mjs';
import { clientKey } from '../lib/guard.mjs';
import { readDevice, makeDevice, passwordProblem, verifyPassword, ABSOLUTE_S, DEVICE_MAX_AGE } from '../lib/auth.mjs';

export function sessionCookie(cfg) { return { path: '/admin', secure: cfg.cookieSecure }; }

export async function currentSession(c, cfg, deps) {
  const value = readCookie(c, cfg.cookieName);
  if (!value) return null;
  const sess = await deps.auth.verifySession(value);
  if (sess?.reissue) setCookie(c, cfg.cookieName, sess.reissue, { ...sessionCookie(cfg), maxAge: Math.max(0, sess.iat + ABSOLUTE_S - Math.floor(deps.clock.now() / 1000)) });
  return sess;
}

export function sessionInfo(cfg, deps) {
  return async (c) => {
    const sess = await currentSession(c, cfg, deps);
    if (!sess) return c.json({ authenticated: false });
    return c.json({ authenticated: true, username: sess.auth.username, mustChangePassword: !!sess.auth.mustChangePassword, ...deps.auth.expiry(sess) });
  };
}

export function authRoutes(cfg, deps) {
  const r = new Hono();
  const { auth, limiter, audit, clock } = deps;

  r.post('/login', async (c) => {
    const body = await jsonBody(c);
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || username.length > 128 || password.length > 1024) fail(400, 'bad_request', 'Username and password are required.');
    if (!(await auth.hasAuth())) fail(503, 'not_initialised', 'No admin account exists yet; set one with the CLI (set-password).');
    const device = readDevice(readCookie(c, cfg.deviceCookieName), cfg.sessionSecrets);
    const ip = clientKey(remoteOf(c), c.req.raw.headers);
    const who = { client: ip, device };
    const allowed = limiter.loginAllowed(who);
    if (!allowed.ok) {
      c.header('Retry-After', String(allowed.retryAfterS));
      fail(429, 'rate_limited', 'Too many failed sign-ins. Try again later.', { retryAfterS: allowed.retryAfterS });
    }
    const res = await auth.checkCredentials(username, password);
    if (res.notInitialised) fail(503, 'not_initialised', 'No admin account exists yet.');
    if (!res.ok) {
      const { globalLocked } = limiter.loginFailed(who);
      await audit.log('login_failed', { ip });
      if (globalLocked) await audit.log('login_global_lock', { ip });
      fail(401, 'invalid_credentials', 'The username or password is wrong.');
    }
    limiter.loginSucceeded(who);
    await auth.upgradeHashIfNeeded(password, res.auth.hash).catch(() => {});
    const s = await auth.createSession({ ip, ua: c.req.header('user-agent') });
    setCookie(c, cfg.cookieName, s.value, { ...sessionCookie(cfg), maxAge: ABSOLUTE_S });
    const dev = device ? makeDevice(cfg.sessionSecrets[0], device) : makeDevice(cfg.sessionSecrets[0]);
    setCookie(c, cfg.deviceCookieName, dev.value, { path: '/admin/api/auth', secure: cfg.cookieSecure, maxAge: DEVICE_MAX_AGE });
    await audit.log('login', { ip, ua: c.req.header('user-agent') });
    return c.json({ ok: true, mustChangePassword: !!res.auth.mustChangePassword });
  });

  r.post('/logout', async (c) => {
    const sess = await currentSession(c, cfg, deps);
    if (!sess) fail(401, 'unauthenticated', 'Not signed in.');
    await auth.deleteSession(sess.sid);
    clearCookie(c, cfg.cookieName, sessionCookie(cfg));
    await audit.log('logout', { ip: clientKey(remoteOf(c), c.req.raw.headers) });
    return c.body(null, 204);
  });

  r.post('/password', async (c) => {
    const sess = await currentSession(c, cfg, deps);
    if (!sess) fail(401, 'unauthenticated', 'Not signed in.');
    const lim = limiter.hit('pw:' + sess.sid, 5, 15 * 60 * 1000);
    if (!lim.ok) { c.header('Retry-After', String(lim.retryAfterS)); fail(429, 'rate_limited', 'Too many attempts.', { retryAfterS: lim.retryAfterS }); }
    const { currentPassword, newPassword } = await jsonBody(c);
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') fail(400, 'bad_request', 'currentPassword and newPassword are required.');
    if (!(await verifyPassword(currentPassword, sess.auth.hash))) fail(401, 'invalid_current_password', 'The current password is wrong.');
    const problem = passwordProblem(newPassword, { username: sess.auth.username, current: currentPassword });
    if (problem) fail(400, 'weak_password', problem === 'length' ? 'Use 12 to 128 characters.' : problem === 'username' ? 'The password must not be the username.' : 'Choose a password different from the current one.', { rules: { min: 12, max: 128 } });
    const out = await auth.changePassword(sess.sid, sess.iat, newPassword);
    setCookie(c, cfg.cookieName, out.value, { ...sessionCookie(cfg), maxAge: Math.max(0, sess.iat + ABSOLUTE_S - Math.floor(clock.now() / 1000)) });
    await audit.log('password_changed', { ip: clientKey(remoteOf(c), c.req.raw.headers) });
    return c.body(null, 204);
  });

  return r;
}
