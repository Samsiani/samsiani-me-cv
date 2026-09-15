// Response headers for everything under /admin/ (admin-ops.md §4.6).
const SPA_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; manifest-src 'self'";

export const previewCsp = (origin) =>
  `sandbox allow-scripts; default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; font-src ${origin}; img-src ${origin} data:; frame-ancestors ${origin}; base-uri 'none'; form-action 'none'`;

export function kindOf(path) {
  if (path.startsWith('/admin/api/')) return 'api';
  if (path.startsWith('/admin/assets/')) return 'asset';
  if (path.startsWith('/admin/preview/')) return /\/$|\.html$/.test(path) ? 'preview-html' : 'preview-file';
  return 'spa';
}

export function headersFor(cfg) {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'same-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    h.set('X-LiteSpeed-Cache-Control', 'no-cache');
    if (cfg.production) h.set('Strict-Transport-Security', 'max-age=31536000');
    const kind = kindOf(c.req.path);
    if (kind === 'api') {
      h.set('Cache-Control', 'no-store');
      h.set('X-Frame-Options', 'DENY');
    } else if (kind === 'asset') {
      if (c.res.status === 200) h.set('Cache-Control', 'public, max-age=31536000, immutable');
      h.set('Cross-Origin-Resource-Policy', 'same-origin');
    } else if (kind === 'preview-html') {
      h.set('Cache-Control', 'no-store');
      h.set('Content-Security-Policy', previewCsp(cfg.publicOrigin));
      h.set('Referrer-Policy', 'no-referrer');
    } else if (kind === 'preview-file') {
      h.set('Cache-Control', 'no-store');
      h.set('Access-Control-Allow-Origin', '*');
    } else {
      h.set('Cache-Control', 'no-store');
      h.set('Content-Security-Policy', SPA_CSP);
      h.set('X-Frame-Options', 'DENY');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'same-origin');
    }
  };
}
