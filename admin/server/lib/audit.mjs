// Append-only audit log data/audit.log (JSONL, 1 MiB rotation). Never logs bodies, cookies, passwords or tokens.
import { appendFile, stat, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX = 1024 * 1024;

export function createAudit(dataDir, { clock = { now: () => Date.now() } } = {}) {
  const file = join(dataDir, 'audit.log');
  let chain = Promise.resolve();
  const write = (entry) => {
    chain = chain.then(async () => {
      try {
        const s = await stat(file).catch(() => null);
        if (s && s.size > MAX) await rename(file, file + '.1');
        await appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      } catch (e) { process.stderr.write(`audit write failed: ${e.message}\n`); }
    });
    return chain;
  };
  return {
    log(event, fields = {}) {
      const { ua, ...rest } = fields;
      return write({ t: new Date(clock.now()).toISOString(), event, ...rest, ...(ua ? { ua: String(ua).slice(0, 160) } : {}) });
    },
    async tail(limit = 50) {
      await chain;
      const text = await readFile(file, 'utf8').catch(() => '');
      return text.trim().split('\n').filter(Boolean).slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
    flush: () => chain,
  };
}

export const nullAudit = { log: async () => {}, tail: async () => [], flush: async () => {} };
