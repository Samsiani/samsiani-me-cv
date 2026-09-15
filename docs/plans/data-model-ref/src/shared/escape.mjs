// HTML escaping for text and attribute values. Every content string goes through esc().
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const pad = (n) => String(n).padStart(2, '0');

// JSON for <script type="application/ld+json">: escape "<" so content can never close the script tag.
const BS = String.fromCharCode(92);
export const jsonForScript = (v) => JSON.stringify(v).replace(/</g, `${BS}u003c`);
