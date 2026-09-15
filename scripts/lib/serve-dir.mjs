// Static file server on an ephemeral port for the page gates. serveDir(dir) -> { url, close() }.
// Missing files answer 404 with the site's 404.html, like the production vhost.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

/** Fail fast when a directory is not a built site (a missing dist/ must never print PASS). */
export function assertBuiltSite(dir) {
  for (const f of ['index.html', 'ka/index.html']) {
    if (!existsSync(join(dir, f))) throw new Error(`${dir} is not a built site: ${f} is missing`);
  }
}

export async function serveDir(dir) {
  const root = resolve(dir);
  assertBuiltSite(root);
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(join(root, p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    try {
      if ((await stat(file)).isDirectory()) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(await readFile(join(root, '404.html')).catch(() => 'Not found'));
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => server.close(ok)) };
}

/** A gate argument is either a URL or a directory; returns { url, close }. */
export async function openTarget(target) {
  if (/^https?:\/\//.test(target)) return { url: target.replace(/\/$/, ''), close: async () => {} };
  return serveDir(target);
}

/** page.goto that fails the gate on any non-200 answer or a page without main#main. */
export async function gotoChecked(page, url) {
  const res = await page.goto(url, { waitUntil: 'networkidle' });
  if (!res || res.status() !== 200) throw new Error(`${url} answered ${res ? res.status() : 'nothing'}`);
  if (!(await page.$('main#main'))) throw new Error(`${url} has no main#main`);
  await page.evaluate(() => document.fonts.ready);
  return res;
}

export function argOf(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
