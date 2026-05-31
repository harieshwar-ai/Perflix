import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/client.js';
import { hlsCacheDir } from '../lib/paths.js';
import type { Rung } from './ladder.js';

export type RenditionStatus = 'pending' | 'encoding' | 'ready' | 'failed';

export type RenditionRow = {
  id: number;
  file_id: number;
  kind: 'video' | 'audio' | 'sub';
  rung: string;
  lang: string | null;
  label: string | null;
  codec: string | null;
  container: string | null;
  status: RenditionStatus;
  progress_pct: number;
  playlist_path: string | null;
  init_path: string | null;
  bytes: number;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  hdr: number;
  pinned: number;
  error: string | null;
  updated_at: number;
};

const findVideo = db.prepare(`
  SELECT * FROM renditions
  WHERE file_id = ? AND kind = 'video' AND rung = ? AND lang IS NULL
`);

const listVideo = db.prepare(`
  SELECT * FROM renditions
  WHERE file_id = ? AND kind = 'video' AND lang IS NULL
  ORDER BY height DESC, rung DESC
`);

const listAudio = db.prepare(`
  SELECT * FROM renditions
  WHERE file_id = ? AND kind = 'audio'
  ORDER BY lang ASC, id ASC
`);

const upsertVideo = db.prepare(`
  INSERT INTO renditions (
    file_id, kind, rung, lang, label, codec, container, status, progress_pct,
    playlist_path, init_path, bytes, bandwidth, width, height, hdr, pinned, error, updated_at
  ) VALUES (
    @file_id, 'video', @rung, NULL, NULL, @codec, 'fmp4', @status, @progress_pct,
    @playlist_path, @init_path, @bytes, @bandwidth, @width, @height, @hdr, 0, NULL, @now
  )
  ON CONFLICT(file_id, kind, rung, lang) DO UPDATE SET
    status = excluded.status,
    progress_pct = excluded.progress_pct,
    playlist_path = excluded.playlist_path,
    init_path = excluded.init_path,
    bytes = excluded.bytes,
    bandwidth = excluded.bandwidth,
    width = excluded.width,
    height = excluded.height,
    hdr = excluded.hdr,
    error = NULL,
    updated_at = excluded.updated_at
`);

const upsertAudio = db.prepare(`
  INSERT INTO renditions (
    file_id, kind, rung, lang, label, codec, container, status, progress_pct,
    playlist_path, init_path, bytes, bandwidth, width, height, hdr, pinned, error, updated_at
  ) VALUES (
    @file_id, 'audio', @rung, @lang, @label, @codec, 'fmp4', @status, @progress_pct,
    @playlist_path, @init_path, @bytes, @bandwidth, NULL, NULL, 0, 0, NULL, @now
  )
  ON CONFLICT(file_id, kind, rung, lang) DO UPDATE SET
    status = excluded.status,
    progress_pct = excluded.progress_pct,
    playlist_path = excluded.playlist_path,
    init_path = excluded.init_path,
    bytes = excluded.bytes,
    label = excluded.label,
    codec = excluded.codec,
    error = NULL,
    updated_at = excluded.updated_at
`);

const updateProgress = db.prepare(`
  UPDATE renditions SET
    status = @status,
    progress_pct = @progress_pct,
    bytes = @bytes,
    updated_at = @now
  WHERE file_id = @file_id AND kind = @kind AND rung = @rung
    AND ((@lang IS NULL AND lang IS NULL) OR lang = @lang)
`);

const markReady = db.prepare(`
  UPDATE renditions SET
    status = 'ready',
    progress_pct = 100,
    bytes = @bytes,
    bandwidth = @bandwidth,
    playlist_path = @playlist_path,
    init_path = @init_path,
    updated_at = @now
  WHERE file_id = @file_id AND kind = @kind AND rung = @rung
    AND ((@lang IS NULL AND lang IS NULL) OR lang = @lang)
`);

const markFailed = db.prepare(`
  UPDATE renditions SET status = 'failed', error = @error, updated_at = @now
  WHERE file_id = @file_id AND kind = @kind AND rung = @rung
    AND ((@lang IS NULL AND lang IS NULL) OR lang = @lang)
`);

const setPinned = db.prepare(`
  UPDATE renditions SET pinned = @pinned, updated_at = @now WHERE file_id = ?
`);

export function renditionDir(fileId: number, rung: string): string {
  return resolve(hlsCacheDir, String(fileId), rung);
}

export function dirBytes(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      try {
        const st = statSync(resolve(dir, name));
        if (st.isFile()) total += st.size;
      } catch {
        // skip
      }
    }
  } catch {
    // missing dir
  }
  return total;
}

export function getVideoRendition(fileId: number, rung: Rung): RenditionRow | undefined {
  return findVideo.get(fileId, rung) as RenditionRow | undefined;
}

export function listVideoRenditions(fileId: number): RenditionRow[] {
  return listVideo.all(fileId) as RenditionRow[];
}

export function listAudioRenditions(fileId: number): RenditionRow[] {
  return listAudio.all(fileId) as RenditionRow[];
}

export function ensureVideoRendition(
  fileId: number,
  rung: Rung,
  opts: {
    codec: string;
    width: number | null;
    height: number | null;
    hdr?: boolean;
    status?: RenditionStatus;
  },
): void {
  const dir = renditionDir(fileId, rung);
  const enc = opts;
  upsertVideo.run({
    file_id: fileId,
    rung,
    codec: enc.codec,
    status: enc.status ?? 'pending',
    progress_pct: 0,
    playlist_path: resolve(dir, 'playlist.m3u8'),
    init_path: resolve(dir, 'init.mp4'),
    bytes: 0,
    bandwidth: null,
    width: enc.width,
    height: enc.height,
    hdr: enc.hdr ? 1 : 0,
    now: Date.now(),
  });
}

export function ensureAudioRendition(
  fileId: number,
  rung: string,
  lang: string,
  label: string,
  codec: string,
): void {
  const dir = resolve(hlsCacheDir, String(fileId), 'audio', lang);
  upsertAudio.run({
    file_id: fileId,
    rung,
    lang,
    label,
    codec,
    status: 'pending',
    progress_pct: 0,
    playlist_path: resolve(dir, 'playlist.m3u8'),
    init_path: resolve(dir, 'init.mp4'),
    bytes: 0,
    now: Date.now(),
  });
}

export function setVideoProgress(
  fileId: number,
  rung: Rung,
  progressPct: number,
  status: RenditionStatus,
): void {
  const dir = renditionDir(fileId, rung);
  updateProgress.run({
    file_id: fileId,
    kind: 'video',
    rung,
    lang: null,
    status,
    progress_pct: Math.min(100, Math.max(0, progressPct)),
    bytes: dirBytes(dir),
    now: Date.now(),
  });
}

export function setAudioProgress(
  fileId: number,
  rung: string,
  lang: string,
  progressPct: number,
  status: RenditionStatus,
): void {
  const dir = resolve(hlsCacheDir, String(fileId), 'audio', lang);
  updateProgress.run({
    file_id: fileId,
    kind: 'audio',
    rung,
    lang,
    status,
    progress_pct: Math.min(100, Math.max(0, progressPct)),
    bytes: dirBytes(dir),
    now: Date.now(),
  });
}

export function completeVideoRendition(
  fileId: number,
  rung: Rung,
  bandwidth: number,
): void {
  const dir = renditionDir(fileId, rung);
  markReady.run({
    file_id: fileId,
    kind: 'video',
    rung,
    lang: null,
    bytes: dirBytes(dir),
    bandwidth,
    playlist_path: resolve(dir, 'playlist.m3u8'),
    init_path: resolve(dir, 'init.mp4'),
    now: Date.now(),
  });
}

export function completeAudioRendition(fileId: number, rung: string, lang: string): void {
  const dir = resolve(hlsCacheDir, String(fileId), 'audio', lang);
  markReady.run({
    file_id: fileId,
    kind: 'audio',
    rung,
    lang,
    bytes: dirBytes(dir),
    bandwidth: null,
    playlist_path: resolve(dir, 'playlist.m3u8'),
    init_path: resolve(dir, 'init.mp4'),
    now: Date.now(),
  });
}

export function failVideoRendition(fileId: number, rung: Rung, error: string): void {
  markFailed.run({ file_id: fileId, kind: 'video', rung, lang: null, error, now: Date.now() });
}

export function failAudioRendition(fileId: number, rung: string, lang: string, error: string): void {
  markFailed.run({ file_id: fileId, kind: 'audio', rung, lang, error, now: Date.now() });
}

export function pinFileRenditions(fileId: number, pinned: boolean): void {
  setPinned.run({ file_id: fileId, pinned: pinned ? 1 : 0, now: Date.now() });
}

export function aggregateEncodeProgress(fileId: number): {
  progressPct: number;
  status: RenditionStatus | 'mixed';
  allReady: boolean;
} {
  const rows = listVideoRenditions(fileId);
  if (rows.length === 0) return { progressPct: 0, status: 'pending', allReady: false };
  const ready = rows.every((r) => r.status === 'ready');
  if (ready) return { progressPct: 100, status: 'ready', allReady: true };
  const max = Math.max(...rows.map((r) => r.progress_pct));
  const anyEncoding = rows.some((r) => r.status === 'encoding');
  const anyFailed = rows.some((r) => r.status === 'failed');
  const status = anyFailed ? 'failed' : anyEncoding ? 'encoding' : 'pending';
  return { progressPct: max, status, allReady: false };
}
