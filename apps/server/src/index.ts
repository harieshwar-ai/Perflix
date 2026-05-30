import Fastify from 'fastify';
import { config } from './config.js';
import './db/client.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerHlsRoutes } from './routes/hls.js';
import { startScanner, stopScanner } from './library/scanner.js';
import { startCacheSweeper, stopCacheSweeper } from './media/cache.js';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
  trustProxy: true,
});

app.get('/health', async () => ({ ok: true, name: 'perflix', version: '0.1.0' }));

await registerLibraryRoutes(app);
await registerStreamRoutes(app);
await registerHlsRoutes(app);

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
