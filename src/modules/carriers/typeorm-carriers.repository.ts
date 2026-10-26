import { DataSource, IsNull } from 'typeorm';
import { CarrierEntity } from './carrier.entity.js';
import {
  CARRIERS_REPOSITORY,
  type CarrierRecord,
  type CarriersRepository,
} from './carriers.repository.js';
import type { CarrierUpdate } from './carriers.schemas.js';

function record(row: CarrierEntity): CarrierRecord {
  return {
    externalId: row.externalId,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    fetchMode: row.fetchMode,
    failurePauseEnabled: row.failurePauseEnabled,
    failurePauseThreshold: row.failurePauseThreshold,
    sessionFailureDisableEnabled: row.sessionFailureDisableEnabled,
    sessionFailureDisableThreshold: row.sessionFailureDisableThreshold,
    consecutiveSessionFailures: row.consecutiveSessionFailures,
    sessionGeneration: row.sessionGeneration,
    autoDisabledReason: row.autoDisabledReason,
    notFoundPauseThreshold: row.notFoundPauseThreshold,
    pollIntervalMinutes: row.pollIntervalMinutes,
    rateLimitPerMinute: row.rateLimitPerMinute,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TypeOrmCarriersRepository implements CarriersRepository {
  constructor(private readonly source: DataSource) {}

  async list(): Promise<CarrierRecord[]> {
    const rows = await this.source
      .getRepository(CarrierEntity)
      .find({ order: { code: 'ASC' } });

    return rows.map(record);
  }

  async listActive(): Promise<CarrierRecord[]> {
    const rows = await this.source.getRepository(CarrierEntity).find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });

    return rows.map(record);
  }

  async find(externalId: string): Promise<CarrierRecord | null> {
    const row = await this.source
      .getRepository(CarrierEntity)
      .findOneBy({ externalId });

    return row ? record(row) : null;
  }

  async update(
    externalId: string,
    changes: CarrierUpdate,
    actorId: number | null = null,
  ): Promise<CarrierRecord | null> {
    // Update only supplied settings. Hold the row lock until the response has
    // been read, so another update/deletion cannot replace this write's result.
    return this.source.transaction(async (manager) => {
      const rows = manager.getRepository(CarrierEntity);
      const current = await rows.findOne({
        where: { externalId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!current) return null;

      const resetShipments =
        changes.failurePauseEnabled === true && !current.failurePauseEnabled;
      const resetSession =
        (changes.sessionFailureDisableEnabled === true &&
          !current.sessionFailureDisableEnabled) ||
        (changes.isActive === true && !current.isActive);
      const sessionChanged =
        changes.isActive !== undefined ||
        changes.fetchMode !== undefined ||
        changes.sessionFailureDisableEnabled !== undefined ||
        changes.sessionFailureDisableThreshold !== undefined;
      const result = await rows.update(
        { externalId, deletedAt: IsNull() },
        {
          ...changes,
          updatedById: actorId,
          ...(resetSession ? { consecutiveSessionFailures: 0 } : {}),
          ...(changes.isActive === true ? { autoDisabledReason: null } : {}),
          ...(sessionChanged
            ? { sessionGeneration: current.sessionGeneration + 1 }
            : {}),
        },
      );

      if (!result.affected) return null;

      if (resetShipments)
        await manager.query(
          'UPDATE shipments SET consecutive_failure_count = 0, lock_version = lock_version + 1 WHERE carrier_id = $1 AND deleted_at IS NULL',
          [current.id],
        );

      return record(await rows.findOneByOrFail({ externalId }));
    });
  }
}

export const carriersRepositoryProvider = {
  provide: CARRIERS_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): CarriersRepository =>
    new TypeOrmCarriersRepository(source),
};
