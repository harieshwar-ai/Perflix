import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** Keg-only Homebrew build with libzimg (zscale) for HDR tone-mapping. */
const FFMPEG_FULL_MAC = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';

let resolvedBin: string | null = null;
let filterNames: Set<string> | null = null;

function candidateBins(): string[] {
  const out: string[] = [];
  const explicit = process.env.FFMPEG_PATH ?? process.env.PERFLIX_FFMPEG;
  if (explicit) out.push(explicit);
  if (process.platform === 'darwin' && existsSync(FFMPEG_FULL_MAC)) out.push(FFMPEG_FULL_MAC);
  out.push('ffmpeg');
  return [...new Set(out)];
}

function loadFilterNames(bin: string): Set<string> {
  const names = new Set<string>();
  try {
    const out = execSync(`"${bin}" -filters`, { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const m = /^\s*[TSC.]{1,3}\s+(\S+)/.exec(line);
      if (m?.[1]) names.add(m[1]!);
    }
  } catch {
    // best effort
  }
  return names;
}

function binWorks(bin: string): boolean {
  try {
    execSync(`"${bin}" -version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Resolve ffmpeg binary — prefers builds with zscale for HDR tone-mapping. */
export function resolveFfmpegBin(): string {
  if (resolvedBin) return resolvedBin;

  const candidates = candidateBins();
  let fallback = 'ffmpeg';

  for (const bin of candidates) {
    if (!binWorks(bin)) continue;
    fallback = bin;
    const filters = loadFilterNames(bin);
    if (filters.has('zscale')) {
      resolvedBin = bin;
      filterNames = filters;
      return bin;
    }
  }

  for (const bin of candidates) {
    if (!binWorks(bin)) continue;
    resolvedBin = bin;
    filterNames = loadFilterNames(bin);
    return bin;
  }

  resolvedBin = fallback;
  filterNames = new Set();
  return fallback;
}

export function resolveFfprobeBin(): string {
  const ff = resolveFfmpegBin();
  if (ff === 'ffmpeg') return 'ffprobe';
  const probe = join(dirname(ff), 'ffprobe');
  return existsSync(probe) ? probe : 'ffprobe';
}

export function ffmpegInfo(): { bin: string; ffprobe: string; zscale: boolean } {
  const bin = resolveFfmpegBin();
  return { bin, ffprobe: resolveFfprobeBin(), zscale: hasFfmpegFilter('zscale') };
}

export function spawnFfmpeg(args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(resolveFfmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Cached check for ffmpeg -filters (e.g. zscale needs libzimg). */
export function hasFfmpegFilter(name: string): boolean {
  resolveFfmpegBin();
  return filterNames?.has(name) ?? false;
}

export function runFfprobe(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfprobeBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/** Convert decimal seconds to a `HH:MM:SS.mmm` timestamp acceptable to `-ss`/`-to`. */
export function fmtSeconds(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs - h * 3600 - m * 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
