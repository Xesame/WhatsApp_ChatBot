import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from './client.ts';
import { runMigrations } from './migrate.ts';

/**
 * For integration tests: creates an empty database with all migrations
 * applied, and drops it again afterwards. Needs TEST_DATABASE_URL pointing
 * at a user that may create databases.
 */
export interface TestDatabase {
  url: string;
  database: Database;
  drop: () => Promise<void>;
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

async function admin(adminUrl: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `reb_test_${randomBytes(4).toString('hex')}`;
  await admin(adminUrl, `CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const database = createDatabase(url.toString(), { max: 4 });
  return {
    url: url.toString(),
    database,
    drop: async () => {
      await database.close();
      await admin(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}
