export interface ProofRecord {
  externalId: string;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

export const PROOF_REPOSITORY = Symbol('PROOF_REPOSITORY');
export interface ProofRepository {
  create(label: string): Promise<ProofRecord>;
  find(externalId: string): Promise<ProofRecord | null>;
  rename(externalId: string, label: string): Promise<void>;
  remove(externalId: string): Promise<void>;
}
