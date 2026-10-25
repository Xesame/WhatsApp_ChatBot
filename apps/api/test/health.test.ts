import type { Database } from '@reb/db';
import { createLogger } from '@reb/runtime';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const fakeDatabase = (ping: () => Promise<void>) => ({ ping }) as unknown as Database;
const logger = createLogger('api', 'silent');

describe('GET /health', () => {
  it('returns 200 when the database answers', async () => {
    const app = buildApp({ logger, database: fakeDatabase(() => Promise.resolve()) });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'api', checks: { database: 'ok' } });
  });

  it('returns 503 when the database is down', async () => {
    const app = buildApp({
      logger,
      database: fakeDatabase(() => Promise.reject(new Error('connection refused'))),
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ checks: { database: 'connection refused' } });
  });
});
