import { rungsFor, effectiveHeight, type Rung } from '../media/ladder.js';
import type { ProbeResult } from '../media/probe.js';

const RUNG_HEIGHT: Record<Rung, number> = {
  '2160': 2160,
  '1080': 1080,
  '720': 720,
  '480': 480,
  src: 0,
  'hevc-hdr': 2160,
};

export type QualityOption = {
  rung: string;
  height: number;
  label: string;
  streamUrl: string;
  bandwidth?: number;
};

export function qualitiesFor(
  fileId: number,
  mode: 'direct' | 'remux' | 'transcode',
  probe: ProbeResult,
): QualityOption[] {
  if (mode === 'direct') {
    const h = effectiveHeight(probe);
    return [
      {
        rung: 'direct',
        height: h,
        label: `${h}p`,
        streamUrl: `/stream/${fileId}`,
      },
    ];
  }

  const rungs = rungsFor(probe);
  return rungs.map((rung) => {
    const height = rung === 'src' ? effectiveHeight(probe) : RUNG_HEIGHT[rung];
    const label =
      rung === 'src' ? 'Source' : rung === 'hevc-hdr' ? '4K HDR' : `${height}p`;
    return {
      rung,
      height,
      label,
      streamUrl: `/hls/${fileId}/master.m3u8`,
    };
  });
}

/** Default to the highest available quality rung, optionally capped by profile pref. */
export function defaultQuality(
  qualities: QualityOption[],
  capRung?: string | null,
): QualityOption {
  let pool = qualities;
  if (capRung && capRung !== 'auto') {
    const cap = qualities.find((q) => q.rung === capRung);
    if (cap) {
      pool = qualities.filter((q) => q.height <= cap.height);
      if (pool.length === 0) pool = qualities;
    }
  }
  return pool.reduce((best, q) => (q.height > best.height ? q : best), pool[0]!);
}
