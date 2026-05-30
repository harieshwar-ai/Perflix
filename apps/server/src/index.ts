import Fastify from 'fastify';
import { config } from './config.js';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
  trustProxy: true,
});

app.get('/health', async () => ({ ok: true, name: 'perflix', version: '0.1.0' }));

const start = async () => {
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
