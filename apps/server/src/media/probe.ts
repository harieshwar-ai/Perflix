import { runFfprobe } from '../lib/ffmpeg.js';
import { db } from '../db/client.js';

type Stream = {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  duration?: string;
  channels?: number;
};

type Format = {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
};

export type ProbeResult = {
  container: string;
  duration: number;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  mode: 'direct' | 'remux' | 'transcode';
};

const HLS_VIDEO_CODECS = new Set(['h264']);
const HLS_AUDIO_CODECS = new Set(['aac']);
const MP4_CONTAINERS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'mp4']);

function decideMode(container: string, vcodec: string | null, acodec: string | null): ProbeResult['mode'] {
  const audioOk = !acodec || HLS_AUDIO_CODECS.has(acodec);
  const videoOk = !vcodec || HLS_VIDEO_CODECS.has(vcodec);
  if (!videoOk || !audioOk) return 'transcode';
  if (MP4_CONTAINERS.has(container)) return 'direct';
  return 'remux';
}

export async function probeFile(absPath: string): Promise<ProbeResult> {
  const { stdout, code } = await runFfprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    absPath,
  ]);
  if (code !== 0) throw new Error(`ffprobe exited ${code}`);
  const parsed = JSON.parse(stdout) as { format?: Format; streams?: Stream[] };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const container = (parsed.format?.format_name ?? 'unknown').toLowerCase();
  const duration = Number(parsed.format?.duration ?? video?.duration ?? '0') || 0;
  const vcodec = video?.codec_name ?? null;
  const acodec = audio?.codec_name ?? null;
  return {
    container,
    duration,
    vcodec,
    acodec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    mode: decideMode(container, vcodec, acodec),
  };
}

const persistProbe = db.prepare(`
  UPDATE files SET
    duration = @duration, container = @container,
    vcodec = @vcodec, acodec = @acodec,
    width = @width, height = @height,
    mode = @mode, probed_at = @now
  WHERE id = @id
`);

export async function probeAndPersist(fileId: number, absPath: string): Promise<ProbeResult> {
  const p = await probeFile(absPath);
  persistProbe.run({
    id: fileId,
    duration: p.duration,
    container: p.container,
    vcodec: p.vcodec,
    acodec: p.acodec,
    width: p.width,
    height: p.height,
    mode: p.mode,
    now: Date.now(),
  });
  return p;
}
