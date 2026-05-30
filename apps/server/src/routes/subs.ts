import type { FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { db } from '../db/client.js';
import { subsCacheDir } from '../lib/paths.js';
import { srtToVtt } from '../subs/convert.js';
import {
  downloadSubtitle,
  fetchSubtitleText,
  searchSubtitles,
  type OsSearchHit,
} from '../subs/opensubs.js';

mkdirSync(subsCacheDir, { recursive: true });

const findFileMeta = db.prepare(`
  SELECT f.id AS file_id, f.path AS file_path,
         t.id AS title_id, t.kind AS title_kind, t.imdb_id AS imdb_id, t.tmdb_id AS tmdb_id, t.title AS title,
         e.season AS season, e.episode AS episode
  FROM files f
  LEFT JOIN titles t ON t.id = f.title_id
  LEFT JOIN episodes e ON e.id = f.episode_id
  WHERE f.id = ?
`);

const listSubs = db.prepare(`
  SELECT id, lang, label, source FROM subtitles WHERE file_id = ?
  ORDER BY source ASC, lang ASC, id ASC
`);

const insertOsSub = db.prepare(`
  INSERT INTO subtitles (file_id, lang, label, path, source, added_at)
  VALUES (@file_id, @lang, @label, @path, 'opensubs', @now)
  RETURNING id
`);

type FileMeta = {
  file_id: number;
  file_path: string;
  title_id: number | null;
  title_kind: 'movie' | 'series' | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  title: string | null;
  season: number | null;
  episode: number | null;
};

export async function registerSubsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/subs/list/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const rows = listSubs.all(id) as {
      id: number;
      lang: string;
      label: string | null;
      source: string;
    }[];
    return { subtitles: rows.map((s) => ({ ...s, url: `/subs/track/${s.id}` })) };
  });

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(
    '/api/subs/search/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      const meta = findFileMeta.get(id) as FileMeta | undefined;
      if (!meta) return reply.code(404).send({ error: 'not found' });

      const languages = (req.query.lang ?? 'en')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      try {
        const hits =
          meta.title_kind === 'series' && meta.season && meta.episode
            ? await searchSubtitles({
                query: meta.title ?? undefined,
                parentImdbId: meta.imdb_id,
                parentTmdbId: meta.tmdb_id ?? null,
                season: meta.season,
                episode: meta.episode,
                languages,
                type: 'episode',
              })
            : await searchSubtitles({
                query: meta.title ?? undefined,
                imdbId: meta.imdb_id,
                tmdbId: meta.tmdb_id ?? null,
                languages,
                type: 'movie',
              });
        return {
          results: hits.slice(0, 25).map((h: OsSearchHit) => ({
            id: h.attributes.subtitle_id,
            lang: h.attributes.language,
            release: h.attributes.release,
            downloads: h.attributes.download_count,
            hearingImpaired: h.attributes.hearing_impaired,
            hd: h.attributes.hd,
            trusted: h.attributes.from_trusted,
            fileId: h.attributes.files?.[0]?.file_id,
            fileName: h.attributes.files?.[0]?.file_name,
          })),
        };
      } catch (err) {
        req.log.warn({ err: String(err) }, 'opensubs search failed');
        return reply.code(502).send({ error: 'opensubs search failed' });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { osFileId: number; lang: string; label?: string };
  }>('/api/subs/download/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const { osFileId, lang, label } = req.body ?? ({} as any);
    if (!osFileId || !lang) return reply.code(400).send({ error: 'missing osFileId/lang' });
    try {
      const info = await downloadSubtitle(osFileId);
      const raw = await fetchSubtitleText(info.link);
      const isSrt = info.fileName?.toLowerCase().endsWith('.srt') ?? true;
      const vtt = isSrt ? srtToVtt(raw) : raw;
      const out = resolve(subsCacheDir, `${id}-${osFileId}.vtt`);
      await writeFile(out, vtt, 'utf8');
      const row = insertOsSub.get({
        file_id: id,
        lang,
        label: label ?? lang,
        path: out,
        now: Date.now(),
      }) as { id: number };
      return {
        id: row.id,
        url: `/subs/track/${row.id}`,
        remaining: info.remaining,
        resetAt: info.resetTimeUtc,
      };
    } catch (err) {
      req.log.warn({ err: String(err) }, 'opensubs download failed');
      return reply.code(502).send({ error: 'download failed' });
    }
  });

  app.get<{ Params: { id: string } }>('/subs/track/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const row = db
      .prepare('SELECT path, source FROM subtitles WHERE id = ?')
      .get(id) as { path: string; source: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    const ext = extname(row.path).toLowerCase();
    try {
      const raw = await readFile(row.path, 'utf8');
      const vtt = ext === '.srt' ? srtToVtt(raw) : raw;
      reply.header('Content-Type', 'text/vtt; charset=utf-8');
      reply.header('Cache-Control', 'private, max-age=2592000');
      return vtt;
    } catch (err) {
      req.log.warn({ err: String(err) }, 'subtitle read failed');
      return reply.code(404).send({ error: 'subtitle missing' });
    }
  });
}
