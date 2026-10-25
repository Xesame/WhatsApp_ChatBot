import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: pg.Pool;
  /** Runs `SELECT 1`; throws if the database is unreachable. Used by health checks. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens a connection pool. Each service calls this once at startup and
 * closes it on shutdown.
 */
export function createDatabase(
  url: string,
  options: { max?: number; onError?: (error: Error) => void } = {},
): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  // When Postgres restarts, idle connections in the pool break and the pool
  // emits 'error'. Without a listener Node treats that as a crash. With one,
  // the broken connection is dropped and the next query opens a fresh one,
  // so services ride out a database restart. Health checks report the outage
  // meanwhile.
  pool.on('error', (error) => {
    options.onError?.(error);
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    ping: async () => {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}
