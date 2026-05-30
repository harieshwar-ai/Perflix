import { SEG_DURATION, type Rung, totalSegmentsFor } from './jobs.js';
import type { ProbeResult } from './probe.js';

const RUNG_BW: Record<Rung, number> = {
  '2160': 14_000_000,
  '1080': 4_700_000,
  '720': 2_700_000,
  '480': 1_200_000,
  src: 6_000_000,
};

const RUNG_RES: Record<Rung, [number, number] | null> = {
  '2160': [3840, 2160],
  '1080': [1920, 1080],
  '720': [1280, 720],
  '480': [854, 480],
  src: null,
};

const CODEC_STRING = 'avc1.640028,mp4a.40.2';

export function buildMasterPlaylist(fileId: number, rungs: Rung[], probe: ProbeResult): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:6'];
  for (const rung of rungs) {
    const [w, h] = RUNG_RES[rung] ?? [probe.width ?? 0, probe.height ?? 0];
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${RUNG_BW[rung]},RESOLUTION=${w}x${h},CODECS="${CODEC_STRING}"`,
      `${rung}/playlist.m3u8`,
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Synthesize the media playlist from duration. Each segment is exactly
 * SEG_DURATION seconds except the final one (which is the remainder).
 * This matches what ffmpeg's HLS muxer emits, so the file content matches
 * what ffmpeg writes once complete.
 */
export function buildMediaPlaylist(probe: ProbeResult): string {
  const total = totalSegmentsFor(probe.duration);
  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${SEG_DURATION + 1}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  for (let i = 0; i < total; i++) {
    const segLen = i === total - 1 ? Math.max(0.1, probe.duration - i * SEG_DURATION) : SEG_DURATION;
    lines.push(`#EXTINF:${segLen.toFixed(3)},`, `seg_${i}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}
