import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, paths } from '../config.js';

function resolveSigningSecret(): string {
  if (config.SIGNING_SECRET && config.SIGNING_SECRET.length >= 32) return config.SIGNING_SECRET;
  mkdirSync(paths.dataDir, { recursive: true });
  const f = resolve(paths.dataDir, '.dev-signing-secret');
  if (existsSync(f)) {
    const v = readFileSync(f, 'utf8').trim();
    if (v.length >= 32) return v;
  }
  const s = randomBytes(32).toString('hex');
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const SECRET = resolveSigningSecret();

function sign(userId: number, route: string, exp: number): string {
  return createHmac('sha256', SECRET).update(`${userId}\n${route}\n${exp}`).digest('hex').slice(0, 32);
}

/** Returns a query-string suffix (without leading ?) bound to a user + route + TTL. */
export function signFor(userId: number, route: string, ttlSec = 60 * 60 * 12): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = sign(userId, route, exp);
  return `u=${userId}&exp=${exp}&t=${sig}`;
}

/** Returns the signed userId on success, or null. Caller must pass the un-signed-query route prefix. */
export function verifyToken(
  userId: number,
  route: string,
  exp: number,
  token: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(userId, route, exp);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
