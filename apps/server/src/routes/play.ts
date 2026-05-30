import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

const findFile = db.prepare(`
  SELECT f.id AS file_id, f.duration, f.width, f.height, f.mode, f.container, f.vcodec, f.acodec,
         f.title_id, f.episode_id
  FROM files f WHERE f.id = ?
`);

const findTitle = db.prepare(`
  SELECT id, kind, title, year, overview, poster, backdrop, genres, runtime, rating
  FROM titles WHERE id = ?
`);

const findEpisode = db.prepare(`
  SELECT id, title_id, season, episode, name, overview, still
  FROM episodes WHERE id = ?
`);

const findSiblingFile = db.prepare(`
  SELECT f.id AS file_id, e.season, e.episode, e.name
  FROM episodes e
  JOIN files f ON f.episode_id = e.id
  WHERE e.title_id = @title_id
    AND ((e.season > @season) OR (e.season = @season AND e.episode @cmp @episode))
  ORDER BY e.season @ord, e.episode @ord
  LIMIT 1
`);

// SQLite doesn't allow parameterizing comparison operators or ORDER direction; build per-direction queries.
const findNextEpisode = db.prepare(`
  SELECT f.id AS file_id, e.season, e.episode, e.name
  FROM episodes e
  JOIN files f ON f.episode_id = e.id
  WHERE e.title_id = @title_id
    AND ((e.season > @season) OR (e.season = @season AND e.episode > @episode))
  ORDER BY e.season ASC, e.episode ASC
  LIMIT 1
`);

const findPrevEpisode = db.prepare(`
  SELECT f.id AS file_id, e.season, e.episode, e.name
  FROM episodes e
  JOIN files f ON f.episode_id = e.id
  WHERE e.title_id = @title_id
    AND ((e.season < @season) OR (e.season = @season AND e.episode < @episode))
  ORDER BY e.season DESC, e.episode DESC
  LIMIT 1
`);

const findSubs = db.prepare(`
  SELECT id, lang, label, source FROM subtitles WHERE file_id = ?
  ORDER BY source ASC, lang ASC, id ASC
`);

const findProgress = db.prepare(`
  SELECT position, duration FROM progress WHERE user_id = ? AND file_id = ?
`);

export async function registerPlayRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/play/:id/context', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const file = findFile.get(id) as
      | {
          file_id: number;
          duration: number | null;
          width: number | null;
          height: number | null;
          mode: 'direct' | 'remux' | 'transcode' | null;
          container: string | null;
          vcodec: string | null;
          acodec: string | null;
          title_id: number | null;
          episode_id: number | null;
        }
      | undefined;
    if (!file) return reply.code(404).send({ error: 'not found' });

    const title = file.title_id
      ? (findTitle.get(file.title_id) as Record<string, unknown> | undefined) ?? null
      : null;

    let episode: Record<string, unknown> | null = null;
    let next: Record<string, unknown> | null = null;
    let prev: Record<string, unknown> | null = null;
    if (file.episode_id) {
      episode = findEpisode.get(file.episode_id) as Record<string, unknown> | null;
      if (episode && typeof episode['title_id'] === 'number') {
        next =
          (findNextEpisode.get({
            title_id: episode['title_id'],
            season: episode['season'],
            episode: episode['episode'],
          }) as Record<string, unknown> | undefined) ?? null;
        prev =
          (findPrevEpisode.get({
            title_id: episode['title_id'],
            season: episode['season'],
            episode: episode['episode'],
          }) as Record<string, unknown> | undefined) ?? null;
      }
    }

    const subs = (findSubs.all(id) as { id: number; lang: string; label: string | null; source: string }[]).map(
      (s) => ({ ...s, url: `/subs/track/${s.id}` }),
    );

    const userId = req.userId!;
    const progress = (findProgress.get(userId, id) as { position: number; duration: number | null } | undefined) ?? null;

    const mode = file.mode ?? 'transcode';
    const preferDirect = mode === 'direct';
    const streamUrl = preferDirect ? `/stream/${id}` : `/hls/${id}/master.m3u8`;

    if (title && typeof title['genres'] === 'string') {
      try {
        title['genres'] = JSON.parse(title['genres'] as string);
      } catch {
        title['genres'] = [];
      }
    }
    if (title) {
      if (title['poster']) title['poster'] = `/art/${title['poster']}`;
      if (title['backdrop']) title['backdrop'] = `/art/${title['backdrop']}`;
    }
    if (episode && episode['still']) episode['still'] = `/art/${episode['still']}`;

    return {
      file,
      title,
      episode,
      next,
      prev,
      subtitles: subs,
      progress,
      mode,
      preferDirect,
      streamUrl,
      thumbsMetaUrl: `/thumbs/${id}/meta.json`,
      thumbsSpriteUrl: `/thumbs/${id}/sprite.jpg`,
    };
  });

  // unused: keep import busy for tools that prune unused vars
  void findSiblingFile;
}
