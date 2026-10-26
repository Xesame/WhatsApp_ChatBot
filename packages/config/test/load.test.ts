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

describe('service-specific required variables', () => {
  const salt = 'x'.repeat(32);

  it('lists the secrets each service requires', async () => {
    const { requiredVariables } = await import('../src/index.ts');
    expect(requiredVariables('capture')).toEqual(['SENDER_HASH_SALT']);
    expect(requiredVariables('api')).toEqual(['AUTH_SECRET']);
  });

  it('lets the api start without SENDER_HASH_SALT', () => {
    expect(
      loadConfig({ DATABASE_URL, AUTH_SECRET: 'a'.repeat(32) }, 'api').SENDER_HASH_SALT,
    ).toBeUndefined();
  });

  it('stops the api without a long enough AUTH_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL }, 'api')).toThrow(/AUTH_SECRET is required for api/);
    expect(() => loadConfig({ DATABASE_URL, AUTH_SECRET: 'short' }, 'api')).toThrow(/at least 32/);
  });

  it('defaults PUBLIC_URL to the local web address', () => {
    expect(loadConfig({ DATABASE_URL, AUTH_SECRET: 'a'.repeat(32) }, 'api').PUBLIC_URL).toBe(
      'http://localhost:4173',
    );
  });

  it('stops capture without SENDER_HASH_SALT', () => {
    expect(() => loadConfig({ DATABASE_URL }, 'capture')).toThrow(
      /SENDER_HASH_SALT is required for capture/,
    );
  });

  it('rejects a short salt', () => {
    expect(() => loadConfig({ DATABASE_URL, SENDER_HASH_SALT: 'short' }, 'capture')).toThrow(
      /at least 32/,
    );
  });

  it('accepts a valid capture configuration', () => {
    const config = loadConfig({ DATABASE_URL, SENDER_HASH_SALT: salt }, 'capture');
    expect(config.SENDER_HASH_SALT).toBe(salt);
    expect(config.MEDIA_DIR).toMatch(/data\/media$/);
    expect(config.MEDIA_MAX_BYTES).toBe(52428800);
  });

  it('validates the pairing phone format', () => {
    expect(() => loadConfig({ DATABASE_URL, WA_PAIRING_PHONE: '+20 100' })).toThrow(/digits only/);
    expect(loadConfig({ DATABASE_URL, WA_PAIRING_PHONE: '201001234567' }).WA_PAIRING_PHONE).toBe(
      '201001234567',
    );
  });
});
