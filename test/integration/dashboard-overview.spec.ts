import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmDashboardRepository } from '@modules/dashboard/typeorm-dashboard.repository.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from '@modules/shipments/shipment.entity.js';
import { shipmentSearchQuerySchema } from '@modules/shipments/shipments.schemas.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('Dashboard overview PostgreSQL repository', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let carrier: CarrierEntity;
  let shipments: TypeOrmShipmentsRepository;

  beforeAll(async () => {
    db = await shipmentDatabase();
  });

  beforeEach(async () => {
    await db.source.query(
      `TRUNCATE tracking_attempts, shipment_tracking_snapshots, tracking_runs,
        shipments, carriers RESTART IDENTITY CASCADE`,
    );
    carrier = await db.source.getRepository(CarrierEntity).save({
      code: 'dashboard-test',
      name: 'Dashboard test Carrier',
      pollIntervalMinutes: 5,
    });
    shipments = new TypeOrmShipmentsRepository(db.source);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function create(
    trackingReference: string,
    carrierExternalId = carrier.externalId,
  ) {
    const result = await shipments.createMany([
      { carrierExternalId, trackingReference, notes: null },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    return db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: result.inserted[0]!.externalId });
  }

  async function snapshot(
    shipment: ShipmentEntity,
    estimatedDeliveryOn: string | null,
    observedAt: string,
  ) {
    const [created]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, estimated_delivery_on, observed_at)
       VALUES ($1, 'In transit', $2, $3) RETURNING id`,
      [shipment.id, estimatedDeliveryOn, observedAt],
    );

    await db.source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [created!.id, shipment.id],
    );

    return created!.id;
  }

  async function fail(shipment: ShipmentEntity, completedAt: string) {
    const [run]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO tracking_runs
        (carrier_id, trigger, status, created_at, started_at, completed_at)
       VALUES ($1, 'manual', 'failed', $2, $2, $2) RETURNING id`,
      [shipment.carrierId, completedAt],
    );

    await db.source.query(
      `INSERT INTO tracking_attempts
        (tracking_run_id, shipment_id, outcome, retryable, reason_code, completed_at)
       VALUES ($1, $2, 'failed', true, 'DASHBOARD_TEST_FAILURE', $3)`,
      [run!.id, shipment.id, completedAt],
    );
  }

  it.each([
    ['2026-03-08T04:59:59.000Z', '2026-03-07', '2026-03-13'],
    ['2026-03-08T05:00:00.000Z', '2026-03-08', '2026-03-14'],
    ['2026-11-01T03:59:59.000Z', '2026-10-31', '2026-11-06'],
    ['2026-11-01T04:00:00.000Z', '2026-11-01', '2026-11-07'],
  ])('uses the New York business date at %s', async (timestamp, from, to) => {
    const asOf = new Date(timestamp);
    const repository = new TypeOrmDashboardRepository(db.source, () => asOf);

    await expect(repository.overview()).resolves.toEqual({
      asOf,
      timezone: 'America/New_York',
      upcomingWindow: { from, to },
      counts: {
        all: 0,
        active: 0,
        paused: 0,
        delivered: 0,
        attention: 0,
      },
      attention: { total: 0, items: [] },
      upcomingDeliveries: { total: 0, items: [] },
      recentChanges: [],
    });
  });

  it('shares search state totals and handles disabled, deleted, null, and ETA rows', async () => {
    const active = await create('dashboard-active');
    const failed = await create('dashboard-failed');
    const manual = await create('dashboard-manual');
    const threshold = await create('dashboard-threshold');
    const delivered = await create('dashboard-delivered');
    const removed = await create('dashboard-removed');
    const disabledCarrier = await db.source.getRepository(CarrierEntity).save({
      code: 'dashboard-disabled',
      name: 'Disabled dashboard Carrier',
      pollIntervalMinutes: 5,
    });
    const disabled = await create(
      'dashboard-disabled-shipment',
      disabledCarrier.externalId,
    );

    await db.source
      .getRepository(CarrierEntity)
      .update({ id: disabledCarrier.id }, { isActive: false });

    await snapshot(active, '2026-03-08', '2026-03-08T10:00:00Z');
    await snapshot(failed, '2026-03-14', '2026-03-08T11:00:00Z');
    await snapshot(manual, '2026-03-10', '2026-03-08T12:00:00Z');
    await snapshot(threshold, '2026-03-15', '2026-03-08T13:00:00Z');
    await snapshot(delivered, '2026-03-09', '2026-03-08T14:00:00Z');
    await snapshot(removed, '2026-03-11', '2026-03-08T16:00:00Z');
    await snapshot(disabled, '2026-03-12', '2026-03-08T15:00:00Z');
    await fail(failed, '2026-03-08T17:00:00Z');
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
        createdAt: new Date('2026-03-02T00:00:00Z'),
      },
    );
    await db.source
      .getRepository(ShipmentEntity)
      .update(
        { id: failed.id },
        { createdAt: new Date('2026-03-01T00:00:00Z') },
      );
    await db.source.getRepository(ShipmentEntity).update(
      { id: delivered.id },
      {
        monitoringStatus: ShipmentMonitoringStatus.Completed,
        monitoringReason: ShipmentMonitoringReason.Delivered,
        nextCheckAt: null,
      },
    );
    await shipments.remove(removed.externalId);

    const asOf = new Date('2026-03-08T12:00:00.000Z');
    const overview = await new TypeOrmDashboardRepository(
      db.source,
      () => asOf,
    ).overview();
    const attentionSearch = await shipments.search(
      shipmentSearchQuerySchema.parse({ tab: 'attention' }),
    );
    const upcomingSearch = await shipments.search(
      shipmentSearchQuerySchema.parse({
        tab: 'all',
        undeliveredOnly: 'true',
        estimatedDeliveryFrom: overview.upcomingWindow.from,
        estimatedDeliveryTo: overview.upcomingWindow.to,
        sortBy: 'estimatedDeliveryOn',
        sortDirection: 'asc',
      }),
    );

    expect(overview.counts).toEqual({
      all: 6,
      active: 3,
      paused: 2,
      delivered: 1,
      attention: 2,
    });
    expect(overview.counts).toEqual(attentionSearch.tabCounts);
    expect(overview.attention.total).toBe(attentionSearch.total);
    expect(overview.attention.items.map((item) => item.externalId)).toEqual([
      threshold.externalId,
      failed.externalId,
    ]);
    expect(overview.attention.items[1]!.latestLookup).toMatchObject({
      outcome: 'failed',
      reasonCode: 'DASHBOARD_TEST_FAILURE',
    });
    expect(overview.upcomingDeliveries.total).toBe(4);
    expect(overview.upcomingDeliveries.total).toBe(upcomingSearch.total);
    expect(
      overview.upcomingDeliveries.items.map(
        (item) => item.currentTracking?.estimatedDeliveryOn,
      ),
    ).toEqual(['2026-03-08', '2026-03-10', '2026-03-12', '2026-03-14']);
    expect(
      overview.upcomingDeliveries.items.find(
        (item) => item.externalId === disabled.externalId,
      )?.carrier.isActive,
    ).toBe(false);
    expect(overview.recentChanges[0]).toMatchObject({
      shipmentExternalId: disabled.externalId,
      trackingReference: disabled.trackingReference,
    });
    expect(
      overview.recentChanges.some(
        (change) => change.shipmentExternalId === removed.externalId,
      ),
    ).toBe(false);
  });

  it('returns full totals with ten-item panels in their documented order', async () => {
    const created: ShipmentEntity[] = [];

    for (let index = 0; index < 12; index += 1) {
      const shipment = await create(
        `bounded-${index.toString().padStart(2, '0')}`,
      );

      await db.source.getRepository(ShipmentEntity).update(
        { id: shipment.id },
        {
          monitoringStatus: ShipmentMonitoringStatus.Paused,
          monitoringReason: ShipmentMonitoringReason.NotFoundThreshold,
          nextCheckAt: null,
          createdAt: new Date(
            `2026-03-01T${index.toString().padStart(2, '0')}:00:00Z`,
          ),
        },
      );
      await snapshot(
        shipment,
        '2026-03-10',
        `2026-03-08T${index.toString().padStart(2, '0')}:00:00Z`,
      );
      created.push(shipment);
    }

    const overview = await new TypeOrmDashboardRepository(
      db.source,
      () => new Date('2026-03-08T12:00:00Z'),
    ).overview();

    expect(overview.attention.total).toBe(12);
    expect(overview.attention.items).toHaveLength(10);
    expect(overview.attention.items.map((item) => item.externalId)).toEqual(
      created
        .slice(2)
        .reverse()
        .map((shipment) => shipment.externalId),
    );
    expect(overview.upcomingDeliveries.total).toBe(12);
    expect(overview.upcomingDeliveries.items).toHaveLength(10);
    expect(
      overview.upcomingDeliveries.items.map((item) => item.externalId),
    ).toEqual(created.slice(0, 10).map((shipment) => shipment.externalId));
    expect(overview.recentChanges).toHaveLength(10);
    expect(
      overview.recentChanges.map((change) => change.shipmentExternalId),
    ).toEqual(
      created
        .slice(2)
        .reverse()
        .map((shipment) => shipment.externalId),
    );
  });

  it('does not expose an uncommitted monitoring change', async () => {
    const shipment = await create('dashboard-concurrent-state');
    const repository = new TypeOrmDashboardRepository(db.source);
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

      await expect(repository.overview()).resolves.toMatchObject({
        counts: { all: 1, active: 1, paused: 0, delivered: 0, attention: 0 },
      });

      await runner.commitTransaction();

      await expect(repository.overview()).resolves.toMatchObject({
        counts: { all: 1, active: 0, paused: 1, delivered: 0, attention: 0 },
      });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();

      await runner.release();
    }
  });

  it('bounds a populated 10,000-row overview in one planned statement', async () => {
    await db.source.query(
      `INSERT INTO shipments (carrier_id, tracking_reference, created_at)
       SELECT $1, 'dashboard-scale-' || lpad(n::text, 5, '0'),
         timestamptz '2026-01-01' + n * interval '1 millisecond'
       FROM generate_series(1, 10000) n`,
      [carrier.id],
    );
    await db.source.query(
      `WITH created AS (
         INSERT INTO shipment_tracking_snapshots
           (shipment_id, carrier_status, estimated_delivery_on, observed_at)
         SELECT id, 'In transit', date '2026-03-10',
           timestamptz '2026-03-08' + id * interval '1 millisecond'
         FROM shipments
         RETURNING id, shipment_id
       )
       UPDATE shipments
       SET current_tracking_snapshot_id = created.id
       FROM created
       WHERE shipments.id = created.shipment_id`,
    );
    const [run]: Array<{ id: string }> = await db.source.query(
      `INSERT INTO tracking_runs
        (carrier_id, trigger, status, created_at, started_at, completed_at)
       VALUES ($1, 'scheduled', 'failed', '2026-03-08T01:00:00Z',
         '2026-03-08T01:00:00Z', '2026-03-08T02:00:00Z')
       RETURNING id`,
      [carrier.id],
    );

    await db.source.query(
      `INSERT INTO tracking_attempts
        (tracking_run_id, shipment_id, outcome, retryable, reason_code, completed_at)
       SELECT $1, id, 'failed', true, 'DASHBOARD_SCALE_FAILURE',
         timestamptz '2026-03-08T02:00:00Z'
       FROM shipments`,
      [run!.id],
    );

    const queries = vi.spyOn(db.source.logger, 'logQuery');
    let explainedQuery = '';
    let explainedParameters: unknown[] = [];

    try {
      const overview = await new TypeOrmDashboardRepository(
        db.source,
        () => new Date('2026-03-08T12:00:00Z'),
      ).overview();

      expect(overview.counts).toEqual({
        all: 10000,
        active: 10000,
        paused: 0,
        delivered: 0,
        attention: 10000,
      });
      expect(overview.attention.total).toBe(10000);
      expect(overview.attention.items).toHaveLength(10);
      expect(overview.attention.items[0]!.latestLookup).toMatchObject({
        outcome: 'failed',
        reasonCode: 'DASHBOARD_SCALE_FAILURE',
      });
      expect(overview.attention.items[0]!.latestRun).toMatchObject({
        attemptCount: 10000,
        status: 'failed',
      });
      expect(overview.upcomingDeliveries.total).toBe(10000);
      expect(overview.upcomingDeliveries.items).toHaveLength(10);
      expect(overview.recentChanges).toHaveLength(10);
      expect(queries).toHaveBeenCalledTimes(1);
      explainedQuery = queries.mock.calls[0]![0];
      const loggedParameters = queries.mock.calls[0]![1];

      if (loggedParameters && !Array.isArray(loggedParameters))
        throw new Error('Expected positional query parameters');

      explainedParameters = loggedParameters ?? [];
    } finally {
      queries.mockRestore();
    }

    const [explain]: Array<{
      'QUERY PLAN': Array<{
        Plan: { 'Actual Rows': number };
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
    expect(plan['Execution Time']).toBeLessThan(2_000);
  });
});
