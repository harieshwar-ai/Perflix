export type VttCue = { start: number; end: number; text: string };

function parseVttTime(raw: string): number {
  const parts = raw.trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** Minimal WebVTT parser — enough for OpenSubtitles + sidecar files. */
export function parseVtt(src: string): VttCue[] {
  const cues: VttCue[] = [];
  const body = src.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = body.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let i = 0;
    if (!lines[0]!.includes('-->')) i = 1;
    const timing = lines[i];
    if (!timing) continue;

    const arrow = timing.indexOf('-->');
    if (arrow < 0) continue;

    const start = parseVttTime(timing.slice(0, arrow).trim());
    const endPart = timing.slice(arrow + 3).trim().split(/\s+/)[0] ?? '';
    const end = parseVttTime(endPart);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/^- /gm, '')
      .trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }
  return cues;
}

export function cueAt(cues: VttCue[], t: number): string | null {
  for (const c of cues) {
    if (t >= c.start && t < c.end) return c.text;
  }
  return null;
}

export function formatSyncSec(sec: number): string {
  const sign = sec > 0 ? '+' : sec < 0 ? '−' : '';
  const abs = Math.abs(sec);
  return `${sign}${abs.toFixed(1)}s`;
}

export async function fetchSubtitleCues(url: string): Promise<VttCue[]> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`subtitle ${res.status}`);
  return parseVtt(await res.text());
}
