import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

const upsert = db.prepare(`
  INSERT INTO lists (profile_id, title_id, kind, added_at)
  VALUES (@profile_id, @title_id, @kind, @now)
  ON CONFLICT(profile_id, title_id, kind) DO NOTHING
`);

const del = db.prepare(`
  DELETE FROM lists WHERE profile_id = ? AND title_id = ? AND kind = ?
`);

const listForProfile = db.prepare(`
  SELECT t.id, t.kind AS title_kind, t.tmdb_id, t.title, t.year, t.overview,
         t.poster, t.backdrop, t.genres, t.runtime, t.rating, t.added_at,
         (SELECT COUNT(*) FROM files f WHERE f.title_id = t.id) AS file_count,
         (SELECT COUNT(DISTINCT e.season) FROM episodes e WHERE e.title_id = t.id) AS season_count,
         (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count
  FROM lists l
  JOIN titles t ON t.id = l.title_id
  WHERE l.profile_id = ? AND l.kind = ?
  ORDER BY l.added_at DESC
`);

const stateForTitle = db.prepare(`
  SELECT kind FROM lists WHERE profile_id = ? AND title_id = ?
`);

const VALID_KINDS = new Set(['watchlist', 'watched', 'hidden']);

type RawTitle = {
  id: number;
  title_kind: 'movie' | 'series';
  tmdb_id: number | null;
  title: string;
  year: number | null;
  overview: string | null;
  poster: string | null;
  backdrop: string | null;
  genres: string | null;
  runtime: number | null;
  rating: number | null;
  added_at: number;
  file_count: number;
  season_count: number;
  episode_count: number;
};

function shape(r: RawTitle) {
  return {
    id: r.id,
    kind: r.title_kind,
    tmdb_id: r.tmdb_id,
    title: r.title,
    year: r.year,
    overview: r.overview,
    poster: r.poster ? `/art/${r.poster}` : null,
    backdrop: r.backdrop ? `/art/${r.backdrop}` : null,
    genres: r.genres ? (JSON.parse(r.genres) as string[]) : [],
    runtime: r.runtime,
    rating: r.rating,
    file_count: r.file_count,
    season_count: r.season_count,
    episode_count: r.episode_count,
    added_at: r.added_at,
  };
}

export async function registerListsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { kind?: string } }>('/api/lists', async (req) => {
    const kind = req.query.kind ?? 'watchlist';
    if (!VALID_KINDS.has(kind)) return { titles: [] };
    const rows = listForProfile.all(req.profileId!, kind) as RawTitle[];
    return { titles: rows.map(shape) };
  });

  app.get<{ Params: { titleId: string } }>('/api/lists/state/:titleId', async (req, reply) => {
    const id = Number(req.params.titleId);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const rows = stateForTitle.all(req.profileId!, id) as { kind: string }[];
    return { kinds: rows.map((r) => r.kind) };
  });

  app.post<{ Params: { titleId: string; kind: string } }>(
    '/api/lists/:titleId/:kind',
    async (req, reply) => {
      const id = Number(req.params.titleId);
      const kind = req.params.kind;
      if (!Number.isFinite(id) || !VALID_KINDS.has(kind)) {
        return reply.code(400).send({ error: 'bad params' });
      }
      upsert.run({ profile_id: req.profileId!, title_id: id, kind, now: Date.now() });
      return { ok: true };
    },
  );

  app.delete<{ Params: { titleId: string; kind: string } }>(
    '/api/lists/:titleId/:kind',
    async (req, reply) => {
      const id = Number(req.params.titleId);
      const kind = req.params.kind;
      if (!Number.isFinite(id) || !VALID_KINDS.has(kind)) {
        return reply.code(400).send({ error: 'bad params' });
      }
      del.run(req.profileId!, id, kind);
      return { ok: true };
    },
  );
}
