import {
  mkdirSync,
  existsSync,
  statSync,
  rmSync,
  readdirSync,
  watch as fsWatch,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';
import { hlsCacheDir } from '../lib/paths.js';
import { fmtSeconds, spawnFfmpeg } from '../lib/ffmpeg.js';
import { SEEK_PREROLL_SEC, segmentStartSec } from './keyframes.js';
import type { ProbeResult } from './probe.js';

export const SEG_DURATION = 4; // seconds per segment — shorter = faster first segment on transcode start

/** Invalidate on-disk HLS when the session encoding model changes. */
const SESSION_CACHE_VERSION = 8;

export type Rung = '2160' | '1080' | '720' | '480' | 'src';
type SessionStatus = 'starting' | 'running' | 'complete' | 'error' | 'cancelled';

export type TranscodeSession = {
  fileId: number;
  rung: Rung;
  dir: string;
  child: ChildProcess | null;
  status: SessionStatus;
  startedAt: number;
  lastAccess: number;
  startSegment: number;
  totalSegments: number;
  error?: string;
};

const sessions = new Map<string, TranscodeSession>();

const RUNG_HEIGHT: Record<Rung, number | null> = {
  '2160': 2160,
  '1080': 1080,
  '720': 720,
  '480': 480,
  src: null,
};

/** Target / peak video bitrates — tuned for high-quality personal streaming (not CDN-style caps). */
export const RUNG_ENCODE: Record<
  Rung,
  { vbr: string; vmax: string; bufsize: string; abr: string; bandwidth: number }
> = {
  '2160': { vbr: '22000k', vmax: '30000k', bufsize: '60000k', abr: '384k', bandwidth: 24_000_000 },
  '1080': { vbr: '12000k', vmax: '16000k', bufsize: '32000k', abr: '384k', bandwidth: 13_000_000 },
  '720': { vbr: '6000k', vmax: '8000k', bufsize: '16000k', abr: '256k', bandwidth: 6_500_000 },
  '480': { vbr: '2500k', vmax: '3500k', bufsize: '7000k', abr: '192k', bandwidth: 2_800_000 },
  src: { vbr: '12000k', vmax: '16000k', bufsize: '32000k', abr: '384k', bandwidth: 13_000_000 },
};

function sessionKey(fileId: number, rung: Rung): string {
  return `${fileId}/${rung}`;
}

function sessionDir(fileId: number, rung: Rung): string {
  return resolve(hlsCacheDir, String(fileId), rung);
}

function versionMarker(dir: string): string {
  return resolve(dir, `.session-v${SESSION_CACHE_VERSION}`);
}

function ensureCacheVersion(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (existsSync(versionMarker(dir))) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(versionMarker(dir), '');
}

function clearEncodedSegments(dir: string): void {
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('seg_') || name === 'playlist.m3u8') {
        rmSync(resolve(dir, name), { force: true });
      }
    }
  } catch {
    // best effort
  }
}

function highestEncodedSegment(dir: string): number | null {
  let max: number | null = null;
  try {
    for (const name of readdirSync(dir)) {
      const idx = parseSegmentIndex(name);
      if (idx !== null && (max === null || idx > max)) max = idx;
    }
  } catch {
    // best effort
  }
  return max;
}

export function getSession(fileId: number, rung: Rung): TranscodeSession | undefined {
  return sessions.get(sessionKey(fileId, rung));
}

/** Map probe dimensions to the highest quality tier the source supports. */
export function effectiveHeight(probe: ProbeResult): number {
  const h = probe.height ?? 0;
  const w = probe.width ?? 0;
  let tier = h;
  if (w >= 3840) tier = Math.max(tier, 2160);
  else if (w >= 1920) tier = Math.max(tier, 1080);
  else if (w >= 1280) tier = Math.max(tier, 720);
  return tier || 1080;
}

function ladderForFile(probe: ProbeResult): Rung[] {
  if (probe.mode === 'remux') return ['src'];
  const h = effectiveHeight(probe);
  const rungs: Rung[] = [];
  if (h >= 2160) rungs.push('2160');
  if (h >= 1080) rungs.push('1080');
  if (h >= 720) rungs.push('720');
  rungs.push('480');
  return rungs;
}

export function rungsFor(probe: ProbeResult): Rung[] {
  return ladderForFile(probe);
}

export function totalSegmentsFor(duration: number): number {
  return Math.max(1, Math.ceil(duration / SEG_DURATION));
}

export function parseSegmentIndex(segName: string): number | null {
  const m = /^seg_(\d+)\.ts$/.exec(segName);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function segmentIndexForTime(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds / SEG_DURATION);
}

function stopSession(session: TranscodeSession): void {
  if (session.child) {
    session.child.kill('SIGTERM');
    session.child = null;
  }
  session.status = 'cancelled';
}

function buildSessionArgs(
  input: string,
  dir: string,
  rung: Rung,
  probe: ProbeResult,
  startSegment: number,
): string[] {
  const segmentStart = segmentStartSec(startSegment);
  const coarseSec = Math.max(0, segmentStart - SEEK_PREROLL_SEC);
  const fineSec = segmentStart - coarseSec;
  const segPath = resolve(dir, 'seg_%d.ts');
  const playlist = resolve(dir, 'playlist.m3u8');

  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-y'];
  // Coarse input seek for speed, short fine seek after -i for segment-boundary accuracy + A/V sync.
  if (coarseSec > 0) args.push('-ss', fmtSeconds(coarseSec));
  if (probe.vcodec === 'hevc' || probe.vcodec === 'h265') {
    args.push('-hwaccel', 'videotoolbox');
  }
  args.push('-fflags', '+genpts', '-i', input);
  if (fineSec > 0.05) args.push('-ss', fmtSeconds(fineSec));
  args.push(
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-avoid_negative_ts',
    'make_zero',
    '-max_muxing_queue_size',
    '4096',
  );

  if (probe.mode === 'remux') {
    args.push('-c', 'copy');
  } else {
    const enc = RUNG_ENCODE[rung];
    const height = RUNG_HEIGHT[rung];
    const srcH = effectiveHeight(probe);
    if (height && srcH > height) {
      args.push('-vf', `scale=-2:${height}:flags=lanczos`);
    }
    const level = height && height >= 2160 ? '5.1' : '4.2';
    args.push(
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      enc.vbr,
      '-maxrate',
      enc.vmax,
      '-bufsize',
      enc.bufsize,
      '-profile:v',
      'high',
      '-level:v',
      level,
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'cfr',
      '-force_key_frames',
      `expr:gte(t,n_forced*${SEG_DURATION})`,
    );
    args.push(
      '-af',
      'aresample=async=1:first_pts=0',
      '-c:a',
      'aac',
      '-b:a',
      enc.abr,
      '-ac',
      '2',
    );
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(SEG_DURATION),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_type',
    'mpegts',
    '-start_number',
    String(startSegment),
    '-hls_segment_filename',
    segPath,
    playlist,
  );
  return args;
}

function startSession(
  fileId: number,
  rung: Rung,
  absPath: string,
  probe: ProbeResult,
  startSegment: number,
  log: FastifyBaseLogger,
): TranscodeSession {
  const key = sessionKey(fileId, rung);
  const existing = sessions.get(key);
  if (existing) stopSession(existing);

  const dir = sessionDir(fileId, rung);
  ensureCacheVersion(dir);
  const headSeg = resolve(dir, `seg_${startSegment}.ts`);
  const hasHead = existsSync(headSeg) && statSync(headSeg).size > 0;
  if (!hasHead) clearEncodedSegments(dir);

  const totalSegments = totalSegmentsFor(probe.duration);
  const segmentStart = segmentStartSec(startSegment);
  const session: TranscodeSession = {
    fileId,
    rung,
    dir,
    child: null,
    status: 'starting',
    startedAt: Date.now(),
    lastAccess: Date.now(),
    startSegment,
    totalSegments,
  };
  sessions.set(key, session);

  const args = buildSessionArgs(absPath, dir, rung, probe, startSegment);
  log.info(
    { fileId, rung, mode: probe.mode, startSegment, segmentStart, totalSegments },
    'starting hls session',
  );
  log.debug({ args }, 'ffmpeg session args');

  const child = spawnFfmpeg(args);
  session.child = child;
  session.status = 'running';

  let stderrBuf = '';
  child.stderr?.on('data', (d) => {
    stderrBuf += d.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  child.once('error', (err) => {
    if (session.status === 'cancelled') return;
    session.status = 'error';
    session.error = String(err);
    log.error({ fileId, rung, err: String(err) }, 'ffmpeg spawn error');
  });

  child.once('close', (code, signal) => {
    session.child = null;
    if (signal === 'SIGTERM' || session.status === 'cancelled') return;
    if (code === 0) {
      session.status = 'complete';
      log.info({ fileId, rung, startSegment }, 'hls session complete');
    } else if (session.status !== 'error') {
      session.status = 'error';
      session.error = stderrBuf.slice(-1000);
      log.error({ fileId, rung, code, tail: session.error }, 'ffmpeg session failed');
    }
  });

  return session;
}

/**
 * Ensure a continuous HLS encode session exists that will produce `segIndex`.
 * One ffmpeg process encodes forward from `startSegment` (Jellyfin/Plex model).
 */
export function ensureSession(
  fileId: number,
  rung: Rung,
  absPath: string,
  probe: ProbeResult,
  segIndex: number,
  log: FastifyBaseLogger,
): TranscodeSession {
  const key = sessionKey(fileId, rung);
  const dir = sessionDir(fileId, rung);
  ensureCacheVersion(dir);

  const session = sessions.get(key);
  const highest = highestEncodedSegment(dir);
  if (session && session.status !== 'error' && session.status !== 'cancelled') {
    const sequential =
      segIndex >= session.startSegment && (highest === null || segIndex <= highest + 1);
    if (sequential) {
      session.lastAccess = Date.now();
      return session;
    }
    stopSession(session);
  }

  return startSession(fileId, rung, absPath, probe, segIndex, log);
}

/** Start encoding early so the first segment is ready when the player requests it. */
export function prewarmPlayback(
  fileId: number,
  rung: Rung,
  absPath: string,
  probe: ProbeResult,
  startSegment: number,
  log: FastifyBaseLogger,
): void {
  ensureSession(fileId, rung, absPath, probe, startSegment, log);
}

/** Wait until the segment file exists on disk (size>0) or timeout. */
export function waitForSegment(
  dir: string,
  segName: string,
  session: TranscodeSession,
  timeoutMs = 120_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const file = `${dir}/${segName}`;
    const tryServe = () => {
      try {
        const st = statSync(file);
        if (st.isFile() && st.size > 0) {
          resolve(true);
          return true;
        }
      } catch {
        // not yet
      }
      return false;
    };
    if (tryServe()) return;
    if (session.status === 'error' || session.status === 'cancelled') {
      resolve(false);
      return;
    }

    let watcher: ReturnType<typeof fsWatch> | null = null;
    const interval = setInterval(() => {
      if (tryServe()) cleanup(true);
      if (session.status === 'error' || session.status === 'cancelled') cleanup(false);
    }, 200);
    const timeout = setTimeout(() => cleanup(false), timeoutMs);
    try {
      watcher = fsWatch(dir, () => {
        if (tryServe()) cleanup(true);
      });
    } catch {
      // fall back to polling only
    }
    const cleanup = (ok: boolean) => {
      clearTimeout(timeout);
      clearInterval(interval);
      watcher?.close();
      resolve(ok);
    };
  });
}

export function touch(fileId: number, rung: Rung) {
  const s = sessions.get(sessionKey(fileId, rung));
  if (s) s.lastAccess = Date.now();
}

export function sessionExists(fileId: number, rung: Rung): boolean {
  const dir = sessionDir(fileId, rung);
  if (existsSync(resolve(dir, 'seg_0.ts'))) return true;
  return sessions.has(sessionKey(fileId, rung));
}

/** @deprecated use sessionExists */
export function jobExists(fileId: number, rung: Rung): boolean {
  return sessionExists(fileId, rung);
}
