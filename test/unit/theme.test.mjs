import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTheme, themeInitScript } from '../../src/shared/theme-init.mjs';
import { renderSite } from '../../src/render.mjs';
import { seed, renderArgs } from './_helpers.mjs';

const precision = { id: 'precision' };
const studio = { id: 'studio', defaultTheme: 'dark' };

test('effective theme precedence', () => {
  assert.equal(effectiveTheme('system', precision), 'system');
  assert.equal(effectiveTheme('light', precision), 'light');
  assert.equal(effectiveTheme('dark', precision), 'dark');
  assert.equal(effectiveTheme('system', studio), 'dark');
  assert.equal(effectiveTheme('light', studio), 'light');
});

// The script shipped in production before the refactor (commit 96e784e), byte for byte.
const PRODUCTION_SCRIPT = `<script>(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('theme');var m=location.search.match(/[?&]theme=(light|dark)/);if(m){t=m[1]}if(t==='dark'||t==='light'){d.dataset.theme=t}}catch(e){}})();</script>`;

test('the "system" init script is byte-identical to production', () => {
  assert.equal(themeInitScript('system'), PRODUCTION_SCRIPT);
});

test('an explicit default theme is baked into the script and the html element', () => {
  assert.match(themeInitScript('dark'), /t='dark'/);
  const s = seed();
  s.settings.defaultTheme = 'dark';
  const html = renderSite(s, renderArgs('precision'))['index.html'];
  assert.match(html, /<html [^>]*data-theme="dark"/);
  const metas = html.match(/<meta name="theme-color"[^>]*>/g);
  assert.equal(metas.length, 1);
  assert.ok(!metas[0].includes('media='));
});

test('"system" keeps the prefers-color-scheme theme-color pair', () => {
  const html = renderSite(seed(), renderArgs('precision'))['index.html'];
  const metas = html.match(/<meta name="theme-color"[^>]*>/g);
  assert.equal(metas.length, 2);
  assert.ok(metas.every((m) => m.includes('media="(prefers-color-scheme:')));
  assert.doesNotMatch(html, /<html [^>]*data-theme=/);
});
