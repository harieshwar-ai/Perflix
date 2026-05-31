import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { hlsCacheDir } from '../lib/paths.js';
import type { FastifyBaseLogger } from 'fastify';

mkdirSync(hlsCacheDir, { recursive: true });

type Entry = { path: string; size: number; atimeMs: number; protected: boolean };

function isProtectedPath(absPath: string): boolean {
  const rel = absPath.replace(hlsCacheDir, '').split('/').filter(Boolean);
  if (rel.length < 2) return false;
  const fileId = Number(rel[0]);
  if (!Number.isFinite(fileId)) return false;

  const file = db.prepare('SELECT pinned FROM files WHERE id = ?').get(fileId) as
    | { pinned: number }
    | undefined;
  if (file?.pinned === 1) return true;

  const renditions = db
    .prepare(
      `SELECT pinned, status FROM renditions WHERE file_id = ? AND (pinned = 1 OR status IN ('encoding','ready'))`,
    )
    .all(fileId) as Array<{ pinned: number; status: string }>;
  return renditions.some((r) => r.pinned === 1 || r.status === 'encoding');
}

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
    else out.push({ path: p, size: st.size, atimeMs: st.atimeMs, protected: isProtectedPath(p) });
  }
}

export function cacheStats(): { totalBytes: number; fileCount: number; protectedBytes: number } {
  const all: Entry[] = [];
  walkDir(hlsCacheDir, all);
  const totalBytes = all.reduce((n, e) => n + e.size, 0);
  const protectedBytes = all.filter((e) => e.protected).reduce((n, e) => n + e.size, 0);
  return { totalBytes, fileCount: all.length, protectedBytes };
}

/** Sweep cache; evict oldest unprotected files until total size <= HLS_CACHE_BYTES. */
export function sweepCache(log: FastifyBaseLogger): { evicted: number; bytes: number } {
  const cap = config.HLS_CACHE_BYTES;
  const all: Entry[] = [];
  walkDir(hlsCacheDir, all);
  let total = all.reduce((n, e) => n + e.size, 0);
  if (total <= cap) return { evicted: 0, bytes: 0 };

  const evictable = all.filter((e) => !e.protected);
  evictable.sort((a, b) => a.atimeMs - b.atimeMs);

  let evicted = 0;
  let freed = 0;
  for (const e of evictable) {
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
