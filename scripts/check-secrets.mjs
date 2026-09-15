// Leak check: no server details in tracked files.
//   node scripts/check-secrets.mjs
// Literals come from the DENYLIST environment variable (CI secret; one per line or comma-separated) or
// ~/.config/samsiani-me/denylist.txt (local, untracked; one per line: server IP, SSH user, unix user,
// site-home path). Also flags any IPv4 literal outside 127.0.0.1, 0.0.0.0, the 203.0.113.0/24 and
// 198.51.100.0/24 documentation ranges and Cloudflare's published ranges. Exit 1 on any hit.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22'];
const ALLOWED = ['127.0.0.1/32', '0.0.0.0/32', '203.0.113.0/24', '198.51.100.0/24', '192.0.2.0/24', ...CF_V4];
const toInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const inCidr = (ip, cidr) => { const [base, bits] = cidr.split('/'); const mask = bits === '0' ? 0 : 2 ** 32 - 2 ** (32 - Number(bits)); return (toInt(ip) & mask) >>> 0 === (toInt(base) & mask) >>> 0; };
const allowedIp = (ip) => ALLOWED.some((c) => inCidr(ip, c));

let deny = [];
let source = '';
if (process.env.DENYLIST) { deny = process.env.DENYLIST.split(/[\n,]/); source = 'DENYLIST'; }
else {
  const f = join(homedir(), '.config/samsiani-me/denylist.txt');
  if (existsSync(f)) { deny = readFileSync(f, 'utf8').split('\n'); source = f; }
}
deny = deny.map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
if (!deny.length) console.log('check-secrets: no denylist configured (DENYLIST or ~/.config/samsiani-me/denylist.txt); only the IPv4 check runs');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|webp|woff2?|ttf|otf|ico|pdf|gz|wasm)$/i.test(f) && existsSync(f));
const hits = [];
const IPV4 = /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\d.])/g;
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const lit of deny) if (line.includes(lit)) hits.push(`${f}:${i + 1}: denylisted literal (${lit.length} chars)`);
    // SVG path data is full of dotted coordinates that look like addresses; the denylist above still covers these lines
    if (/<path|\sd="|viewBox=/.test(line)) return;
    for (const m of line.matchAll(IPV4)) {
      const ip = m[1];
      const before = line[m.index - 1] || '';
      if (/[\/A-Za-z_-]/.test(before)) continue; // version strings such as Chrome/128.0.0.0
      if (allowedIp(ip)) continue;
      hits.push(`${f}:${i + 1}: IPv4 literal ${ip}`);
    }
  });
}
if (hits.length) {
  for (const h of hits) console.error('FAIL', h);
  console.error(`check-secrets: ${hits.length} hit(s)`);
  process.exit(1);
}
console.log(`check-secrets: ok (${files.length} tracked files${deny.length ? `, ${deny.length} denylisted literals from ${source}` : ''})`);
