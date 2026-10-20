import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { retryInputBlock } from './quote-retry-policy.js';
import {
  QuoteExecutionRepository,
  type LeasedQuote,
  type ExecutionResult,
} from './quote-execution.repository.js';

export class TypeOrmQuoteExecutionRepository extends QuoteExecutionRepository {
  constructor(private readonly source: DataSource) {
    super();
  }

  async claim(leaseMs: number): Promise<LeasedQuote | null> {
    return this.source.transaction(async (manager) => {
      // Account locks serialize claims and completion, including expired-lease recovery.
      const [account] = await manager.query(`
        SELECT s.id FROM shipping_accounts s
        WHERE EXISTS (SELECT 1 FROM quote_provider_attempts a WHERE a.account_id=s.id
          AND (a.status='queued' OR (a.status='running' AND a.lease_until <= clock_timestamp())))
        AND NOT EXISTS (SELECT 1 FROM quote_provider_attempts a WHERE a.account_id=s.id
          AND a.status='running' AND a.lease_until > clock_timestamp())
        ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1`);

      if (!account) return null;

      const [attempt] = await manager.query(
        `SELECT a.*,a.lease_until > clock_timestamp() AS leased,p.code,p.execution_mode AS mode,p.enabled,p.used_internationally,q.input
        FROM quote_provider_attempts a JOIN quote_requests q ON q.id=a.request_id
        JOIN shipping_accounts s ON s.id=a.account_id JOIN shipping_providers p ON p.id=s.provider_id
        WHERE a.account_id=$1 AND a.status IN ('queued','running')
        ORDER BY (a.status='running') DESC,a.created_at,a.id LIMIT 1`,
        [account.id],
      );

      if (!attempt) return null;

      if (attempt.status === 'running' && attempt.leased) return null;

      await manager.query(
        'SELECT id FROM quote_requests WHERE id=$1 FOR UPDATE',
        [attempt.request_id],
      );

      // Revalidate retries at execution time as configuration/date can change while queued.
      const blocked =
        attempt.attempt_number > 1
          ? retryInputBlock(attempt.input, attempt.sender, {
              code: attempt.code,
              enabled: attempt.enabled,
              executionMode: attempt.mode,
              usedInternationally: attempt.used_internationally,
            })
          : null;
      if (blocked) {
        await manager.query(
          `UPDATE quote_provider_attempts SET status='failed',outcome=$2,reason_code=$3,
          execution_mode=$4,completed_at=clock_timestamp(),lease_until=NULL,lease_owner=NULL WHERE id=$1`,
          [
            attempt.id,
            blocked === 'provider_disabled' ? 'failed' : 'validation_failed',
            blocked === 'provider_disabled'
              ? 'provider_disabled'
              : 'validation_failed',
            attempt.mode,
          ],
        );
        await this.summarize(manager, attempt.request_id);
        return null;
      }

      if (attempt.status === 'running' && attempt.recovery_count === 1) {
        await manager.query(
          `UPDATE quote_provider_attempts SET status='failed',outcome='failed',reason_code='recovery_exhausted',
          completed_at=clock_timestamp(),lease_until=NULL,lease_owner=NULL WHERE id=$1`,
          [attempt.id],
        );

        await this.summarize(manager, attempt.request_id);

        return null;
      }

      const owner = randomUUID();

      await manager.query(
        `UPDATE quote_provider_attempts SET status='running',lease_owner=$2,
        lease_until=clock_timestamp()+($3 * interval '1 millisecond'),started_at=COALESCE(started_at,clock_timestamp()),
        execution_mode=$4,recovery_count=recovery_count+CASE WHEN status='running' THEN 1 ELSE 0 END
        WHERE id=$1`,
        [attempt.id, owner, leaseMs, attempt.mode],
      );

      await this.summarize(manager, attempt.request_id);

      return {
        id: attempt.id,
        requestId: attempt.request_id,
        accountId: account.id,
        owner,
        code: attempt.code,
        mode: attempt.mode,
        enabled: attempt.enabled,
        input: attempt.input,
        sender: attempt.sender,
        conversionSnapshot: attempt.conversion_snapshot,
        reloginCount: attempt.diagnostics.reloginCount === 1 ? 1 : 0,
      };
    });
  }

  async reserveRelogin(job: LeasedQuote): Promise<boolean> {
    const rows = await this.source.query(
      `UPDATE quote_provider_attempts
      SET diagnostics=jsonb_build_object('reloginCount',1)
      WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_until > clock_timestamp()
      AND COALESCE((diagnostics->>'reloginCount')::int,0)=0 RETURNING id`,
      [job.id, job.owner],
    );

    return rows[1] === 1;
  }

  async finish(job: LeasedQuote, result: ExecutionResult): Promise<boolean> {
    return this.source.transaction(async (manager) => {
      await manager.query(
        'SELECT id FROM shipping_accounts WHERE id=$1 FOR UPDATE',
        [job.accountId],
      );

      await manager.query(
        'SELECT id FROM quote_requests WHERE id=$1 FOR UPDATE',
        [job.requestId],
      );
      const [current] = await manager.query(
        `SELECT id FROM quote_provider_attempts WHERE id=$1 AND status='running'
        AND lease_owner=$2 AND lease_until > clock_timestamp() FOR UPDATE`,
        [job.id, job.owner],
      );

      if (!current) return false;

      for (const quote of result.quotes) {
        const [savedQuote] = await manager.query(
          `INSERT INTO shipping_quotes(attempt_id,carrier,service,transportation_total,currency,
          estimate_method,transit_description,expires_at,retrieved_at,option_coverage,duty_status,tax_status,clearance_status,group_contributions)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,$12,$13::jsonb) RETURNING id`,
          [
            job.id,
            quote.carrier,
            quote.service,
            quote.total,
            quote.currency,
            quote.estimateMethod,
            quote.transitDescription ?? null,
            quote.expiresAt ?? null,
            quote.optionCoverage ?? 'unverified',
            quote.dutyStatus ?? 'unknown',
            quote.taxStatus ?? 'unknown',
            quote.clearanceStatus ?? 'unknown',
            JSON.stringify(quote.groupContributions ?? []),
          ],
        );
        for (const charge of quote.charges ?? []) {
          const [group] =
            charge.packageGroupPosition === null
              ? []
              : await manager.query(
                  'SELECT id FROM quote_package_groups WHERE request_id=$1 AND position=$2',
                  [job.requestId, charge.packageGroupPosition],
                );
          await manager.query(
            `INSERT INTO shipping_quote_items(quote_id,package_group_id,description,amount,scope)
            VALUES ($1,$2,$3,$4,$5)`,
            [
              savedQuote.id,
              group?.id ?? null,
              charge.description,
              charge.amount,
              charge.scope,
            ],
          );
        }
      }
      // Diagnostics are constructed here; raw errors and provider payloads are never accepted.
      await manager.query(
        `UPDATE quote_provider_attempts SET status=$3,outcome=$4,reason_code=$5,simulated=$6,
        diagnostics=jsonb_build_object('reloginCount',GREATEST(COALESCE((diagnostics->>'reloginCount')::int,0),$7::int)),completed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL
        WHERE id=$1 AND lease_owner=$2`,
        [
          job.id,
          job.owner,
          result.outcome === 'success' ? 'completed' : 'failed',
          result.outcome,
          result.reason,
          result.simulated,
          result.relogins,
        ],
      );

      await this.summarize(manager, job.requestId);

      return true;
    });
  }

  private async summarize(manager: EntityManager, requestId: string) {
    // The request lock prevents concurrent provider completions losing the aggregate status.
    await manager.query(
      `UPDATE quote_requests SET status=(SELECT CASE
      WHEN bool_or(status='running') THEN 'running'
      WHEN bool_or(status='queued') THEN 'queued'
      WHEN bool_or(status='completed') THEN 'completed' ELSE 'failed' END
      FROM quote_provider_attempts WHERE request_id=$1) WHERE id=$1`,
      [requestId],
    );
  }
}
