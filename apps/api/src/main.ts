import { loadConfigOrExit } from '@reb/config';
import { createDatabase } from '@reb/db';
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
const app = buildApp({ logger, database });

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  await app.close();
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
