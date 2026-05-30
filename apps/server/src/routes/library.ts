import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { db, type Episode, type Title } from '../db/client.js';
import { artDir } from '../lib/paths.js';

type TitleWithCounts = Title & { file_count: number; season_count: number; episode_count: number };
type EpisodeWithFile = Episode & {
  file_id: number | null;
  position: number | null;
  duration: number | null;
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
    p.position AS position, p.duration AS duration
  FROM episodes e
  LEFT JOIN files f ON f.episode_id = e.id
  LEFT JOIN progress p ON p.file_id = f.id
  WHERE e.title_id = ?
  ORDER BY e.season, e.episode
`);

const movieFile = db.prepare(`
  SELECT f.id AS file_id, p.position, p.duration
  FROM files f LEFT JOIN progress p ON p.file_id = f.id
  WHERE f.title_id = ? AND f.episode_id IS NULL LIMIT 1
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
    if (t.kind === 'series') {
      const episodes = listEpisodes.all(id) as EpisodeWithFile[];
      const stills = episodes.map((e) => ({
        ...e,
        still: e.still ? `/art/${e.still}` : null,
      }));
      return { ...decorated, episodes: stills };
    }
    const file = movieFile.get(id) as
      | { file_id: number; position: number | null; duration: number | null }
      | undefined;
    return { ...decorated, file };
  });
}
