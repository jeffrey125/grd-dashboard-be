import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from '@modules/shipments/shipment.entity.js';
import { shipmentSearchQuerySchema } from '@modules/shipments/shipments.schemas.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('Shipment search PostgreSQL repository', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let repository: TypeOrmShipmentsRepository;
  let carrier: CarrierEntity;
  let sequence = 0;

  beforeAll(async () => {
    db = await shipmentDatabase();
    repository = new TypeOrmShipmentsRepository(db.source);
    carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
  });

  afterAll(async () => {
    await db?.close();
  });

  const search = (query: Record<string, unknown> = {}) =>
    repository.search(shipmentSearchQuerySchema.parse(query));

  async function create(
    label: string,
    carrierExternalId = carrier.externalId,
    notes: string | null = null,
  ) {
    sequence += 1;
    const result = await repository.createMany([
      {
        carrierExternalId,
        trackingReference: `${label}-${sequence}`,
        notes,
      },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    return db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: result.inserted[0]!.externalId });
  }

  async function snapshot(
    shipment: ShipmentEntity,
    estimatedDeliveryOn: string | null,
    deliveredOn: string | null = null,
  ) {
    const [created]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, estimated_delivery_on, delivered_on)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        shipment.id,
        deliveredOn ? 'Delivered' : 'In transit',
        estimatedDeliveryOn,
        deliveredOn,
      ],
    );

    await db.source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [created!.id, shipment.id],
    );

    return created!.id;
  }

  async function attempt(
    shipment: ShipmentEntity,
    outcome: 'found' | 'not_found' | 'failed' | 'skipped',
    completedAt: string,
    snapshotId: string | null = null,
  ) {
    const [run]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO tracking_runs
        (carrier_id, trigger, status, created_at, started_at, completed_at)
       VALUES ($1, 'manual', 'succeeded', $2, $2, $2) RETURNING id`,
      [shipment.carrierId, completedAt],
    );

    await db.source.query(
      `INSERT INTO tracking_attempts
        (tracking_run_id, shipment_id, outcome, snapshot_id, retryable, reason_code, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run!.id,
        shipment.id,
        outcome,
        snapshotId,
        outcome === 'failed' ? true : null,
        outcome === 'failed'
          ? 'TEST_FAILURE'
          : outcome === 'skipped'
            ? 'TEST_SKIP'
            : null,
        completedAt,
      ],
    );
  }

  async function pendingAttempt(shipment: ShipmentEntity) {
    const [run]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO tracking_runs (carrier_id, trigger, status)
       VALUES ($1, 'manual', 'queued') RETURNING id`,
      [shipment.carrierId],
    );

    await db.source.query(
      `INSERT INTO tracking_attempts (tracking_run_id, shipment_id)
       VALUES ($1, $2)`,
      [run!.id, shipment.id],
    );
  }

  it('defaults to Active and returns overlapping tab counts from all matching rows', async () => {
    const group = `states-${sequence + 1}`;
    const active = await create(`${group}-active`);
    const failed = await create(`${group}-failed`);
    const manual = await create(`${group}-manual`);
    const threshold = await create(`${group}-threshold`);
    const delivered = await create(`${group}-delivered`);
    const removed = await create(`${group}-removed`);
    const disabledCarrier = await db.source.getRepository(CarrierEntity).save({
      code: `disabled-search-${sequence}`,
      name: 'Disabled search Carrier',
      pollIntervalMinutes: 5,
    });
    const disabled = await create(
      `${group}-disabled`,
      disabledCarrier.externalId,
    );

    await attempt(failed, 'failed', '2026-01-01T12:00:00Z');
    await db.source.getRepository(ShipmentEntity).update(
      { id: manual.id },
      {
        monitoringStatus: ShipmentMonitoringStatus.Paused,
        monitoringReason: ShipmentMonitoringReason.Manual,
        nextCheckAt: null,
      },
    );
    await db.source.getRepository(ShipmentEntity).update(
      { id: threshold.id },
      {
        monitoringStatus: ShipmentMonitoringStatus.Paused,
        monitoringReason: ShipmentMonitoringReason.NotFoundThreshold,
        nextCheckAt: null,
      },
    );
    await db.source.getRepository(ShipmentEntity).update(
      { id: delivered.id },
      {
        monitoringStatus: ShipmentMonitoringStatus.Completed,
        monitoringReason: ShipmentMonitoringReason.Delivered,
        nextCheckAt: null,
      },
    );
    await db.source
      .getRepository(CarrierEntity)
      .update({ id: disabledCarrier.id }, { isActive: false });
    await repository.remove(removed.externalId);

    const result = await search({ q: group });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 3,
      tabCounts: { all: 6, active: 3, paused: 2, delivered: 1, attention: 2 },
    });
    expect(result.items.map((item) => item.externalId)).toEqual([
      disabled.externalId,
      failed.externalId,
      active.externalId,
    ]);
    expect(result.items[0]!.carrier.isActive).toBe(false);
    expect(
      result.items.find((item) => item.externalId === failed.externalId)
        ?.latestLookup,
    ).toMatchObject({
      outcome: 'failed',
      reasonCode: 'TEST_FAILURE',
    });

    const attention = await search({ q: group, tab: 'attention' });

    expect(attention.total).toBe(2);
    expect(attention.tabCounts).toEqual(result.tabCounts);
    expect(attention.items.map((item) => item.externalId).sort()).toEqual(
      [failed.externalId, threshold.externalId].sort(),
    );

    for (const [tab, expected] of [
      ['all', [active, failed, manual, threshold, delivered, disabled]],
      ['paused', [manual, threshold]],
      ['delivered', [delivered]],
    ] as const) {
      const tabResult = await search({ q: group, tab });

      expect(tabResult.items.map((item) => item.externalId).sort()).toEqual(
        expected.map((item) => item.externalId).sort(),
      );
      expect(tabResult.tabCounts).toEqual(result.tabCounts);
    }
  });

  it('combines literal search, Carrier, completed-outcome, and undelivered filters', async () => {
    const otherCarrier = await db.source.getRepository(CarrierEntity).save({
      code: `search-filter-${sequence}`,
      name: 'Search filter Carrier',
      pollIntervalMinutes: 5,
    });
    const literal = await create(
      'literal-%_Needle',
      otherCarrier.externalId,
      'Alpha note',
    );
    const wildcardLookalike = await create(
      'literal-xxneedle',
      otherCarrier.externalId,
      'Other',
    );
    const pending = await create(
      'literal-pending',
      otherCarrier.externalId,
      'Pending note',
    );
    const completed = await create(
      'literal-completed',
      otherCarrier.externalId,
      'Needle delivered',
    );
    const found = await create('outcome-found', otherCarrier.externalId);
    const notFound = await create('outcome-not-found', otherCarrier.externalId);
    const skipped = await create('outcome-skipped', otherCarrier.externalId);

    await pendingAttempt(pending);
    await attempt(literal, 'not_found', '2026-02-01T12:00:00Z');
    await attempt(literal, 'failed', '2026-02-02T12:00:00Z');
    await attempt(
      found,
      'found',
      '2026-02-03T12:00:00Z',
      await snapshot(found, '2026-05-01'),
    );
    await attempt(notFound, 'not_found', '2026-02-03T12:00:00Z');
    await attempt(skipped, 'skipped', '2026-02-03T12:00:00Z');
    await db.source.getRepository(ShipmentEntity).update(
      { id: completed.id },
      {
        monitoringStatus: ShipmentMonitoringStatus.Completed,
        monitoringReason: ShipmentMonitoringReason.Delivered,
        nextCheckAt: null,
      },
    );

    expect(
      (
        await search({
          tab: 'all',
          q: '%_needle',
          carrierExternalId: otherCarrier.externalId,
        })
      ).items.map((item) => item.externalId),
    ).toEqual([literal.externalId]);
    expect(wildcardLookalike.externalId).not.toBe(literal.externalId);

    const latestFailed = await search({
      tab: 'all',
      carrierExternalId: otherCarrier.externalId,
      lookupOutcome: 'failed',
    });

    expect(latestFailed.items.map((item) => item.externalId)).toEqual([
      literal.externalId,
    ]);

    for (const [lookupOutcome, expected] of [
      ['found', found],
      ['not_found', notFound],
      ['skipped', skipped],
    ] as const) {
      const result = await search({
        tab: 'all',
        carrierExternalId: otherCarrier.externalId,
        lookupOutcome,
      });

      expect(result.items.map((item) => item.externalId)).toEqual([
        expected.externalId,
      ]);
    }

    const neverChecked = await search({
      tab: 'all',
      carrierExternalId: otherCarrier.externalId,
      lookupOutcome: 'never_checked',
    });

    expect(neverChecked.items.map((item) => item.externalId).sort()).toEqual(
      [
        completed.externalId,
        pending.externalId,
        wildcardLookalike.externalId,
      ].sort(),
    );

    const undelivered = await search({
      tab: 'all',
      carrierExternalId: otherCarrier.externalId,
      undeliveredOnly: 'true',
    });

    expect(undelivered.items.map((item) => item.externalId)).not.toContain(
      completed.externalId,
    );
    expect(undelivered.tabCounts.delivered).toBe(0);
  });

  it('uses New York calendar boundaries across spring and fall DST changes', async () => {
    const springBefore = await create('dst-spring-before');
    const springStart = await create('dst-spring-start');
    const springEnd = await create('dst-spring-end');
    const springAfter = await create('dst-spring-after');
    const fallStart = await create('dst-fall-start');
    const fallEnd = await create('dst-fall-end');

    const timestamps = new Map<ShipmentEntity, string>([
      [springBefore, '2026-03-08T04:59:59.999Z'],
      [springStart, '2026-03-08T05:00:00.000Z'],
      [springEnd, '2026-03-09T03:59:59.999Z'],
      [springAfter, '2026-03-09T04:00:00.000Z'],
      [fallStart, '2026-11-01T04:00:00.000Z'],
      [fallEnd, '2026-11-02T04:59:59.999Z'],
    ]);

    for (const [shipment, createdAt] of timestamps)
      await db.source
        .getRepository(ShipmentEntity)
        .update({ id: shipment.id }, { createdAt: new Date(createdAt) });

    expect(
      (
        await search({
          tab: 'all',
          q: 'dst-spring',
          createdFrom: '2026-03-08',
          createdTo: '2026-03-08',
        })
      ).items.map((item) => item.externalId),
    ).toEqual([springEnd.externalId, springStart.externalId]);
    expect(
      (
        await search({
          tab: 'all',
          q: 'dst-fall',
          createdFrom: '2026-11-01',
          createdTo: '2026-11-01',
        })
      ).items.map((item) => item.externalId),
    ).toEqual([fallEnd.externalId, fallStart.externalId]);
  });

  it('filters date-only ETAs, sorts nulls last, and keeps ties deterministic', async () => {
    const first = await create('eta-tie');
    const second = await create('eta-tie');
    const outside = await create('eta-outside');
    const missing = await create('eta-missing');

    await snapshot(first, '2026-05-10');
    await snapshot(second, '2026-05-10');
    await snapshot(outside, '2026-05-11');
    const sameCreatedAt = new Date('2026-04-01T12:00:00Z');

    await db.source
      .getRepository(ShipmentEntity)
      .update({ id: first.id }, { createdAt: sameCreatedAt });
    await db.source
      .getRepository(ShipmentEntity)
      .update({ id: second.id }, { createdAt: sameCreatedAt });

    expect(
      (
        await search({
          tab: 'all',
          q: 'eta-tie',
        })
      ).items.map((item) => item.externalId),
    ).toEqual([second.externalId, first.externalId]);

    const ranged = await search({
      tab: 'all',
      q: 'eta-',
      estimatedDeliveryFrom: '2026-05-10',
      estimatedDeliveryTo: '2026-05-10',
      sortBy: 'estimatedDeliveryOn',
      sortDirection: 'asc',
    });

    expect(ranged.items.map((item) => item.externalId)).toEqual([
      first.externalId,
      second.externalId,
    ]);
    expect(
      ranged.items.every(
        (item) => item.currentTracking?.estimatedDeliveryOn === '2026-05-10',
      ),
    ).toBe(true);

    const ascending = await search({
      tab: 'all',
      q: 'eta-',
      sortBy: 'estimatedDeliveryOn',
      sortDirection: 'asc',
    });

    expect(ascending.items.at(-1)?.externalId).toBe(missing.externalId);
  });

  it('implements every public sort with deterministic null placement', async () => {
    const beta = await create('ordering-search-beta');
    const alpha = await create('ordering-search-alpha');
    const gamma = await create('ordering-search-gamma');

    await db.source.getRepository(ShipmentEntity).update(
      { id: beta.id },
      {
        createdAt: new Date('2026-01-02T00:00:00Z'),
        lastAttemptedAt: new Date('2026-01-03T00:00:00Z'),
      },
    );
    await db.source.getRepository(ShipmentEntity).update(
      { id: alpha.id },
      {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastAttemptedAt: new Date('2026-01-02T00:00:00Z'),
      },
    );
    await db.source
      .getRepository(ShipmentEntity)
      .update(
        { id: gamma.id },
        { createdAt: new Date('2026-01-03T00:00:00Z'), lastAttemptedAt: null },
      );

    const ids = async (
      sortBy: 'createdAt' | 'trackingReference' | 'lastAttemptedAt',
      sortDirection: 'asc' | 'desc',
    ) =>
      (
        await search({
          tab: 'all',
          q: 'ordering-search-',
          pageSize: '50',
          sortBy,
          sortDirection,
        })
      ).items.map((item) => item.externalId);

    expect(await ids('createdAt', 'asc')).toEqual([
      alpha.externalId,
      beta.externalId,
      gamma.externalId,
    ]);
    expect(await ids('trackingReference', 'asc')).toEqual([
      alpha.externalId,
      beta.externalId,
      gamma.externalId,
    ]);
    expect(await ids('lastAttemptedAt', 'desc')).toEqual([
      beta.externalId,
      alpha.externalId,
      gamma.externalId,
    ]);
    expect(await ids('lastAttemptedAt', 'asc')).toEqual([
      alpha.externalId,
      beta.externalId,
      gamma.externalId,
    ]);
  });

  it('returns one consistent snapshot while a monitoring change is uncommitted', async () => {
    const shipment = await create('search-concurrent-state');
    const runner = db.source.createQueryRunner();

    await runner.connect();
    await runner.startTransaction();

    try {
      await runner.manager.getRepository(ShipmentEntity).update(
        { id: shipment.id },
        {
          monitoringStatus: ShipmentMonitoringStatus.Paused,
          monitoringReason: ShipmentMonitoringReason.Manual,
          nextCheckAt: null,
        },
      );

      const beforeCommit = await search({ q: 'search-concurrent-state' });

      expect(beforeCommit).toMatchObject({
        total: 1,
        tabCounts: { all: 1, active: 1, paused: 0, delivered: 0, attention: 0 },
      });
      expect(beforeCommit.items[0]!.monitoringStatus).toBe('active');

      await runner.commitTransaction();

      const afterCommit = await search({
        q: 'search-concurrent-state',
        tab: 'paused',
      });

      expect(afterCommit).toMatchObject({
        total: 1,
        tabCounts: { all: 1, active: 0, paused: 1, delivered: 0, attention: 0 },
      });
      expect(afterCommit.items[0]!.monitoringStatus).toBe('paused');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();

      await runner.release();
    }
  });

  it('returns accurate empty out-of-range pages and bounds a 10,000-row result in one query', async () => {
    const scaleCarrier = await db.source.getRepository(CarrierEntity).save({
      code: `search-scale-${sequence}`,
      name: 'Search scale Carrier',
      pollIntervalMinutes: 5,
    });

    await db.source.query(
      `INSERT INTO shipments (carrier_id, tracking_reference, created_at)
       SELECT $1, 'scale-' || lpad(n::text, 5, '0'), timestamptz '2026-01-01' + n * interval '1 millisecond'
       FROM generate_series(1, 10000) n`,
      [scaleCarrier.id],
    );

    const queries = vi.spyOn(db.source.logger, 'logQuery');
    let explainedQuery = '';
    let explainedParameters: unknown[] = [];

    try {
      const lastPage = await search({
        carrierExternalId: scaleCarrier.externalId,
        page: '100',
        pageSize: '100',
      });

      expect(lastPage).toMatchObject({
        page: 100,
        pageSize: 100,
        total: 10000,
        tabCounts: {
          all: 10000,
          active: 10000,
          paused: 0,
          delivered: 0,
          attention: 0,
        },
      });
      expect(lastPage.items).toHaveLength(100);
      expect(lastPage.items[0]!.trackingReference).toBe('scale-00100');
      expect(lastPage.items.at(-1)!.trackingReference).toBe('scale-00001');
      expect(queries).toHaveBeenCalledTimes(1);
      explainedQuery = queries.mock.calls[0]![0];
      const loggedParameters = queries.mock.calls[0]![1];

      if (loggedParameters && !Array.isArray(loggedParameters))
        throw new Error('Expected positional query parameters');

      explainedParameters = loggedParameters ?? [];

      queries.mockClear();

      const beyond = await search({
        carrierExternalId: scaleCarrier.externalId,
        page: '101',
        pageSize: '100',
      });

      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(10000);
      expect(queries).toHaveBeenCalledTimes(1);
    } finally {
      queries.mockRestore();
    }

    const [explain]: Array<{
      'QUERY PLAN': Array<{
        Plan: {
          'Node Type': string;
          'Actual Rows': number;
          'Shared Hit Blocks': number;
        };
        'Planning Time': number;
        'Execution Time': number;
      }>;
    }> = await db.source.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${explainedQuery}`,
      explainedParameters,
    );
    const plan = explain!['QUERY PLAN'][0]!;

    expect(plan.Plan['Actual Rows']).toBe(1);
    expect(plan['Planning Time']).toBeGreaterThan(0);
    expect(plan['Execution Time']).toBeGreaterThan(0);
  });
});
