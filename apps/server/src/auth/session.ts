import { getIronSession, type SessionOptions } from 'iron-session';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, paths } from '../config.js';

export type PerflixSession = {
  userId?: number;
  profileId?: number;
  pendingChallenge?: string;
  pendingChallengeFor?: 'register' | 'login' | 'enroll';
  pendingUserId?: number;
};

function resolveSecret(): string {
  if (config.SESSION_SECRET && config.SESSION_SECRET.length >= 32) return config.SESSION_SECRET;
  // dev fallback: generate and persist under .perflix
  mkdirSync(paths.dataDir, { recursive: true });
  const f = resolve(paths.dataDir, '.dev-session-secret');
  if (existsSync(f)) {
    const v = readFileSync(f, 'utf8').trim();
    if (v.length >= 32) return v;
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(f, secret, { mode: 0o600 });
  return secret;
}

const SESSION_PASSWORD = resolveSecret();
const isHttps = config.PUBLIC_URL.startsWith('https://');

export const sessionOptions: SessionOptions = {
  cookieName: 'perflix_session',
  password: SESSION_PASSWORD,
  cookieOptions: {
    secure: isHttps,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  },
  ttl: 30 * 24 * 60 * 60,
};

export function session(req: FastifyRequest, reply: FastifyReply) {
  return getIronSession<PerflixSession>(req.raw, reply.raw, sessionOptions);
}
