import { z } from 'zod';
import { envSchema, type Config } from './env.ts';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads and validates environment variables once at startup.
 *
 * A service that is missing a required variable must fail immediately with a
 * readable message, rather than crash later in the middle of a job.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as "not set", so `FOO=` in .env falls back to the
  // default instead of failing validation.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * `loadConfig()` for service entry points: prints only the readable list of
 * problems (no stack trace) and exits with code 1 when the config is invalid.
 */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
