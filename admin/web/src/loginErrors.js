// Login error texts (admin-ops.md §6.5): never say which field was wrong; 429 shows the wait.
export function loginMessage(e) {
  if (!e || !e.status) return 'The admin server could not be reached. Check the connection and try again.';
  if (e.status === 401) return 'Wrong username or password.';
  if (e.status === 429 && e.code === 'busy') return 'The server is busy. Try again in a few seconds.';
  if (e.status === 429) {
    const min = Math.max(1, Math.ceil((e.body?.retryAfterS || 60) / 60));
    return `Too many attempts. Try again in ${min} ${min === 1 ? 'minute' : 'minutes'}.`;
  }
  if (e.status === 503) return 'The admin account is not set up yet.';
  if (e.status === 400) return 'Enter your username and password.';
  if (e.status === 403) return 'This request was refused. Reload the page and try again.';
  return e.message || 'Signing in failed.';
}
