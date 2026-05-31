import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { config } from '../config.js';
import { enqueuePrepare, listQueue } from '../media/queue.js';
import { pinFileRenditions } from '../media/renditions.js';
import { sweepCache, cacheStats } from '../media/cache.js';

const setPinned = db.prepare(`UPDATE files SET pinned = @pinned WHERE id = @file_id`);

export async function registerStorageRoutes(app: FastifyInstance) {
  app.get('/api/storage/stats', async () => {
    const stats = cacheStats();
    const queue = listQueue();
    const renditions = db
      .prepare(
        `SELECT status, COUNT(*) AS n, SUM(bytes) AS bytes FROM renditions GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number; bytes: number | null }>;
    return {
      capBytes: config.HLS_CACHE_BYTES,
      ...stats,
      renditions,
      queue,
    };
  });

  app.post<{ Params: { id: string } }>('/api/storage/prepare/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    enqueuePrepare(id, req.log);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { pinned?: boolean } }>(
    '/api/storage/pin/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      const pinned = req.body?.pinned !== false;
      setPinned.run({ file_id: id, pinned: pinned ? 1 : 0 });
      pinFileRenditions(id, pinned);
      return { ok: true, pinned };
    },
  );

  app.post('/api/storage/sweep', async (req) => {
    const result = sweepCache(req.log);
    return result;
  });
}
