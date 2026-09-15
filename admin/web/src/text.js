// Plain text only (data-model.md §12.1): line breaks and control characters never reach the draft.
// CONTROL_CHAR is a structural error, so a pasted line break would otherwise make the save fail.
// Character classes are built from code points (no escapes that an editor could turn into raw characters).
const cls = (...ranges) => new RegExp('[' + ranges.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']', 'g');
const BREAKS = cls([0x09, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]); // tab, line feed, carriage return, U+2028/9
const CONTROL = cls([0x00, 0x1f], [0x7f, 0x9f]); // every other C0/C1 control character
export const GEORGIAN = new RegExp(cls([0x10a0, 0x10ff], [0x1c90, 0x1cbf], [0x2d00, 0x2d2f]).source);
export const sanitize = (v) => String(v ?? '').replace(BREAKS, ' ').replace(CONTROL, '');

/** Write a cleaned value back into the input when cleaning changed it, keeping the caret in place. */
export function cleanInput(el) {
  const raw = el.value;
  const clean = sanitize(raw);
  if (clean !== raw) {
    const pos = Math.max(0, (el.selectionStart ?? raw.length) - (raw.length - clean.length));
    el.value = clean;
    try { el.setSelectionRange(pos, pos); } catch { /* not a text control */ }
  }
  return clean;
}

// textarea auto-grow (height through CSSOM, which the CSP allows)
function grow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}
export const vAutogrow = { mounted: grow, updated: grow };
if (typeof window !== 'undefined') {
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => document.querySelectorAll('textarea[data-autogrow]').forEach(grow), 100);
  });
}

/** A short, single-line label for an item (used in button names such as "Move 'PHP 8' up"). */
export function itemTitle(item, index) {
  if (typeof item === 'string') return item || `item ${index + 1}`;
  const pick = (v) => (v && typeof v === 'object' ? v.en || v.ka : v);
  const t = pick(item?.title) || pick(item?.name) || pick(item?.role) || pick(item?.label) || pick(item?.value) || pick(item?.text) || '';
  const s = String(t).trim();
  if (!s) return `item ${index + 1}`;
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}
