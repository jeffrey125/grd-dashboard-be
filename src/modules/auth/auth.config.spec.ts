import { describe, expect, it } from 'vitest';
import { authConfiguration } from './auth.config.js';

describe('authentication configuration', () => {
  const valid = {
    NODE_ENV: 'production',
    AUTH_SECRET: 'a'.repeat(32),
    AUTH_BASE_URL: 'https://api.example.test',
    AUTH_TRUSTED_ORIGINS: 'https://dashboard.example.test',
  };

  it('requires HTTPS and exact origins without leaking secret input', () => {
    expect(authConfiguration(valid).origins).toEqual([
      'https://dashboard.example.test',
    ]);

    for (const patch of [
      { AUTH_SECRET: 'CANARY_SECRET' },
      { AUTH_BASE_URL: 'http://api.example.test' },
      { AUTH_TRUSTED_ORIGINS: 'https://dashboard.example.test/path' },
      { AUTH_TRUSTED_ORIGINS: '*' },
    ]) {
      expect(() => authConfiguration({ ...valid, ...patch })).toThrow(
        'Invalid auth configuration',
      );

      try {
        authConfiguration({ ...valid, ...patch });
      } catch (error) {
        expect(String(error)).not.toContain('CANARY_SECRET');
      }
    }
  });
});
