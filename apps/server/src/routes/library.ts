import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { db, type Episode, type Title } from '../db/client.js';
import { artDir } from '../lib/paths.js';
import { resolvePlayTarget } from '../lib/playTarget.js';

type TitleWithCounts = Title & { file_count: number; season_count: number; episode_count: number };
type EpisodeWithFile = Episode & {
  file_id: number | null;
  position: number | null;
  duration: number | null;
  progress_updated_at: number | null;
};

const listTitles = db.prepare(`
  SELECT t.*,
    (SELECT COUNT(*) FROM files f WHERE f.title_id = t.id) AS file_count,
    (SELECT COUNT(DISTINCT e.season) FROM episodes e WHERE e.title_id = t.id) AS season_count,
    (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count
  FROM titles t
  ORDER BY t.added_at DESC
`);

const getTitleById = db.prepare(`
  SELECT t.*,
    (SELECT COUNT(*) FROM files f WHERE f.title_id = t.id) AS file_count,
    (SELECT COUNT(DISTINCT e.season) FROM episodes e WHERE e.title_id = t.id) AS season_count,
    (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count
  FROM titles t WHERE t.id = ?
`);

const listEpisodes = db.prepare(`
  SELECT e.*,
    f.id AS file_id,
    p.position AS position,
    p.duration AS duration,
    p.updated_at AS progress_updated_at
  FROM episodes e
  LEFT JOIN files f ON f.episode_id = e.id
  LEFT JOIN progress p ON p.file_id = f.id AND p.profile_id = @profile_id
  WHERE e.title_id = @title_id
  ORDER BY e.season, e.episode
`);

const movieFile = db.prepare(`
  SELECT f.id AS file_id, p.position, p.duration, p.updated_at AS progress_updated_at
  FROM files f
  LEFT JOIN progress p ON p.file_id = f.id AND p.profile_id = @profile_id
  WHERE f.title_id = @title_id AND f.episode_id IS NULL
  LIMIT 1
`);

const previewFileForTitle = db.prepare(`
  SELECT f.id AS file_id
  FROM files f
  WHERE f.title_id = @title_id
  ORDER BY f.episode_id IS NULL DESC, f.id ASC
  LIMIT 1
`);

function decorate(t: TitleWithCounts) {
  return {
    ...t,
    genres: t.genres ? (JSON.parse(t.genres) as string[]) : [],
    poster: t.poster ? `/art/${t.poster}` : null,
    backdrop: t.backdrop ? `/art/${t.backdrop}` : null,
    logo: t.logo ? `/art/${t.logo}` : null,
  };
}

export async function registerLibraryRoutes(app: FastifyInstance) {
  await app.register(fastifyStatic, {
    root: artDir,
    prefix: '/art/',
    decorateReply: false,
    maxAge: '30d',
  });

  app.get('/api/library', async () => {
    const rows = listTitles.all() as TitleWithCounts[];
    return { titles: rows.map(decorate) };
  });

  app.get('/api/library/movies', async () => {
    const rows = listTitles.all() as TitleWithCounts[];
    return { titles: rows.filter((t) => t.kind === 'movie').map(decorate) };
  });

  app.get('/api/library/series', async () => {
    const rows = listTitles.all() as TitleWithCounts[];
    return { titles: rows.filter((t) => t.kind === 'series').map(decorate) };
  });

  app.get<{ Params: { id: string } }>('/api/title/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const t = getTitleById.get(id) as TitleWithCounts | undefined;
    if (!t) return reply.code(404).send({ error: 'not found' });
    const decorated = decorate(t);
    const profileId = req.profileId!;
    if (t.kind === 'series') {
      const episodes = listEpisodes.all({ title_id: id, profile_id: profileId }) as EpisodeWithFile[];
      const stills = episodes.map((e) => ({
        ...e,
        still: e.still ? `/art/${e.still}` : null,
      }));
      const playTarget = resolvePlayTarget(id, 'series', profileId);
      return { ...decorated, episodes: stills, playTarget };
    }
    const file = movieFile.get({ title_id: id, profile_id: profileId }) as
      | { file_id: number; position: number | null; duration: number | null; progress_updated_at: number | null }
      | undefined;
    const playTarget = resolvePlayTarget(id, 'movie', profileId);
    return { ...decorated, file, playTarget };
  });

  app.get<{ Params: { id: string } }>('/api/title/:id/play-target', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const t = getTitleById.get(id) as TitleWithCounts | undefined;
    if (!t) return reply.code(404).send({ error: 'not found' });
    const playTarget = resolvePlayTarget(id, t.kind, req.profileId!);
    if (!playTarget) return reply.code(404).send({ error: 'no playable file' });
    return playTarget;
  });

  app.get<{ Params: { id: string } }>('/api/title/:id/preview-file', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const row = previewFileForTitle.get({ title_id: id }) as { file_id: number } | undefined;
    if (!row?.file_id) return reply.code(404).send({ error: 'no file' });
    return { fileId: row.file_id };
  });

  app.post('/api/library/backfill-art', async (req, reply) => {
    const { backfillVideoArt } = await import('../media/videoArt.js');
    void backfillVideoArt(req.log).catch((err) =>
      req.log.warn({ err: String(err) }, 'manual video art backfill failed'),
    );
    return { ok: true, message: 'Video thumbnail backfill started' };
  });
}
