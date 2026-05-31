import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db/client.js';
import { registerAuthGate } from './auth/gate.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerHlsRoutes } from './routes/hls.js';
import { registerPreviewRoutes } from './routes/preview.js';
import { registerSubsRoutes } from './routes/subs.js';
import { registerPlayRoutes } from './routes/play.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerListsRoutes } from './routes/lists.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerStorageRoutes } from './routes/storage.js';
import { startScanner, stopScanner } from './library/scanner.js';
import { startCacheSweeper, stopCacheSweeper } from './media/cache.js';
import { resumeQueueOnBoot } from './media/queue.js';
import { ffmpegInfo } from './lib/ffmpeg.js';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
  trustProxy: true,
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.PUBLIC_URL.startsWith('https://') ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
});

await app.register(rateLimit, {
  global: false,
});

app.get('/health', async () => ({ ok: true, name: 'perflix', version: '0.1.0' }));

await registerAuthGate(app);
await registerAuthRoutes(app);

await registerLibraryRoutes(app);
await registerStreamRoutes(app);
await registerHlsRoutes(app);
await registerPreviewRoutes(app);
await registerSubsRoutes(app);
await registerPlayRoutes(app);
await registerProgressRoutes(app);
await registerListsRoutes(app);
await registerProfileRoutes(app);
await registerStorageRoutes(app);

// Production: serve built SPA from apps/web/dist. Public — the SPA decides what to render
// based on /api/auth/state; gated APIs return 401 to drive the login flow.
{
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: apps/server/src -> ../../web/dist ; prod: apps/server/dist -> ../../web/dist
  const webDist = resolve(here, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
    const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?', 1)[0] ?? req.url;
      if (
        url.startsWith('/api/') ||
        url.startsWith('/stream/') ||
        url.startsWith('/hls/') ||
        url.startsWith('/preview/') ||
        url.startsWith('/thumbs/') ||
        url.startsWith('/art/') ||
        url.startsWith('/subs/') ||
        url === '/health'
      ) {
        return reply.code(404).send({ error: 'not found' });
      }
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(indexHtml);
    });
    app.log.info({ webDist }, 'serving SPA');
  } else {
    app.log.info('web/dist not present — SPA served by vite dev on :5173');
  }
}

app.post('/api/library/rescan', async () => {
  await stopScanner();
  await startScanner(app.log);
  return { ok: true };
});

const start = async () => {
  try {
    const ff = ffmpegInfo();
    app.log.info({ ffmpeg: ff.bin, ffprobe: ff.ffprobe, zscale: ff.zscale }, 'ffmpeg ready');
    if (!ff.zscale) {
      app.log.warn(
        'HDR titles need ffmpeg with zscale — install: brew install ffmpeg-full (or set FFMPEG_PATH)',
      );
    }

    await app.listen({ host: config.HOST, port: config.PORT });
    await startScanner(app.log);
    resumeQueueOnBoot(app.log);
    startCacheSweeper(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  stopCacheSweeper();
  await stopScanner();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
