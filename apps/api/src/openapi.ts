import { createAuth } from '@reb/auth';
import type { Database } from '@reb/db';
import type { PgBoss } from '@reb/queue';
import { createLogger } from '@reb/runtime';
import { randomBytes } from 'node:crypto';
import { buildApp } from './app.ts';

/** The OpenAPI document for every route, built without a database (for the docs generator). */
export async function openApiDocument(): Promise<Record<string, unknown>> {
  const database = { db: {}, ping: () => Promise.resolve() } as unknown as Database;
  const app = buildApp({
    logger: createLogger('api', 'silent'),
    database,
    admin: {
      auth: createAuth(database.db, {
        secret: randomBytes(32).toString('hex'),
        baseUrl: 'http://localhost:4173',
      }),
      boss: {} as PgBoss,
      mediaDir: '/nonexistent',
      publicUrl: 'http://localhost:4173',
      usdEgpRateFallback: undefined,
    },
  });
  await app.ready();
  const document = app.swagger() as unknown as Record<string, unknown>;
  await app.close();
  return document;
}
