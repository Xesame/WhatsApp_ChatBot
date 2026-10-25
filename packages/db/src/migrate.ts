import { fileURLToPath } from 'node:url';
import { loadConfigOrExit } from '@reb/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.ts';

/**
 * Applies every migration in ./migrations that has not run yet, in order.
 *
 * Drizzle records applied migrations in the `drizzle.__drizzle_migrations`
 * table, so running this twice is safe: the second run does nothing. Docker
 * Compose runs it automatically (the `migrate` service) before any app
 * starts.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 1 });
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  const config = loadConfigOrExit();
  await runMigrations(config.DATABASE_URL);
  console.log('Migrations applied.');
}
