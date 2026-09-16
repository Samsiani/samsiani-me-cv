// Admin end-to-end flows E1–E11 (docs/plans/admin-layouts-palettes.md, M8 acceptance), node:test + Playwright.
// Run: npm run test:e2e   (E2E_SHOTS=<dir> also writes review screenshots)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSpa, createHarness, waitFor, sleep, INITIAL_PASSWORD, PASSWORD, USERNAME, ROOT } from './_harness.mjs';
import { overflowProbe, contrastProbe, focusProbe } from '../../scripts/lib/dom-checks.mjs';

let h; // harness
let main; // the owner's main browser context { context, page }
const T = { timeout: 180_000 };

before(async () => {
  buildSpa();
  h = await createHarness();
  await h.start();
}, { timeout: 180_000 });

after(async () => {
  if (h) {
    if (process.env.E2E_SERVER_LOGS) process.stdout.write(h.logs.join(''));
    await h.close();
  }
});

const hash = (page) => page.evaluate(() => location.hash);
const go = async (page, route) => { await page.evaluate((r) => { location.hash = r; }, route); };
const typeAtEnd = async (page, selector, text) => {
  const el = page.locator(selector);
  await el.click();
  // the caret at the very end (End only reaches the end of the visual line in a wrapped textarea)
  await el.evaluate((e) => e.setSelectionRange(e.value.length, e.value.length));
  await el.pressSequentially(text, { delay: 15 });
};

test('E1: first login → forced password change → dashboard', T, async () => {
  main = await h.open();
  const { page } = main;
  await page.goto(`${h.origin}/admin/`);
  await page.locator('main h1', { hasText: 'Sign in' }).waitFor();
  // a wrong password never says which field was wrong
  await page.locator('#login-user').fill(USERNAME);
  await page.locator('#login-pass').fill('not-the-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('login-error').waitFor();
  assert.equal((await page.getByTestId('login-error').innerText()).trim(), 'Wrong username or password.');
  // the initial password leads to the forced change, where only the password form is available
  await page.locator('#login-pass').fill(INITIAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('main h1', { hasText: 'Choose your password' }).waitFor();
  assert.equal(await hash(page), '#/account?force=1');
  assert.equal(await page.getByRole('link', { name: 'Revisions' }).count(), 0, 'no navigation while the password must change');
  assert.equal(await page.getByRole('button', { name: 'Publish' }).count(), 0);
  // a request to another screen is sent back to the password form
  await go(page, '/content/skills');
  await waitFor(async () => (await hash(page)) === '#/account?force=1', { message: 'the guard' });
  await page.locator('#pw-current').fill(INITIAL_PASSWORD);
  await page.locator('#pw-new').fill(PASSWORD);
  await page.locator('#pw-again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.locator('main h1', { hasText: 'Dashboard' }).waitFor({ timeout: 15_000 });
  assert.equal(await hash(page), '#/');
  await h.waitSaved(page);
  const auth = h.readData('auth.json');
  assert.equal(auth.mustChangePassword, false);
});

test('review screenshots (E2E_SHOTS=<dir>)', { ...T, skip: !process.env.E2E_SHOTS }, async () => {
  const dir = resolve(ROOT, process.env.E2E_SHOTS || '.cache/admin-shots');
  mkdirSync(dir, { recursive: true });
  const shots = [
    ['dashboard-1440-light', 1440, 'light', '/'],
    ['dashboard-1440-dark', 1440, 'dark', '/'],
    ['content-skills-1440-light', 1440, 'light', '/content/skills'],
    ['dashboard-390-light', 390, 'light', '/'],
  ];
  for (const [name, width, colorScheme, route] of shots) {
    const x = await h.open({ width, height: 900, colorScheme });
    try {
      await h.login(x.page);
      await go(x.page, route);
      await x.page.locator('main h1').first().waitFor();
      if (route === '/') await h.inPreview(x.page, () => document.readyState === 'complete');
      await x.page.waitForLoadState('networkidle').catch(() => {});
      // a viewport as tall as the page (a full-page capture leaves the sandboxed frame unpainted)
      const height = await x.page.evaluate(() => document.documentElement.scrollHeight);
      await x.page.setViewportSize({ width, height: Math.min(height, 16_000) });
      await sleep(800);
      await x.page.screenshot({ path: join(dir, `${name}.png`) });
    } finally {
      await x.context.close();
    }
  }
});

test('E2: typing in the KA tagline updates the preview /ka/ within 1 s of the last keystroke, before the save returns', T, async () => {
  const { page } = main;
  // the preview in Georgian (the toolbar choice is kept while moving between screens)
  await page.getByRole('button', { name: 'KA', exact: true }).click();
  await h.inPreview(page, () => document.documentElement.lang === 'ka');
  // hold every autosave so the check below provably happens before the save returns
  let hold = true;
  const held = [];
  let putsDone = 0;
  await page.route('**/admin/api/draft', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    if (hold) held.push(route); else route.continue();
  });
  page.on('requestfinished', (r) => { if (r.method() === 'PUT' && r.url().endsWith('/admin/api/draft')) putsDone++; });
  await page.getByRole('link', { name: 'Content' }).first().click();
  await page.locator('#f-hero-tagline-ka').waitFor();
  const marker = ' გამოცდა2';
  await typeAtEnd(page, '#f-hero-tagline-ka', marker);
  const lastKey = Date.now();
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await h.inPreview(page, (m) => location.pathname.endsWith('/ka/') && document.body.innerText.includes(m.trim()), marker, { timeout: 5_000 });
  const elapsed = Date.now() - lastKey;
  assert.ok(elapsed < 1000, `the preview showed the keystrokes after ${elapsed} ms`);
  assert.equal(putsDone, 0, 'no save had returned yet');
  assert.doesNotMatch(await h.status(page), /^Saved/);
  hold = false;
  for (const r of held.splice(0)) await r.continue();
  await h.waitSaved(page);
  await page.unroute('**/admin/api/draft');
  const d = await h.api(page, 'GET', '/draft');
  assert.ok(d.json.site.hero.tagline.ka.endsWith(marker.trim()), 'the save carried the text');
});

test('E3: moving a skill down with the keyboard keeps focus on the moved item and GET /draft has the new order', T, async () => {
  const { page } = main;
  const before = (await h.api(page, 'GET', '/draft')).json.site.sections.skills.groups[0].items;
  const [first, second] = before;
  await page.getByRole('link', { name: 'Content' }).first().click();
  await page.getByRole('link', { name: /^Stack & skills/ }).click();
  const label = `Move ‘${first.name.en}’ down`;
  const btn = page.getByRole('button', { name: label, exact: true });
  await btn.focus();
  await page.keyboard.press('Enter');
  await waitFor(() => page.evaluate(() => document.activeElement?.closest('[data-key]')?.previousElementSibling?.dataset?.key), { message: 'the move' });
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const row = el.closest('[data-key]');
    return { label: el.getAttribute('aria-label'), key: row.dataset.key, index: [...row.parentElement.children].filter((c) => c.dataset.key).indexOf(row) };
  });
  assert.equal(focus.label, label, 'focus stays on the same button');
  assert.equal(focus.key, first.id, 'on the moved item');
  assert.equal(focus.index, 1, 'which is now second');
  await h.waitSaved(page);
  const after = (await h.api(page, 'GET', '/draft')).json.site.sections.skills.groups[0].items;
  assert.deepEqual(after.slice(0, 2).map((i) => i.id), [second.id, first.id]);
});

test('E4: layout re-renders the preview; palette switches through the bridge with no request; KA keeps the palette', T, async () => {
  const { page } = main;
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await page.locator('input[name="layout"][value="studio"]').check();
  await h.inPreview(page, () => document.documentElement.dataset.layout === 'studio');
  await sleep(900); // let the layout render settle
  const posts = [];
  const onReq = (r) => { if (r.method() === 'POST' && r.url().endsWith('/admin/api/preview')) posts.push(Date.now()); };
  page.on('request', onReq);
  const t0 = Date.now();
  await page.locator('input[name="palette"][value="amber"]').check();
  await h.inPreview(page, () => document.documentElement.dataset.palette === 'amber', undefined, { timeout: 1_000 });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await h.inPreview(page, () => !location.pathname.endsWith('/ka/') && document.documentElement.dataset.palette === 'amber');
  await page.getByRole('button', { name: 'KA', exact: true }).click();
  await h.inPreview(page, () => location.pathname.endsWith('/ka/') && document.documentElement.lang === 'ka' && document.documentElement.dataset.palette === 'amber');
  await sleep(Math.max(0, t0 + 2000 - Date.now()));
  assert.deepEqual(posts.filter((t) => t >= t0), [], 'no POST /admin/api/preview within 2 s of choosing a palette or switching language');
  page.off('request', onReq);
  await h.waitSaved(page);
  const s = (await h.api(page, 'GET', '/draft')).json.site.settings;
  assert.equal(s.layout, 'studio');
  assert.equal(s.palette, 'amber');
  // back to the default look for the next flows
  await page.locator('input[name="layout"][value="precision"]').check();
  await page.locator('input[name="palette"][value="cobalt"]').check();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await h.inPreview(page, () => document.documentElement.dataset.layout === 'precision' && document.documentElement.dataset.palette === 'cobalt');
  await h.waitSaved(page);
});

async function publishFromDialog(page) {
  const submit = page.getByRole('button', { name: 'Publish to samsiani.me' });
  await submit.waitFor({ timeout: 15_000 });
  const ack = page.getByLabel('I have reviewed these warnings');
  if (await ack.count()) await ack.check();
  await waitFor(async () => (await submit.getAttribute('aria-disabled')) !== 'true', { message: 'an enabled publish button' });
  await submit.click();
  const dialogText = () => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.innerText).join('\n'));
  const alertText = () => page.evaluate(() => [...document.querySelectorAll('dialog[open] [role="alert"]')].map((d) => d.innerText).join('\n'));
  await waitFor(async () => {
    if (/Live · r\d+ · published in/.test(await dialogText())) return true;
    const alert = await alertText();
    if (alert) throw new Error(`publish failed: ${alert}`);
    return false;
  }, { timeout: 30_000, message: 'the publish result' }).catch(async (e) => {
    throw new Error(`${e.message}\n--- dialog:\n${await dialogText()}`);
  });
  await page.getByRole('button', { name: 'Close' }).click();
}

test('E5: type in the KA tagline and publish at once; the web root has the last keystroke; roll back restores the previous bytes', T, async () => {
  const { page } = main;
  // a first publish, so there is a previous build to roll back to
  await page.getByTestId('publish').click();
  await publishFromDialog(page);
  const prevKa = h.webFile('ka/index.html');
  const prevEn = h.webFile('index.html');
  // type and publish at once
  await page.getByRole('link', { name: 'Content' }).first().click();
  await page.locator('#f-hero-tagline-ka').waitFor();
  const marker = ' საბოლოო5';
  await typeAtEnd(page, '#f-hero-tagline-ka', marker);
  await page.getByTestId('publish').click();
  await publishFromDialog(page);
  const liveKa = h.webFile('ka/index.html').toString('utf8');
  assert.ok(liveKa.includes(marker.trim()), 'the published /ka/ page has the last keystroke');
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await h.waitSaved(page);
  assert.match((await page.getByTestId('diff-count').innerText()).trim(), /Same as live/);
  assert.equal(await page.getByTestId('publish').getAttribute('aria-disabled'), 'true', 'nothing left to publish');
  // Revisions → roll back to the previous build
  await page.getByRole('link', { name: 'Revisions' }).first().click();
  const rows = page.locator('[data-testid="builds"] tbody tr');
  await waitFor(async () => (await rows.count()) >= 2, { message: 'two builds' });
  await rows.nth(1).getByRole('button', { name: /^Roll back to this build/ }).click();
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  await page.getByText(/^Rolled back: the live site is r\d+ again\.$/).waitFor({ timeout: 15_000 });
  assert.ok(h.webFile('ka/index.html').equals(prevKa), 'ka/index.html has the previous bytes');
  assert.ok(h.webFile('index.html').equals(prevEn), 'index.html has the previous bytes');
});

test('E6: two contexts: the second save shows the conflict dialog; both choices keep the other version in Revisions', T, async () => {
  const a = await h.open();
  const b = await h.open();
  try {
    await h.login(a.page);
    await h.login(b.page);
    for (const x of [a, b]) {
      await x.page.getByRole('link', { name: 'Content' }).first().click();
      await x.page.locator('#f-hero-tagline-en').waitFor();
    }
    await typeAtEnd(a.page, '#f-hero-tagline-en', ' fromA6');
    await h.waitSaved(a.page);
    await typeAtEnd(b.page, '#f-hero-tagline-en', ' fromB6');
    const titleB = b.page.locator('#conflict-title');
    await titleB.waitFor({ timeout: 10_000 });
    assert.match(await titleB.innerText(), /^This draft was changed in another tab or device \(r\d+, \d\d:\d\d\)\.$/);
    // "Keep mine": B's text wins, A's version stays as pre-overwrite
    await b.page.getByRole('button', { name: /^Keep mine and overwrite/ }).click();
    await h.waitSaved(b.page);
    assert.ok((await h.api(b.page, 'GET', '/draft')).json.site.hero.tagline.en.endsWith('fromB6'));
    const pre = (await h.api(b.page, 'GET', '/revisions')).json.items.find((r) => r.reason === 'pre-overwrite');
    assert.ok(pre, 'a pre-overwrite revision exists');
    assert.ok((await h.api(b.page, 'GET', `/revisions/${pre.id}`)).json.site.hero.tagline.en.endsWith('fromA6'), 'it holds the other version');
    // A is stale now: "Load the newer draft" keeps A's local text as a checkpoint first
    await typeAtEnd(a.page, '#f-hero-tagline-en', ' againA6');
    await a.page.locator('#conflict-title').waitFor({ timeout: 10_000 });
    await a.page.getByRole('button', { name: 'Load the newer draft', exact: true }).click();
    await waitFor(async () => (await a.page.locator('#f-hero-tagline-en').inputValue()).endsWith('fromB6'), { message: 'the newer draft in the first context' });
    await h.waitSaved(a.page);
    const cp = (await h.api(a.page, 'GET', '/revisions')).json.items.find((r) => r.reason === 'checkpoint' && /^Local edits replaced by r\d+/.test(r.note));
    assert.ok(cp, 'a checkpoint of the local copy exists');
    assert.ok((await h.api(a.page, 'GET', `/revisions/${cp.id}`)).json.site.hero.tagline.en.endsWith('fromA6 againA6'), 'it holds the local text');
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('E7: after session expiry the next save opens the login modal and the queued save is sent after login', T, async () => {
  await h.stop();
  await h.start({ SESSION_IDLE_S: '4' }); // test-only override (ignored in production)
  const x = await h.open();
  try {
    await h.login(x.page);
    await x.page.getByRole('link', { name: 'Content' }).first().click();
    await x.page.locator('#f-hero-subrole-en').waitFor();
    await sleep(5_500); // idle past the 4 s window
    const marker = ' (expiry E7)';
    await typeAtEnd(x.page, '#f-hero-subrole-en', marker);
    await x.page.locator('#relogin-title').waitFor({ timeout: 10_000 });
    const pending = await x.page.evaluate(() => JSON.parse(localStorage.getItem('sm-admin:pending') || 'null'));
    assert.ok(pending?.site?.hero?.subrole?.en?.endsWith(marker.trim()), 'what was typed is kept on this device meanwhile');
    await x.page.locator('#relogin-pass').fill(PASSWORD);
    await x.page.locator('dialog[open]').getByRole('button', { name: 'Sign in' }).click();
    await h.waitSaved(x.page);
    assert.ok(h.readData('draft.json').site.hero.subrole.en.endsWith(marker.trim()), 'the queued save reached the server');
    assert.equal(await x.page.evaluate(() => localStorage.getItem('sm-admin:pending')), null, 'the device copy is removed once saved');
  } finally {
    await x.context.close();
    await h.stop();
    await h.start();
  }
});

test('E8: export draft → import → the banner shows and the preview shows the imported text', T, async () => {
  const { page } = main;
  await h.login(page); // the short idle window of E7 pruned the older sessions
  await page.getByRole('link', { name: 'Account' }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-draft').click()]);
  assert.match(download.suggestedFilename(), /^samsiani-site-draft-r\d+-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(doc.format, 'samsiani.me/site');
  const marker = 'Imported through the admin E8';
  doc.site.hero.tagline.en = marker;
  const file = join(h.tmp, 'import-e8.json');
  writeFileSync(file, JSON.stringify(doc));
  await page.locator('#import-file').setInputFiles(file);
  const banner = page.getByTestId('import-banner');
  await banner.waitFor({ timeout: 10_000 });
  assert.match(await banner.innerText(), /Imported into the draft\. Preview it, then publish\./);
  assert.equal(await page.locator('#f-hero-tagline-en').count(), 0);
  await banner.getByRole('link', { name: 'Open the preview' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await h.inPreview(page, (m) => !location.pathname.endsWith('/ka/') && document.body.innerText.includes(m), marker);
  const revs = (await h.api(page, 'GET', '/revisions')).json.items;
  assert.ok(revs.some((r) => r.reason === 'pre-import'), 'the replaced draft is in Revisions');
});

test('E9: inside the preview frame document.cookie is empty and fetching /admin/api/draft fails', T, async () => {
  const { page } = main;
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  assert.equal(await page.locator('iframe[title="Site preview"]').getAttribute('sandbox'), 'allow-scripts');
  const probe = async () => {
    let cookie;
    try { cookie = document.cookie; } catch { cookie = ''; } // an opaque-origin document may not read cookies at all
    let status = null, error = null;
    try {
      const res = await fetch('/admin/api/draft', { credentials: 'include', headers: { 'X-Requested-With': 'samsiani-admin' } });
      status = res.status;
    } catch (e) { error = String(e); }
    return { cookie, status, error, origin: self.origin }; // the document's security origin ("null" when sandboxed)
  };
  const f = await waitFor(() => h.previewFrame(page), { message: 'the preview frame' });
  const r = await f.evaluate(probe);
  assert.equal(r.cookie, '', 'no cookie is visible in the frame');
  assert.equal(r.origin, 'null', 'the frame has an opaque origin');
  assert.ok(r.error || r.status === 401 || r.status === 403, `the request failed (${JSON.stringify(r)})`);
  // without the preview CSP the request still fails: opaque origin, no session cookie, no CORS
  const y = await h.open({ bypassCSP: true });
  try {
    await h.login(y.page);
    const fy = await waitFor(() => h.previewFrame(y.page), { message: 'the preview frame' });
    await h.inPreview(y.page, () => document.readyState === 'complete');
    const ry = await fy.evaluate(probe);
    assert.equal(ry.cookie, '');
    assert.ok(ry.error || ry.status === 401 || ry.status === 403, `the request failed without CSP too (${JSON.stringify(ry)})`);
  } finally {
    await y.context.close();
  }
});

// E10 helpers: the in-page probes of scripts/lib/dom-checks.mjs, plus the palette rows whose focus ring is
// drawn on the row (palettes.md §8: `.pal-opt:has(input:focus-visible)`), measured the same way.
function rowRingProbe() {
  const el = document.activeElement?.closest('.pal-opt');
  if (!el) return { width: 0, style: 'none', clippedBy: null, label: 'palette row' };
  const cs = getComputedStyle(el);
  const width = parseFloat(cs.outlineWidth) || 0;
  const off = parseFloat(cs.outlineOffset) || 0;
  const r = el.getBoundingClientRect();
  const grow = Math.max(0, off + width);
  const ring = { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow };
  let clippedBy = null;
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const acs = getComputedStyle(a);
    if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
    const ar = a.getBoundingClientRect();
    const bl = parseFloat(acs.borderLeftWidth), bt = parseFloat(acs.borderTopWidth);
    const pad = { left: ar.left + bl, top: ar.top + bt, right: ar.left + bl + a.clientWidth, bottom: ar.top + bt + a.clientHeight };
    if (ring.left < pad.left - 0.5 || ring.top < pad.top - 0.5 || ring.right > pad.right + 0.5 || ring.bottom > pad.bottom + 0.5) { clippedBy = a.tagName.toLowerCase() + '.' + a.className; break; }
  }
  return { width, style: cs.outlineStyle, clippedBy, label: 'label.pal-opt' };
}
function activeInfo() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  if (!el.__e2eId) el.__e2eId = (window.__e2eN = (window.__e2eN || 0) + 1);
  return { id: el.__e2eId, tag: el.tagName, pal: !!el.closest('.pal-opt') };
}

async function auditScreen(page, cdp, label) {
  const fails = [];
  const o = await page.evaluate(overflowProbe);
  if (o.sw > o.cw || o.over.length) fails.push(`${label}: horizontal scroll (sw=${o.sw} cw=${o.cw}) ${o.over.join(' | ')}`);
  const c = await page.evaluate(contrastProbe);
  if (c.low.length) fails.push(`${label}: contrast ${c.low.slice(0, 6).join('; ')}`);
  if (c.caps.length) fails.push(`${label}: uppercase Georgian ${c.caps.slice(0, 6).join('; ')}`);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const unnamed = nodes.filter((n) => !n.ignored && ['link', 'button'].includes(n.role?.value) && !(n.name?.value || '').trim());
  if (unnamed.length) fails.push(`${label}: ${unnamed.length} link/button without an accessible name`);
  const seen = new Set();
  let stops = 0, last = null, repeats = 0;
  for (let i = 0; i < 4000; i++) {
    await page.keyboard.press('Tab');
    const a = await page.evaluate(activeInfo);
    if (!a) break;
    if (a.id === last) { if (++repeats > 8) break; continue; } // a composite control (date input segments)
    repeats = 0;
    last = a.id;
    if (seen.has(a.id)) break; // back at the start: every stop was visited
    seen.add(a.id);
    if (a.tag === 'IFRAME') break; // the preview page inside has its own rings (checked by the public-site gates)
    let r = await page.evaluate(focusProbe);
    if ((r.style === 'none' || r.width < 2) && a.pal) r = await page.evaluate(rowRingProbe);
    if (r.style === 'none' || r.width < 2) fails.push(`${label}: no visible 2 px focus ring on ${r.label}`);
    else if (r.clippedBy) fails.push(`${label}: focus ring of ${r.label} clipped by ${r.clippedBy}`);
    stops++;
  }
  if (!stops) fails.push(`${label}: nothing focusable`);
  return { fails, stops };
}

const SCREENS = ['/', '/content/person', '/content/contact', '/content/sections', '/content/profile', '/content/skills',
  '/content/abilities', '/content/workstyle', '/content/principles', '/content/experience', '/content/languages',
  '/content/talk', '/content/ui', '/seo', '/revisions', '/account'];

test('E10: dom-checks on every screen at 1280 and 390 px, light and dark', { timeout: 900_000 }, async () => {
  const fails = [];
  const summary = [];
  for (const width of [1280, 390]) {
    for (const colorScheme of ['light', 'dark']) {
      const x = await h.open({ width, height: 900, colorScheme });
      const cdp = await x.context.newCDPSession(x.page);
      try {
        const at = `${width}/${colorScheme}`;
        await x.page.goto(`${h.origin}/admin/#/login`);
        await x.page.locator('main h1', { hasText: 'Sign in' }).waitFor();
        const l = await auditScreen(x.page, cdp, `${at} login`);
        fails.push(...l.fails);
        await h.login(x.page);
        for (const route of SCREENS) {
          await x.page.goto('about:blank');
          await x.page.goto(`${h.origin}/admin/#${route}`);
          await x.page.locator('main h1').first().waitFor();
          await x.page.waitForLoadState('networkidle').catch(() => {});
          await sleep(150);
          const r = await auditScreen(x.page, cdp, `${at} ${route}`);
          fails.push(...r.fails);
          summary.push(`${at} ${route}: ${r.stops} tab stops`);
        }
        // the publish dialog (the draft differs from live after E8's import)
        await x.page.goto('about:blank');
        await x.page.goto(`${h.origin}/admin/#/`);
        await x.page.locator('main h1', { hasText: 'Dashboard' }).waitFor();
        if ((await x.page.getByTestId('publish').getAttribute('aria-disabled')) !== 'true') {
          await x.page.getByTestId('publish').click();
          await x.page.getByRole('button', { name: 'Publish to samsiani.me' }).waitFor({ timeout: 15_000 });
          const d = await auditScreen(x.page, cdp, `${at} publish dialog`);
          fails.push(...d.fails);
          summary.push(`${at} publish dialog: ${d.stops} tab stops`);
          await x.page.getByRole('button', { name: 'Cancel', exact: true }).click();
        }
      } finally {
        await x.context.close();
      }
    }
  }
  if (process.env.E2E_DEBUG) console.log(summary.join('\n'));
  assert.deepEqual(fails, [], fails.join('\n'));
});

test('E11: an offline copy whose ETag no longer matches is offered at boot with Use mine, Download my copy and Discard', T, async () => {
  const x = await h.open();
  try {
    await h.login(x.page);
    const server = (await h.api(x.page, 'GET', '/draft')).json;
    const site = structuredClone(server.site);
    const marker = 'Offline copy from this device E11';
    site.hero.tagline.en = marker;
    await x.page.evaluate((v) => localStorage.setItem('sm-admin:pending', JSON.stringify(v)), { etag: 'f'.repeat(64), rev: 1, site, at: new Date().toISOString() });
    await x.page.reload();
    const title = x.page.locator('#pending-title');
    await title.waitFor({ timeout: 10_000 });
    assert.equal((await title.innerText()).trim(), `Unsaved changes from this device, based on r1; the server now has r${server.rev}`);
    for (const name of ['Use mine', 'Download my copy', 'Discard']) assert.equal(await x.page.getByRole('button', { name, exact: true }).count(), 1, name);
    const [dl] = await Promise.all([x.page.waitForEvent('download'), x.page.getByRole('button', { name: 'Download my copy', exact: true }).click()]);
    assert.equal(JSON.parse(readFileSync(await dl.path(), 'utf8')).site.hero.tagline.en, marker, 'the downloaded copy');
    assert.ok(await title.isVisible(), 'still offered after the download');
    await x.page.getByRole('button', { name: 'Use mine', exact: true }).click();
    await h.waitSaved(x.page);
    assert.equal((await h.api(x.page, 'GET', '/draft')).json.site.hero.tagline.en, marker, '"Use mine" saved the copy');
    const pre = (await h.api(x.page, 'GET', '/revisions')).json.items.filter((r) => r.reason === 'pre-overwrite');
    assert.ok(pre.length >= 1, 'the server draft stayed in Revisions');
    assert.equal(await x.page.evaluate(() => localStorage.getItem('sm-admin:pending')), null, 'the key is gone once saved');
    // "Discard" drops a stale copy and leaves the server draft alone
    const other = structuredClone(site);
    other.hero.tagline.en = 'please discard me';
    await x.page.evaluate((v) => localStorage.setItem('sm-admin:pending', JSON.stringify(v)), { etag: 'e'.repeat(64), rev: 2, site: other, at: new Date().toISOString() });
    await x.page.reload();
    await title.waitFor({ timeout: 10_000 });
    await x.page.getByRole('button', { name: 'Discard', exact: true }).click();
    await waitFor(async () => !(await title.isVisible()), { message: 'the dialog to close' });
    assert.equal(await x.page.evaluate(() => localStorage.getItem('sm-admin:pending')), null);
    assert.equal((await h.api(x.page, 'GET', '/draft')).json.site.hero.tagline.en, marker);
  } finally {
    await x.context.close();
  }
});

test('autosave on a 5xx or a network error keeps the copy on this device, retries and saves (admin-ops §6.6); Ctrl+S saves at once', T, async () => {
  const x = await h.open();
  try {
    await h.login(x.page);
    await x.page.getByRole('link', { name: 'Content' }).first().click();
    await x.page.locator('#f-hero-availability-en').waitFor();
    let mode = '503';
    await x.page.route('**/admin/api/draft', (route) => {
      if (route.request().method() !== 'PUT' || mode === 'ok') return route.continue();
      if (mode === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'degraded', message: 'Try later.' }) });
      return route.abort('internetdisconnected');
    });
    await typeAtEnd(x.page, '#f-hero-availability-en', ' (offline test)');
    const t0 = Date.now();
    await x.page.keyboard.press('Control+s');
    await waitFor(async () => /Unsaved changes, retrying/.test(await h.status(x.page)), { message: 'the retrying status' });
    assert.ok(Date.now() - t0 < 1400, 'Ctrl+S sent the save before the 1.5 s debounce');
    const copy = await x.page.evaluate(() => JSON.parse(localStorage.getItem('sm-admin:pending') || 'null'));
    assert.ok(copy?.site?.hero?.availability?.en?.endsWith('(offline test)'), 'the copy is on this device');
    mode = 'offline';
    await waitFor(async () => /Offline, kept on this device/.test(await h.status(x.page)), { timeout: 10_000, message: 'the offline status' });
    mode = 'ok';
    await h.waitSaved(x.page, 30_000);
    assert.ok(h.readData('draft.json').site.hero.availability.en.endsWith('(offline test)'), 'the retry saved it');
    assert.equal(await x.page.evaluate(() => localStorage.getItem('sm-admin:pending')), null, 'the device copy is removed after the save');
  } finally {
    await x.context.close();
  }
});

test('E12: Remove takes a single line off the page, Undo puts it back, Add back leaves an empty pair', T, async () => {
  const x = await h.open();
  try {
    await h.login(x.page);
    const before = (await h.api(x.page, 'GET', '/draft')).json.site.hero.subrole;
    await x.page.getByRole('link', { name: 'Content' }).first().click();
    await x.page.locator('#f-hero-subrole-en').waitFor();
    const t0 = Date.now();
    await x.page.getByRole('button', { name: 'Remove Subrole', exact: true }).click();
    assert.equal(await x.page.evaluate(() => document.activeElement?.textContent?.trim()), 'Add back', 'focus moves to Add back');
    await x.page.getByRole('link', { name: 'Dashboard' }).first().click();
    await h.inPreview(x.page, () => !document.querySelector('.subrole, .st-subrole, .lg-subrole'), undefined, { timeout: 5_000 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1500, `the preview dropped the line after ${elapsed} ms`);
    // the toast is still open (10 s): Undo restores the pair and focuses its EN input
    await x.page.getByRole('link', { name: 'Content' }).first().click();
    await x.page.getByText('Removed ‘Subrole’.').waitFor({ timeout: 5_000 });
    await x.page.getByRole('button', { name: 'Undo', exact: true }).click();
    await x.page.locator('#f-hero-subrole-en').waitFor();
    assert.equal(await x.page.locator('#f-hero-subrole-en').inputValue(), before.en, 'the text is back');
    assert.equal(await x.page.evaluate(() => document.activeElement?.id), 'f-hero-subrole-en', 'focus is in the EN input');
    // removed again and saved: the stored draft has null
    await x.page.getByRole('button', { name: 'Remove Subrole', exact: true }).click();
    await h.waitSaved(x.page);
    assert.equal((await h.api(x.page, 'GET', '/draft')).json.site.hero.subrole, null);
    // Add back gives an empty pair, which the form flags
    await x.page.getByRole('button', { name: 'Add back Subrole', exact: true }).click();
    await x.page.locator('#f-hero-subrole-en').waitFor();
    await waitFor(async () => (await x.page.locator('#f-hero-subrole-en').getAttribute('aria-invalid')) === 'true', { message: 'the EMPTY flag' });
    await x.page.locator('#f-hero-subrole-en').fill(before.en);
    await x.page.locator('#f-hero-subrole-ka').fill(before.ka);
    await h.waitSaved(x.page);
  } finally {
    await x.context.close();
  }
});

test('E13: hide and reorder sections with the keyboard; the published page loses the hidden one', T, async () => {
  const x = await h.open();
  try {
    await h.login(x.page);
    await x.page.goto(`${h.origin}/admin/#/content/sections`);
    await x.page.locator('main h1').first().waitFor();
    const hide = x.page.getByRole('button', { name: 'Hide ‘Experience’', exact: true });
    await hide.focus();
    await x.page.keyboard.press('Enter');
    await x.page.getByRole('button', { name: 'Show ‘Experience’', exact: true }).waitFor();
    assert.equal(await x.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Show ‘Experience’', 'focus stays on the toggle');
    assert.equal(await x.page.evaluate(() => document.activeElement?.textContent?.trim()), 'Show', 'the visible label stays short so the rows line up');
    const move = x.page.getByRole('button', { name: 'Move ‘Languages’ up', exact: true });
    await move.focus();
    await x.page.keyboard.press('Enter');
    await waitFor(async () => (await x.page.evaluate(() => document.activeElement?.closest('[data-key]')?.dataset?.key)) === 'languages', { message: 'the move' });
    assert.equal(await x.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Move ‘Languages’ up', 'focus stays on the same button of the moved row');
    // the tab list follows the order and marks the hidden section
    assert.deepEqual(
      await x.page.evaluate(() => [...document.querySelectorAll('.tabs a')].map((a) => a.innerText.trim().replace(/\s+/g, ' '))),
      ['Person & hero', 'Contact rail', 'Section order', 'Profile', 'Stack & skills', 'Abilities', 'How I work', 'Principles',
        'Languages', 'Experience · hidden', 'Let’s talk', 'Interface strings'],
    );
    await h.waitSaved(x.page);
    // the preview lists the shown sections only, in the new order, numbered 01…07
    await x.page.getByRole('link', { name: 'Dashboard' }).first().click();
    await h.inPreview(x.page, () => new Set([...document.querySelectorAll('a[data-spy]')].map((a) => a.getAttribute('href'))).size === 7, undefined, { timeout: 5_000 });
    const nav = await h.inPreview(x.page, () => {
      const first = [...document.querySelectorAll('nav')].find((n) => n.querySelector('a[data-spy]'));
      const numbered = [...document.querySelectorAll('nav')].find((n) => n.querySelector('a[data-spy] .idx, a[data-spy] .st-menu-idx, a[data-spy] .n'));
      return {
        hrefs: [...first.querySelectorAll('a[data-spy]')].map((a) => a.getAttribute('href')),
        numbers: [...numbered.querySelectorAll('a[data-spy]')].map((a) => a.querySelector('.idx, .st-menu-idx, .n').textContent),
      };
    });
    assert.deepEqual(nav.hrefs, ['#profile', '#skills', '#abilities', '#work-style', '#principles', '#languages', '#contact']);
    assert.deepEqual(nav.numbers, ['01', '02', '03', '04', '05', '06', '07']);
    // publish: the live page has no experience section and no worksFor
    await x.page.getByTestId('publish').click();
    await publishFromDialog(x.page);
    const live = h.webFile('index.html').toString('utf8');
    assert.equal(live.includes('id="experience"'), false, 'the hidden section is not on the page');
    const ld = JSON.parse(live.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal('worksFor' in ld, false, 'the structured data follows what is shown');
    // show it again and publish (the next flows expect the whole page)
    await x.page.goto(`${h.origin}/admin/#/content/sections`);
    await x.page.getByRole('button', { name: 'Show ‘Experience’', exact: true }).click();
    await h.waitSaved(x.page);
    await x.page.getByRole('link', { name: 'Dashboard' }).first().click();
    await x.page.getByTestId('publish').click();
    await publishFromDialog(x.page);
    assert.ok(h.webFile('index.html').toString('utf8').includes('id="experience"'), 'the section is back');
  } finally {
    await x.context.close();
  }
});

test('E14: the facts strip goes to zero and one Undo brings a fact back', T, async () => {
  const x = await h.open();
  try {
    await h.login(x.page);
    await x.page.goto(`${h.origin}/admin/#/content/person`);
    await x.page.locator('#f-hero-facts').waitFor();
    const remove = x.page.locator('#f-hero-facts [data-act="remove"]');
    for (let left = 4; left > 0; left--) {
      assert.equal(await remove.first().getAttribute('aria-disabled'), null, `Remove stays enabled at ${left} facts`);
      await remove.first().click();
      await waitFor(async () => (await remove.count()) === left - 1, { message: `${left - 1} facts` });
    }
    await h.waitSaved(x.page);
    assert.deepEqual((await h.api(x.page, 'GET', '/draft')).json.site.hero.facts, []);
    await x.page.getByRole('link', { name: 'Dashboard' }).first().click();
    await h.inPreview(x.page, () => !document.querySelector('.facts, .st-facts, .lg-facts'), undefined, { timeout: 5_000 });
    // the last removal is still undoable
    await x.page.getByRole('link', { name: 'Content' }).first().click();
    await x.page.locator('#f-hero-facts').waitFor();
    await x.page.getByRole('button', { name: 'Undo', exact: true }).last().click();
    await waitFor(async () => (await x.page.locator('#f-hero-facts [data-act="remove"]').count()) === 1, { message: 'the restored fact' });
    assert.equal((await x.page.locator('#f-hero-facts-max').innerText()).trim(), '1 of at most 4 facts.');
    await h.waitSaved(x.page);
  } finally {
    await x.context.close();
  }
});
