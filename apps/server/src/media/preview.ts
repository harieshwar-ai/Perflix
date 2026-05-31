import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnFfmpeg, fmtSeconds } from '../lib/ffmpeg.js';
import { previewDir, thumbsDir } from '../lib/paths.js';

mkdirSync(previewDir, { recursive: true });
mkdirSync(thumbsDir, { recursive: true });

const inflight = new Map<string, Promise<void>>();

function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p as unknown as Promise<void>);
  return p;
}

function run(cmd: string[]): Promise<void> {
  return new Promise((resolveP, reject) => {
    const child = spawnFfmpeg(cmd);
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveP() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

export function previewPath(fileId: number): string {
  return resolve(previewDir, `${fileId}.mp4`);
}

export async function ensurePreview(fileId: number, srcPath: string, duration: number): Promise<string> {
  const dest = previewPath(fileId);
  if (existsSync(dest)) {
    const st = statSync(dest);
    if (st.size > 0) return dest;
  }
  await coalesce(`preview:${fileId}`, async () => {
    const start = duration > 60 ? Math.max(30, duration / 3) : 0;
    const clipLen = duration > 30 ? 10 : Math.max(2, Math.floor(duration / 2));
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', fmtSeconds(start),
      '-i', srcPath,
      '-t', String(clipLen),
      '-vf', 'scale=-2:480',
      '-an',
      '-c:v', 'h264_videotoolbox',
      '-b:v', '800k',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      dest,
    ]);
  });
  return dest;
}

export type ThumbMeta = {
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  count: number;
  intervalSec: number;
  duration: number;
};

const TILE_W = 240;
const TARGET_THUMBS = 120;
const COLS = 10;

export function thumbsSpritePath(fileId: number): string {
  return resolve(thumbsDir, `${fileId}.jpg`);
}

export function thumbsMetaPath(fileId: number): string {
  return resolve(thumbsDir, `${fileId}.json`);
}

export function computeThumbMeta(
  duration: number,
  srcWidth: number | null,
  srcHeight: number | null,
): ThumbMeta {
  const intervalSec = Math.max(2, Math.floor(duration / TARGET_THUMBS) || 1);
  const count = Math.min(TARGET_THUMBS, Math.max(1, Math.floor(duration / intervalSec)));
  const cols = Math.min(COLS, count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const aspect = srcWidth && srcHeight ? srcWidth / srcHeight : 16 / 9;
  const tileHeight = Math.round(TILE_W / aspect);
  return {
    tileWidth: TILE_W,
    tileHeight,
    cols,
    rows,
    count,
    intervalSec,
    duration,
  };
}

function generateScrubSprite(
  fileId: number,
  srcPath: string,
  duration: number,
  srcWidth: number | null,
  srcHeight: number | null,
): Promise<ThumbMeta> {
  return coalesce(`thumbs:${fileId}`, async () => {
    const sprite = thumbsSpritePath(fileId);
    const metaFile = thumbsMetaPath(fileId);
    const meta = computeThumbMeta(duration, srcWidth, srcHeight);
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', srcPath,
      '-vf', `fps=1/${meta.intervalSec},scale=${TILE_W}:-1,tile=${meta.cols}x${meta.rows}`,
      '-frames:v', '1',
      '-q:v', '4',
      sprite,
    ]);
    await writeFile(metaFile, JSON.stringify(meta));
    return meta;
  });
}

/** Returns meta immediately; generates the sprite in the background when missing. */
export async function ensureScrubSprite(
  fileId: number,
  srcPath: string,
  duration: number,
  srcWidth: number | null,
  srcHeight: number | null,
): Promise<ThumbMeta> {
  const sprite = thumbsSpritePath(fileId);
  const metaFile = thumbsMetaPath(fileId);
  if (existsSync(sprite) && existsSync(metaFile)) {
    return JSON.parse(await readFile(metaFile, 'utf8')) as ThumbMeta;
  }
  void generateScrubSprite(fileId, srcPath, duration, srcWidth, srcHeight).catch(() => {});
  return computeThumbMeta(duration, srcWidth, srcHeight);
}
