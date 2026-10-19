import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { Address, ProviderCode } from './quote.schemas.js';
import {
  SENDER_DEFAULTS_REPOSITORY,
  type RefreshWork,
  type SenderDefaultsRepository,
} from './sender-defaults.repository.js';

export class TypeOrmSenderDefaultsRepository implements SenderDefaultsRepository {
  constructor(private readonly source: DataSource) {}
  enqueue(code: ProviderCode): Promise<string> {
    return this.source.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT a.id,a.default_refresh FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.code=$1 AND p.enabled FOR UPDATE OF a`,
        [code],
      );
      if (!row)
        throw new BadRequestException('Provider is disabled or unavailable');
      const pending = row.default_refresh;
      if (
        pending &&
        ['queued', 'running'].includes(pending.state) &&
        Date.parse(pending.deadline) > Date.now()
      )
        return pending.id;
      const id = randomUUID();
      await manager.query(
        'UPDATE shipping_accounts SET default_refresh=$1,updated_at=now() WHERE id=$2',
        [
          JSON.stringify({
            id,
            state: 'queued',
            deadline: new Date(Date.now() + 90000).toISOString(),
          }),
          row.id,
        ],
      );
      return id;
    });
  }
  async result(code: ProviderCode, id: string) {
    const [row] = await this.source.query(
      `SELECT a.default_refresh FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.code=$1 AND a.default_refresh->>'id'=$2 AND p.enabled`,
      [code, id],
    );
    return row?.default_refresh ?? null;
  }
  claim(): Promise<RefreshWork | null> {
    return this.source.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT a.id,p.code,a.default_refresh FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.enabled AND a.default_refresh->>'state'='queued' AND (a.default_refresh->>'deadline')::timestamptz>now() ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`,
      );
      if (!row) return null;
      await manager.query(
        `UPDATE shipping_accounts SET default_refresh=jsonb_set(default_refresh,'{state}','"running"'),updated_at=now() WHERE id=$1`,
        [row.id],
      );
      return { id: row.default_refresh.id, code: row.code };
    });
  }
  async finish(work: RefreshWork, address: Address | null) {
    const result = {
      id: work.id,
      state: address ? 'succeeded' : 'failed',
      ...(address ? { address, retrievedAt: new Date().toISOString() } : {}),
    };
    await this.source.query(
      `UPDATE shipping_accounts a SET default_refresh=$1,updated_at=now() FROM shipping_providers p WHERE a.provider_id=p.id AND p.code=$2 AND a.default_refresh->>'id'=$3`,
      [JSON.stringify(result), work.code, work.id],
    );
  }
}
export const senderDefaultsRepositoryProvider = {
  provide: SENDER_DEFAULTS_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): SenderDefaultsRepository =>
    new TypeOrmSenderDefaultsRepository(source),
};
