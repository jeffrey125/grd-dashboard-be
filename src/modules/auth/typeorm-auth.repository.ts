import Bottleneck from 'bottleneck';
import { DataSource, type EntityManager } from 'typeorm';
import { AuthUserEntity } from './auth-user.entity.js';
import { AuthAccountEntity } from './auth-account.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import type {
  AccountChanges,
  AuthRepository,
  AuthTransaction,
  NewAccount,
  Principal,
} from './auth.repository.js';

class AuthStore implements AuthTransaction {
  constructor(private readonly manager: EntityManager) {}
  findById(id: number) {
    return this.manager.findOneBy(AuthUserEntity, { id });
  }
  findByEmail(email: string) {
    return this.manager.findOneBy(AuthUserEntity, { email });
  }
  findByExternalId(externalId: string) {
    return this.manager.findOneBy(AuthUserEntity, { externalId });
  }
  list() {
    return this.manager.find(AuthUserEntity, { order: { id: 'ASC' } });
  }
  async principal(
    sessionId: number,
    userId: number,
  ): Promise<Principal | null> {
    const rows: Array<{
      id: number;
      externalId: string;
      role: 'admin' | 'staff';
      mustChangePassword: boolean;
    }> = await this.manager.query(
      `SELECT u.id, u.external_id AS "externalId", u.role, u.must_change_password AS "mustChangePassword"
       FROM auth_users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = $1 AND s.id = $2 AND u.active = true AND s.expires_at > clock_timestamp()`,
      [userId, sessionId],
    );
    return rows[0] ? { ...rows[0], sessionId } : null;
  }
  async create(
    input: NewAccount,
    passwordHash: string,
    actorId: number | null,
  ) {
    const user = await this.manager.save(AuthUserEntity, {
      ...input,
      name: `${input.firstName} ${input.lastName}`,
      active: true,
      mustChangePassword: true,
      emailVerified: false,
      createdById: actorId,
      updatedById: actorId,
    });
    await this.manager.save(AuthAccountEntity, {
      userId: user.id,
      accountId: String(user.id),
      providerId: 'credential',
      password: passwordHash,
    });
    return this.manager.findOneByOrFail(AuthUserEntity, { id: user.id });
  }
  async update(id: number, changes: AccountChanges, actorId: number | null) {
    const current = await this.manager.findOneByOrFail(AuthUserEntity, { id });
    const next = { ...current, ...changes };
    await this.manager.update(
      AuthUserEntity,
      { id },
      {
        ...changes,
        name: `${next.firstName} ${next.lastName}`,
        updatedById: actorId,
        updatedAt: () => 'clock_timestamp()',
      },
    );
    return this.manager.findOneByOrFail(AuthUserEntity, { id });
  }
  async passwordHash(userId: number) {
    return (
      (
        await this.manager.findOneBy(AuthAccountEntity, {
          userId,
          providerId: 'credential',
        })
      )?.password ?? null
    );
  }
  async replacePassword(userId: number, passwordHash: string) {
    const result = await this.manager.update(
      AuthAccountEntity,
      { userId, providerId: 'credential' },
      { password: passwordHash, updatedAt: () => 'clock_timestamp()' },
    );
    if (result.affected !== 1) throw new Error('Credential record missing');
  }
  async revokeSessions(userId: number) {
    await this.manager.delete(AuthSessionEntity, { userId });
  }
}

// Queue before acquiring a pool connection: transactions waiting on the database
// lock must not exhaust the pool needed by Better Auth's own queries.
const queues = new WeakMap<DataSource, Bottleneck>();

export class TypeOrmAuthRepository extends AuthStore implements AuthRepository {
  private readonly queue: Bottleneck;
  constructor(private readonly source: DataSource) {
    super(source.manager);
    this.queue = queues.get(source) ?? new Bottleneck({ maxConcurrent: 1 });
    queues.set(source, this.queue);
  }
  transaction<T>(
    work: (transaction: AuthTransaction) => Promise<T>,
  ): Promise<T> {
    return this.queue.schedule(() =>
      this.source.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(1792108800)');
        return work(new AuthStore(manager));
      }),
    );
  }
}
