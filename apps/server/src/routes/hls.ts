import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/client.js';
import { hlsCacheDir } from '../lib/paths.js';
import { buildMasterPlaylist, buildMediaPlaylist } from '../media/hls.js';
import { probeAndPersist } from '../media/probe.js';
import { rungsFor, startJob, touch, waitForSegment, type Rung } from '../media/jobs.js';

const findFile = db.prepare(`
  SELECT id, path, duration, container, vcodec, acodec, width, height, mode
  FROM files WHERE id = ?
`);

type FileRow = {
  id: number;
  path: string;
  duration: number | null;
  container: string | null;
  vcodec: string | null;
  acodec: string | null;
  width: number | null;
  height: number | null;
  mode: 'direct' | 'remux' | 'transcode' | null;
};

async function loadProbed(fileId: number) {
  const row = findFile.get(fileId) as FileRow | undefined;
  if (!row) return null;
  if (row.mode && row.duration && row.duration > 0) {
    return {
      row,
      probe: {
        container: row.container ?? 'unknown',
        duration: row.duration,
        vcodec: row.vcodec,
        acodec: row.acodec,
        width: row.width,
        height: row.height,
        mode: row.mode,
      },
    };
  }
  // probe now
  const p = await probeAndPersist(row.id, row.path);
  return { row, probe: p };
}

function rungParam(s: string): Rung | null {
  if (s === '2160' || s === '1080' || s === '720' || s === '480' || s === 'src') return s;
  return null;
}

export async function registerHlsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/hls/:id/master.m3u8', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const loaded = await loadProbed(id);
    if (!loaded) return reply.code(404).send({ error: 'not found' });
    const rungs = rungsFor(loaded.probe);
    const body = buildMasterPlaylist(id, rungs, loaded.probe);
    reply.header('Content-Type', 'application/vnd.apple.mpegurl');
    reply.header('Cache-Control', 'private, no-store');
    return body;
  });

  app.get<{ Params: { id: string; rung: string } }>(
    '/hls/:id/:rung/playlist.m3u8',
    async (req, reply) => {
      const id = Number(req.params.id);
      const rung = rungParam(req.params.rung);
      if (!Number.isFinite(id) || !rung) return reply.code(400).send({ error: 'bad params' });
      const loaded = await loadProbed(id);
      if (!loaded) return reply.code(404).send({ error: 'not found' });
      // Start the job so segments are already in flight by the time the player asks.
      startJob(id, rung, loaded.row.path, loaded.probe, req.log);
      const body = buildMediaPlaylist(loaded.probe);
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'private, no-store');
      return body;
    },
  );

  app.get<{ Params: { id: string; rung: string; seg: string } }>(
    '/hls/:id/:rung/:seg',
    async (req: FastifyRequest<{ Params: { id: string; rung: string; seg: string } }>, reply: FastifyReply) => {
      const id = Number(req.params.id);
      const rung = rungParam(req.params.rung);
      const seg = req.params.seg;
      if (!Number.isFinite(id) || !rung) return reply.code(400).send({ error: 'bad params' });
      if (!/^seg_\d+\.ts$/.test(seg)) return reply.code(400).send({ error: 'bad seg name' });
      const dir = resolve(hlsCacheDir, String(id), rung);
      const file = resolve(dir, seg);

      // fast path: already cached
      if (existsSync(file)) {
        const st = statSync(file);
        if (st.isFile() && st.size > 0) {
          touch(id, rung);
          reply.header('Content-Type', 'video/mp2t');
          reply.header('Content-Length', String(st.size));
          reply.header('Cache-Control', 'private, max-age=3600');
          return reply.send(createReadStream(file));
        }
      }

      const loaded = await loadProbed(id);
      if (!loaded) return reply.code(404).send({ error: 'not found' });
      const job = startJob(id, rung, loaded.row.path, loaded.probe, req.log);
      const ok = await waitForSegment(dir, seg, job, 45_000);
      if (!ok) return reply.code(503).send({ error: 'segment not ready' });
      const st = statSync(file);
      reply.header('Content-Type', 'video/mp2t');
      reply.header('Content-Length', String(st.size));
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(createReadStream(file));
    },
  );
}
