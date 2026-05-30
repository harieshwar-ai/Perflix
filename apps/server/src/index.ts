import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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
import { startScanner, stopScanner } from './library/scanner.js';
import { startCacheSweeper, stopCacheSweeper } from './media/cache.js';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
  trustProxy: true,
});

await app.register(helmet, {
  contentSecurityPolicy: false, // SPA + HLS make CSP tight; tune in Phase 12
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

app.post('/api/library/rescan', async () => {
  await stopScanner();
  await startScanner(app.log);
  return { ok: true };
});

const start = async () => {
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    await startScanner(app.log);
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
