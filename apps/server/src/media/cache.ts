import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { hlsCacheDir } from '../lib/paths.js';
import type { FastifyBaseLogger } from 'fastify';

mkdirSync(hlsCacheDir, { recursive: true });

type Entry = { path: string; size: number; atimeMs: number };

function walkDir(dir: string, out: Entry[]) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = resolve(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDir(p, out);
    else out.push({ path: p, size: st.size, atimeMs: st.atimeMs });
  }
}

/** Sweep cache; evict oldest files until total size <= HLS_CACHE_BYTES. */
export function sweepCache(log: FastifyBaseLogger): { evicted: number; bytes: number } {
  const cap = config.HLS_CACHE_BYTES;
  const all: Entry[] = [];
  walkDir(hlsCacheDir, all);
  let total = all.reduce((n, e) => n + e.size, 0);
  if (total <= cap) return { evicted: 0, bytes: 0 };
  all.sort((a, b) => a.atimeMs - b.atimeMs);
  let evicted = 0;
  let freed = 0;
  for (const e of all) {
    if (total <= cap) break;
    try {
      rmSync(e.path, { force: true });
      total -= e.size;
      freed += e.size;
      evicted++;
    } catch (err) {
      log.warn({ err: String(err), file: e.path }, 'evict failed');
    }
  }
  log.info({ evicted, freed, cap }, 'cache sweep complete');
  return { evicted, bytes: freed };
}

let timer: NodeJS.Timeout | null = null;
export function startCacheSweeper(log: FastifyBaseLogger) {
  if (timer) return;
  timer = setInterval(() => sweepCache(log), 5 * 60 * 1000).unref();
}

export function stopCacheSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}
