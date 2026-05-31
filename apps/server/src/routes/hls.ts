import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/client.js';
import { hlsCacheDir } from '../lib/paths.js';
import { masterForFile, readMediaPlaylist } from '../media/hls.js';
import { waitForSegmentFile } from '../media/encoder.js';
import { type Rung, rungsFor } from '../media/ladder.js';
import { probeAndPersist } from '../media/probe.js';
import { renditionDir } from '../media/renditions.js';

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
        hdr: false,
        audioStreams: [],
      },
    };
  }
  const p = await probeAndPersist(row.id, row.path);
  return { row, probe: p };
}

function rungParam(s: string): Rung | null {
  if (s === '2160' || s === '1080' || s === '720' || s === '480' || s === 'src' || s === 'hevc-hdr')
    return s;
  return null;
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.m4s')) return 'video/iso.segment';
  return 'application/octet-stream';
}

function serveFile(reply: FastifyReply, file: string, cacheable: boolean) {
  const st = statSync(file);
  reply.header('Content-Type', contentTypeFor(file));
  reply.header('Content-Length', String(st.size));
  reply.header('Cache-Control', cacheable ? 'private, max-age=3600' : 'private, no-store');
  return reply.send(createReadStream(file));
}

export async function registerHlsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/hls/:id/master.m3u8', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const loaded = await loadProbed(id);
    if (!loaded) return reply.code(404).send({ error: 'not found' });
    const body = masterForFile(id, loaded.probe);
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

      const dir = renditionDir(id, rung);
      const pl = resolve(dir, 'playlist.m3u8');
      let body = readMediaPlaylist(pl, loaded.probe.duration);
      if (!body) {
        const rungs = rungsFor(loaded.probe);
        if (!rungs.includes(rung)) return reply.code(404).send({ error: 'rung not available' });
        body = [
          '#EXTM3U',
          '#EXT-X-VERSION:7',
          '#EXT-X-TARGETDURATION:5',
          '#EXT-X-PLAYLIST-TYPE:EVENT',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-INDEPENDENT-SEGMENTS',
          '#EXT-X-MAP:URI="init.mp4"',
        ].join('\n') + '\n';
      }
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'private, no-store');
      return body;
    },
  );

  app.get<{ Params: { id: string; lang: string } }>(
    '/hls/:id/audio/:lang/playlist.m3u8',
    async (req, reply) => {
      const id = Number(req.params.id);
      const lang = req.params.lang;
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      const pl = resolve(hlsCacheDir, String(id), 'audio', lang, 'playlist.m3u8');
      const body = readMediaPlaylist(pl);
      if (!body) return reply.code(503).send({ error: 'audio not ready' });
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'private, no-store');
      return body;
    },
  );

  app.get<{ Params: { id: string; rung: string; asset: string } }>(
    '/hls/:id/:rung/:asset',
    async (req: FastifyRequest<{ Params: { id: string; rung: string; asset: string } }>, reply: FastifyReply) => {
      const id = Number(req.params.id);
      const rung = rungParam(req.params.rung);
      const asset = req.params.asset;
      if (!Number.isFinite(id) || !rung) return reply.code(400).send({ error: 'bad params' });

      const dir = renditionDir(id, rung);
      const file = resolve(dir, asset);
      const valid = /^init\.mp4$/.test(asset) || /^seg_\d+\.m4s$/.test(asset);
      if (!valid) return reply.code(400).send({ error: 'bad asset name' });

      if (existsSync(file)) {
        const st = statSync(file);
        if (st.isFile() && st.size > 0) return serveFile(reply, file, true);
      }

      const loaded = await loadProbed(id);
      if (!loaded) return reply.code(404).send({ error: 'not found' });

      const ok = await waitForSegmentFile(file, 120_000);
      if (!ok) return reply.code(503).send({ error: 'segment not ready' });
      return serveFile(reply, file, false);
    },
  );

  app.get<{ Params: { id: string; lang: string; asset: string } }>(
    '/hls/:id/audio/:lang/:asset',
    async (req, reply) => {
      const id = Number(req.params.id);
      const { lang, asset } = req.params;
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      const file = resolve(hlsCacheDir, String(id), 'audio', lang, asset);
      if (!existsSync(file)) return reply.code(503).send({ error: 'not ready' });
      return serveFile(reply, file, true);
    },
  );
}
