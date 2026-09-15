// In-memory previews behind a capability token (admin-ops.md §7). Nothing here touches the file system.
import { randomBytes, createHash } from 'node:crypto';
import { jsonForScript } from '../../../src/shared/escape.mjs';
import { loadPalettes, allPalettesCss } from '../../../src/palettes.mjs';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 20;

let bundle = null; // palettes-all.<md5-8>.css, built once per process
export function paletteBundle() {
  if (!bundle) {
    const css = allPalettesCss(loadPalettes());
    bundle = { name: `palettes-all.${createHash('md5').update(css).digest('hex').slice(0, 8)}.css`, body: Buffer.from(css) };
  }
  return bundle;
}

function injection({ base, origin, token }) {
  const ids = loadPalettes().palettes.map((p) => p.id);
  const script = `(() => {
  const O = ${jsonForScript(origin)}, B = ${jsonForScript('/admin/preview/' + token)};
  const PAL = ${jsonForScript(ids)}, TH = ["light", "dark"];
  addEventListener("message", (e) => {
    if (e.origin !== O || !e.data || e.data.type !== "sm-preview") return;
    const r = document.documentElement;
    if (PAL.includes(e.data.palette)) r.dataset.palette = e.data.palette;
    if (TH.includes(e.data.theme)) r.dataset.theme = e.data.theme;
  });
  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('a[href="/"], a[href="/ka/"]').forEach((a) => { a.href = B + a.getAttribute("href"); });
  });
})();`;
  return `<meta name="robots" content="noindex">\n<link rel="stylesheet" href="${base}${paletteBundle().name}">\n<script>${script}</script>\n`;
}

export function createPreviewStore({ clock = { now: () => Date.now() }, origin }) {
  const entries = new Map(); // token -> { files: Map<path, { body, type }>, exp }
  const sweep = () => { for (const [t, e] of entries) if (e.exp <= clock.now()) entries.delete(t); };
  return {
    newToken: () => randomBytes(32).toString('base64url'),
    /** files: the Map from buildSite(mode 'preview'); returns { token, base, expiresAt, bundle } */
    put(token, files) {
      sweep();
      const base = `/admin/preview/${token}/`;
      const inject = injection({ base, origin, token });
      const map = new Map();
      for (const [path, f] of files) {
        let body = f.body;
        if (path.endsWith('.html')) body = String(body).replace('</head>', `${inject}</head>`);
        map.set(path, { body: typeof body === 'string' ? Buffer.from(body) : body, type: f.type });
      }
      const b = paletteBundle();
      map.set(b.name, { body: b.body, type: 'text/css; charset=utf-8' });
      const exp = clock.now() + TTL_MS;
      entries.set(token, { files: map, exp });
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      return { token, base, expiresAt: new Date(exp).toISOString(), bundle: b.name };
    },
    get(token, path) {
      if (!TOKEN_RE.test(token)) return null;
      const e = entries.get(token);
      if (!e || e.exp <= clock.now()) { entries.delete(token); return null; }
      return e.files.get(path) || null;
    },
    size: () => entries.size,
  };
}

/** Log-safe path: tokens never reach a log file. */
export const maskPreviewPath = (p) => p.replace(/^\/admin\/preview\/[A-Za-z0-9_-]+/, '/admin/preview/…');
