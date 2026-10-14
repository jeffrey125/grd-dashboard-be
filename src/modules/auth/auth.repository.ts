import type { AuthUserEntity } from './auth-user.entity.js';

export type AuthRole = 'admin' | 'staff';

export interface Principal {
  id: number;
  externalId: string;
  sessionId: number;
  role: AuthRole;
  mustChangePassword: boolean;
}

export type NewAccount = Pick<
  AuthUserEntity,
  'firstName' | 'lastName' | 'email' | 'role'
>;

export type AccountChanges = Partial<
  Pick<
    AuthUserEntity,
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'role'
    | 'active'
    | 'mustChangePassword'
  >
>;

export interface AuthTransaction {
  findById(id: number): Promise<AuthUserEntity | null>;
  findByEmail(email: string): Promise<AuthUserEntity | null>;
  findByExternalId(externalId: string): Promise<AuthUserEntity | null>;
  principal(sessionId: number, userId: number): Promise<Principal | null>;
  list(): Promise<AuthUserEntity[]>;
  create(
    input: NewAccount,
    passwordHash: string,
    actorId: number | null,
  ): Promise<AuthUserEntity>;
  update(
    id: number,
    changes: AccountChanges,
    actorId: number | null,
  ): Promise<AuthUserEntity>;
  passwordHash(userId: number): Promise<string | null>;
  replacePassword(userId: number, passwordHash: string): Promise<void>;
  revokeSessions(userId: number): Promise<void>;
}

export interface AuthRepository extends AuthTransaction {
  /** Serializes account/session mutations, including Better Auth calls. */
  transaction<T>(
    work: (transaction: AuthTransaction) => Promise<T>,
  ): Promise<T>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export function publicAccount(user: AuthUserEntity) {
  return {
    externalId: user.externalId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
