import { AuthUserEntity } from './auth-user.entity.js';
import { AuthAccountEntity } from './auth-account.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { AuthVerificationEntity } from './auth-verification.entity.js';

export const AUTH_ENTITIES = [
  AuthUserEntity,
  AuthAccountEntity,
  AuthSessionEntity,
  AuthVerificationEntity,
];
