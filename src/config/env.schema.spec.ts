import { describe, expect, it } from 'vitest';
import { testEnvironment } from '../../test/support/environment.js';
import { createConfiguration } from './configuration.js';
import { ConfigurationError, validateEnvironment } from './env.schema.js';

describe('runtime configuration', () => {
  it('maps DB_* values and preserves literal passwords', () => {
    expect(
      createConfiguration({
        ...testEnvironment,
        DB_PASSWORD: ' p@ss%$word ',
        PORT: '3137',
      }),
    ).toEqual({
      environment: 'test',
      port: 3137,
      database: {
        host: '127.0.0.1',
        port: 5432,
        database: 'runtime_test',
        username: 'runtime_test',
        password: ' p@ss%$word ',
      },
    });
  });

  it('defaults only optional settings and ignores future Carrier credentials', () => {
    const env = validateEnvironment({
      ...testEnvironment,
      NODE_ENV: undefined,
      DB_PORT: undefined,
      ECHOSHIP_PASSWORD: '',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_PORT: 5432,
    });
    expect(env).not.toHaveProperty('ECHOSHIP_PASSWORD');
  });

  it.each(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
    'requires %s',
    (field) => {
      for (const value of [undefined, '', '   ']) {
        expect(() =>
          validateEnvironment({ ...testEnvironment, [field]: value }),
        ).toThrow(`${field} is required`);
      }
    },
  );

  it.each(['PORT', 'DB_PORT'])('strictly validates %s', (field) => {
    for (const value of [
      '',
      ' ',
      '0',
      '-1',
      '65536',
      '1.5',
      '3e3',
      '3000junk',
      '0xFF',
    ]) {
      expect(() =>
        validateEnvironment({ ...testEnvironment, [field]: value }),
      ).toThrow(`${field} must be an integer`);
    }
    for (const value of ['1', '65535']) {
      expect(
        validateEnvironment({ ...testEnvironment, [field]: value })[
          field as 'PORT' | 'DB_PORT'
        ],
      ).toBe(Number(value));
    }
  });

  it('reports all invalid fields without retaining input or underlying errors', () => {
    const secret = 'CANARY_CONFIG_SECRET';
    let failure: unknown;
    try {
      validateEnvironment({
        ...testEnvironment,
        NODE_ENV: secret,
        PORT: secret,
        DB_USER: '',
        DB_PASSWORD: secret,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfigurationError);
    expect(String(failure)).toContain('NODE_ENV');
    expect(String(failure)).toContain('PORT');
    expect(String(failure)).toContain('DB_USER');
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure).not.toHaveProperty('cause');
  });
});
