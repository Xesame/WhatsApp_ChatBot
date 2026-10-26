import { loadConfigOrExit } from '@reb/config';
import { createAuth } from '@reb/auth';
import { createDatabase } from '@reb/db';
import { startQueue } from '@reb/queue';
import { createLogger } from '@reb/runtime';
import { buildApp } from './app.ts';

// The API has its own HTTP server, so it serves /health on API_PORT instead
// of using runService's separate health port.
const config = loadConfigOrExit('api');
const logger = createLogger('api', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL, {
  onError: (error) => {
    logger.warn({ reason: error.message }, 'Idle database connection lost; will reconnect');
  },
});
// The API only adds or retries jobs; the worker runs them.
const boss = await startQueue(config.DATABASE_URL, {
  supervise: false,
  onError: (error) => {
    logger.warn({ reason: error.message }, 'Job queue connection problem');
  },
});
const auth = createAuth(database.db, {
  secret: config.AUTH_SECRET ?? '', // required for the api; loadConfigOrExit checked it
  baseUrl: config.PUBLIC_URL,
});
const app = buildApp({
  logger,
  database,
  admin: {
    auth,
    boss,
    mediaDir: config.MEDIA_DIR,
    publicUrl: config.PUBLIC_URL,
    usdEgpRateFallback: config.USD_EGP_RATE,
  },
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await boss.stop({ graceful: true });
  await database.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  logger.fatal({ err: error }, 'API failed to start');
  await database.close();
  process.exit(1);
}
