import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { AUTH_ENGINE, type AuthEngine } from './auth.engine.js';
import {
  AUTH_REPOSITORY,
  publicAccount,
  type AuthRepository,
  type AuthTransaction,
  type Principal,
} from './auth.repository.js';
import {
  changePasswordSchema,
  createAccountSchema,
  emailSchema,
  parseAuth,
  resetPasswordSchema,
  signInSchema,
  updateAccountSchema,
} from './auth.schemas.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(AUTH_ENGINE) private readonly engine: AuthEngine,
    @Optional() @Inject(ProjectLogger) private readonly logger?: ProjectLogger,
  ) {}

  async bootstrap(input: unknown) {
    const parsed = parseAuth(createAccountSchema, input);
    const hash = await hashPassword(parsed.password);
    const user = await this.repository.transaction(async (tx) => {
      if ((await tx.list()).some((user) => user.role === 'admin'))
        throw new ConflictException('Initial administrator already exists');

      if (await tx.findByEmail(parsed.email))
        throw new ConflictException('Email already exists');

      return publicAccount(
        await tx.create({ ...parsed, role: 'admin' }, hash, null),
      );
    });

    this.logger?.info(
      'auth.admin.bootstrapped',
      'Initial administrator created',
      { component: 'auth', accountExternalId: user.externalId },
    );

    return user;
  }

  async signIn(input: unknown) {
    const parsed = parseAuth(signInSchema, input);
    const result = await this.repository.transaction(async (tx) => {
      // Let the library verify nonexistent/inactive credentials too; do not reveal
      // account status or skip its dummy password verification for unknown users.
      const response = await this.engine.api.signInEmail({
        body: parsed,
        asResponse: true,
      });
      const user = await tx.findByEmail(parsed.email);

      if (!response.ok || !user?.active) {
        if (user && !user.active) await tx.revokeSessions(user.id);

        return null;
      }

      return {
        user: publicAccount(user),
        cookies: response.headers.getSetCookie(),
      };
    });

    if (!result) throw new UnauthorizedException('Invalid email or password');

    return result;
  }

  async authenticate(headers: Headers): Promise<Principal> {
    const session = await this.engine.api.getSession({
      headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });

    if (!session) throw new UnauthorizedException();

    const principal = await this.repository.principal(
      Number(session.session.id),
      Number(session.user.id),
    );

    if (!principal) throw new UnauthorizedException();

    return principal;
  }

  async current(principal: Principal) {
    const user = await this.repository.findById(principal.id);

    if (!user?.active) throw new UnauthorizedException();

    return publicAccount(user);
  }

  private async authorize(
    tx: AuthTransaction,
    principal: Principal,
    admin = false,
  ) {
    const fresh = await tx.principal(principal.sessionId, principal.id);

    if (!fresh) throw new UnauthorizedException();

    if (admin && (fresh.role !== 'admin' || fresh.mustChangePassword))
      throw new ForbiddenException();

    return fresh;
  }

  async changePassword(principal: Principal, input: unknown) {
    const parsed = parseAuth(changePasswordSchema, input);
    const hash = await hashPassword(parsed.newPassword);

    await this.repository.transaction(async (tx) => {
      await this.authorize(tx, principal);

      const currentHash = await tx.passwordHash(principal.id);

      if (
        !currentHash ||
        !(await verifyPassword({
          hash: currentHash,
          password: parsed.currentPassword,
        }))
      )
        throw new BadRequestException('Password change failed');

      if (
        await verifyPassword({
          hash: currentHash,
          password: parsed.newPassword,
        })
      )
        throw new BadRequestException('Choose a different password');

      await tx.replacePassword(principal.id, hash);
      await tx.update(
        principal.id,
        { mustChangePassword: false },
        principal.id,
      );
      await tx.revokeSessions(principal.id);
    });
    this.logger?.info('auth.password.changed', 'Employee password changed', {
      component: 'auth',
      actorExternalId: principal.externalId,
      accountExternalId: principal.externalId,
    });
  }

  async signOut(principal: Principal, headers: Headers) {
    return this.repository.transaction(async (tx) => {
      await this.authorize(tx, principal);

      const response = await this.engine.api.signOut({
        headers,
        asResponse: true,
      });

      if (!response.ok) throw new UnauthorizedException();

      return response.headers.getSetCookie();
    });
  }

  async createAccount(principal: Principal, input: unknown) {
    const parsed = parseAuth(createAccountSchema, input);

    // Reject unauthorized callers before expensive hashing; recheck under lock.
    if (principal.role !== 'admin' || principal.mustChangePassword)
      throw new ForbiddenException();

    const hash = await hashPassword(parsed.password);
    const user = await this.repository.transaction(async (tx) => {
      await this.authorize(tx, principal, true);

      if (await tx.findByEmail(parsed.email))
        throw new ConflictException('Email already exists');

      return publicAccount(await tx.create(parsed, hash, principal.id));
    });

    this.logger?.info('auth.account.created', 'Employee account created', {
      component: 'auth',
      actorExternalId: principal.externalId,
      accountExternalId: user.externalId,
    });

    return user;
  }

  async listAccounts(principal: Principal) {
    await this.authorize(this.repository, principal, true);

    return (await this.repository.list()).map(publicAccount);
  }

  async account(principal: Principal, externalId: string) {
    await this.authorize(this.repository, principal, true);

    const user = await this.repository.findByExternalId(externalId);

    if (!user) throw new NotFoundException('Account not found');

    return publicAccount(user);
  }

  async updateAccount(
    principal: Principal,
    externalId: string,
    input: unknown,
  ) {
    const parsed = parseAuth(updateAccountSchema, input);
    const result = await this.repository.transaction(async (tx) => {
      await this.authorize(tx, principal, true);

      const user = await tx.findByExternalId(externalId);

      if (!user) throw new NotFoundException('Account not found');

      if (
        user.id === principal.id &&
        (parsed.active === false || parsed.role === 'staff')
      )
        throw new ConflictException(
          'Cannot remove your own administrator access',
        );

      if (
        user.active &&
        user.role === 'admin' &&
        (parsed.active === false || parsed.role === 'staff') &&
        (await tx.list()).filter(
          (account) => account.active && account.role === 'admin',
        ).length <= 1
      )
        throw new ConflictException(
          'At least one active administrator is required',
        );

      if (
        parsed.email &&
        parsed.email !== user.email &&
        (await tx.findByEmail(parsed.email))
      )
        throw new ConflictException('Email already exists');

      const updated = await tx.update(user.id, parsed, principal.id);

      if (
        parsed.active === false ||
        (parsed.email !== undefined && parsed.email !== user.email) ||
        (parsed.role !== undefined && parsed.role !== user.role)
      )
        await tx.revokeSessions(user.id);

      return publicAccount(updated);
    });

    this.logger?.info('auth.account.updated', 'Employee account updated', {
      component: 'auth',
      actorExternalId: principal.externalId,
      accountExternalId: result.externalId,
    });

    return result;
  }

  async resetPassword(
    principal: Principal,
    externalId: string,
    input: unknown,
  ) {
    const { password } = parseAuth(resetPasswordSchema, input);

    if (principal.role !== 'admin' || principal.mustChangePassword)
      throw new ForbiddenException();

    const hash = await hashPassword(password);

    await this.repository.transaction(async (tx) => {
      await this.authorize(tx, principal, true);

      const user = await tx.findByExternalId(externalId);

      if (!user) throw new NotFoundException('Account not found');

      await tx.replacePassword(user.id, hash);
      await tx.update(user.id, { mustChangePassword: true }, principal.id);
      await tx.revokeSessions(user.id);
    });
    this.logger?.info('auth.password.reset', 'Employee password reset', {
      component: 'auth',
      actorExternalId: principal.externalId,
      accountExternalId: externalId,
    });
  }

  async recoverAdmin(email: unknown, input: unknown) {
    const normalized = parseAuth(emailSchema, email);
    const { password } = parseAuth(resetPasswordSchema, input);
    const hash = await hashPassword(password);
    const externalId = await this.repository.transaction(async (tx) => {
      const user = await tx.findByEmail(normalized);

      if (!user || user.role !== 'admin')
        throw new NotFoundException('Administrator not found');

      await tx.replacePassword(user.id, hash);
      await tx.update(user.id, { mustChangePassword: true }, null);
      await tx.revokeSessions(user.id);

      return user.externalId;
    });

    this.logger?.info(
      'auth.admin.recovered',
      'Operator reset administrator password',
      { component: 'auth', accountExternalId: externalId },
    );
  }
}
