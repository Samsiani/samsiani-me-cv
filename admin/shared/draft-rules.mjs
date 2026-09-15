// What autosave may store vs what publish requires (docs/plans/admin-ops.md §3.3).
// Shared by the server and the SPA so both classify validator errors the same way.

// Known content errors a draft may hold while the owner is still typing. Anything else is blocking,
// including codes this file does not know yet (a future validator code fails safe).
const NON_BLOCKING = new Set([
  'EMPTY', 'TOO_LONG', 'COUNT', 'NAV_LABEL', 'NAV_BUDGET', 'REF', 'REF_PRIMARY', 'PERIOD_ORDER',
  'WHITESPACE', 'CYRILLIC', 'RUSSIAN', 'GEORGIAN_IN_CAPS', 'DATE', 'PATTERN',
]);

// Structural codes: a draft with any of these is refused outright.
export const DRAFT_BLOCKING = new Set([
  'TYPE', 'MISSING', 'MISSING_LANG', 'UNKNOWN_KEY', 'LANG_KEY', 'ID', 'DUPLICATE_ID', 'ENUM', 'INT', 'CONTROL_CHAR',
]);

/** True when a validator error must stop a draft from being stored. */
export function isBlocking(e) {
  if (typeof e.path === 'string' && e.path.startsWith('$.settings.')) return true; // reaches new URL() / footer markup
  if (e.code === 'RUSSIAN') return e.path.endsWith('.ru'); // a "ru" key is structure; Russian words are content
  if (DRAFT_BLOCKING.has(e.code)) return true;
  if (typeof e.code === 'string' && e.code.startsWith('HREF_')) return false;
  return !NON_BLOCKING.has(e.code);
}

export const blockingErrors = (errors) => errors.filter(isBlocking);

/** Counter threshold: neutral below, warning at or above, error above max. */
export const softLimit = (max) => Math.floor(max * 0.9);
