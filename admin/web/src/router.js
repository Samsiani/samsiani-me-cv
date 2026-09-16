// A small hash router (admin-ops.md §6.1): six fixed screens, one guard. Hash routes need no server
// fallback: the service serves index.html only at /admin/.
import { reactive, nextTick } from 'vue';
import { session } from './state/session.js';

// The eight section tabs are shown in settings.sectionOrder (ContentView); this list is the fixed set.
export const CONTENT_TABS = [
  { id: 'person', title: 'Person & hero' },
  { id: 'contact', title: 'Contact rail' },
  { id: 'sections', title: 'Section order' },
  { id: 'profile', title: 'Profile' },
  { id: 'skills', title: 'Stack & skills' },
  { id: 'abilities', title: 'Abilities' },
  { id: 'workstyle', title: 'How I work' },
  { id: 'principles', title: 'Principles' },
  { id: 'experience', title: 'Experience' },
  { id: 'languages', title: 'Languages' },
  { id: 'talk', title: 'Let’s talk' },
  { id: 'ui', title: 'Interface strings' },
];

const ROUTES = [
  { name: 'login', re: /^\/login$/ },
  { name: 'dashboard', re: /^\/$/ },
  { name: 'content', re: /^\/content(?:\/([a-z]+))?$/, keys: ['tab'] },
  { name: 'seo', re: /^\/seo$/ },
  { name: 'revisions', re: /^\/revisions$/ },
  { name: 'account', re: /^\/account$/ },
];

export const route = reactive({ name: '', path: '/', params: {}, query: {}, seq: 0 });

function parse(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, q = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(q));
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) return { name: r.name, path, params: Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1]])), query };
  }
  return null;
}

let nextAfterLogin = '/';

/** Where the guard sends a location, or null to stay. */
function redirectFor(r) {
  if (!r) return '/';
  if (r.name === 'content' && !CONTENT_TABS.some((t) => t.id === r.params.tab)) return '/content/person';
  if (!session.authenticated) return r.name === 'login' ? null : '/login';
  if (session.mustChangePassword) return r.name === 'account' && r.query.force === '1' ? null : '/account?force=1';
  if (r.name === 'login') return nextAfterLogin || '/';
  if (r.name === 'account' && r.query.force === '1') return '/account';
  return null;
}

let focusHeadingOnce = true; // false when the caller focuses something itself (an issue link)

function apply({ initial = false } = {}) {
  const r = parse(location.hash);
  const to = redirectFor(r);
  if (to !== null) {
    if (r && !session.authenticated && r.name !== 'login') nextAfterLogin = r.path + (Object.keys(r.query).length ? '?' + new URLSearchParams(r.query) : '');
    location.replace('#' + to);
    if (parse('#' + to)) Object.assign(route, parse('#' + to), { seq: route.seq + 1 });
    return;
  }
  const changed = route.path !== r.path || route.name !== r.name;
  Object.assign(route, r, { seq: route.seq + 1 });
  const focusHeading = focusHeadingOnce;
  focusHeadingOnce = true;
  if (changed && !initial && focusHeading) {
    nextTick(() => {
      window.scrollTo(0, 0);
      const h = document.querySelector('main h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    });
  }
}

export function startRouter() {
  window.addEventListener('hashchange', () => apply());
  apply({ initial: true });
}

/** Re-run the guard after sign-in, sign-out or a password change. */
export const reroute = () => apply();

export function navigate(to, { focusHeading = true } = {}) {
  focusHeadingOnce = focusHeading;
  if (location.hash === '#' + to) apply();
  else location.hash = to;
}

export function takeNextAfterLogin() {
  const n = nextAfterLogin || '/';
  nextAfterLogin = '/';
  return n === '/login' ? '/' : n;
}
