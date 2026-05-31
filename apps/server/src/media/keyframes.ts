import { SEG_DURATION } from './jobs.js';

/** Max fine decode after a coarse input seek — keeps A/V aligned while landing on segment boundary. */
export const SEEK_PREROLL_SEC = 6;

/** Snap a wall-clock position to the HLS segment grid shared with the synthetic playlist. */
export function segmentStartSec(segIndex: number): number {
  return segIndex * SEG_DURATION;
}

export function segmentIndexForResume(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds / SEG_DURATION);
}

export function playbackStartSec(resumeSec: number): number {
  return segmentStartSec(segmentIndexForResume(resumeSec));
}
