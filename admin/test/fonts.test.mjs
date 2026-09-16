// Fonts F3 (docs/plans/fonts.md §4.4, §4.7, §7.2): the store, the upload pipeline and the routes.
// Uploads are untrusted input, so most of this file is about what the server refuses and about nothing
// being written when it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { setup, req, login } from './_helpers.mjs';
import { createBackup } from '../server/lib/backup.mjs';
import { parseFont } from '../../src/typography/sfnt.mjs';

const WEB = new URL('../../src/fonts/', import.meta.url);
const TTF = new URL('../../src/brand/fonts/', import.meta.url);
const face = (dir, name) => readFileSync(new URL(name, dir));
const NOTO_TTF = () => face(TTF, 'NotoSansGeorgian-SemiBold.ttf');
const PLEX_SANS = () => face(WEB, 'ibm-plex-sans-latin-wght-100-700.woff2');

/** POST /fonts/upload with the standard headers; `licence: false` leaves the attestation off. */
const upload = (ctx, cookie, bytes, { filename = 'Test-Regular.ttf', licence = true, type = 'application/octet-stream' } = {}) =>
  req(ctx, 'POST', '/admin/api/fonts/upload', {
    cookie,
    body: bytes,
    headers: { 'Content-Type': type, 'X-Font-Filename': filename, ...(licence ? { 'X-Font-Licence': 'attested' } : { 'X-Font-Licence': null }) },
  });

const signedIn = async () => { const ctx = await setup(); return { ctx, cookie: (await login(ctx)).cookie }; };
const files = (ctx) => readdirSync(join(ctx.cfg.dataDir, 'fonts', 'files')).sort();

test('a TTF upload is stored as a WOFF2 plus the original, with its coverage and metrics', async () => {
  const { ctx, cookie } = await signedIn();
  const res = await upload(ctx, cookie, NOTO_TTF(), { filename: 'NotoSansGeorgian-SemiBold.ttf' });
  assert.equal(res.status, 201);
  const rec = await res.json();
  assert.match(rec.id, /^[0-9a-f]{16}$/);
  assert.equal(rec.source, 'upload');
  assert.equal(rec.family, 'Noto Sans Georgian');
  assert.deepEqual(rec.coverage, { latin: true, georgian: true });
  assert.equal(rec.licence.kind, 'attested');
  assert.equal(rec.origin.filename, 'NotoSansGeorgian-SemiBold.ttf');
  // both roles from one file, the Latin face fenced out of Georgian, plus the original for satori
  assert.deepEqual(rec.faces.map((f) => `${f.kind}:${f.subset ?? ''}`), ['web:latin', 'web:georgian', 'satori:']);
  assert.equal(rec.faces[0].file, rec.faces[1].file);
  assert.doesNotMatch(rec.faces[0].unicodeRange, /U\+10[A-F0-9]{2}/);
  assert.match(rec.faces[1].unicodeRange, /^U\+0589, U\+10A0-10FF/);
  assert.ok(rec.faces[0].bytes < NOTO_TTF().length * 0.55, `the WOFF2 is ${rec.faces[0].bytes} of ${NOTO_TTF().length} bytes`);
  assert.equal(rec.metrics.georgian.mean, 0.678);
  assert.equal(rec.metrics.latin.adv, undefined, 'the per-character table is not sent to the admin');
  assert.equal(files(ctx).length, 2);
  // the stored WOFF2 really is one, and reads back as the font that was uploaded
  const stored = parseFont(readFileSync(join(ctx.cfg.dataDir, 'fonts', 'files', rec.faces[0].file)));
  assert.equal(stored.flavor, 'woff2');
  assert.equal(stored.numGlyphs, parseFont(NOTO_TTF()).numGlyphs);
});

test('a WOFF2 upload ships as it is and carries no satori face', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, PLEX_SANS(), { filename: 'plex.woff2' })).json();
  assert.deepEqual(rec.faces.map((f) => f.kind), ['web']);
  assert.equal(rec.faces[0].bytes, PLEX_SANS().length);
  assert.equal(rec.variable, true);
  assert.deepEqual(rec.axes, { wght: [100, 700] });
  assert.deepEqual(rec.weights, [100, 200, 300, 400, 500, 600, 700]);
  assert.equal(files(ctx).length, 1);
});

test('the same bytes twice are one font', async () => {
  const { ctx, cookie } = await signedIn();
  const a = await upload(ctx, cookie, NOTO_TTF());
  const b = await upload(ctx, cookie, NOTO_TTF());
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal((await a.json()).id, (await b.json()).id);
  assert.equal(files(ctx).length, 2);
  assert.equal((await (await req(ctx, 'GET', '/admin/api/fonts', { cookie })).json()).items.length, 1);
});

for (const [name, bytes, status, error, reason] of [
  ['a PNG renamed .ttf', () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4000, 7)]), 422, 'font_invalid', 'format'],
  ['a truncated font', () => NOTO_TTF().subarray(0, 40_000), 422, 'font_invalid', null],
  ['a file under 1 KB', () => Buffer.alloc(900, 1), 422, 'font_invalid', 'format'],
]) {
  test(`upload refuses ${name} and writes nothing`, async () => {
    const { ctx, cookie } = await signedIn();
    const res = await upload(ctx, cookie, bytes());
    assert.equal(res.status, status);
    const body = await res.json();
    assert.equal(body.error, error);
    if (reason) assert.equal(body.reason, reason);
    assert.equal(existsSync(join(ctx.cfg.dataDir, 'fonts', 'files')), false, 'nothing was written under data/fonts/files');
  });
}

test('upload needs the licence attestation, the right content type and a session', async () => {
  const { ctx, cookie } = await signedIn();
  assert.equal((await upload(ctx, cookie, NOTO_TTF(), { licence: false })).status, 400);
  assert.equal((await upload(ctx, cookie, NOTO_TTF(), { type: 'application/json' })).status, 415);
  assert.equal((await upload(ctx, '', NOTO_TTF())).status, 401);
  assert.equal(existsSync(join(ctx.cfg.dataDir, 'fonts', 'files')), false);
});

test('a body over 3 MB is refused before it is read', async () => {
  const { ctx, cookie } = await signedIn();
  const res = await upload(ctx, cookie, Buffer.alloc(3 * 1024 * 1024 + 1, 9));
  assert.equal(res.status, 413);
});

test('a face is served with private, immutable caching and its own type', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const res = await req(ctx, 'GET', `/admin/api/fonts/${rec.id}/files/0`, { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=86400, immutable');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await res.arrayBuffer()).byteLength, rec.faces[0].bytes);
  assert.equal((await req(ctx, 'GET', `/admin/api/fonts/${rec.id}/files/2`, { cookie })).headers.get('content-type'), 'font/ttf');
  assert.equal((await req(ctx, 'GET', `/admin/api/fonts/${rec.id}/files/9`, { cookie })).status, 404);
  assert.equal((await req(ctx, 'GET', '/admin/api/fonts/../../etc/files/0', { cookie })).status, 404);
});

test('the layout default face is served from the manifest, never from the path', async () => {
  const { ctx, cookie } = await signedIn();
  const ok = await req(ctx, 'GET', '/admin/api/fonts/default/precision/georgian', { cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'font/woff2');
  assert.equal((await ok.arrayBuffer()).byteLength, face(WEB, 'noto-sans-georgian-georgian-normal-400-700.woff2').length);
  assert.equal((await req(ctx, 'GET', '/admin/api/fonts/default/precision/display', { cookie })).status, 404);
  assert.equal((await req(ctx, 'GET', '/admin/api/fonts/default/nope/text', { cookie })).status, 404);
});

test('rename keeps the family and cleans the display name', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const res = await req(ctx, 'PATCH', `/admin/api/fonts/${rec.id}`, { cookie, body: { displayName: '  My <script> face  ' } });
  assert.equal(res.status, 200);
  const after = await res.json();
  assert.equal(after.displayName, 'My script face');
  assert.equal(after.family, 'Noto Sans Georgian');
  assert.equal((await req(ctx, 'PATCH', '/admin/api/fonts/0000000000000000', { cookie, body: { displayName: 'x' } })).status, 404);
});

test('a font in use cannot be deleted; an unused one takes its files with it', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const draft = await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json();
  const site = structuredClone(draft.site);
  site.settings.fonts = { precision: { georgian: rec.id } };
  const put = await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site }, headers: { 'If-Match': `"${draft.etag}"` } });
  assert.equal(put.status, 200);

  const list = await (await req(ctx, 'GET', '/admin/api/fonts', { cookie })).json();
  assert.deepEqual(list.usage, { [rec.id]: ['draft'] });
  assert.equal(list.bytes > 0 && list.bytes < list.limit, true);

  const refused = await req(ctx, 'DELETE', `/admin/api/fonts/${rec.id}`, { cookie });
  assert.equal(refused.status, 409);
  assert.deepEqual((await refused.json()).usedBy, ['draft']);
  assert.equal(files(ctx).length, 2);

  site.settings.fonts = { precision: { georgian: null } };
  const etag = (await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).etag;
  await req(ctx, 'PUT', '/admin/api/draft', { cookie, body: { site }, headers: { 'If-Match': `"${etag}"` } });
  assert.equal((await req(ctx, 'DELETE', `/admin/api/fonts/${rec.id}`, { cookie })).status, 204);
  assert.equal(files(ctx).length, 0);
  assert.equal((await req(ctx, 'DELETE', `/admin/api/fonts/${rec.id}`, { cookie })).status, 404);
});

test('the report names the roles, the page weight and the nav fit', async () => {
  const { ctx, cookie } = await signedIn();
  const plain = await (await req(ctx, 'POST', '/admin/api/fonts/report', { cookie, body: {} })).json();
  assert.equal(plain.layout, 'precision');
  assert.deepEqual(plain.roles.text, { id: null, family: 'Chivo', source: 'layout', default: true });
  assert.deepEqual(plain.navFit, { en: '1440', ka: '1680' });
  assert.ok(plain.bytes.ka > plain.bytes.en && plain.bytes.ka < 400 * 1024);
  assert.deepEqual(plain.widthFactor, { text: 1, label: 1, georgian: 1 });
  assert.deepEqual(plain.issues, { errors: [], warnings: [] });

  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const site = structuredClone((await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).site);
  site.settings.fonts = { precision: { text: rec.id, georgian: rec.id } };
  const over = await (await req(ctx, 'POST', '/admin/api/fonts/report', { cookie, body: { site } })).json();
  assert.deepEqual(over.roles.text, { id: rec.id, family: 'Noto Sans Georgian', source: 'upload', default: false });
  assert.equal(over.roles.label.default, true);
  assert.equal(over.issues.errors.length, 0);
  // one upload serving both the text and the Georgian role is one file and one download on both pages
  assert.equal(over.bytes.en, over.bytes.ka);
  assert.ok(over.bytes.ka < plain.bytes.ka, `${over.bytes.ka} vs ${plain.bytes.ka}`);
});

test('an id the store lost is an error under the live layout and a warning under another', async () => {
  const { ctx, cookie } = await signedIn();
  const site = structuredClone((await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).site);
  site.settings.fonts = { precision: { text: 'abcdef0123456789' }, studio: { text: 'abcdef0123456789' } };
  const r = await (await req(ctx, 'POST', '/admin/api/fonts/report', { cookie, body: { site } })).json();
  assert.deepEqual(r.issues.errors.map((e) => [e.code, e.path]), [['FONT_UNKNOWN', '$.settings.fonts.precision.text']]);
  assert.deepEqual(r.issues.warnings.map((e) => [e.code, e.path]), [['FONT_UNKNOWN', '$.settings.fonts.studio.text']]);
});

test('a Georgian-less font in the Georgian role is an error, and a static face warns about weights', async () => {
  const { ctx, cookie } = await signedIn();
  const plex = await (await upload(ctx, cookie, PLEX_SANS(), { filename: 'plex.woff2' })).json();
  const mono = await (await upload(ctx, cookie, face(WEB, 'ibm-plex-mono-latin-400.woff2'), { filename: 'mono.woff2' })).json();
  const site = structuredClone((await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).site);
  site.settings.fonts = { precision: { georgian: plex.id, label: mono.id } };
  const r = await (await req(ctx, 'POST', '/admin/api/fonts/report', { cookie, body: { site } })).json();
  assert.deepEqual(r.issues.errors.map((e) => e.code), ['FONT_NO_GEORGIAN']);
  const weights = r.issues.warnings.find((w) => w.code === 'FONT_WEIGHTS');
  assert.ok(weights && weights.msg.includes('500'), JSON.stringify(r.issues.warnings));
});

test('the backup carries the font index and no font bytes; a restore drops records without files', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const backup = createBackup({ dataDir: ctx.cfg.dataDir, store: ctx.deps.store, paletteIds: ctx.deps.paletteIds, layoutIds: ctx.deps.layoutIds, clock: ctx.clock, audit: ctx.deps.audit });
  const file = await backup.write('t');
  const doc = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  assert.deepEqual(Object.keys(doc.fonts.fonts), [rec.id]);
  const text = JSON.stringify(doc);
  assert.ok(text.length < 400 * 1024, `the backup is ${text.length} bytes; the font files must not be in it`);

  // the same backup on a machine that never had the files: the record is dropped, not restored dangling
  const fresh = await setup();
  const b2 = createBackup({ dataDir: fresh.cfg.dataDir, store: fresh.deps.store, paletteIds: fresh.deps.paletteIds, layoutIds: fresh.deps.layoutIds, clock: fresh.clock, audit: fresh.deps.audit });
  const out = await b2.restore(file, 'all');
  assert.deepEqual(out.droppedFonts, [rec.id]);
  assert.equal(await fresh.deps.fonts.get(rec.id), null);
});

test('sweep removes a file no record points at and keeps the rest', async () => {
  const { ctx, cookie } = await signedIn();
  const rec = await (await upload(ctx, cookie, NOTO_TTF())).json();
  const { writeFileSync } = await import('node:fs');
  const orphan = 'f'.repeat(64) + '.woff2';
  writeFileSync(join(ctx.cfg.dataDir, 'fonts', 'files', orphan), Buffer.alloc(10));
  assert.deepEqual(await ctx.deps.fonts.sweep(), [orphan]);
  assert.deepEqual(files(ctx).sort(), [...new Set(rec.faces.map((f) => f.file))].sort());
});

// ---------------------------------------------------------------- Google (F4)
// Every request below goes through the frozen fixture in test/fixtures/google-fonts. `ctx.seen` records what
// the server asked for, and a setup() without `google: true` throws on any fetch at all: no test can reach
// the network, and one that tried would fail rather than quietly pass on someone's laptop.
const FIXTURE_HOSTS = /^https:\/\/fonts\.(google\.com|googleapis\.com|gstatic\.com)\//;
const googleIn = async (opts = {}) => { const ctx = await setup({ google: true, ...opts }); return { ctx, cookie: (await login(ctx)).cookie }; };
const catalogue = (ctx, cookie, q = '') => req(ctx, 'GET', `/admin/api/fonts/catalogue${q}`, { cookie });
const addFamily = (ctx, cookie, family) => req(ctx, 'POST', '/admin/api/fonts/google', { cookie, body: { family } });
const offFixture = (ctx) => assert.deepEqual(ctx.seen.filter((u) => !FIXTURE_HOSTS.test(u)), [], 'a request went somewhere other than Google');

test('the catalogue is fetched once, trimmed, cached for a day and refreshed on demand', async () => {
  const { ctx, cookie } = await googleIn();
  const first = await catalogue(ctx, cookie);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.stale, false);
  // the ")]}'" anti-JSON prefix is stripped, closed-source families are dropped, the rest is trimmed
  assert.equal(body.families.length, 7);
  assert.equal(body.families.some((f) => f.family === 'Closed Source Sans'), false);
  const geo = body.families.filter((f) => f.georgian).map((f) => f.family);
  assert.deepEqual(geo.sort(), ['Noto Sans Georgian', 'Noto Serif Georgian']);
  assert.deepEqual(body.families.find((f) => f.family === 'IBM Plex Mono'), {
    family: 'IBM Plex Mono', category: 'Monospace', weights: [400, 500], italic: false, axes: [], wght: null,
    latin: true, georgian: false, popularity: 100, lastModified: '2026-08-01',
  });

  assert.equal(ctx.seen.length, 1);
  await catalogue(ctx, cookie);
  assert.equal(ctx.seen.length, 1, 'the cached copy answered the second call');
  ctx.clock.advance(25 * 60 * 60 * 1000); // a day on, the session is gone too
  const later = (await login(ctx)).cookie;
  await catalogue(ctx, later);
  assert.equal(ctx.seen.length, 2, 'a day later it is fetched again');
  assert.equal((await catalogue(ctx, later, '?refresh=1')).status, 200);
  assert.equal((await catalogue(ctx, later, '?refresh=1')).status, 429, 'a forced refresh is once per ten minutes');
  offFixture(ctx);
});

test('a Google outage answers 503 with no cache and the stale copy with one', async () => {
  const off = await googleIn({ offline: true });
  assert.equal((await catalogue(off.ctx, off.cookie)).status, 503);
  assert.equal((await (await catalogue(off.ctx, off.cookie)).json()).error, 'google_unavailable');
  assert.equal((await addFamily(off.ctx, off.cookie, 'Chivo')).status, 503);
  assert.equal(existsSync(join(off.ctx.cfg.dataDir, 'fonts', 'catalogue.json')), false);

  // the same outage on a server that has fetched the catalogue before: the stale copy still answers
  const good = await googleIn();
  await catalogue(good.ctx, good.cookie);
  const broken = await setup({ google: true, offline: true });
  const cookie = (await login(broken)).cookie;
  const { copyFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(broken.cfg.dataDir, 'fonts'), { recursive: true });
  copyFileSync(join(good.ctx.cfg.dataDir, 'fonts', 'catalogue.json'), join(broken.cfg.dataDir, 'fonts', 'catalogue.json'));
  broken.clock.advance(25 * 60 * 60 * 1000);
  const stale = await catalogue(broken, (await login(broken)).cookie);
  assert.equal(stale.status, 200);
  const body = await stale.json();
  assert.equal(body.stale, true);
  assert.equal(body.families.length, 7);
  assert.equal(cookie.length > 0, true);
});

test('a variable family is downloaded once and is idempotent', async () => {
  const { ctx, cookie } = await googleIn();
  const res = await addFamily(ctx, cookie, 'Chivo');
  assert.equal(res.status, 201);
  const rec = await res.json();
  assert.equal(rec.source, 'google');
  assert.equal(rec.family, 'Chivo');
  assert.equal(rec.displayName, 'Chivo', 'the subset file calls itself "Chivo Medium"; the catalogue name wins');
  assert.equal(rec.version, 'v20');
  assert.equal(rec.licence.url, 'https://fonts.google.com/specimen/Chivo/license');
  assert.deepEqual(rec.coverage, { latin: true, georgian: false });
  assert.deepEqual(rec.faces.map((f) => [f.kind, f.subset, f.weight]), [['web', 'latin', [100, 900]]]);
  assert.doesNotMatch(rec.faces[0].unicodeRange, /U\+10[A-F0-9]{2}/);
  assert.equal(files(ctx).length, 1);

  const before = ctx.seen.length;
  const again = await addFamily(ctx, cookie, 'Chivo');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, rec.id);
  assert.equal(ctx.seen.length, before + 1, 'only css2 is asked again; the font file is not downloaded twice');
  assert.equal(files(ctx).length, 1);
  offFixture(ctx);
});

test('a static family brings one file per weight', async () => {
  const { ctx, cookie } = await googleIn();
  const rec = await (await addFamily(ctx, cookie, 'IBM Plex Mono')).json();
  assert.equal(rec.variable, false);
  assert.deepEqual(rec.weights, [400, 500]);
  assert.deepEqual(rec.faces.map((f) => f.weight), [[400, 400], [500, 500]]);
  assert.equal(new Set(rec.faces.map((f) => f.file)).size, 2);
  assert.ok(ctx.seen.some((u) => u.includes('wght@400;500')), ctx.seen.join(' '));
  offFixture(ctx);
});

test('the Georgian family arrives with Georgian coverage and the Georgian fence', async () => {
  const { ctx, cookie } = await googleIn();
  const rec = await (await addFamily(ctx, cookie, 'Noto Sans Georgian')).json();
  assert.equal(rec.coverage.georgian, true);
  assert.equal(rec.faces[0].subset, 'georgian');
  assert.equal(rec.faces[0].unicodeRange, 'U+0589, U+10A0-10FF, U+1C90-1CBA, U+1CBD-1CBF, U+205A, U+2D00-2D2F, U+2E31');
  assert.equal(rec.faces[0].stretch, '62.5% 100%');
  assert.equal(rec.metrics.georgian.mean, 0.659);
  offFixture(ctx);
});

for (const [name, family, status, error] of [
  ['a family the catalogue does not list', 'Comic Sans MS', 404, 'unknown_family'],
  ['a file that is not a font', 'Noto Serif Georgian', 502, 'google_unexpected'],
  ['a file over the 2 MB cap', 'Archivo', 413, 'too_large'],
  ['a file served from another host', 'IBM Plex Sans', 502, 'google_unexpected'],
]) {
  test(`Google refuses ${name} and writes nothing`, async () => {
    const { ctx, cookie } = await googleIn();
    const res = await addFamily(ctx, cookie, family);
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, error);
    assert.equal(existsSync(join(ctx.cfg.dataDir, 'fonts', 'files')), false, 'nothing was written under data/fonts/files');
    offFixture(ctx);
  });
}

test('a downloaded family renders like an upload and can be deleted again', async () => {
  const { ctx, cookie } = await googleIn();
  const rec = await (await addFamily(ctx, cookie, 'Noto Sans Georgian')).json();
  const site = structuredClone((await (await req(ctx, 'GET', '/admin/api/draft', { cookie })).json()).site);
  site.settings.fonts = { precision: { georgian: rec.id } };
  const report = await (await req(ctx, 'POST', '/admin/api/fonts/report', { cookie, body: { site } })).json();
  assert.deepEqual(report.roles.georgian, { id: rec.id, family: 'Noto Sans Georgian', source: 'google', default: false });
  assert.deepEqual(report.issues.errors, []);
  assert.equal((await req(ctx, 'DELETE', `/admin/api/fonts/${rec.id}`, { cookie })).status, 204);
  assert.equal(files(ctx).length, 0);
  offFixture(ctx);
});
