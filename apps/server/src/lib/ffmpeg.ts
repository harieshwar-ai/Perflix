import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export function spawnFfmpeg(args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

export function runFfprobe(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
