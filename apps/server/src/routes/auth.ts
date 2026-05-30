import type { FastifyInstance } from 'fastify';
import { session } from '../auth/session.js';
import {
  finishAuthentication,
  finishEnrollment,
  finishRegistration,
  listCredentials,
  startAuthentication,
  startEnrollment,
  startRegistration,
  userCount,
} from '../auth/webauthn.js';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/api/auth/state', async (req, reply) => {
    const s = await session(req, reply);
    const total = userCount();
    return {
      hasUser: total > 0,
      authenticated: Boolean(s.userId),
      userId: s.userId ?? null,
      credentialCount: s.userId ? listCredentials(s.userId).length : 0,
    };
  });

  app.post<{ Body: { deviceName?: string } }>('/api/auth/register/begin', async (req, reply) => {
    if (userCount() > 0) return reply.code(409).send({ error: 'already registered' });
    const s = await session(req, reply);
    try {
      const opts = await startRegistration(req.body?.deviceName ?? 'First Device');
      s.pendingChallenge = opts.challenge;
      s.pendingChallengeFor = 'register';
      await s.save();
      return opts;
    } catch (err) {
      req.log.warn({ err: String(err) }, 'register/begin failed');
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post<{ Body: { response: any; deviceName?: string } }>(
    '/api/auth/register/finish',
    async (req, reply) => {
      const s = await session(req, reply);
      if (s.pendingChallengeFor !== 'register' || !s.pendingChallenge) {
        return reply.code(400).send({ error: 'no pending registration' });
      }
      try {
        const { userId } = await finishRegistration(
          req.body.response,
          s.pendingChallenge,
          req.body.deviceName ?? 'First Device',
        );
        s.userId = userId;
        s.pendingChallenge = undefined;
        s.pendingChallengeFor = undefined;
        await s.save();
        return { ok: true, userId };
      } catch (err) {
        req.log.warn({ err: String(err) }, 'register/finish failed');
        return reply.code(400).send({ error: String(err) });
      }
    },
  );

  app.post('/api/auth/login/begin', async (req, reply) => {
    if (userCount() === 0) return reply.code(404).send({ error: 'no user registered' });
    const s = await session(req, reply);
    try {
      const { options, userId } = await startAuthentication();
      s.pendingChallenge = options.challenge;
      s.pendingChallengeFor = 'login';
      s.pendingUserId = userId;
      await s.save();
      return options;
    } catch (err) {
      req.log.warn({ err: String(err) }, 'login/begin failed');
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post<{ Body: { response: any } }>('/api/auth/login/finish', async (req, reply) => {
    const s = await session(req, reply);
    if (s.pendingChallengeFor !== 'login' || !s.pendingChallenge) {
      return reply.code(400).send({ error: 'no pending login' });
    }
    try {
      const { userId } = await finishAuthentication(req.body.response, s.pendingChallenge);
      s.userId = userId;
      s.pendingChallenge = undefined;
      s.pendingChallengeFor = undefined;
      s.pendingUserId = undefined;
      await s.save();
      return { ok: true, userId };
    } catch (err) {
      req.log.warn({ err: String(err) }, 'login/finish failed');
      return reply.code(401).send({ error: 'authentication failed' });
    }
  });

  app.post<{ Body: { deviceName?: string } }>('/api/auth/enroll/begin', async (req, reply) => {
    const s = await session(req, reply);
    if (!s.userId) return reply.code(401).send({ error: 'login required' });
    try {
      const opts = await startEnrollment(s.userId, req.body?.deviceName ?? 'New Device');
      s.pendingChallenge = opts.challenge;
      s.pendingChallengeFor = 'enroll';
      await s.save();
      return opts;
    } catch (err) {
      req.log.warn({ err: String(err) }, 'enroll/begin failed');
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post<{ Body: { response: any; deviceName?: string } }>(
    '/api/auth/enroll/finish',
    async (req, reply) => {
      const s = await session(req, reply);
      if (!s.userId) return reply.code(401).send({ error: 'login required' });
      if (s.pendingChallengeFor !== 'enroll' || !s.pendingChallenge) {
        return reply.code(400).send({ error: 'no pending enrollment' });
      }
      try {
        const { credentialId } = await finishEnrollment(
          s.userId,
          req.body.response,
          s.pendingChallenge,
          req.body.deviceName ?? 'New Device',
        );
        s.pendingChallenge = undefined;
        s.pendingChallengeFor = undefined;
        await s.save();
        return { ok: true, credentialId };
      } catch (err) {
        req.log.warn({ err: String(err) }, 'enroll/finish failed');
        return reply.code(400).send({ error: String(err) });
      }
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const s = await session(req, reply);
    s.destroy();
    return { ok: true };
  });
}
