// Optional Cloudflare purge of the six fixed-name URLs (admin-ops.md §5.8). Hashed files never need it.
export async function purgeFixedUrls(cfg) {
  if (!cfg.cfApiToken || !cfg.cfZoneId) return { skipped: true };
  const o = cfg.siteUrl;
  const files = [`${o}/`, `${o}/ka/`, `${o}/404.html`, `${o}/sitemap.xml`, `${o}/robots.txt`, `${o}/site.webmanifest`];
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.cfZoneId)}/purge_cache`, {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.cfApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }), signal: AbortSignal.timeout(5000),
    });
    return r.ok ? { ok: true } : { ok: false, warning: `cloudflare purge answered ${r.status}` };
  } catch (e) { return { ok: false, warning: `cloudflare purge failed: ${e.message}` }; }
}
