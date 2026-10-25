import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` compares src/schema with the existing migrations and
// writes a new plain-SQL migration into ./migrations. Review it before
// committing. It is the exact SQL that will run on the server.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
