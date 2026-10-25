import { z } from 'zod';

/**
 * The single list of environment variables the Node services read.
 *
 * Each variable carries its own documentation in `.meta()`. `pnpm docs` turns
 * this schema into docs/generated/env.md and .env.example, so the docs can
 * never drift from what the code actually accepts.
 *
 * Meta fields:
 * - description: what the variable is for (plain English)
 * - examples:    first entry is written into .env.example
 * - secret:      true when the value must never be logged or committed
 * - usedBy:      which services read it
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development')
    .meta({
      description: 'Runtime mode. Use `production` on the server.',
      usedBy: 'all services',
      examples: ['development'],
    }),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info')
    .meta({
      description: 'Minimum level written to the JSON logs (pino).',
      usedBy: 'all services',
      examples: ['info'],
    }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).meta({
    description:
      'Postgres connection string used by every service. Docker Compose overrides the host to `postgres` inside the containers.',
    usedBy: 'all services',
    examples: ['postgres://reb:change-me@localhost:5432/reb'],
    secret: true,
  }),
  HEALTH_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(8080)
    .meta({
      description:
        'Port for the `/health` endpoint of capture, worker and chatbot. Docker health checks call it.',
      usedBy: 'capture, worker, chatbot',
      examples: ['8080'],
    }),
  API_HOST: z
    .string()
    .default('0.0.0.0')
    .meta({
      description:
        'Interface the API listens on. `0.0.0.0` accepts connections from other containers.',
      usedBy: 'api',
      examples: ['0.0.0.0'],
    }),
  API_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000)
    .meta({
      description: 'Port the API listens on. The API serves `/health` on this same port.',
      usedBy: 'api',
      examples: ['3000'],
    }),
});

/**
 * Variables read only by docker-compose.yml (to create the Postgres
 * container), never by application code. Kept here so they are documented
 * and written to .env.example alongside everything else.
 */
export const composeEnvSchema = z.object({
  POSTGRES_USER: z
    .string()
    .default('reb')
    .meta({
      description: 'Database user created by the Postgres container on first start.',
      usedBy: 'docker-compose.yml',
      examples: ['reb'],
    }),
  POSTGRES_PASSWORD: z
    .string()
    .min(8)
    .meta({
      description:
        'Password for POSTGRES_USER. Must match the password inside DATABASE_URL. Only read the first time the database volume is created.',
      usedBy: 'docker-compose.yml',
      examples: ['change-me'],
      secret: true,
    }),
  POSTGRES_DB: z
    .string()
    .default('reb')
    .meta({
      description: 'Database name created by the Postgres container on first start.',
      usedBy: 'docker-compose.yml',
      examples: ['reb'],
    }),
});

export type Config = z.output<typeof envSchema>;
