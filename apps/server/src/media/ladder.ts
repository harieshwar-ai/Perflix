import type { ProbeResult } from './probe.js';

export const SEG_DURATION = 4;

export type Rung = '2160' | '1080' | '720' | '480' | 'src' | 'hevc-hdr';

export const RUNG_HEIGHT: Record<Rung, number | null> = {
  '2160': 2160,
  '1080': 1080,
  '720': 720,
  '480': 480,
  src: null,
  'hevc-hdr': 2160,
};

/** Target / peak video bitrates for personal streaming. */
export const RUNG_ENCODE: Record<
  Rung,
  { vbr: string; vmax: string; bufsize: string; abr: string; bandwidth: number }
> = {
  '2160': { vbr: '22000k', vmax: '30000k', bufsize: '60000k', abr: '384k', bandwidth: 24_000_000 },
  '1080': { vbr: '12000k', vmax: '16000k', bufsize: '32000k', abr: '384k', bandwidth: 13_000_000 },
  '720': { vbr: '6000k', vmax: '8000k', bufsize: '16000k', abr: '256k', bandwidth: 6_500_000 },
  '480': { vbr: '2500k', vmax: '3500k', bufsize: '7000k', abr: '192k', bandwidth: 2_800_000 },
  src: { vbr: '12000k', vmax: '16000k', bufsize: '32000k', abr: '384k', bandwidth: 13_000_000 },
  'hevc-hdr': { vbr: '28000k', vmax: '40000k', bufsize: '80000k', abr: '384k', bandwidth: 30_000_000 },
};

export const RUNG_RES: Record<Rung, [number, number] | null> = {
  '2160': [3840, 2160],
  '1080': [1920, 1080],
  '720': [1280, 720],
  '480': [854, 480],
  src: null,
  'hevc-hdr': [3840, 2160],
};

export function effectiveHeight(probe: ProbeResult): number {
  const h = probe.height ?? 0;
  const w = probe.width ?? 0;
  let tier = h;
  if (w >= 3840) tier = Math.max(tier, 2160);
  else if (w >= 1920) tier = Math.max(tier, 1080);
  else if (w >= 1280) tier = Math.max(tier, 720);
  return tier || 1080;
}

export function ladderForFile(probe: ProbeResult): Rung[] {
  if (probe.mode === 'remux') return ['src'];
  const h = effectiveHeight(probe);
  const rungs: Rung[] = [];
  if (probe.hdr && h >= 2160) rungs.push('hevc-hdr');
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

export function encodedSecondsFromProgress(duration: number, progressPct: number): number {
  if (duration <= 0) return 0;
  return Math.min(duration, (duration * progressPct) / 100);
}
