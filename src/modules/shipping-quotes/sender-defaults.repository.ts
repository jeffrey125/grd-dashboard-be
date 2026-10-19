import type { Address, ProviderCode } from './quote.schemas.js';
export const SENDER_DEFAULTS_REPOSITORY = Symbol('SENDER_DEFAULTS_REPOSITORY');
export type RefreshWork = { id: string; code: ProviderCode };
export type RefreshResult = {
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  address?: Address;
  retrievedAt?: string;
};
export interface SenderDefaultsRepository {
  enqueue(code: ProviderCode): Promise<string>;
  result(code: ProviderCode, id: string): Promise<RefreshResult | null>;
  claim(): Promise<RefreshWork | null>;
  finish(work: RefreshWork, address: Address | null): Promise<void>;
}
