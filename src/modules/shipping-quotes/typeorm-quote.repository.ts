import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  Comparison,
  QuoteInput,
  SenderSnapshot,
} from './quote.schemas.js';
import { QUOTE_REPOSITORY, type QuoteRepository } from './quote.repository.js';

const projection = `SELECT q.external_id AS "externalId", q.created_at AS "createdAt", u.external_id AS "createdBy", q.input, q.senders, q.deleted_at AS "deletedAt" FROM quote_requests q JOIN auth_users u ON u.id=q.created_by_id`;
function comparison(
  row: Omit<Comparison, 'status' | 'ratesRun' | 'warnings'>,
): Comparison {
  const { deletedAt, ...publicRow } = row as typeof row & {
    deletedAt: Date | null;
  };

  if (deletedAt)
    throw new ConflictException('The original comparison is deleted');

  return {
    ...publicRow,
    createdAt: new Date(row.createdAt).toISOString(),
    status: 'saved',
    ratesRun: false,
    warnings: ['Provider support unverified — no rates run'],
  };
}
export class TypeOrmQuoteRepository implements QuoteRepository {
  constructor(private readonly source: DataSource) {}

  providers() {
    return this.source.query(
      'SELECT code,name,enabled FROM shipping_providers ORDER BY id',
    );
  }

  async existing(input: QuoteInput, actorId: number) {
    const [row] = await this.source.query(
      `${projection} WHERE q.created_by_id=$1 AND q.idempotency_key=$2`,
      [actorId, input.idempotencyKey],
    );
    if (!row) return null;
    const [{ same }] = await this.source.query(
      'SELECT input=$1::jsonb AS same FROM quote_requests WHERE created_by_id=$2 AND idempotency_key=$3',
      [JSON.stringify(input), actorId, input.idempotencyKey],
    );
    if (!same)
      throw new ConflictException(
        'Save key already used with different inputs',
      );
    return comparison(row);
  }

  async create(input: QuoteInput, actorId: number, senders: SenderSnapshot[]) {
    return this.source.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`quote:${actorId}:${input.idempotencyKey}`],
      );
      const [existing] = await manager.query(
        `${projection.replace(' FROM quote_requests', ', q.input=$3::jsonb AS same FROM quote_requests')} WHERE q.created_by_id=$1 AND q.idempotency_key=$2`,
        [actorId, input.idempotencyKey, JSON.stringify(input)],
      );
      if (existing) {
        if (!existing.same)
          throw new ConflictException(
            'Save key already used with different inputs',
          );
        delete existing.same;
        return {
          outcome: 'existing' as const,
          comparison: comparison(existing),
        };
      }
      const providers: Array<{ code: string; enabled: boolean }> =
        await manager.query(
          'SELECT code,enabled FROM shipping_providers WHERE code=ANY($1::text[]) ORDER BY id FOR SHARE',
          [input.providers.map((p) => p.code)],
        );
      if (
        providers.length !== input.providers.length ||
        providers.some((p) => !p.enabled)
      )
        throw new BadRequestException(
          'Selected provider is disabled or unavailable',
        );
      const [row] = await manager.query(
        'INSERT INTO quote_requests(idempotency_key,created_by_id,input,senders) VALUES ($1,$2,$3,$4) RETURNING external_id',
        [
          input.idempotencyKey,
          actorId,
          JSON.stringify(input),
          JSON.stringify(senders),
        ],
      );
      const [{ id: requestId }] = await manager.query(
        'SELECT id FROM quote_requests WHERE external_id=$1',
        [row.external_id],
      );
      for (const [position, group] of input.packageGroups.entries()) {
        const [{ id: groupId }] = await manager.query(
          `INSERT INTO quote_package_groups(normalized,request_id,position,quantity,units,length_original,width_original,height_original,weight_original,length_value,width_value,height_value,weight_value) VALUES (jsonb_build_object('lengthCm', ($5::text::numeric * CASE WHEN $4='imperial' THEN 2.54 ELSE 1 END)::text,'widthCm', ($6::text::numeric * CASE WHEN $4='imperial' THEN 2.54 ELSE 1 END)::text,'heightCm', ($7::text::numeric * CASE WHEN $4='imperial' THEN 2.54 ELSE 1 END)::text,'weightKg', ($8::text::numeric * CASE WHEN $4='imperial' THEN 0.45359237 ELSE 1 END)::text),$1,$2,$3,$4,$5,$6,$7,$8,$5::text::numeric,$6::text::numeric,$7::text::numeric,$8::text::numeric) RETURNING id`,
          [
            requestId,
            position,
            group.quantity,
            group.units,
            group.length,
            group.width,
            group.height,
            group.weight,
          ],
        );
        for (const [itemPosition, item] of group.customsItems.entries())
          await manager.query(
            `INSERT INTO quote_customs_items(package_group_id,position,description,quantity,unit_value,currency,country_of_manufacture,weight,hs_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              groupId,
              itemPosition,
              item.description,
              item.quantity,
              item.unitValue,
              item.currency,
              item.countryOfManufacture,
              item.weight,
              item.hsCode ?? null,
            ],
          );
      }
      for (const sender of senders)
        await manager.query(
          `INSERT INTO quote_provider_attempts(request_id,account_id,sender,execution_mode,status) SELECT $1,a.id,$2,p.execution_mode,'saved' FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.code=$3`,
          [requestId, JSON.stringify(sender), sender.code],
        );
      const [saved] = await manager.query(
        `${projection} WHERE q.external_id=$1`,
        [row.external_id],
      );
      return { outcome: 'created' as const, comparison: comparison(saved) };
    });
  }

  async find(id: string) {
    const [row] = await this.source.query(
      `${projection} WHERE q.external_id=$1 AND q.deleted_at IS NULL`,
      [id],
    );
    return row ? comparison(row) : null;
  }
  async list(page: number) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const rows = await manager.query(
        `${projection} WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC,q.id DESC LIMIT 25 OFFSET $1`,
        [(page - 1) * 25],
      );
      const [{ total }] = await manager.query(
        'SELECT count(*)::integer AS total FROM quote_requests WHERE deleted_at IS NULL',
      );
      return { items: rows.map(comparison), total, page, pageSize: 25 };
    });
  }
}
export const quoteRepositoryProvider = {
  provide: QUOTE_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): QuoteRepository =>
    new TypeOrmQuoteRepository(source),
};
