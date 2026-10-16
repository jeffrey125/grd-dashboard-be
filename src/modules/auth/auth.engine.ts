import { betterAuth } from 'better-auth';
import { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';
import { API_BASE_PATH } from '@runtime/api-routing.js';
import type { AuthConfiguration } from './auth.config.js';

/** Owns the library protocol; application account policies remain in AuthService. */
export function createAuthEngine(
  source: DataSource,
  config: AuthConfiguration,
) {
  return betterAuth({
    baseURL: config.baseURL,
    basePath: `${API_BASE_PATH}/auth`,
    secret: config.secret,
    database: (source.driver as PostgresDriver).master,
    logger: { disabled: true },
    trustedOrigins: config.origins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    user: {
      modelName: 'auth_users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        externalId: {
          type: 'string',
          fieldName: 'external_id',
          input: false,
          returned: false,
        },
        firstName: { type: 'string', fieldName: 'first_name', input: false },
        lastName: { type: 'string', fieldName: 'last_name', input: false },
        role: { type: ['admin', 'staff'], input: false },
        active: { type: 'boolean', input: false },
        mustChangePassword: {
          type: 'boolean',
          fieldName: 'must_change_password',
          input: false,
        },
      },
    },
    session: {
      modelName: 'auth_sessions',
      expiresIn: 86400,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    advanced: {
      database: { generateId: 'serial' },
      useSecureCookies: config.secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
  });
}

export type AuthEngine = ReturnType<typeof createAuthEngine>;

export const AUTH_ENGINE = Symbol('AUTH_ENGINE');
