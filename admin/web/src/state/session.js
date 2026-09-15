// Session state (admin-ops.md §6.2): who is signed in, whether the first password must change, and the
// login modal that a 401 during work opens over the current screen. Requests waiting for it resume after
// the next successful sign-in.
import { reactive } from 'vue';
import { api, onUnauthorized } from '../api.js';

export const session = reactive({
  checked: false,
  authenticated: false,
  username: '',
  mustChangePassword: false,
  idleExpiresAt: null,
  modal: false, // the login modal is open (a request is waiting for a new session)
});

let waiters = [];
onUnauthorized(() => new Promise((resolve) => {
  waiters.push(resolve);
  session.modal = true;
}));

/** Called by the login modal after a successful sign-in: every waiting request is sent again. */
export function modalLoginDone() {
  session.modal = false;
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
}

export async function refreshSession() {
  const s = await api('GET', '/session', { auth: false });
  Object.assign(session, {
    checked: true,
    authenticated: !!s.authenticated,
    username: s.username || '',
    mustChangePassword: !!s.mustChangePassword,
    idleExpiresAt: s.idleExpiresAt || null,
  });
  return session;
}

export async function login(username, password) {
  const r = await api('POST', '/auth/login', { body: { username, password }, auth: false });
  Object.assign(session, { checked: true, authenticated: true, username, mustChangePassword: !!r.mustChangePassword });
  return r;
}

export async function logout() {
  try { await api('POST', '/auth/logout', { auth: false }); } catch { /* already signed out */ }
  Object.assign(session, { authenticated: false, mustChangePassword: false });
}

export async function changePassword(currentPassword, newPassword) {
  await api('POST', '/auth/password', { body: { currentPassword, newPassword } });
  session.mustChangePassword = false;
}
