import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { db } from '../db/client.js';
import { ensurePreview, ensureScrubSprite, previewPath, thumbsSpritePath } from '../media/preview.js';
import { probeAndPersist } from '../media/probe.js';

const findFile = db.prepare(`
  SELECT id, path, duration, width, height, mode FROM files WHERE id = ?
`);

type FileRow = {
  id: number;
  path: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  mode: 'direct' | 'remux' | 'transcode' | null;
};

async function ensureProbed(id: number): Promise<FileRow | null> {
  const row = findFile.get(id) as FileRow | undefined;
  if (!row) return null;
  if (row.duration && row.duration > 0 && row.mode) return row;
  await probeAndPersist(row.id, row.path);
  return findFile.get(id) as FileRow;
}

export async function registerPreviewRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/preview/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const row = await ensureProbed(id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    try {
      const dest = await ensurePreview(row.id, row.path, row.duration ?? 0);
      const st = statSync(dest);
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', String(st.size));
      reply.header('Cache-Control', 'private, max-age=2592000');
      return reply.send(createReadStream(dest));
    } catch (err) {
      req.log.error({ err: String(err) }, 'preview gen failed');
      return reply.code(503).send({ error: 'preview not ready' });
    }
  });

  app.get<{ Params: { id: string; asset: string } }>(
    '/thumbs/:id/:asset',
    async (req, reply) => {
      const id = Number(req.params.id);
      const asset = req.params.asset;
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      if (asset !== 'sprite.jpg' && asset !== 'meta.json') {
        return reply.code(404).send({ error: 'unknown asset' });
      }
      const row = await ensureProbed(id);
      if (!row) return reply.code(404).send({ error: 'not found' });
      const meta = await ensureScrubSprite(
        row.id,
        row.path,
        row.duration ?? 0,
        row.width,
        row.height,
      );
      if (asset === 'meta.json') {
        reply.header('Content-Type', 'application/json');
        reply.header('Cache-Control', 'private, max-age=2592000');
        return reply.send(meta);
      }
      const sprite = thumbsSpritePath(id);
      if (!existsSync(sprite)) return reply.code(503).send({ error: 'sprite not ready' });
      const st = statSync(sprite);
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Content-Length', String(st.size));
      reply.header('Cache-Control', 'private, max-age=2592000');
      return reply.send(createReadStream(sprite));
    },
  );

  // unused: keeps tree-shaker happy if we move preview file extension
  void previewPath;
  void extname;
}
