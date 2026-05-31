import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { session, type PerflixSession } from '../auth/session.js';

const findDefault = db.prepare(`
  SELECT id FROM profiles WHERE user_id = ? AND is_default = 1 LIMIT 1
`);

const findProfile = db.prepare(`
  SELECT id FROM profiles WHERE id = ? AND user_id = ?
`);

const createDefault = db.prepare(`
  INSERT INTO profiles (user_id, name, avatar, is_default, created_at)
  VALUES (?, 'Default', NULL, 1, ?)
`);

export async function resolveProfileId(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<number | null> {
  const s = await session(req, reply);
  if (!s.userId) return null;

  let profileId = s.profileId;
  if (profileId) {
    const ok = findProfile.get(profileId, s.userId) as { id: number } | undefined;
    if (ok) return profileId;
  }

  let row = findDefault.get(s.userId) as { id: number } | undefined;
  if (!row) {
    createDefault.run(s.userId, Date.now());
    row = findDefault.get(s.userId) as { id: number };
  }
  s.profileId = row.id;
  await s.save();
  return row.id;
}

export async function setActiveProfile(
  req: FastifyRequest,
  reply: FastifyReply,
  profileId: number,
): Promise<boolean> {
  const s = await session(req, reply);
  if (!s.userId) return false;
  const ok = findProfile.get(profileId, s.userId) as { id: number } | undefined;
  if (!ok) return false;
  s.profileId = profileId;
  await s.save();
  return true;
}

export function getPref(profileId: number, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM profile_prefs WHERE profile_id = ? AND key = ?')
    .get(profileId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setPref(profileId: number, key: string, value: string): void {
  db.prepare(`
    INSERT INTO profile_prefs (profile_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value
  `).run(profileId, key, value);
}

declare module 'fastify' {
  interface FastifyRequest {
    profileId?: number;
  }
}

