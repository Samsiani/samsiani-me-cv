// The page-gate matrix over every registered layout (CI entry point): node scripts/check-all.mjs
// Exits 1 on any failure and prints every failure. Plan: docs/plans/admin-layouts-palettes.md §11.
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { LAYOUTS } from '../src/layouts/index.mjs';
import { loadPalettes } from '../src/palettes.mjs';
import { upgrade } from '../src/schema/migrate.mjs';
import { canonicalize } from '../src/schema/validate.mjs';

const PIXEL_BASE = '96e784e'; // the last commit before the refactor; Precision must render identically to it
// minimal: also build and gate test/fixtures/site.minimal.json (hidden sections, no facts, removed lines);
// the layouts' own scripts assert the seed's geometry, so they are not run on it.
const TABLE = {
  precision: { nav: '.topnav', design: 'cobalt', script: null, minimal: true },
  studio: { nav: '.st-nav', design: 'lime', script: 'scripts/checks/studio.mjs', minimal: true },
  ledger: { nav: '.lg-nav', design: 'cobalt', script: 'scripts/checks/ledger.mjs', palettes: ['cobalt', 'lime', 'crimson'], minimal: true },
};
const layouts = Object.keys(LAYOUTS).filter((id) => TABLE[id]);
const palettes = loadPalettes().palettes.map((p) => p.id);
const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY || 4);
const failures = [];
let ran = 0;

const run = (label, cmd, args, env = {}) => new Promise((ok) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => {
    ran++;
    if (code !== 0) {
      failures.push(label);
      console.log(`FAIL ${label}\n${out.split('\n').filter((l) => /FAIL|error|Error/.test(l)).slice(0, 8).map((l) => '     ' + l).join('\n')}`);
    } else console.log(`ok   ${label}`);
    ok(code);
  });
});
async function pool(jobs) {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { while (queue.length) await queue.shift()(); }));
}
const node = (label, args, env) => () => run(label, 'node', args, env);
const dir = (layout, variant) => `.cache/matrix/${layout}-${variant}`;

// 1. palette gate + stylesheet greps
await run('palette contrast gate', 'node', ['src/palettes.mjs']);
const css = layouts.map((id) => `src/layouts/${id}/styles.css`);
const grepGate = (label, pattern) => {
  try { const hits = execSync(`grep -nE -- '${pattern}' ${css.join(' ')}`, { encoding: 'utf8' }); failures.push(label); console.log(`FAIL ${label}\n${hits}`); }
  catch { console.log(`ok   ${label}`); }
};
grepGate('layouts never declare palette tokens', '--(accent|on-accent|accent-ink|accent-soft|accent-line|focus)[[:space:]]*:');
grepGate('text never uses the fill token', '(^|[^-])color:[[:space:]]*var\\(--accent\\)');
grepGate('focus rings use --focus', 'outline[^;]*var\\(--accent');
grepGate('no serif display, dotted textures or radial gradients', '(^|[^-])serif|dotted|radial-gradient');
if (layouts.includes('ledger')) {
  try { const hits = execSync(`grep -nE 'border-radius:\\s*[1-9]|(^|[^-])serif|radial-gradient|dotted|box-shadow' src/layouts/ledger/styles.css`, { encoding: 'utf8' }); failures.push('ledger A12'); console.log(`FAIL ledger A12\n${hits}`); }
  catch { console.log('ok   ledger A12: no radii, shadows, serif, textures'); }
}

// 2. builds: seed for every layout x palette, stress fixture for every layout
const builds = [];
for (const id of layouts) {
  for (const pal of palettes) builds.push(node(`build ${id}-${pal}`, ['build.mjs'], { LAYOUT: id, PALETTE: pal, OUT_DIR: dir(id, pal) }));
  builds.push(node(`build ${id}-stress`, ['build.mjs'], { LAYOUT: id, SITE_JSON: 'test/fixtures/site.stress.json', OUT_DIR: dir(id, 'stress') }));
  if (TABLE[id].minimal) builds.push(node(`build ${id}-minimal`, ['build.mjs'], { LAYOUT: id, SITE_JSON: 'test/fixtures/site.minimal.json', OUT_DIR: dir(id, 'minimal') }));
}
await pool(builds);
if (failures.some((f) => f.startsWith('build '))) { console.log(`\n${failures.length} FAILED (builds broken; later gates skipped)`); process.exit(1); }

// 3-5. page gates
const jobs = [];
for (const id of layouts) {
  const t = TABLE[id];
  jobs.push(node(`${id}: page gate (${t.design})`, ['scripts/check-pages.mjs', '--dist', dir(id, t.design)]));
  jobs.push(node(`${id}: page gate (stress, no print)`, ['scripts/check-pages.mjs', '--dist', dir(id, 'stress'), '--only', 'overflow,casing,focus,names,motion']));
  jobs.push(node(`${id}: stress gate (seed)`, ['scripts/check-layout-stress.mjs', '--dist', dir(id, t.design), '--topnav', t.nav]));
  jobs.push(node(`${id}: stress gate (stress fixture)`, ['scripts/check-layout-stress.mjs', '--dist', dir(id, 'stress'), '--topnav', t.nav]));
  if (t.minimal) {
    jobs.push(node(`${id}: page gate (minimal)`, ['scripts/check-pages.mjs', '--dist', dir(id, 'minimal')]));
    jobs.push(node(`${id}: stress gate (minimal)`, ['scripts/check-layout-stress.mjs', '--dist', dir(id, 'minimal'), '--topnav', t.nav]));
  }
  for (const pal of palettes) jobs.push(node(`${id}: contrast with ${pal}`, ['scripts/check-pages.mjs', '--dist', dir(id, pal), '--only', 'contrast']));
  if (t.script) {
    for (const pal of t.palettes || [t.design]) jobs.push(node(`${id}: own checks (${pal})`, [t.script, dir(id, pal)]));
    if (id === 'studio') jobs.push(node(`${id}: own checks (stress, no print)`, [t.script, dir(id, 'stress'), '--skip', 'print']));
  }
}
await pool(jobs);

// 6. Precision pixel identity against the pre-refactor build
if (layouts.includes('precision')) {
  // site.example.json is the v1 design record: both documents are compared canonical, at the current version
  const norm = (s) => { const o = upgrade(JSON.parse(s)); delete o.settings.layout; delete o.settings.palette; return canonicalize(o); };
  const same = norm(readFileSync('src/content/site.json', 'utf8')) === norm(readFileSync('docs/plans/site.example.json', 'utf8'));
  if (!same) console.log('--   pixel identity skipped: seed differs from the base content');
  else {
    if (!existsSync('.cache/base/dist/index.html')) {
      execSync(`git worktree add --force --detach .cache/base ${PIXEL_BASE}`, { stdio: 'ignore' });
      execSync('node build.mjs', { cwd: '.cache/base', stdio: 'ignore' });
    }
    await run('precision: pixel identity with production (30 shots)', 'node', ['scripts/check-precision-pixels.mjs', '--baseline', '.cache/base/dist', '--candidate', dir('precision', 'cobalt')]);
  }
}

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : `\nALL CHECKS PASSED (${ran} runs, layouts: ${layouts.join(', ')})`);
process.exit(failures.length ? 1 : 0);
