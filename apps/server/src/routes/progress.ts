import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

const upsert = db.prepare(`
  INSERT INTO progress (profile_id, file_id, position, duration, updated_at)
  VALUES (@profile_id, @file_id, @position, @duration, @now)
  ON CONFLICT(profile_id, file_id) DO UPDATE SET
    position = excluded.position,
    duration = excluded.duration,
    updated_at = excluded.updated_at
`);

const recent = db.prepare(`
  SELECT p.file_id, p.position, p.duration, p.updated_at,
         f.title_id, f.episode_id, f.duration AS file_duration,
         t.id AS title_id_, t.kind, t.title, t.year, t.poster, t.backdrop,
         e.season, e.episode, e.name AS episode_name
  FROM progress p
  JOIN files f ON f.id = p.file_id
  LEFT JOIN titles t ON t.id = f.title_id
  LEFT JOIN episodes e ON e.id = f.episode_id
  WHERE p.profile_id = ?
    AND p.position > 30
    AND (p.duration IS NULL OR p.position / p.duration < 0.95)
  ORDER BY p.updated_at DESC
  LIMIT 24
`);

const clearOne = db.prepare(`DELETE FROM progress WHERE profile_id = ? AND file_id = ?`);

export async function registerProgressRoutes(app: FastifyInstance) {
  app.post<{
    Body: { fileId: number; position: number; duration?: number };
  }>('/api/progress', async (req, reply) => {
    const { fileId, position, duration } = req.body ?? ({} as any);
    if (!Number.isFinite(fileId) || !Number.isFinite(position)) {
      return reply.code(400).send({ error: 'bad payload' });
    }
    upsert.run({
      profile_id: req.profileId!,
      file_id: fileId,
      position,
      duration: duration ?? null,
      now: Date.now(),
    });
    return { ok: true };
  });

  app.get('/api/progress/recent', async (req) => {
    const rows = recent.all(req.profileId!) as Array<{
      file_id: number;
      position: number;
      duration: number | null;
      updated_at: number;
      title_id: number | null;
      kind: 'movie' | 'series' | null;
      title: string | null;
      year: number | null;
      poster: string | null;
      backdrop: string | null;
      season: number | null;
      episode: number | null;
      episode_name: string | null;
    }>;
    return {
      items: rows.map((r) => ({
        fileId: r.file_id,
        position: r.position,
        duration: r.duration,
        updatedAt: r.updated_at,
        title: r.title_id
          ? {
              id: r.title_id,
              kind: r.kind,
              title: r.title,
              year: r.year,
              poster: r.poster ? `/art/${r.poster}` : null,
              backdrop: r.backdrop ? `/art/${r.backdrop}` : null,
              season: r.season,
              episode: r.episode,
              episodeName: r.episode_name,
            }
          : null,
      })),
    };
  });

  app.delete<{ Params: { fileId: string } }>('/api/progress/:fileId', async (req, reply) => {
    const fileId = Number(req.params.fileId);
    if (!Number.isFinite(fileId)) return reply.code(400).send({ error: 'bad id' });
    clearOne.run(req.profileId!, fileId);
    return { ok: true };
  });
}
