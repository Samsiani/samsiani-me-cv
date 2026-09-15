// npm run dev: the admin API (npm run dev:server, :3097) and the SPA with hot reload (npm run dev:web, :5173)
// together. Lines are prefixed with their source; Ctrl+C stops both; when one exits, the other is stopped.
// Open http://localhost:5173/admin/ (Vite proxies /admin/api and /admin/preview to the service).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function run(name, script, colour) {
  const child = spawn(npm, ['run', '--silent', script], { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const tag = process.stdout.isTTY ? `\x1b[${colour}m[${name}]\x1b[0m` : `[${name}]`;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => process.stdout.write(`${tag} ${line}\n`));
  }
  child.on('exit', (code, signal) => {
    process.stdout.write(`${tag} exited (${signal || code})\n`);
    stop(code ?? 0);
  });
  children.push(child);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGINT');
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('server', 'dev:server', '36');
run('web', 'dev:web', '35');
