import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { db } from '../db/client.js';

const LANG_FROM_FILENAME = /\.(?<lang>[a-z]{2,3}(?:[_-][A-Z]{2})?)\.(?:srt|vtt|ass|ssa)$/i;

const insertSub = db.prepare(`
  INSERT INTO subtitles (file_id, lang, label, path, source, added_at)
  VALUES (@file_id, @lang, @label, @path, 'local', @now)
`);

const findExisting = db.prepare(`
  SELECT id FROM subtitles WHERE file_id = ? AND path = ? LIMIT 1
`);

const clearLocalForFile = db.prepare(`DELETE FROM subtitles WHERE file_id = ? AND source = 'local'`);

const SUPPORTED = new Set(['.srt', '.vtt']);

export type LocalSub = { lang: string; label: string; path: string };

/** Walk the directory containing `videoPath` for sidecar subtitle files. */
export function scanSidecars(videoPath: string): LocalSub[] {
  const dir = dirname(videoPath);
  const vidBase = basename(videoPath, extname(videoPath)).toLowerCase();
  const out: LocalSub[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (name.startsWith('.') || name.startsWith('._')) continue;
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED.has(ext)) continue;
    const lower = name.toLowerCase();
    // require it to start with the video's basename to avoid grabbing unrelated subs
    if (!lower.startsWith(vidBase)) continue;
    const match = LANG_FROM_FILENAME.exec(name);
    const lang = match?.groups?.['lang']?.toLowerCase() ?? 'und';
    const label = lang === 'und' ? name : lang;
    const abs = join(dir, name);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ lang, label, path: abs });
  }
  return out;
}

export function registerLocalSubs(fileId: number, videoPath: string): number {
  const subs = scanSidecars(videoPath);
  if (subs.length === 0) return 0;
  clearLocalForFile.run(fileId);
  const now = Date.now();
  let n = 0;
  for (const sub of subs) {
    const existing = findExisting.get(fileId, sub.path) as { id: number } | undefined;
    if (existing) continue;
    insertSub.run({ file_id: fileId, lang: sub.lang, label: sub.label, path: sub.path, now });
    n++;
  }
  return n;
}
