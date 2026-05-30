import { mkdirSync, existsSync, statSync, watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';
import { hlsCacheDir } from '../lib/paths.js';
import { spawnFfmpeg } from '../lib/ffmpeg.js';
import type { ProbeResult } from './probe.js';

export const SEG_DURATION = 6; // seconds per segment

export type Rung = '2160' | '1080' | '720' | '480' | 'src';
type JobStatus = 'starting' | 'running' | 'complete' | 'error';

type Job = {
  fileId: number;
  rung: Rung;
  dir: string;
  child: ChildProcess | null;
  status: JobStatus;
  startedAt: number;
  lastAccess: number;
  totalSegments: number;
  error?: string;
};

const jobs = new Map<string, Job>();

const RUNG_HEIGHT: Record<Rung, number | null> = {
  '2160': 2160,
  '1080': 1080,
  '720': 720,
  '480': 480,
  src: null,
};

const RUNG_VBR: Record<Rung, string> = {
  '2160': '12000k',
  '1080': '4500k',
  '720': '2500k',
  '480': '1100k',
  src: '4500k',
};

const RUNG_VMAX: Record<Rung, string> = {
  '2160': '15000k',
  '1080': '5000k',
  '720': '2800k',
  '480': '1200k',
  src: '5000k',
};

function jobKey(fileId: number, rung: Rung): string {
  return `${fileId}/${rung}`;
}

function jobDir(fileId: number, rung: Rung): string {
  return resolve(hlsCacheDir, String(fileId), rung);
}

export function getJob(fileId: number, rung: Rung): Job | undefined {
  return jobs.get(jobKey(fileId, rung));
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
  // transcode mode → choose rungs no larger than source height
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

export function startJob(
  fileId: number,
  rung: Rung,
  absPath: string,
  probe: ProbeResult,
  log: FastifyBaseLogger,
): Job {
  const key = jobKey(fileId, rung);
  const existing = jobs.get(key);
  if (existing && existing.status !== 'error') {
    existing.lastAccess = Date.now();
    return existing;
  }

  const dir = jobDir(fileId, rung);
  mkdirSync(dir, { recursive: true });

  const totalSegments = totalSegmentsFor(probe.duration);
  const job: Job = {
    fileId,
    rung,
    dir,
    child: null,
    status: 'starting',
    startedAt: Date.now(),
    lastAccess: Date.now(),
    totalSegments,
  };
  jobs.set(key, job);

  const args = buildFfmpegArgs(absPath, dir, rung, probe);
  log.info({ fileId, rung, mode: probe.mode, totalSegments }, 'starting hls job');
  log.debug({ args }, 'ffmpeg args');

  const child = spawnFfmpeg(args);
  job.child = child;
  job.status = 'running';

  let stderrBuf = '';
  child.stderr?.on('data', (d) => {
    stderrBuf += d.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  child.once('error', (err) => {
    job.status = 'error';
    job.error = String(err);
    log.error({ fileId, rung, err: String(err) }, 'ffmpeg spawn error');
  });

  child.once('close', (code) => {
    if (code === 0) {
      job.status = 'complete';
      log.info({ fileId, rung }, 'hls job complete');
    } else if (job.status !== 'error') {
      job.status = 'error';
      job.error = stderrBuf.slice(-1000);
      log.error({ fileId, rung, code, tail: job.error }, 'ffmpeg exited non-zero');
    }
    job.child = null;
  });

  return job;
}

function buildFfmpegArgs(
  input: string,
  dir: string,
  rung: Rung,
  probe: ProbeResult,
): string[] {
  const segPath = resolve(dir, 'seg_%d.ts');
  const playlist = resolve(dir, 'playlist.m3u8');
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-y'];

  // Hardware-accelerated decode where the source uses HEVC.
  if (probe.vcodec === 'hevc' || probe.vcodec === 'h265') {
    args.push('-hwaccel', 'videotoolbox');
  }
  args.push('-i', input);
  args.push('-map', '0:v:0', '-map', '0:a:0?');

  if (probe.mode === 'remux') {
    args.push('-c', 'copy');
  } else {
    // transcode video with VideoToolbox, audio with libfaac (aac native)
    const height = RUNG_HEIGHT[rung];
    if (height && probe.height && probe.height > height) {
      args.push('-vf', `scale=-2:${height}`);
    }
    args.push(
      '-c:v', 'h264_videotoolbox',
      '-b:v', RUNG_VBR[rung],
      '-maxrate', RUNG_VMAX[rung],
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-g', String(SEG_DURATION * 30), // ~keyframes per segment @ 30fps
      '-keyint_min', String(SEG_DURATION * 30),
      '-sc_threshold', '0',
    );
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  }

  args.push(
    '-f', 'hls',
    '-hls_time', String(SEG_DURATION),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segPath,
    playlist,
  );

  return args;
}

/** Wait until the segment file exists on disk (size>0) or timeout. */
export function waitForSegment(
  dir: string,
  segName: string,
  job: Job,
  timeoutMs = 30_000,
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
    if (job.status === 'error' || job.status === 'complete') {
      resolve(false);
      return;
    }

    let watcher: ReturnType<typeof fsWatch> | null = null;
    const interval = setInterval(() => {
      if (tryServe()) cleanup(true);
      if (job.status === 'error') cleanup(false);
    }, 250);
    const timeout = setTimeout(() => cleanup(false), timeoutMs);
    try {
      watcher = fsWatch(dir, () => {
        if (tryServe()) cleanup(true);
      });
    } catch {
      // dir vanished — fall back to polling only
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
  const j = jobs.get(jobKey(fileId, rung));
  if (j) j.lastAccess = Date.now();
}

export function jobExists(fileId: number, rung: Rung): boolean {
  const dir = jobDir(fileId, rung);
  if (existsSync(resolve(dir, 'seg_0.ts'))) return true;
  return jobs.has(jobKey(fileId, rung));
}
