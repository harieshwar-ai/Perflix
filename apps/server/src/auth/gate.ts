import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { session } from './session.js';
import { resolveProfileId } from '../profiles/context.js';

const PUBLIC_PREFIXES = ['/health', '/api/auth/'];

function isPublic(url: string): boolean {
  const noQs = url.split('?', 1)[0] ?? url;
  return PUBLIC_PREFIXES.some((p) => noQs === p || noQs.startsWith(p));
}

const GATED_PREFIXES = ['/api/', '/stream/', '/hls/', '/preview/', '/thumbs/', '/art/', '/subs/'];

function isGated(url: string): boolean {
  const noQs = url.split('?', 1)[0] ?? url;
  return GATED_PREFIXES.some((p) => noQs.startsWith(p));
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
    profileId?: number;
  }
}

export async function registerAuthGate(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;
    if (isPublic(url)) return;
    if (!isGated(url)) return;
    const s = await session(req, reply);
    if (!s.userId) {
      reply.code(401).send({ error: 'unauthenticated' });
      return reply;
    }
    req.userId = s.userId;
    const profileId = await resolveProfileId(req, reply);
    if (profileId) req.profileId = profileId;
  });
}
