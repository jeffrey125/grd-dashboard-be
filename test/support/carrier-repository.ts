import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';

// V1-007 removes this test-only seam when the production Carrier repository lands.
export interface CarrierRecord {
  externalId: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarrierRepository {
  create(code: string, name: string): Promise<CarrierRecord>;
  find(externalId: string): Promise<CarrierRecord | null>;
  rename(externalId: string, name: string): Promise<void>;
  remove(externalId: string): Promise<void>;
}

export const CARRIER_REPOSITORY = Symbol('TEST_CARRIER_REPOSITORY');

function record(entity: CarrierEntity): CarrierRecord {
  return {
    externalId: entity.externalId,
    code: entity.code,
    name: entity.name,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

class TypeOrmCarrierRepository implements CarrierRepository {
  private readonly rows;
  constructor(source: DataSource) {
    this.rows = source.getRepository(CarrierEntity);
  }
  async create(code: string, name: string) {
    return record(
      await this.rows.save(
        this.rows.create({ code, name, pollIntervalMinutes: 5 }),
      ),
    );
  }
  async find(externalId: string) {
    const row = await this.rows.findOneBy({ externalId });
    return row ? record(row) : null;
  }
  async rename(externalId: string, name: string) {
    await this.rows.update({ externalId }, { name });
  }
  async remove(externalId: string) {
    await this.rows.softDelete({ externalId });
  }
}

export const carrierRepositoryProvider = {
  provide: CARRIER_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): CarrierRepository =>
    new TypeOrmCarrierRepository(source),
};

@Injectable()
export class CarrierTestService {
  constructor(
    @Inject(CARRIER_REPOSITORY) private readonly repository: CarrierRepository,
  ) {}
  create(code: string, name: string) {
    return this.repository.create(code, name);
  }
  find(externalId: string) {
    return this.repository.find(externalId);
  }
  rename(externalId: string, name: string) {
    return this.repository.rename(externalId, name);
  }
  remove(externalId: string) {
    return this.repository.remove(externalId);
  }
}
