import { DataSource, IsNull } from 'typeorm';
import { SalesRepEntity } from './sales-rep.entity.js';
import {
  SALES_REPS_REPOSITORY,
  type SalesRepRecord,
  type SalesRepsRepository,
  type SalesRepChanges,
} from './sales-reps.repository.js';

function record(row: SalesRepEntity): SalesRepRecord {
  return {
    externalId: row.externalId,
    firstName: row.firstName,
    lastName: row.lastName,
    active: !row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export class TypeOrmSalesRepsRepository implements SalesRepsRepository {
  constructor(private readonly source: DataSource) {}

  async listActive() {
    const rows = await this.source.getRepository(SalesRepEntity).find({
      order: { lastName: 'ASC', firstName: 'ASC', id: 'ASC' },
    });

    return rows.filter((row) => !row.deletedAt).map(record);
  }

  async listAll() {
    const rows = await this.source.getRepository(SalesRepEntity).find({
      withDeleted: true,
      order: { lastName: 'ASC', firstName: 'ASC', id: 'ASC' },
    });

    return rows.map(record);
  }

  async find(externalId: string, includeDeleted = false) {
    const row = await this.source.getRepository(SalesRepEntity).findOne({
      where: { externalId },
      withDeleted: includeDeleted,
    });

    return row ? record(row) : null;
  }

  async findActive(externalId: string) {
    return this.find(externalId);
  }

  async create(
    input: Pick<SalesRepEntity, 'firstName' | 'lastName'>,
    actorId: number | null,
  ) {
    const row = await this.source.getRepository(SalesRepEntity).save({
      ...input,
      createdById: actorId,
      updatedById: actorId,
    });

    return record(row);
  }

  async update(
    externalId: string,
    changes: SalesRepChanges,
    actorId: number | null,
  ) {
    return this.source.transaction(async (manager) => {
      const rows = manager.getRepository(SalesRepEntity);
      const result = await rows.update(
        { externalId, deletedAt: IsNull() },
        {
          ...changes,
          updatedById: actorId,
          updatedAt: () => 'clock_timestamp()',
        },
      );

      if (!result.affected) return null;

      return record(await rows.findOneByOrFail({ externalId }));
    });
  }

  async remove(externalId: string, actorId: number | null) {
    const result = await this.source
      .getRepository(SalesRepEntity)
      .createQueryBuilder()
      .softDelete()
      .where('external_id = :externalId AND deleted_at IS NULL', { externalId })
      .execute();

    if (result.affected) {
      await this.source.getRepository(SalesRepEntity).update(
        { externalId },
        {
          deletedById: actorId,
          updatedById: actorId,
          updatedAt: () => 'clock_timestamp()',
        },
      );
    }

    return Boolean(result.affected);
  }

  async restore(externalId: string, actorId: number | null) {
    const result = await this.source
      .getRepository(SalesRepEntity)
      .createQueryBuilder()
      .restore()
      .where('external_id = :externalId AND deleted_at IS NOT NULL', {
        externalId,
      })
      .execute();

    if (result.affected) {
      await this.source.getRepository(SalesRepEntity).update(
        { externalId },
        {
          deletedById: null,
          updatedById: actorId,
          updatedAt: () => 'clock_timestamp()',
        },
      );
    }

    return Boolean(result.affected);
  }
}

export const salesRepsRepositoryProvider = {
  provide: SALES_REPS_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): SalesRepsRepository =>
    new TypeOrmSalesRepsRepository(source),
};
