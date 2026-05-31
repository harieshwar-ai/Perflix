import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { runFfprobe } from '../lib/ffmpeg.js';

type Chapter = { start_time: string; end_time: string; tags?: { title?: string } };

const upsert = db.prepare(`
  INSERT INTO skip_markers (file_id, kind, start_sec, end_sec, confidence)
  VALUES (@file_id, @kind, @start_sec, @end_sec, @confidence)
  ON CONFLICT(file_id, kind) DO UPDATE SET
    start_sec = excluded.start_sec,
    end_sec = excluded.end_sec,
    confidence = excluded.confidence
`);

const listForFile = db.prepare(`
  SELECT kind, start_sec, end_sec, confidence FROM skip_markers WHERE file_id = ?
`);

export type SkipMarker = {
  kind: 'intro' | 'recap' | 'credits';
  startSec: number;
  endSec: number;
  confidence: number | null;
};

function classifyChapter(title: string): SkipMarker['kind'] | null {
  const t = title.toLowerCase();
  if (/intro|opening|theme|studio|logo|fox/.test(t)) return 'intro';
  if (/recap|previously|last time/.test(t)) return 'recap';
  if (/credit|end/.test(t)) return 'credits';
  return null;
}

export async function detectSkipMarkers(
  fileId: number,
  absPath: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const { stdout, code } = await runFfprobe([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_chapters',
      absPath,
    ]);
    if (code !== 0) return;
    const parsed = JSON.parse(stdout) as { chapters?: Chapter[] };
    const chapters = parsed.chapters ?? [];
    const fileRow = db.prepare('SELECT duration FROM files WHERE id = ?').get(fileId) as
      | { duration: number | null }
      | undefined;
    const duration = fileRow?.duration ?? 0;

    for (const ch of chapters) {
      const title = ch.tags?.title ?? '';
      const kind = classifyChapter(title);
      if (!kind) continue;
      const start = Number(ch.start_time);
      const end = Number(ch.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      upsert.run({ file_id: fileId, kind, start_sec: start, end_sec: end, confidence: 0.95 });
    }

    const existing = listForFile.all(fileId) as { kind: string }[];
    if (duration > 120 && !existing.find((r) => r.kind === 'intro')) {
      upsert.run({
        file_id: fileId,
        kind: 'intro',
        start_sec: 0,
        end_sec: Math.min(90, duration * 0.08),
        confidence: 0.3,
      });
    }

    if (duration > 300 && !existing.find((r) => r.kind === 'credits')) {
      const start = Math.max(0, duration - Math.min(240, duration * 0.12));
      upsert.run({
        file_id: fileId,
        kind: 'credits',
        start_sec: start,
        end_sec: duration,
        confidence: 0.25,
      });
    }
  } catch (err) {
    log.warn({ fileId, err: String(err) }, 'skip marker detection failed');
  }
}

export function getSkipMarkers(fileId: number): SkipMarker[] {
  return (listForFile.all(fileId) as Array<{
    kind: SkipMarker['kind'];
    start_sec: number;
    end_sec: number;
    confidence: number | null;
  }>).map((r) => ({
    kind: r.kind,
    startSec: r.start_sec,
    endSec: r.end_sec,
    confidence: r.confidence,
  }));
}
