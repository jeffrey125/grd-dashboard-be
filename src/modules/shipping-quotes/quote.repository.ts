import type {
  Comparison,
  ProviderConfiguration,
  QuoteInput,
  SenderSnapshot,
} from './quote.schemas.js';

export const QUOTE_REPOSITORY = Symbol('QUOTE_REPOSITORY');
export interface QuoteRepository {
  providers(): Promise<ProviderConfiguration[]>;
  create(
    input: QuoteInput,
    actorId: number,
    senders: SenderSnapshot[],
  ): Promise<{ outcome: 'created' | 'existing'; comparison: Comparison }>;
  existing(input: QuoteInput, actorId: number): Promise<Comparison | null>;
  retry(id: string, attemptId: string): Promise<Comparison>;
  setDeleted(
    id: string,
    deleted: boolean,
    actorId: number,
  ): Promise<Comparison>;
  find(id: string, includeDeleted?: boolean): Promise<Comparison | null>;
  list(
    page: number,
    deleted?: boolean,
  ): Promise<{
    items: Comparison[];
    total: number;
    page: number;
    pageSize: number;
  }>;
}
