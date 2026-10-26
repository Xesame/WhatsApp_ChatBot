import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** <repo>/data/media, the same place whether run from Docker (/app) or a checkout. */
const DEFAULT_MEDIA_DIR = fileURLToPath(new URL('../../../data/media', import.meta.url));

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
 * - requiredFor: services that refuse to start without it. The variable is
 *                optional in the schema (other services don't need it);
 *                `loadConfig(env, service)` enforces it for these services.
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
  SENDER_HASH_SALT: z
    .string()
    .min(32, 'must be at least 32 characters; generate one with `openssl rand -hex 32`')
    .optional()
    .meta({
      description:
        'Secret mixed into every sender hash, so a stored hash cannot be turned back into a phone number by hashing guesses. Generate with `openssl rand -hex 32`. Never change it after messages are stored: the same sender would get a different hash.',
      usedBy: 'capture',
      requiredFor: ['capture'],
      examples: ['replace-with-output-of-openssl-rand-hex-32'],
      secret: true,
    }),
  MEDIA_DIR: z
    .string()
    .default(DEFAULT_MEDIA_DIR)
    .meta({
      description:
        'Folder where downloaded WhatsApp media is stored. Defaults to `data/media` in the repository; Docker keeps it in the `media` volume.',
      usedBy: 'capture, worker',
      examples: [''],
    }),
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(50 * 1024 * 1024)
    .meta({
      description:
        'Media files larger than this (in bytes) are not downloaded; the message is still saved. Default 50 MB.',
      usedBy: 'capture',
      examples: ['52428800'],
    }),
  WA_PAIRING_PHONE: z
    .string()
    .regex(/^\d{8,15}$/, 'digits only, in international format without + (e.g. 201001234567)')
    .optional()
    .meta({
      description:
        "The scraper's own WhatsApp number, digits only (e.g. `201001234567`). When set, capture prints an 8-character pairing code to enter on the phone instead of a QR code. Leave empty to pair by QR.",
      usedBy: 'capture',
      examples: [''],
    }),
  GEMINI_API_KEY: z
    .string()
    .optional()
    .meta({
      description:
        'API key from Google AI Studio (aistudio.google.com). Gemini is the primary model for classification and extraction. Without any model API key the worker stores and queues messages but does not extract them.',
      usedBy: 'worker',
      examples: [''],
      secret: true,
    }),
  GROQ_API_KEY: z
    .string()
    .optional()
    .meta({
      description:
        'API key from console.groq.com. Groq is the first fallback when Gemini is rate-limited or down.',
      usedBy: 'worker',
      examples: [''],
      secret: true,
    }),
  OPENROUTER_API_KEY: z
    .string()
    .optional()
    .meta({
      description: 'API key from openrouter.ai. OpenRouter (free models) is the last fallback.',
      usedBy: 'worker',
      examples: [''],
      secret: true,
    }),
  CEREBRAS_API_KEY: z
    .string()
    .optional()
    .meta({
      description:
        'API key from cloud.cerebras.ai. Only needed if a `cerebras:` model is listed (Cerebras is paid).',
      usedBy: 'worker',
      examples: [''],
      secret: true,
    }),
  LLM_CLASSIFY_MODELS: z
    .string()
    .default('gemini:gemini-flash-lite-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free')
    .meta({
      description:
        'Models that classify messages, as `provider:model`, comma-separated, in fallback order (providers: gemini, groq, openrouter, cerebras). A rate limit or error on one moves to the next; models without an API key are skipped.',
      usedBy: 'worker',
      examples: [
        'gemini:gemini-flash-lite-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free',
      ],
    }),
  LLM_EXTRACT_MODELS: z
    .string()
    .default('gemini:gemini-flash-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free')
    .meta({
      description:
        'Models that extract units, as `provider:model`, comma-separated, in fallback order.',
      usedBy: 'worker',
      examples: ['gemini:gemini-flash-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free'],
    }),
  LLM_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .default(10)
    .meta({
      description:
        "Maximum requests per minute to each model. Free tiers allow roughly 10-30 per minute depending on provider and model (see each provider's console); the lowest one you use is the safe value.",
      usedBy: 'worker',
      examples: ['10'],
    }),
  LLM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60_000)
    .meta({
      description: 'How long to wait for one model answer before trying the next model.',
      usedBy: 'worker',
      examples: ['60000'],
    }),
  LLM_FREE_TIER: z
    .enum(['true', 'false'])
    .default('true')
    .meta({
      description:
        'Record model cost as 0 (free tier). Set to `false` on a paid plan so costs are calculated.',
      usedBy: 'worker',
      examples: ['true'],
    }),
  USD_EGP_RATE: z.coerce
    .number()
    .positive()
    .optional()
    .meta({
      description:
        'EGP per 1 USD, set by the owner. The Excel export converts USD prices to EGP with it (EGP is the main currency). Exports fail if a unit is in USD and this is not set.',
      usedBy: 'worker (export command)',
      examples: ['50'],
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
