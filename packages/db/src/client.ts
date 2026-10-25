import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: pg.Pool;
  /** Runs `SELECT 1`; throws if the database is unreachable. Used by health checks. */
  ping: () => Promise<void>;
  /**
   * Runs `fn` in a transaction on one connection: commits if it resolves,
   * rolls back if it throws. `client` is the raw connection, for libraries
   * (like pg-boss) that must join the same transaction.
   */
  transaction: <T>(fn: (tx: Db, client: pg.PoolClient) => Promise<T>) => Promise<T>;
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
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(drizzle(client, { schema }), client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
