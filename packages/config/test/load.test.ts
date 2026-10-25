import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/index.ts';

const DATABASE_URL = 'postgres://reb:secret@localhost:5432/reb';

describe('loadConfig', () => {
  it('applies defaults when only required variables are set', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      HEALTH_PORT: 8080,
      API_PORT: 3000,
      DATABASE_URL,
    });
  });

  it('coerces numeric ports from strings', () => {
    expect(loadConfig({ DATABASE_URL, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ DATABASE_URL, LOG_LEVEL: '' }).LOG_LEVEL).toBe('info');
  });

  it('fails with a readable error when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/reb' })).toThrow(ConfigError);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
