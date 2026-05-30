import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { artDir } from '../lib/paths.js';
import { spawnFfmpeg, fmtSeconds } from '../lib/ffmpeg.js';
import { probeAndPersist } from './probe.js';

const inflight = new Map<string, Promise<string>>();

const getFileRow = db.prepare(`
  SELECT f.id, f.path, f.duration, f.title_id, f.episode_id
  FROM files f WHERE f.id = ?
`);

const updateTitlePoster = db.prepare(`
  UPDATE titles SET poster = @poster WHERE id = @title_id AND poster IS NULL
`);

const updateTitleBackdrop = db.prepare(`
  UPDATE titles SET backdrop = @backdrop WHERE id = @title_id AND backdrop IS NULL
`);

const updateEpisodeStill = db.prepare(`
  UPDATE episodes SET still = @still WHERE id = @episode_id AND still IS NULL
`);

export type VideoArtKind = 'poster' | 'backdrop' | 'still';

export function videoArtFilename(fileId: number, kind: VideoArtKind): string {
  return `file-${fileId}-${kind}.jpg`;
}

export function videoArtPath(fileId: number, kind: VideoArtKind): string {
  return resolve(artDir, videoArtFilename(fileId, kind));
}

function pickSeekSec(duration: number): number {
  if (duration <= 0) return 0;
  if (duration <= 30) return Math.max(0, duration * 0.25);
  if (duration <= 120) return Math.min(duration - 2, duration * 0.2);
  return Math.min(duration - 5, Math.max(30, duration / 3));
}

const VF: Record<VideoArtKind, string> = {
  poster: 'scale=500:750:force_original_aspect_ratio=increase,crop=500:750',
  backdrop: 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
  still: 'scale=500:281:force_original_aspect_ratio=increase,crop=500:281',
};

function runFfmpegFrame(srcPath: string, seekSec: number, vf: string, dest: string): Promise<void> {
  return new Promise((resolveP, reject) => {
    const child = spawnFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      fmtSeconds(seekSec),
      '-i',
      srcPath,
      '-frames:v',
      '1',
      '-vf',
      vf,
      '-q:v',
      '4',
      dest,
    ]);
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveP() : reject(new Error(`ffmpeg frame ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

export async function ensureVideoArt(
  fileId: number,
  srcPath: string,
  duration: number,
  kind: VideoArtKind,
): Promise<string> {
  const name = videoArtFilename(fileId, kind);
  const dest = resolve(artDir, name);
  if (existsSync(dest)) {
    const st = statSync(dest);
    if (st.size > 0) return name;
  }
  const key = `video-art:${fileId}:${kind}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const seek = pickSeekSec(duration);
    await runFfmpegFrame(srcPath, seek, VF[kind], dest);
    return name;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Generate poster/backdrop/still from the video and fill missing DB art fields. */
export async function syncVideoArt(fileId: number, log?: FastifyBaseLogger): Promise<void> {
  const row = getFileRow.get(fileId) as
    | {
        id: number;
        path: string;
        duration: number | null;
        title_id: number | null;
        episode_id: number | null;
      }
    | undefined;
  if (!row?.path) return;

  let duration = row.duration ?? 0;
  if (duration <= 0) {
    try {
      const probed = await probeAndPersist(fileId, row.path);
      duration = probed.duration;
    } catch (err) {
      log?.warn({ err: String(err), fileId }, 'video art probe failed');
      return;
    }
  }
  if (duration <= 0) return;

  try {
    const poster = await ensureVideoArt(fileId, row.path, duration, 'poster');
    const backdrop = await ensureVideoArt(fileId, row.path, duration, 'backdrop');
    const still = await ensureVideoArt(fileId, row.path, duration, 'still');

    if (row.title_id) {
      updateTitlePoster.run({ poster, title_id: row.title_id });
      updateTitleBackdrop.run({ backdrop, title_id: row.title_id });
    }
    if (row.episode_id) {
      updateEpisodeStill.run({ still, episode_id: row.episode_id });
    }
    log?.info({ fileId, titleId: row.title_id, episodeId: row.episode_id }, 'synced video art');
  } catch (err) {
    log?.warn({ err: String(err), fileId }, 'video art generation failed');
  }
}

const allFiles = db.prepare(`
  SELECT id FROM files ORDER BY id ASC
`);

/** Backfill video-derived art for every file (fills only NULL poster/backdrop/still). */
export async function backfillVideoArt(log: FastifyBaseLogger, concurrency = 2): Promise<void> {
  const ids = (allFiles.all() as { id: number }[]).map((r) => r.id);
  if (ids.length === 0) return;
  log.info({ count: ids.length }, 'backfilling video art');
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++]!;
      await syncVideoArt(id, log);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  log.info('video art backfill complete');
}
