// Ledger's print running footer is written into a <style> element: admin text must not break out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../../src/render.mjs';
import { LAYOUTS } from '../../src/layouts/index.mjs';
import { localize, siteContext } from '../../src/shared/localize.mjs';
import { seed, renderArgs } from './_helpers.mjs';

test('the seed gives the exact running footer', () => {
  const html = renderSite(seed(), renderArgs('ledger'))['index.html'];
  assert.ok(html.includes('<style media="print">@page{@bottom-left{content:"Giorgi Samsiani · samsiani.me"}}</style>'));
});

test('a family name with </style><script> cannot escape the style element', () => {
  const s = seed();
  s.person.familyName.en = 'X</style><script>';
  const c = localize(s, 'en');
  const out = LAYOUTS.ledger.meta.headExtra(c, siteContext(s));
  assert.ok(out.includes('\\3C /style>'), out);
  assert.ok(!out.includes('</style><script>'), out);
  const html = renderSite(s, renderArgs('ledger'))['index.html'];
  assert.ok(!html.includes('</style><script>'));
});

test('robots.txt stays open for crawlers', () => {
  const out = renderSite(seed(), renderArgs('ledger'));
  assert.match(out['robots.txt'], /Allow: \//);
});
