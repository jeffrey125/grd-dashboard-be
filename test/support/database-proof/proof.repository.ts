import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PROOF_REPOSITORY,
  type ProofRecord,
  type ProofRepository,
} from './proof.contract.js';
import { ProofEntity } from './proof.entity.js';

function record(entity: ProofEntity): ProofRecord {
  return {
    externalId: entity.externalId,
    label: entity.label,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

class TypeOrmProofRepository implements ProofRepository {
  private readonly rows;
  constructor(source: DataSource) {
    this.rows = source.getRepository(ProofEntity);
  }
  async create(label: string) {
    return record(await this.rows.save(this.rows.create({ label })));
  }
  async find(externalId: string) {
    const row = await this.rows.findOneBy({ externalId });
    return row ? record(row) : null;
  }
  async rename(externalId: string, label: string) {
    await this.rows.update({ externalId }, { label });
  }
  async remove(externalId: string) {
    await this.rows.softDelete({ externalId });
  }
}

export const proofRepositoryProvider = {
  provide: PROOF_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): ProofRepository =>
    new TypeOrmProofRepository(source),
};

@Injectable()
export class ProofService {
  constructor(
    @Inject(PROOF_REPOSITORY) private readonly repository: ProofRepository,
  ) {}
  create(label: string) {
    return this.repository.create(label);
  }
  find(externalId: string) {
    return this.repository.find(externalId);
  }
  rename(externalId: string, label: string) {
    return this.repository.rename(externalId, label);
  }
  remove(externalId: string) {
    return this.repository.remove(externalId);
  }
}
