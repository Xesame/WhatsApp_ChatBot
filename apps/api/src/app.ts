import fastifySwagger from '@fastify/swagger';
import type { Database } from '@reb/db';
import { runHealthChecks, type Logger } from '@reb/runtime';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { adminRoutes, type AdminOptions } from './admin-routes.ts';
import { appRoutes } from './app-routes.ts';
import { authRoutes } from './auth-routes.ts';
import { linkRoutes } from './link-routes.ts';

/**
 * Builds the Fastify app without starting it, so tests can call routes with
 * `app.inject()` and no open port. Without `admin`, only /health is served.
 */
export function buildApp(options: { logger: Logger; database: Database; admin?: AdminOptions }) {
  const app = Fastify({ loggerInstance: options.logger, bodyLimit: 1024 * 1024 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Route schemas double as the API reference (docs/generated/api.md).
  void app.register(fastifySwagger, {
    openapi: { info: { title: 'Real Estate Bot API', version: '1' } },
    transform: jsonSchemaTransform,
  });

  app.get(
    '/health',
    { schema: { tags: ['Service'], summary: 'Health check (database reachable)' } },
    async (_request, reply) => {
      const report = await runHealthChecks('api', { database: options.database.ping });
      return reply.code(report.status === 'ok' ? 200 : 503).send(report);
    },
  );

  if (options.admin) {
    void app.register(authRoutes, {
      auth: options.admin.auth,
      db: options.database.db,
      publicUrl: options.admin.publicUrl,
    });
    void app.register(adminRoutes, {
      ...options.admin,
      database: options.database,
      prefix: '/api/admin',
    });
    void app.register(appRoutes, {
      ...options.admin,
      database: options.database,
      prefix: '/api/app',
    });
    void app.register(linkRoutes, {
      db: options.database.db,
      publicUrl: options.admin.publicUrl,
      prefix: '/api/links',
    });
  }
  return app;
}
