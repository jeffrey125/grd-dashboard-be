import { type AxiosAdapter } from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { FfeAdapter } from '@modules/carriers/adapters/ffe/ffe.adapter.js';
import { FfeConfiguration } from '@modules/carriers/adapters/ffe/ffe.config.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';

class SilentLogger extends ProjectLogger {
  debug() {}

  info() {}

  warn() {}

  error() {}

  setLevel() {}

  child() {
    return this;
  }
}

describe('Ffe outcomes persisted through the real executor', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;

  beforeAll(async () => {
    db = await shipmentDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('preserves earlier success and old snapshot/counter when authentication fails after detail', async () => {
    const carriers = new TypeOrmCarriersRepository(db.source);
    const carrier = (await carriers.list()).find((row) => row.code === 'ffe')!;
    const shipments = new TypeOrmShipmentsRepository(db.source);
    const created = await shipments.createMany(
      ['69451086', '69372728', '69173190'].map((trackingReference) => ({
        carrierExternalId: carrier.externalId,
        trackingReference,
        notes: null,
      })),
    );

    if (created.kind !== 'created') throw new Error('Fixture creation failed');

    const tracking = new TrackingService(
      new TypeOrmTrackingRepository(db.source),
    );
    const second = created.inserted[1]!;
    const previous = await tracking.createRun({
      carrierExternalId: carrier.externalId,
      trigger: 'manual',
      shipmentExternalIds: [second.externalId],
      requestedById: null,
    });
    const started = await tracking.startRun(previous.externalId);

    await tracking.finalizeFound({
      runExternalId: previous.externalId,
      shipmentExternalId: second.externalId,
      expectedLockVersion: started.targets[0]!.expectedLockVersion,
      effectiveIntervalMinutes: 5,
      sourceData: null,
      snapshot: {
        carrierStatus: 'Previously known',
        carrierStatusDetail: null,
        pickedUpOn: '2026-10-01',
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
    });
    await tracking.finalizeRun(previous.externalId);
    await db.source.query(
      'UPDATE shipments SET consecutive_not_found_count = 2 WHERE external_id = $1',
      [second.externalId],
    );

    const calls: string[] = [];
    let pickupDate = '2026-10-08T16:23:00';
    let deliveryDate: string | null = null;
    const transport: AxiosAdapter = async (request) => {
      calls.push(request.url!);

      let status = 200;
      const headers: Record<string, string> = { 'content-type': 'text/html' };
      let data = '<table id="shipmentTrackingDataTable"></table>';

      if (request.url === '/Account/Login') {
        if (request.method === 'post') {
          status = 302;
          headers.location = '/Customer';
          data = '';
        } else
          data =
            '<form action="/Account/Login" method="post"><input name="__RequestVerificationToken" value="TOKEN"></form>';
      }

      if (request.url === '/Customer/LoadShipmentTrackingData') {
        const body = JSON.parse(request.data);
        const reference = body.columns[0].search.value;

        calls.push(reference);
        headers['content-type'] = 'application/json';

        if (reference === '69372728') status = 401;

        data = JSON.stringify({
          draw: body.draw,
          recordsTotal: 1,
          recordsFiltered: 1,
          data: [
            {
              orderNumber: reference,
              shipmentStatus: 'Delivered',
              pickupDate,
              apptPickupDate:
                pickupDate === 'invalid' ? 'invalid' : '2026-10-07T00:00:00',
              deliveryDate,
            },
          ],
        });
      }

      return { config: request, status, statusText: 'OK', headers, data };
    };
    const adapter = new FfeAdapter(
      new FfeConfiguration({
        FFE_URL: 'https://www.ffeinc.com/Customer/ShipmentTracking',
        FFE_USERNAME: 'fixture',
        FFE_PASSWORD: 'PRIVATE',
      }),
      transport,
    );

    try {
      const executor = new TrackingExecutorService(
        tracking,
        new CarrierAdapterRegistry([adapter]),
        new SilentLogger(),
      );
      const run = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        trigger: 'scheduled',
        shipmentExternalIds: created.inserted.map((row) => row.externalId),
        requestedById: null,
      });

      await executor.execute(
        run.externalId,
        carrier,
        new AbortController().signal,
      );

      const outcomes = await db.source.query(
        `SELECT attempt.outcome, attempt.reason_code, attempt.source_data FROM tracking_attempts attempt JOIN tracking_runs run ON run.id=attempt.tracking_run_id WHERE run.external_id=$1 ORDER BY attempt.id`,
        [run.externalId],
      );

      expect(outcomes.map((row: { outcome: string }) => row.outcome)).toEqual([
        'found',
        'failed',
        'failed',
      ]);
      expect(outcomes[1]).toMatchObject({
        reason_code: 'FFE_AUTHENTICATION_FAILED',
        source_data: null,
      });

      const [preserved] = await db.source.query(
        `SELECT s.consecutive_not_found_count, snapshot.carrier_status, snapshot.picked_up_on::text AS picked_up_on FROM shipments s JOIN shipment_tracking_snapshots snapshot ON snapshot.id=s.current_tracking_snapshot_id WHERE s.external_id=$1`,
        [second.externalId],
      );

      expect(preserved).toEqual({
        consecutive_not_found_count: 2,
        carrier_status: 'Previously known',
        picked_up_on: '2026-10-01',
      });

      const [record] = await db.source.query(
        'SELECT status,fetch_mode FROM tracking_runs WHERE external_id=$1',
        [run.externalId],
      );

      expect(record).toEqual({
        status: 'partially_succeeded',
        fetch_mode: 'request',
      });

      const [active] = await db.source.query(
        'SELECT monitoring_status FROM shipments WHERE external_id=$1',
        [created.inserted[0]!.externalId],
      );

      expect(active.monitoring_status).toBe('active');
      expect(outcomes[0].source_data).toMatchObject({
        pickupDate: '2026-10-08T16:23:00',
        apptPickupDate: '2026-10-07T00:00:00',
      });
      expect(calls.some((url) => url.includes('69173190'))).toBe(false);

      const repeated = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        trigger: 'manual',
        shipmentExternalIds: [created.inserted[0]!.externalId],
        requestedById: null,
      });

      await executor.execute(
        repeated.externalId,
        carrier,
        new AbortController().signal,
      );

      const [same] = await db.source.query(
        'SELECT snapshot_changed FROM tracking_attempts attempt JOIN tracking_runs run ON run.id=attempt.tracking_run_id WHERE run.external_id=$1',
        [repeated.externalId],
      );

      expect(same.snapshot_changed).toBe(false);

      pickupDate = 'invalid';
      deliveryDate = '2026-10-12T00:00:00';

      const completed = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        trigger: 'manual',
        shipmentExternalIds: [created.inserted[0]!.externalId],
        requestedById: null,
      });

      await executor.execute(
        completed.externalId,
        carrier,
        new AbortController().signal,
      );

      const [final] = await db.source.query(
        `SELECT s.monitoring_status, snapshot.picked_up_on::text AS picked_up_on, snapshot.delivered_on::text AS delivered_on FROM shipments s JOIN shipment_tracking_snapshots snapshot ON snapshot.id=s.current_tracking_snapshot_id WHERE s.external_id=$1`,
        [created.inserted[0]!.externalId],
      );

      expect(final).toEqual({
        monitoring_status: 'completed',
        picked_up_on: '2026-10-08',
        delivered_on: '2026-10-12',
      });
    } finally {
      await adapter.onModuleDestroy();
    }
  });
});
