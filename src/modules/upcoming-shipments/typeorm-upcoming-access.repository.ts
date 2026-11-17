import { DataSource } from 'typeorm';
import { AuthUserEntity } from '@modules/auth/auth-user.entity.js';
import { UpcomingAccessEntity } from './upcoming-access.entity.js';
import type {
  UpcomingAccess,
  UpcomingAccessRepository,
} from './upcoming.contracts.js';

export class TypeOrmUpcomingAccessRepository implements UpcomingAccessRepository {
  constructor(private readonly source: DataSource) {}

  async account(externalId: string) {
    const user = await this.source
      .getRepository(AuthUserEntity)
      .findOneBy({ externalId });
    return user ? { id: user.id, email: user.email } : null;
  }

  async get(accountId: number): Promise<UpcomingAccess> {
    const rows = await this.source
      .getRepository(UpcomingAccessEntity)
      .findBy({ accountId });
    return {
      ownRepId: rows.find((row) => row.kind === 'own')?.repId ?? null,
      assignedRepIds: rows
        .filter((row) => row.kind === 'assigned')
        .map((row) => row.repId)
        .sort(),
    };
  }

  async replace(accountId: number, access: UpcomingAccess) {
    await this.source.transaction(async (manager) => {
      // Serialize complete replacements, including the initial empty assignment.
      await manager.getRepository(AuthUserEntity).findOneOrFail({
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      const repository = manager.getRepository(UpcomingAccessEntity);
      await repository.delete({ accountId });
      const rows: UpcomingAccessEntity[] = access.assignedRepIds
        .filter((repId) => repId !== access.ownRepId)
        .map((repId) => ({ accountId, repId, kind: 'assigned' }));
      if (access.ownRepId)
        rows.push({ accountId, repId: access.ownRepId, kind: 'own' });
      if (rows.length) await repository.insert(rows);
    });
  }
}
