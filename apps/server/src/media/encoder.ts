import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';
import { spawnFfmpeg, hasFfmpegFilter } from '../lib/ffmpeg.js';
import {
  SEG_DURATION,
  RUNG_ENCODE,
  RUNG_HEIGHT,
  type Rung,
  effectiveHeight,
} from './ladder.js';
import type { AudioStreamInfo, ProbeResult } from './probe.js';
import {
  completeAudioRendition,
  completeVideoRendition,
  dirBytes,
  ensureAudioRendition,
  ensureVideoRendition,
  failAudioRendition,
  failVideoRendition,
  renditionDir,
  setAudioProgress,
  setVideoProgress,
} from './renditions.js';

const ENCODE_CACHE_VERSION = 3;

function versionMarker(dir: string): string {
  return resolve(dir, `.encode-v${ENCODE_CACHE_VERSION}`);
}

function ensureEncodeDir(dir: string): void {
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

function parseFfmpegTime(stderr: string): number | null {
  const m = /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function finalizePlaylist(playlistPath: string): void {
  if (!existsSync(playlistPath)) return;
  let text = readFileSync(playlistPath, 'utf8');
  text = text.replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
  if (!text.includes('#EXT-X-ENDLIST')) text = text.trimEnd() + '\n#EXT-X-ENDLIST\n';
  writeFileSync(playlistPath, text);
}

function highestSegmentIndex(dir: string): number {
  let max = -1;
  try {
    for (const name of readdirSync(dir)) {
      const m = /^seg_(\d+)\.m4s$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    // missing
  }
  return max;
}

function buildVideoFilter(
  probe: ProbeResult,
  rung: Rung,
): { vf: string | null; toneMapOnCpu: boolean } {
  const parts: string[] = [];
  let toneMapOnCpu = false;

  if (probe.hdr && rung !== 'hevc-hdr') {
    toneMapOnCpu = true;
    if (hasFfmpegFilter('zscale')) {
      parts.push(
        'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p',
      );
    } else {
      // Approximate PQ→SDR when ffmpeg lacks libzimg (brew install ffmpeg-full).
      parts.push('eq=gamma=0.45:contrast=1.15:brightness=0.12:saturation=1.25');
    }
  }

  const height = RUNG_HEIGHT[rung];
  const srcH = effectiveHeight(probe);
  if (height && srcH > height) {
    parts.push(`scale=-2:${height}:flags=lanczos`);
  }
  if (parts.length === 0) return { vf: null, toneMapOnCpu: false };
  if (!parts.some((p) => p.includes('format=yuv420p'))) {
    parts.push('format=yuv420p');
  }
  return { vf: parts.join(','), toneMapOnCpu };
}

function sdrColorTags(args: string[]): void {
  args.push(
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
  );
}

function buildVideoEncodeArgs(
  input: string,
  dir: string,
  rung: Rung,
  probe: ProbeResult,
  audioStreamIndex: number,
): string[] {
  const playlist = resolve(dir, 'playlist.m3u8');
  const segPath = resolve(dir, 'seg_%d.m4s');
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-y'];

  const { vf, toneMapOnCpu } = buildVideoFilter(probe, rung);
  const hevc = probe.vcodec === 'hevc' || probe.vcodec === 'h265';
  if (hevc && !toneMapOnCpu) {
    args.push('-hwaccel', 'videotoolbox');
  }
  args.push('-fflags', '+genpts', '-i', input);

  if (probe.mode === 'remux') {
    args.push('-map', '0:v:0', '-map', `0:a:${audioStreamIndex}?`, '-c', 'copy');
  } else {
    args.push('-map', '0:v:0');
    if (vf) args.push('-vf', vf);

    if (rung === 'hevc-hdr') {
      args.push(
        '-c:v',
        'hevc_videotoolbox',
        '-tag:v',
        'hvc1',
        '-profile:v',
        'main10',
        '-pix_fmt',
        'yuv420p10le',
      );
    } else {
      const enc = RUNG_ENCODE[rung];
      const height = RUNG_HEIGHT[rung];
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
      );
      sdrColorTags(args);
    }
    args.push('-fps_mode', 'cfr', '-force_key_frames', `expr:gte(t,n_forced*${SEG_DURATION})`);

    const enc = RUNG_ENCODE[rung];
    args.push(
      '-map',
      `0:a:${audioStreamIndex}?`,
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
    'event',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    segPath,
    playlist,
  );
  return args;
}

function buildAudioEncodeArgs(
  input: string,
  dir: string,
  audio: AudioStreamInfo,
  passthrough: boolean,
): string[] {
  const playlist = resolve(dir, 'playlist.m3u8');
  const segPath = resolve(dir, 'seg_%d.m4s');
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-y'];
  args.push('-fflags', '+genpts', '-i', input);
  args.push('-map', `0:a:${audio.index}?`);

  if (passthrough && (audio.codec === 'aac' || audio.codec === 'eac3' || audio.codec === 'ac3')) {
    args.push('-c:a', 'copy');
  } else {
    args.push('-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '384k', '-ac', '2');
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(SEG_DURATION),
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    segPath,
    playlist,
  );
  return args;
}

function runFfmpegEncode(
  args: string[],
  duration: number,
  onProgress: (pct: number) => void,
  log: FastifyBaseLogger,
  label: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnFfmpeg(args);
    let stderrBuf = '';
    let lastPct = 0;

    const tick = () => {
      const t = parseFfmpegTime(stderrBuf);
      if (t !== null && duration > 0) {
        const pct = Math.min(99, (t / duration) * 100);
        if (pct - lastPct >= 0.5) {
          lastPct = pct;
          onProgress(pct);
        }
      }
    };

    child.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
      tick();
    });

    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} ffmpeg exited ${code}: ${stderrBuf.slice(-800)}`));
    });
  });
}

export async function encodeVideoRung(
  fileId: number,
  absPath: string,
  probe: ProbeResult,
  rung: Rung,
  log: FastifyBaseLogger,
): Promise<void> {
  const dir = renditionDir(fileId, rung);
  ensureEncodeDir(dir);

  const height = RUNG_HEIGHT[rung] ?? effectiveHeight(probe);
  const width = rung === 'src' ? probe.width : null;
  const codec = rung === 'hevc-hdr' ? 'hvc1' : rung === 'src' && probe.mode === 'remux' ? 'avc1' : 'avc1';
  ensureVideoRendition(fileId, rung, {
    codec,
    width,
    height,
    hdr: rung === 'hevc-hdr',
    status: 'encoding',
  });
  setVideoProgress(fileId, rung, 0, 'encoding');

  const existing = shouldReuseRendition(dir, probe.duration);
  if (existing) {
    completeVideoRendition(fileId, rung, RUNG_ENCODE[rung].bandwidth);
    return;
  }

  const args = buildVideoEncodeArgs(absPath, dir, rung, probe, 0);
  log.info({ fileId, rung, mode: probe.mode }, 'encoding video rung');

  try {
    await runFfmpegEncode(
      args,
      probe.duration,
      (pct) => setVideoProgress(fileId, rung, pct, 'encoding'),
      log,
      `video/${rung}`,
    );
    finalizePlaylist(resolve(dir, 'playlist.m3u8'));
    completeVideoRendition(fileId, rung, RUNG_ENCODE[rung].bandwidth);
    log.info({ fileId, rung, bytes: dirBytes(dir) }, 'video rung ready');
  } catch (err) {
    const msg = String(err);
    failVideoRendition(fileId, rung, msg);
    log.error({ fileId, rung, err: msg }, 'video rung failed');
    throw err;
  }
}

export async function encodeAudioRendition(
  fileId: number,
  absPath: string,
  probe: ProbeResult,
  audio: AudioStreamInfo,
  log: FastifyBaseLogger,
): Promise<void> {
  const lang = audio.lang ?? `track${audio.index}`;
  const dir = resolve(renditionDir(fileId, 'audio'), lang);
  ensureEncodeDir(dir);

  const passthrough = audio.channels > 2;
  const rung = passthrough ? 'surround' : 'stereo';
  ensureAudioRendition(fileId, rung, lang, audio.label ?? lang, passthrough ? audio.codec : 'aac');
  setAudioProgress(fileId, rung, lang, 0, 'encoding');

  const args = buildAudioEncodeArgs(absPath, dir, audio, passthrough);
  log.info({ fileId, lang, rung, passthrough }, 'encoding audio rendition');

  try {
    await runFfmpegEncode(
      args,
      probe.duration,
      (pct) => setAudioProgress(fileId, rung, lang, pct, 'encoding'),
      log,
      `audio/${lang}`,
    );
    finalizePlaylist(resolve(dir, 'playlist.m3u8'));
    completeAudioRendition(fileId, rung, lang);
  } catch (err) {
    failAudioRendition(fileId, rung, lang, String(err));
    log.warn({ fileId, lang, err: String(err) }, 'audio rendition failed');
  }
}

function getReadyIfComplete(dir: string, duration: number): boolean {
  const pl = resolve(dir, 'playlist.m3u8');
  if (!existsSync(pl)) return false;
  const text = readFileSync(pl, 'utf8');
  if (!text.includes('#EXT-X-ENDLIST')) return false;
  const init = resolve(dir, 'init.mp4');
  if (!existsSync(init) || statSync(init).size <= 0) return false;
  const segs = highestSegmentIndex(dir);
  const expected = Math.max(0, Math.ceil(duration / SEG_DURATION) - 1);
  return segs >= expected;
}

/** True when on-disk cache matches the current encode model and is fully written. */
export function shouldReuseRendition(dir: string, duration: number): boolean {
  if (!existsSync(versionMarker(dir))) return false;
  return getReadyIfComplete(dir, duration);
}

export function readyThroughSec(dir: string, duration: number): number {
  const idx = highestSegmentIndex(dir);
  if (idx < 0) return 0;
  return Math.min(duration, (idx + 1) * SEG_DURATION);
}

export function waitForSegmentFile(
  filePath: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const check = () => {
      try {
        const st = statSync(filePath);
        if (st.isFile() && st.size > 0) {
          resolvePromise(true);
          return;
        }
      } catch {
        // not yet
      }
      if (Date.now() - start >= timeoutMs) {
        resolvePromise(false);
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

export type { ChildProcess };
