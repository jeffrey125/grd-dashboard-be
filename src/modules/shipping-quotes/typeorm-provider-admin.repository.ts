import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ProviderAdminRepository,
  type ProviderSettingsInput,
  type ReadinessWork,
  type ReadinessFailure,
} from './provider-admin.repository.js';
import {
  providerSupportsExecutionMode,
  type ExecutionMode,
} from './provider-execution-mode.js';
import { providerCode } from './quote.schemas.js';

const testProjection = `SELECT t.id,t.mode AS "executionMode",t.state,t.failure_summary AS "failureSummary",
  t.created_at AS "createdAt",t.completed_at AS "completedAt",t.completed_at + interval '15 minutes' AS "expiresAt",
  t.consumed_at AS "savedAt",u.external_id AS "testedBy"
  FROM shipping_provider_tests t JOIN auth_users u ON u.id=t.actor_id`;

export class TypeOrmProviderAdminRepository extends ProviderAdminRepository {
  constructor(private readonly source: DataSource) {
    super();
  }

  async settings() {
    const rows = await this.source
      .query(`SELECT p.code,p.name,p.enabled,p.execution_mode AS "executionMode",
      p.maintenance_message AS "maintenanceMessage",p.stale_hours AS "staleHours",p.revision,
      p.updated_at AS "updatedAt",u.external_id AS "updatedBy",
      (SELECT row_to_json(t) FROM (${testProjection} WHERE t.provider_id=p.id AND t.consumed_at IS NOT NULL ORDER BY t.consumed_at DESC LIMIT 1) t) AS "savedConnectionTest"
      FROM shipping_providers p LEFT JOIN auth_users u ON u.id=p.updated_by_id ORDER BY p.id`);
    return rows.map(
      (row: { savedConnectionTest: Record<string, unknown> | null }) => {
        const test = row.savedConnectionTest;
        if (!test) return row;
        return {
          ...row,
          savedConnectionTest: {
            ...test,
            ...Object.fromEntries(
              ['createdAt', 'completedAt', 'expiresAt', 'savedAt'].map(
                (key) => [
                  key,
                  test[key]
                    ? new Date(test[key] as string).toISOString()
                    : null,
                ],
              ),
            ),
          },
        };
      },
    );
  }

  async save(code: string, input: ProviderSettingsInput, actorId: number) {
    this.assertMode(code, input.executionMode);
    await this.source.transaction(async (manager) => {
      // The provider lock also serializes create/retry and worker start with disable.
      const [provider] = await manager.query(
        'SELECT * FROM shipping_providers WHERE code=$1 FOR UPDATE',
        [code],
      );
      if (!provider) throw new NotFoundException('Provider not found');
      if (provider.revision !== input.revision)
        throw new ConflictException('Settings changed; reload before saving');
      if (provider.execution_mode !== input.executionMode) {
        const [test] = await manager.query(
          `SELECT * FROM shipping_provider_tests
          WHERE id=$1 AND provider_id=$2 AND actor_id=$3 AND mode=$4 AND revision=$5
          AND state IN ('succeeded','failed') AND consumed_at IS NULL
          AND completed_at + interval '15 minutes' > clock_timestamp() FOR UPDATE`,
          [
            input.connectionTestId ?? null,
            provider.id,
            actorId,
            input.executionMode,
            provider.revision,
          ],
        );
        if (!test)
          throw new ConflictException(
            'Run a current connection test for the proposed mode',
          );
        if (test.state === 'failed' && !input.acknowledgeFailure)
          throw new ConflictException(
            'Acknowledge the failed connection test before saving',
          );
        await manager.query(
          'UPDATE shipping_provider_tests SET consumed_at=clock_timestamp() WHERE id=$1',
          [test.id],
        );
      }
      await manager.query(
        `UPDATE shipping_providers SET enabled=$2,execution_mode=$3,maintenance_message=$4,
        stale_hours=$5,updated_by_id=$6,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,
        [
          provider.id,
          input.enabled,
          input.executionMode,
          input.maintenanceMessage || null,
          input.staleHours,
          actorId,
        ],
      );
    });
  }

  async enqueue(code: string, mode: ReadinessWork['mode'], actorId: number) {
    this.assertMode(code, mode);
    const id = await this.source.transaction(async (manager) => {
      const [provider] = await manager.query(
        'SELECT id,revision FROM shipping_providers WHERE code=$1 FOR UPDATE',
        [code],
      );
      if (!provider) throw new NotFoundException('Provider not found');
      await manager.query(
        `UPDATE shipping_provider_tests SET state='failed',failure_summary='readiness_timeout',completed_at=clock_timestamp()
        WHERE provider_id=$1 AND state IN ('queued','running') AND deadline <= clock_timestamp()`,
        [provider.id],
      );
      const [pending] = await manager.query(
        "SELECT id FROM shipping_provider_tests WHERE provider_id=$1 AND state IN ('queued','running')",
        [provider.id],
      );
      if (pending)
        throw new ConflictException(
          'A connection test is already pending for this provider',
        );
      const [test] = await manager.query(
        `INSERT INTO shipping_provider_tests(provider_id,actor_id,mode,revision,deadline)
        VALUES ($1,$2,$3,$4,clock_timestamp()+interval '90 seconds') RETURNING id`,
        [provider.id, actorId, mode, provider.revision],
      );
      return test.id as string;
    });
    return this.result(code, id, actorId);
  }

  async result(code: string, id: string, actorId: number) {
    await this.source.query(
      `UPDATE shipping_provider_tests SET state='failed',failure_summary='readiness_timeout',completed_at=clock_timestamp()
      WHERE id=$1 AND actor_id=$2 AND state IN ('queued','running') AND deadline <= clock_timestamp()`,
      [id, actorId],
    );
    const [row] = await this.source.query(
      `${testProjection}
      JOIN shipping_providers p ON p.id=t.provider_id WHERE t.id=$1 AND p.code=$2 AND t.actor_id=$3`,
      [id, code, actorId],
    );
    if (!row) throw new NotFoundException('Connection test not found');
    return row;
  }

  async claim(): Promise<ReadinessWork | null> {
    return this.source.transaction(async (manager) => {
      const [account] =
        await manager.query(`SELECT a.id,p.code FROM shipping_accounts a JOIN shipping_providers p ON p.id=a.provider_id
        WHERE EXISTS (SELECT 1 FROM shipping_provider_tests t WHERE t.provider_id=p.id AND t.state='queued' AND t.deadline>clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM quote_provider_attempts q WHERE q.account_id=a.id AND q.status='running' AND q.lease_until>clock_timestamp())
        AND NOT (COALESCE(a.default_refresh->>'state','')='running' AND (a.default_refresh->>'deadline')::timestamptz>clock_timestamp())
        ORDER BY a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`);
      if (!account) return null;
      // The account lock is the shared reservation seam. Use a new statement
      // snapshot after locking to observe another worker's committed claim.
      const [reservation] = await manager.query(
        `SELECT
        EXISTS (SELECT 1 FROM quote_provider_attempts q WHERE q.account_id=$1 AND q.status='running' AND q.lease_until>clock_timestamp()) OR
        EXISTS (SELECT 1 FROM shipping_accounts a WHERE a.id=$1 AND a.default_refresh->>'state'='running' AND (a.default_refresh->>'deadline')::timestamptz>clock_timestamp()) AS busy`,
        [account.id],
      );
      if (reservation.busy) return null;
      const [[test]] = await manager.query(
        `UPDATE shipping_provider_tests t SET state='running',deadline=clock_timestamp()+interval '90 seconds'
        FROM shipping_accounts a WHERE a.id=$1 AND t.provider_id=a.provider_id AND t.state='queued' AND t.deadline>clock_timestamp()
        RETURNING t.id,t.mode`,
        [account.id],
      );
      return test ? { ...test, code: account.code } : null;
    });
  }

  async finish(work: ReadinessWork, failure: ReadinessFailure | null) {
    await this.source.query(
      `UPDATE shipping_provider_tests SET state=$2,failure_summary=$3,completed_at=clock_timestamp()
      WHERE id=$1 AND state='running' AND deadline>clock_timestamp()`,
      [work.id, failure ? 'failed' : 'succeeded', failure],
    );
  }

  private assertMode(code: string, mode: ExecutionMode) {
    const parsed = providerCode.safeParse(code);
    if (!parsed.success || !providerSupportsExecutionMode(parsed.data, mode))
      throw new BadRequestException(
        'Execution mode is unavailable for provider',
      );
  }
}
