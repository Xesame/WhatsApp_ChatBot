import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/index.ts';
import { runMigrations } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';

/**
 * Runs the real migrations and seed against a throwaway database.
 *
 * Needs a Postgres server: set TEST_DATABASE_URL to a connection string for a
 * user that may create databases (for example the one from
 * `docker compose up -d postgres`). Skipped when it is not set, so unit tests
 * still run anywhere.
 */
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('migrations and seed on a clean database', () => {
  const dbName = `reb_test_${randomBytes(4).toString('hex')}`;
  let testUrl = '';
  let database: Database | undefined;
  const db = (): Database => {
    if (!database) throw new Error('Test database was not created');
    return database;
  };

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
    await runMigrations(testUrl);
    database = createDatabase(testUrl, { max: 2 });
  });

  afterAll(async () => {
    await database?.close();
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  });

  const count = async (table: string) => {
    const result = await db().pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
    return Number(result.rows[0]?.n);
  };

  it('running migrations a second time is a no-op', async () => {
    await expect(runMigrations(testUrl)).resolves.toBeUndefined();
  });

  it('loads the seed, and a second run adds nothing', async () => {
    const first = await seed(db().db);
    expect(first.aliasesAdded).toBeGreaterThan(0);
    const before = {
      cities: await count('cities'),
      developers: await count('developers'),
      projects: await count('projects'),
      aliases: await count('entity_aliases'),
    };
    expect(before.cities).toBe(first.cities);
    expect(before.projects).toBe(first.projects);

    const second = await seed(db().db);
    expect(second.aliasesAdded).toBe(0);
    expect(await count('cities')).toBe(before.cities);
    expect(await count('developers')).toBe(before.developers);
    expect(await count('projects')).toBe(before.projects);
    expect(await count('entity_aliases')).toBe(before.aliases);
  });

  it('resolves an Arabic alias to its canonical city', async () => {
    const result = await db().pool.query<{ name_en: string }>(
      `SELECT c.name_en FROM entity_aliases a JOIN cities c ON c.id = a.city_id
       WHERE a.alias_normalized = $1`,
      ['التجمع الخامس'],
    );
    expect(result.rows).toEqual([{ name_en: 'New Cairo' }]);
  });

  it('finds a misspelled project by trigram similarity', async () => {
    const result = await db().pool.query<{ name_en: string }>(
      `SELECT p.name_en FROM entity_aliases a JOIN projects p ON p.id = a.project_id
       WHERE a.alias_normalized % $1
       ORDER BY similarity(a.alias_normalized, $1) DESC LIMIT 1`,
      ['mivda'],
    );
    expect(result.rows[0]?.name_en).toBe('Mivida');
  });

  it('rejects an alias that points at two entities', async () => {
    await expect(
      db().pool.query(
        `INSERT INTO entity_aliases (alias, alias_normalized, city_id, developer_id)
         VALUES ('x', 'x', 1, 1)`,
      ),
    ).rejects.toThrow(/entity_aliases_exactly_one_entity/);
  });

  it('refuses to delete a city that still has projects', async () => {
    await expect(db().pool.query(`DELETE FROM cities WHERE name_en = 'New Cairo'`)).rejects.toThrow(
      /foreign key/,
    );
  });
});
