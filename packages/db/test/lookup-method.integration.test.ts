import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.ts';
import { runMigrations } from '../src/migrate.ts';

/**
 * Migration 0014 on a database that already has lookup answers: the answers
 * Gemini gave from memory before lookups searched the web are marked
 * `method = 'memory'`, so the pipeline treats them as stale and asks again.
 */
const adminUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(new URL('../migrations', import.meta.url));

describe.skipIf(!adminUrl)('migration 0014 (lookup method and sources)', () => {
  const dbName = `reb_test_${randomBytes(4).toString('hex')}`;
  let testUrl = '';
  let olderMigrations = '';

  const admin = async (statement: string) => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${dbName}`;
    testUrl = url.toString();
    // The migrations as they were before 0014: same files, shorter journal.
    olderMigrations = await mkdtemp(join(tmpdir(), 'reb-migrations-'));
    await cp(migrations, olderMigrations, { recursive: true });
    const journalFile = join(olderMigrations, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalFile, 'utf8')) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((e) => e.tag < '0014');
    await writeFile(journalFile, JSON.stringify(journal));
  });

  afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    if (olderMigrations) await rm(olderMigrations, { recursive: true, force: true });
  });

  it('marks the answers saved before it as from memory', async () => {
    const database = createDatabase(testUrl, { max: 1 });
    try {
      await migrate(database.db, { migrationsFolder: olderMigrations });
      await database.pool.query(
        `insert into name_lookups (name, name_normalized, developer, city, known, model, prompt_version)
         values ('Lumia', 'lumia', 'Dev', 'City', true, 'gemini:gemini-flash-latest', 'lookup-old')`,
      );
    } finally {
      await database.close();
    }

    await runMigrations(testUrl);

    const after = createDatabase(testUrl, { max: 1 });
    try {
      const { rows } = await after.pool.query<{
        method: string | null;
        provider: string | null;
        sources: unknown;
      }>(`select method, provider, sources from name_lookups`);
      expect(rows).toEqual([{ method: 'memory', provider: null, sources: null }]);

      // Only the known values are allowed.
      await expect(
        after.pool.query(
          `insert into name_lookups (name, name_normalized, known, model, prompt_version, method)
           values ('X', 'x', false, 'm', 'v', 'guess')`,
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        after.pool.query(
          `insert into name_lookups (name, name_normalized, known, model, prompt_version, method, provider)
           values ('Y', 'y', false, 'm', 'v', 'search', 'openrouter')`,
        ),
      ).rejects.toThrow(/check constraint/);
    } finally {
      await after.close();
    }
  });
});
