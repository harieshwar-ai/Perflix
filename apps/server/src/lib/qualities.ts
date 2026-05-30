import { rungsFor, effectiveHeight, type Rung } from '../media/jobs.js';
import type { ProbeResult } from '../media/probe.js';

const RUNG_HEIGHT: Record<Rung, number> = {
  '2160': 2160,
  '1080': 1080,
  '720': 720,
  '480': 480,
  src: 0,
};

export type QualityOption = {
  rung: string;
  height: number;
  label: string;
  streamUrl: string;
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
    const label = rung === 'src' ? 'Source' : `${height}p`;
    return {
      rung,
      height,
      label,
      streamUrl: `/hls/${fileId}/${rung}/playlist.m3u8`,
    };
  });
}

/** Default to the highest available quality rung. */
export function defaultQuality(qualities: QualityOption[]): QualityOption {
  return qualities.reduce((best, q) => (q.height > best.height ? q : best), qualities[0]!);
}
