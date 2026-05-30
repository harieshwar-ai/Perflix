import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { db } from '../db/client.js';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
};

const findFilePath = db.prepare('SELECT path FROM files WHERE id = ?');

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startStr = m[1] ?? '';
  const endStr = m[2] ?? '';
  if (startStr === '' && endStr === '') return null;
  let start: number;
  let end: number;
  if (startStr === '') {
    // suffix range: last N bytes
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? size - 1 : parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  }
  if (start < 0 || end < start || end >= size) return null;
  return { start, end };
}

async function handle(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
  const row = findFilePath.get(id) as { path: string } | undefined;
  if (!row) return reply.code(404).send({ error: 'not found' });

  let st;
  try {
    st = statSync(row.path);
  } catch {
    return reply.code(404).send({ error: 'file missing on disk' });
  }
  if (!st.isFile()) return reply.code(404).send({ error: 'not a file' });

  const mime = MIME[extname(row.path).toLowerCase()] ?? 'application/octet-stream';
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mime);
  reply.header('Cache-Control', 'private, max-age=0');

  if (req.method === 'HEAD') {
    reply.header('Content-Length', String(st.size));
    return reply.code(200).send();
  }

  const range = parseRange(req.headers.range, st.size);
  if (!range) {
    reply.header('Content-Length', String(st.size));
    return reply.code(200).send(createReadStream(row.path));
  }

  const len = range.end - range.start + 1;
  reply.header('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`);
  reply.header('Content-Length', String(len));
  reply.code(206);
  return reply.send(createReadStream(row.path, { start: range.start, end: range.end }));
}

export async function registerStreamRoutes(app: FastifyInstance) {
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'HEAD'],
    url: '/stream/:id',
    handler: handle,
  });
}
