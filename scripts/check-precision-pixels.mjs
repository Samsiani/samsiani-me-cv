// Screenshot identity: node scripts/check-precision-pixels.mjs --baseline <dir|url> --candidate <dir|url> [--widths 390,768,1080,1440,1920]
// Full-page PNGs at height 900 in three modes (light, OS dark, ?theme=dark), EN and KA, reduced motion,
// after document.fonts.ready. Pass = byte-identical PNGs. On a mismatch the differing pixels are counted
// and both images are saved to .cache/pixels/.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { openTarget, gotoChecked, argOf } from './lib/serve-dir.mjs';

const baseline = argOf('--baseline');
const candidate = argOf('--candidate');
if (!baseline || !candidate) { console.error('usage: --baseline <dir|url> --candidate <dir|url> [--widths ...]'); process.exit(2); }
const widths = argOf('--widths', '390,768,1080,1440,1920').split(',').map(Number);
const MODES = ['light', 'os-dark', 'toggle-dark'];

const fatal = (e) => { console.error('FAIL', e.message); process.exit(1); };
const A = await openTarget(baseline).catch(fatal);
const B = await openTarget(candidate).catch(fatal);
const browser = await chromium.launch();
let same = 0;
const diffs = [];
try {
  for (const w of widths) for (const lang of ['en', 'ka']) for (const mode of MODES) {
    const shots = [];
    for (const t of [A, B]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: mode === 'os-dark' ? 'dark' : 'light' });
      const page = await ctx.newPage();
      await gotoChecked(page, `${t.url}${lang === 'ka' ? '/ka/' : '/'}${mode === 'toggle-dark' ? '?theme=dark' : ''}`);
      shots.push(await page.screenshot({ fullPage: true }));
      await ctx.close();
    }
    const label = `${w} ${lang} ${mode}`;
    if (Buffer.compare(shots[0], shots[1]) === 0) { same++; continue; }
    // count differing pixels in a page (the browser decodes the PNGs for us)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const n = await page.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = Math.max(ia.width, ib.width), H = Math.max(ia.height, ib.height);
      const data = (img) => { const c = new OffscreenCanvas(W, H), x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H).data; };
      const da = data(ia), db = data(ib);
      let d = 0; for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) d++;
      return { d, size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }, [shots[0].toString('base64'), shots[1].toString('base64')]);
    await ctx.close();
    await mkdir('.cache/pixels', { recursive: true });
    const stem = label.replace(/ /g, '-');
    await writeFile(`.cache/pixels/${stem}-baseline.png`, shots[0]);
    await writeFile(`.cache/pixels/${stem}-candidate.png`, shots[1]);
    diffs.push(`${label}: ${n.d} px (${n.size})`);
  }
} finally {
  await browser.close();
  await A.close();
  await B.close();
}
const total = same + diffs.length;
console.log(`${same}/${total} identical`);
for (const d of diffs) console.log('DIFF', d);
process.exit(diffs.length ? 1 : 0);
