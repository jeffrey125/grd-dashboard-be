import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  packageDimensionsSupportedForProvider,
  type Comparison,
  type ProviderCode,
  type QuoteInput,
  type SenderSnapshot,
} from './quote.schemas.js';
import { QUOTE_REPOSITORY, type QuoteRepository } from './quote.repository.js';
import {
  canonicalMeasurements,
  conversionSnapshot,
} from './quote-conversions.js';
import { canQueueProvider } from './quote-provider-eligibility.js';
import {
  retryInputBlock,
  type RetryConfiguration,
} from './quote-retry-policy.js';
import type { ExecutionMode } from './provider-execution-mode.js';

const projection = `SELECT q.external_id AS "externalId", q.status, q.created_at AS "createdAt", u.external_id AS "createdBy", q.input, q.senders, q.deleted_at AS "deletedAt", q.restored_at AS "restoredAt",q.last_deleted_at AS "lastDeletedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'externalId',a.external_id,'provider',p.code,'status',a.status,'attemptNumber',a.attempt_number,
    'createdAt',a.created_at,'sender',a.sender,
    'configuration',jsonb_build_object('code',p.code,'enabled',p.enabled,'executionMode',p.execution_mode,'usedInternationally',p.used_internationally),
    'executionMode',a.execution_mode,'startedAt',a.started_at,'completedAt',a.completed_at,
    'recoveryCount',a.recovery_count,'outcome',a.outcome,'reasonCode',a.reason_code,'simulated',a.simulated,
    'conversionSnapshot',a.conversion_snapshot,
    'quotes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'platform',p.name,'carrier',r.carrier,'service',r.service,'transportationTotal',r.transportation_total::text,
      'currency',r.currency,'estimateMethod',r.estimate_method,'transitDescription',r.transit_description,
      'retrievedAt',r.retrieved_at,'expiresAt',r.expires_at,'optionCoverage',r.option_coverage,
      'staleAt',CASE WHEN r.expires_at IS NULL THEN r.retrieved_at + p.stale_hours * interval '1 hour' ELSE NULL END,
      'dutyStatus',r.duty_status,'taxStatus',r.tax_status,'clearanceStatus',r.clearance_status,
      'charges',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'description',i.description,'amount',i.amount::text,'scope',i.scope,
        'packageGroupPosition',g.position) ORDER BY i.id)
        FROM shipping_quote_items i LEFT JOIN quote_package_groups g ON g.id=i.package_group_id
        WHERE i.quote_id=r.id),'[]'::jsonb),
      'groupContributions',COALESCE(r.group_contributions,'[]'::jsonb)
    ) ORDER BY r.id) FROM shipping_quotes r WHERE r.attempt_id=a.id),'[]'::jsonb)
  ) ORDER BY a.id) FROM quote_provider_attempts a JOIN shipping_accounts s ON s.id=a.account_id
    JOIN shipping_providers p ON p.id=s.provider_id WHERE a.request_id=q.id),'[]'::jsonb) AS attempts
  FROM quote_requests q JOIN auth_users u ON u.id=q.created_by_id`;
function comparison(
  row: Omit<Comparison, 'ratesRun' | 'warnings'>,
): Comparison {
  return {
    ...row,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    restoredAt: row.restoredAt ? new Date(row.restoredAt).toISOString() : null,
    lastDeletedAt: row.lastDeletedAt
      ? new Date(row.lastDeletedAt).toISOString()
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
    ratesRun: row.attempts.some((a) => a.startedAt !== null),
    attempts: row.attempts.map((attempt) => {
      const { configuration, ...a } = attempt as typeof attempt & {
        configuration: RetryConfiguration;
      };
      const latest = !row.attempts.some(
        (other) =>
          other.provider === a.provider &&
          other.attemptNumber > a.attemptNumber,
      );
      const retryBlockedReason = row.deletedAt
        ? 'comparison_deleted'
        : !latest
          ? 'newer_attempt'
          : ['queued', 'running'].includes(a.status)
            ? 'attempt_active'
            : a.status !== 'failed' ||
                !['timeout', 'authentication_failed', 'failed'].includes(
                  a.outcome ?? '',
                )
              ? 'outcome_not_retryable'
              : retryInputBlock(row.input, a.sender, configuration);
      return {
        ...a,
        retryBlockedReason,
        createdAt: new Date(a.createdAt).toISOString(),
        startedAt: a.startedAt ? new Date(a.startedAt).toISOString() : null,
        completedAt: a.completedAt
          ? new Date(a.completedAt).toISOString()
          : null,
        quotes: a.quotes.map((q) => ({
          ...q,
          retrievedAt: new Date(q.retrievedAt).toISOString(),
          expiresAt: q.expiresAt ? new Date(q.expiresAt).toISOString() : null,
          staleAt: q.staleAt ? new Date(q.staleAt).toISOString() : null,
          charges: q.charges ?? [],
          groupContributions: q.groupContributions ?? [],
        })),
      };
    }),
    warnings: row.attempts.some((a) => a.simulated)
      ? ['Simulated rates — not provider quotes']
      : ['Provider support unverified'],
  };
}
export class TypeOrmQuoteRepository implements QuoteRepository {
  constructor(private readonly source: DataSource) {}

  providers() {
    return this.source.query(
      `SELECT code,name,enabled,execution_mode AS "executionMode",maintenance_message AS "maintenanceMessage",stale_hours AS "staleHours",
      (SELECT last_default FROM shipping_accounts WHERE provider_id=shipping_providers.id) AS "cachedDefault",
      used_internationally AS "usedInternationally",
      false AS "internationalAvailable",
      false AS "supportsSignature",
      false AS "supportsInsurance"
      FROM shipping_providers ORDER BY id`,
    );
  }

  async existing(input: QuoteInput, actorId: number) {
    const [row] = await this.source.query(
      `${projection} WHERE q.created_by_id=$1 AND q.idempotency_key=$2`,
      [actorId, input.idempotencyKey],
    );
    if (!row) return null;
    if (row.deletedAt)
      throw new ConflictException('The original comparison is deleted');
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
        if (existing.deletedAt)
          throw new ConflictException('The original comparison is deleted');
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
      const providers: Array<{
        code: ProviderCode;
        enabled: boolean;
        executionMode: ExecutionMode;
        usedInternationally: boolean;
      }> = await manager.query(
        'SELECT code,enabled,execution_mode AS "executionMode",used_internationally AS "usedInternationally" FROM shipping_providers WHERE code=ANY($1::text[]) ORDER BY id FOR SHARE',
        [input.providers.map((p) => p.code)],
      );
      if (
        providers.length !== input.providers.length ||
        providers.some((p) => !p.enabled)
      )
        throw new BadRequestException(
          'Selected provider is disabled or unavailable',
        );
      const configurations = new Map(
        providers.map((provider) => [provider.code, provider]),
      );
      const queueable = (code: ProviderCode) => {
        const provider = configurations.get(code);
        return provider ? canQueueProvider(input, provider) : false;
      };
      if (
        input.providers.some(
          (provider) =>
            !packageDimensionsSupportedForProvider(input, provider.code),
        )
      )
        throw new BadRequestException(
          'Dimensions may be blank only for a myUnishippers-only comparison',
        );
      const hasQueuedAttempt = input.providers.some((provider) =>
        queueable(provider.code),
      );
      const [row] = await manager.query(
        'INSERT INTO quote_requests(idempotency_key,created_by_id,input,senders,status) VALUES ($1,$2,$3,$4,$5) RETURNING external_id',
        [
          input.idempotencyKey,
          actorId,
          JSON.stringify(input),
          JSON.stringify(senders),
          hasQueuedAttempt ? 'queued' : 'failed',
        ],
      );
      const [{ id: requestId }] = await manager.query(
        'SELECT id FROM quote_requests WHERE external_id=$1',
        [row.external_id],
      );
      for (const [position, group] of input.packageGroups.entries()) {
        const [{ id: groupId }] = await manager.query(
          `INSERT INTO quote_package_groups(normalized,request_id,position,quantity,units,length_original,width_original,height_original,weight_original,length_value,width_value,height_value,weight_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($6::text,'')::numeric,NULLIF($7::text,'')::numeric,NULLIF($8::text,'')::numeric,$9::text::numeric) RETURNING id`,
          [
            JSON.stringify(canonicalMeasurements(group)),
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
      for (const sender of senders) {
        const provider = configurations.get(sender.code)!;
        const queued = queueable(sender.code);
        await manager.query(
          `INSERT INTO quote_provider_attempts(request_id,account_id,sender,conversion_snapshot,execution_mode,status,outcome,reason_code,completed_at)
          SELECT $1,a.id,$2,$3,$4,$5::varchar,$6,$7,CASE WHEN $5::varchar='failed' THEN clock_timestamp() ELSE NULL END
          FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id WHERE p.code=$8`,
          [
            requestId,
            JSON.stringify(sender),
            JSON.stringify(conversionSnapshot(input, sender.code)),
            provider.executionMode,
            queued ? 'queued' : 'failed',
            queued ? null : 'unsupported',
            queued ? null : 'unsupported',
            sender.code,
          ],
        );
      }
      const [saved] = await manager.query(
        `${projection} WHERE q.external_id=$1`,
        [row.external_id],
      );
      return { outcome: 'created' as const, comparison: comparison(saved) };
    });
  }

  async retry(id: string, attemptId: string) {
    return this.source.transaction(async (manager) => {
      const [target] = await manager.query(
        `SELECT a.account_id,s.provider_id FROM quote_provider_attempts a
         JOIN quote_requests q ON q.id=a.request_id JOIN shipping_accounts s ON s.id=a.account_id
         WHERE q.external_id=$1 AND a.external_id=$2 AND q.deleted_at IS NULL`,
        [id, attemptId],
      );
      if (!target)
        throw new NotFoundException('Comparison or attempt not found');

      // Match worker lock order: provider configuration, account, then comparison.
      await manager.query(
        'SELECT id FROM shipping_providers WHERE id=$1 FOR SHARE',
        [target.provider_id],
      );
      await manager.query(
        'SELECT id FROM shipping_accounts WHERE id=$1 FOR UPDATE',
        [target.account_id],
      );
      await manager.query(
        'SELECT id FROM quote_requests WHERE external_id=$1 FOR UPDATE',
        [id],
      );
      const [row] = await manager.query(
        `${projection} WHERE q.external_id=$1 AND q.deleted_at IS NULL`,
        [id],
      );
      if (!row) throw new NotFoundException('Comparison not found');
      const current = comparison(row);
      const attempt = current.attempts.find(
        (item) => item.externalId === attemptId,
      )!;
      if (attempt.retryBlockedReason)
        throw new ConflictException({
          message:
            'Retry is unavailable. Copy to new comparison when inputs need changing.',
          reason: attempt.retryBlockedReason,
        });

      await manager.query(
        `INSERT INTO quote_provider_attempts(request_id,account_id,sender,conversion_snapshot,execution_mode,status,attempt_number)
        SELECT request_id,account_id,sender,conversion_snapshot,p.execution_mode,'queued',attempt_number+1
        FROM quote_provider_attempts a JOIN shipping_accounts s ON s.id=a.account_id
        JOIN shipping_providers p ON p.id=s.provider_id WHERE a.external_id=$1`,
        [attemptId],
      );
      await manager.query(
        `UPDATE quote_requests SET status=CASE WHEN EXISTS(
        SELECT 1 FROM quote_provider_attempts WHERE request_id=quote_requests.id AND status='running'
      ) THEN 'running' ELSE 'queued' END WHERE external_id=$1`,
        [id],
      );
      const [saved] = await manager.query(
        `${projection} WHERE q.external_id=$1`,
        [id],
      );
      return comparison(saved);
    });
  }

  async setDeleted(id: string, deleted: boolean, actorId: number) {
    return this.source.transaction(async (manager) => {
      const [row] = await manager.query(
        'SELECT id,status,deleted_at FROM quote_requests WHERE external_id=$1 FOR UPDATE',
        [id],
      );
      if (!row) throw new NotFoundException('Comparison not found');
      const [active] = await manager.query(
        "SELECT id FROM quote_provider_attempts WHERE request_id=$1 AND status IN ('queued','running') LIMIT 1",
        [row.id],
      );
      if (deleted && (active || !['completed', 'failed'].includes(row.status)))
        throw new ConflictException(
          'Only completed or failed comparisons can be deleted',
        );
      if (deleted && !row.deleted_at)
        await manager.query(
          'UPDATE quote_requests SET deleted_at=statement_timestamp(),last_deleted_at=statement_timestamp(),deleted_by_id=$2 WHERE id=$1',
          [row.id, actorId],
        );
      if (!deleted && row.deleted_at)
        await manager.query(
          'UPDATE quote_requests SET deleted_at=NULL,deleted_by_id=NULL,restored_at=clock_timestamp(),restored_by_id=$2 WHERE id=$1',
          [row.id, actorId],
        );
      const [saved] = await manager.query(
        `${projection} WHERE q.external_id=$1`,
        [id],
      );
      return comparison(saved);
    });
  }

  async find(id: string, includeDeleted = false) {
    const [row] = await this.source.query(
      `${projection} WHERE q.external_id=$1 AND ($2::boolean OR q.deleted_at IS NULL)`,
      [id, includeDeleted],
    );
    return row ? comparison(row) : null;
  }
  async list(page: number, deleted = false) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const rows = await manager.query(
        `${projection} WHERE (q.deleted_at IS NOT NULL)=$2 ORDER BY q.created_at DESC,q.id DESC LIMIT 25 OFFSET $1`,
        [(page - 1) * 25, deleted],
      );
      const [{ total }] = await manager.query(
        'SELECT count(*)::integer AS total FROM quote_requests WHERE (deleted_at IS NOT NULL)=$1',
        [deleted],
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
