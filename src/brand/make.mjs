import { chromium } from '/Users/george/Documents/codeon/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const en = (await import('../content/en.mjs')).default;
const ka = (await import('../content/ka.mjs')).default;

const b = await chromium.launch();

// ---- OG images (1200x630) ----
for (const c of [en, ka]) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('file://' + join(here, 'og.html'), { waitUntil: 'load' });
  await p.evaluate(({ c, isKa }) => {
    if (isKa) document.body.classList.add('ka');
    document.getElementById('eyebrow').textContent = c.hero.eyebrow;
    document.getElementById('name').innerHTML = c.hero.name.split(' ').join('<br>');
    document.getElementById('role').textContent = c.hero.role;
    document.getElementById('sub').textContent = c.hero.subrole;
    document.getElementById('facts').innerHTML = c.hero.facts
      .map((f) => `<div class="f"><div class="fv">${f.value}</div><div class="fl">${f.label}</div></div>`).join('');
  }, { c: JSON.parse(JSON.stringify(c)), isKa: c.lang === 'ka' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(here, '..', `og-${c.lang}.png`) });
  await ctx.close();
}

// ---- icons ----
const ctx = await b.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto('file://' + join(here, 'icon.html'), { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(150);
await p.screenshot({ path: join(here, 'icon-512.png') });
for (const size of [180, 192, 32]) {
  await p.setViewportSize({ width: size, height: size });
  await p.evaluate((s) => {
    document.documentElement.style.width = document.documentElement.style.height = s + 'px';
    document.body.style.width = document.body.style.height = s + 'px';
    document.querySelector('.g').style.fontSize = Math.round(s * 0.453) + 'px';
    document.querySelector('.g').style.top = -Math.round(s * 0.012) + 'px';
    document.querySelector('.bar').style.height = Math.max(2, Math.round(s * 0.066)) + 'px';
  }, size);
  await p.waitForTimeout(80);
  await p.screenshot({ path: join(here, `icon-${size}.png`) });
}
await ctx.close();
await b.close();
console.log('brand assets rendered');
