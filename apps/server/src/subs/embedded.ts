import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/client.js';
import { paths } from '../config.js';
import { runFfprobe, spawnFfmpeg } from '../lib/ffmpeg.js';
import { srtToVtt } from './convert.js';
import { readFileSync } from 'node:fs';

const insertSub = db.prepare(`
  INSERT INTO subtitles (file_id, lang, label, path, source, added_at)
  VALUES (@file_id, @lang, @label, @path, 'local', @now)
`);

const findEmbedded = db.prepare(`
  SELECT id FROM subtitles WHERE file_id = ? AND source = 'local' AND path LIKE '%/embedded/%'
`);

const clearEmbedded = db.prepare(`
  DELETE FROM subtitles WHERE file_id = ? AND source = 'local' AND path LIKE '%/embedded/%'
`);

type Stream = {
  index: number;
  codec_type: string;
  codec_name?: string;
  tags?: { language?: string; title?: string };
};

export async function extractEmbeddedSubs(fileId: number, videoPath: string): Promise<number> {
  const { stdout, code } = await runFfprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    videoPath,
  ]);
  if (code !== 0) return 0;

  const parsed = JSON.parse(stdout) as { streams?: Stream[] };
  const textSubs = (parsed.streams ?? []).filter(
    (s) =>
      s.codec_type === 'subtitle' &&
      ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt'].includes(s.codec_name ?? ''),
  );
  if (textSubs.length === 0) return 0;

  const outDir = resolve(paths.dataDir, 'embedded-subs', String(fileId));
  mkdirSync(outDir, { recursive: true });
  clearEmbedded.run(fileId);
  const now = Date.now();
  let n = 0;

  for (const stream of textSubs) {
    const lang = stream.tags?.language?.toLowerCase() ?? `und${stream.index}`;
    const label = stream.tags?.title ?? lang;
    const srtPath = resolve(outDir, `${lang}_${stream.index}.srt`);
    const vttPath = resolve(outDir, `${lang}_${stream.index}.vtt`);

    await new Promise<void>((resolvePromise, reject) => {
      const child = spawnFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        videoPath,
        '-map',
        `0:${stream.index}`,
        '-c:s',
        'srt',
        srtPath,
      ]);
      child.once('error', reject);
      child.once('close', (c) => (c === 0 ? resolvePromise() : reject(new Error(`exit ${c}`))));
    }).catch(() => {});

    try {
      const srt = readFileSync(srtPath, 'utf8');
      writeFileSync(vttPath, srtToVtt(srt), 'utf8');
      insertSub.run({ file_id: fileId, lang, label, path: vttPath, now });
      n++;
    } catch {
      // skip failed extraction
    }
  }

  void findEmbedded;
  return n;
}
