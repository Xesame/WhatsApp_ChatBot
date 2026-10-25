import type { Database } from '@reb/db';
import { runHealthChecks, type Logger } from '@reb/runtime';
import Fastify from 'fastify';

/**
 * Builds the Fastify app without starting it, so tests can call routes with
 * `app.inject()` and no open port.
 */
export function buildApp(options: { logger: Logger; database: Database }) {
  const app = Fastify({ loggerInstance: options.logger });

  app.get('/health', async (_request, reply) => {
    const report = await runHealthChecks('api', { database: options.database.ping });
    return reply.code(report.status === 'ok' ? 200 : 503).send(report);
  });

  return app;
}
