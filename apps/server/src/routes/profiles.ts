import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { getPref, setActiveProfile, setPref } from '../profiles/context.js';

const listProfiles = db.prepare(`
  SELECT id, name, avatar, is_default, created_at FROM profiles WHERE user_id = ? ORDER BY is_default DESC, id ASC
`);

const createProfile = db.prepare(`
  INSERT INTO profiles (user_id, name, avatar, is_default, created_at)
  VALUES (@user_id, @name, @avatar, 0, @now)
`);

const updateProfile = db.prepare(`
  UPDATE profiles SET name = @name, avatar = @avatar WHERE id = @id AND user_id = @user_id
`);

const deleteProfile = db.prepare(`
  DELETE FROM profiles WHERE id = @id AND user_id = @user_id AND is_default = 0
`);

const countProfiles = db.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?`);

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/api/profiles', async (req) => {
    const rows = listProfiles.all(req.userId!) as Array<{
      id: number;
      name: string;
      avatar: string | null;
      is_default: number;
      created_at: number;
    }>;
    return {
      profiles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        avatar: r.avatar,
        isDefault: r.is_default === 1,
        createdAt: r.created_at,
      })),
      activeProfileId: req.profileId,
    };
  });

  app.post<{ Body: { name: string; avatar?: string } }>('/api/profiles', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    const count = (countProfiles.get(req.userId!) as { n: number }).n;
    if (count >= 8) return reply.code(400).send({ error: 'max profiles reached' });
    const info = createProfile.run({
      user_id: req.userId!,
      name,
      avatar: req.body?.avatar ?? null,
      now: Date.now(),
    });
    return { id: Number(info.lastInsertRowid), name };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; avatar?: string } }>(
    '/api/profiles/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
      updateProfile.run({
        id,
        user_id: req.userId!,
        name: req.body?.name?.trim() ?? 'Profile',
        avatar: req.body?.avatar ?? null,
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    deleteProfile.run({ id, user_id: req.userId! });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/profiles/:id/switch', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    const ok = await setActiveProfile(req, reply, id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true, profileId: id };
  });

  app.get('/api/profiles/prefs', async (req) => {
    const keys = ['qualityCap', 'qualityLock', 'audioTrack', 'subtitleStyle', 'subtitleSyncSec'];
    const prefs: Record<string, string | null> = {};
    for (const k of keys) prefs[k] = getPref(req.profileId!, k);
    return { prefs };
  });

  app.post<{ Body: { key: string; value: string } }>('/api/profiles/prefs', async (req, reply) => {
    const { key, value } = req.body ?? {};
    if (!key || value === undefined) return reply.code(400).send({ error: 'bad payload' });
    setPref(req.profileId!, key, value);
    return { ok: true };
  });
}
