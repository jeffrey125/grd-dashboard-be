import type { SalesRepEntity } from './sales-rep.entity.js';

export interface SalesRepRecord {
  externalId: string;
  firstName: string;
  lastName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type SalesRepChanges = Partial<
  Pick<SalesRepEntity, 'firstName' | 'lastName'>
>;

export interface SalesRepsRepository {
  listActive(): Promise<SalesRepRecord[]>;
  listAll(): Promise<SalesRepRecord[]>;
  findActive(externalId: string): Promise<SalesRepRecord | null>;
  find(
    externalId: string,
    includeDeleted?: boolean,
  ): Promise<SalesRepRecord | null>;
  create(
    input: Pick<SalesRepEntity, 'firstName' | 'lastName'>,
    actorId: number | null,
  ): Promise<SalesRepRecord>;
  update(
    externalId: string,
    changes: SalesRepChanges,
    actorId: number | null,
  ): Promise<SalesRepRecord | null>;
  remove(externalId: string, actorId: number | null): Promise<boolean>;
  restore(externalId: string, actorId: number | null): Promise<boolean>;
}

export const SALES_REPS_REPOSITORY = Symbol('SALES_REPS_REPOSITORY');
