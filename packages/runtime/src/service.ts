import { loadConfigOrExit, type Config } from '@reb/config';
import { createDatabase, type Database } from '@reb/db';
import { startHealthServer, type HealthCheck } from './health.ts';
import { createLogger, type Logger } from './logger.ts';

export interface ServiceContext {
  config: Config;
  logger: Logger;
  database: Database;
}

export interface ServiceHooks {
  /** Extra health checks beyond the database ping (e.g. "whatsapp connected"). */
  checks?: Record<string, HealthCheck>;
  /** Called on SIGTERM/SIGINT before the database pool closes. */
  stop?: () => Promise<void>;
}

/**
 * The common startup and shutdown sequence for a background service:
 * load config, create the logger, open the database, start the health
 * endpoint, run the service, and shut everything down cleanly on SIGTERM
 * (which `docker compose stop` sends).
 *
 * Keeping this in one place means every service behaves the same way when it
 * starts, fails or stops.
 */
export async function runService(
  service: string,
  start: (context: ServiceContext) => Promise<ServiceHooks | undefined>,
): Promise<void> {
  const config = loadConfigOrExit(service);
  const logger = createLogger(service, config.LOG_LEVEL);

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  const database = createDatabase(config.DATABASE_URL, {
    onError: (error) => {
      logger.warn({ reason: error.message }, 'Idle database connection lost; will reconnect');
    },
  });
  let hooks: ServiceHooks = {};
  try {
    hooks = (await start({ config, logger, database })) ?? {};
  } catch (error) {
    logger.fatal({ err: error }, 'Service failed to start');
    await database.close();
    process.exit(1);
  }

  const server = await startHealthServer({
    service,
    port: config.HEALTH_PORT,
    checks: { database: database.ping, ...hooks.checks },
  });
  logger.info({ healthPort: config.HEALTH_PORT }, 'Service started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    try {
      await hooks.stop?.();
      server.close();
      await database.close();
      logger.info('Stopped cleanly');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
