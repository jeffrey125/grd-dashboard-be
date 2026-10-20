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
        `SELECT a.id,p.code,a.default_refresh FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.enabled AND a.default_refresh->>'state'='queued' AND (a.default_refresh->>'deadline')::timestamptz>now() AND NOT EXISTS (SELECT 1 FROM shipping_provider_tests t WHERE t.provider_id=p.id AND t.state='running' AND t.deadline>clock_timestamp()) AND NOT EXISTS (SELECT 1 FROM quote_provider_attempts q WHERE q.account_id=a.id AND q.status='running' AND q.lease_until>clock_timestamp()) ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`,
      );
      if (!row) return null;
      const [reservation] = await manager.query(
        `SELECT
        EXISTS (SELECT 1 FROM shipping_provider_tests t JOIN shipping_accounts a ON a.provider_id=t.provider_id WHERE a.id=$1 AND t.state='running' AND t.deadline>clock_timestamp()) OR
        EXISTS (SELECT 1 FROM quote_provider_attempts q WHERE q.account_id=$1 AND q.status='running' AND q.lease_until>clock_timestamp()) AS busy`,
        [row.id],
      );
      if (reservation.busy) return null;
      await manager.query(
        `UPDATE shipping_accounts SET default_refresh=jsonb_set(jsonb_set(default_refresh,'{state}','"running"'),'{deadline}',to_jsonb(clock_timestamp()+interval '90 seconds')),updated_at=now() WHERE id=$1`,
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
      `UPDATE shipping_accounts a SET default_refresh=$1,last_default=CASE WHEN $4::jsonb IS NULL THEN a.last_default ELSE $4::jsonb END,updated_at=now() FROM shipping_providers p WHERE a.provider_id=p.id AND p.code=$2 AND a.default_refresh->>'id'=$3`,
      [
        JSON.stringify(result),
        work.code,
        work.id,
        address
          ? JSON.stringify({ address, retrievedAt: result.retrievedAt })
          : null,
      ],
    );
  }
}
export const senderDefaultsRepositoryProvider = {
  provide: SENDER_DEFAULTS_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): SenderDefaultsRepository =>
    new TypeOrmSenderDefaultsRepository(source),
};
