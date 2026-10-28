import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import type { TrackingResult } from '@modules/carriers/adapters/carrier-result.js';
import { mapFfe } from '@modules/carriers/adapters/ffe/ffe.mapping.js';
import { mapEchoShip } from '@modules/carriers/adapters/echoship/echoship.mapping.js';
import { mapUpsResponse } from '@modules/carriers/adapters/ups/ups.mapper.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

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

type Carrier = 'ffe' | 'ups' | 'echoship';

// Exercise the real mappers, including providers returning an old delivery date
// alongside a newer non-delivered status. No live credentials or carrier I/O.
function mapped(
  carrier: Carrier,
  reference: string,
  status: string | null,
  deliveredOn: string | null,
): TrackingResult {
  if (carrier === 'ffe')
    return mapFfe(reference, {
      orderNumber: reference,
      shipmentStatus: status,
      deliveryDate: deliveredOn,
      apptPickupDate: '2026-10-15',
      apptDeliveryDate: '2026-10-28',
    });

  if (carrier === 'ups')
    return mapUpsResponse(
      {
        trackResponse: {
          shipment: [
            {
              package: [
                {
                  trackingNumber: reference,
                  currentStatus: { description: status ?? 'Unknown' },
                  deliveryDate: deliveredOn
                    ? [{ type: 'DEL', date: deliveredOn.replaceAll('-', '') }]
                    : [],
                },
              ],
            },
          ],
        },
      },
      reference,
    );

  const envelope = (data: unknown) => ({ status: { code: 200 }, data });

  return mapEchoShip(
    reference,
    envelope({ id: reference, status, deliveryDate: deliveredOn }),
    envelope(
      status && !['CheckedIn', 'PickedUp'].includes(status)
        ? [
            {
              id: reference,
              typeName: status,
              notes: null,
              createdDate: '2026-10-28T10:00:00',
              modifiedDate: '2026-10-28T10:00:00',
            },
          ]
        : [],
    ),
  );
}

describe('MON-V1-003 carrier delivery reversals through executor and PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let shipments: TypeOrmShipmentsRepository;
  let tracking: TrackingService;
  let today: string;
  let tomorrow: string;
  let serial = 10000000;

  beforeAll(async () => {
    db = await shipmentDatabase();
    shipments = new TypeOrmShipmentsRepository(db.source);
    tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
    [{ today, tomorrow }] = await db.source.query(`SELECT
      (clock_timestamp() AT TIME ZONE 'America/New_York')::date::text AS today,
      ((clock_timestamp() AT TIME ZONE 'America/New_York')::date + 1)::text AS tomorrow`);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function fixture(code: Carrier) {
    const carrier = (
      await new TypeOrmCarriersRepository(db.source).list()
    ).find((row) => row.code === code)!;
    const reference = String(++serial);
    const created = await shipments.createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: reference,
        notes: null,
        followUpOn: tomorrow,
      },
    ]);

    if (created.kind !== 'created') throw new Error('Fixture creation failed');

    const shipment = created.inserted[0]!;
    let response: TrackingResult;
    const executor = new TrackingExecutorService(
      tracking,
      new CarrierAdapterRegistry([
        {
          code,
          minimumIntervalMinutes: 0,
          referencePolicy: carrierReferencePolicy(code),
          validateConfiguration() {},
          async openSession() {
            return {
              async read() {
                return response;
              },
              async close() {},
            };
          },
        },
      ]),
      new SilentLogger(),
    );

    async function observe(result: TrackingResult, crossCutoff = false) {
      response = result;
      const run = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        trigger: 'scheduled',
        shipmentExternalIds: [shipment.externalId],
        requestedById: null,
      });

      // Move the date only after prepareLookup, to model a lookup finishing
      // across midnight without an intervening staff edit/version change.
      if (crossCutoff) {
        const original = tracking.prepareLookup.bind(tracking);
        tracking.prepareLookup = async (...args) => {
          const eligible = await original(...args);
          await db.source.query(
            'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
            [shipment.externalId, today],
          );
          return eligible;
        };
        try {
          await executor.execute(
            run.externalId,
            carrier,
            new AbortController().signal,
          );
        } finally {
          tracking.prepareLookup = original;
        }
      } else {
        await executor.execute(
          run.externalId,
          carrier,
          new AbortController().signal,
        );
      }

      return shipments.find(shipment.externalId);
    }

    return { shipment, reference, observe };
  }

  it.each([
    ['ffe', 'Scheduled'],
    ['ffe', 'In Route'],
    ['ffe', 'Out for Delivery'],
    ['ups', 'In Transit'],
    ['ups', 'Moving'],
    ['ups', 'On the Way'],
    ['ups', 'Loaded on Delivery Vehicle'],
    ['ups', 'Out for Delivery'],
    ['echoship', 'Shipment enroute'],
    ['echoship', 'Moving'],
    ['echoship', 'Out for delivery'],
    ['echoship', 'CheckedIn'],
    ['echoship', 'PickedUp'],
    ['echoship', 'Picked Up'],
  ] as const)(
    'clears a stale delivery for %s / %s and allows a later real delivery',
    async (code, status) => {
      const { shipment, reference, observe } = await fixture(code);
      await observe(mapped(code, reference, 'Delivered', today));
      const before = await db.source.query(
        `SELECT t.* FROM shipment_tracking_snapshots t
      JOIN shipments s ON s.id=t.shipment_id WHERE s.external_id=$1`,
        [shipment.externalId],
      );

      expect(
        await observe(mapped(code, reference, status, today), true),
      ).toMatchObject({
        monitoringStatus: 'active',
        monitoringReason: null,
        currentTracking: { carrierStatus: status, deliveredOn: null },
      });
      await tracking.reconcileDeliveredMonitoring();
      expect(await shipments.find(shipment.externalId)).toMatchObject({
        monitoringStatus: 'active',
      });
      const [schedule] = await db.source.query(
        `SELECT next_check_at > last_attempted_at AS scheduled
      FROM shipments WHERE external_id=$1`,
        [shipment.externalId],
      );
      expect(schedule.scheduled).toBe(true);
      expect(
        await db.source.query(
          'SELECT * FROM shipment_tracking_snapshots WHERE id=$1',
          [before[0].id],
        ),
      ).toEqual(before);

      expect(
        await observe(mapped(code, reference, 'Delivered', today)),
      ).toMatchObject({
        monitoringStatus: 'completed',
        currentTracking: { carrierStatus: 'Delivered', deliveredOn: today },
      });
    },
  );

  it.each(['ffe', 'ups', 'echoship'] as const)(
    'does not complete a first %s observation with conflicting delivery fields',
    async (code) => {
      const { shipment, reference, observe } = await fixture(code);
      await shipments.update(shipment.externalId, { followUpOn: null });

      expect(
        await observe(mapped(code, reference, 'Out for Delivery', today)),
      ).toMatchObject({
        monitoringStatus: 'active',
        currentTracking: { deliveredOn: null },
      });
    },
  );

  it.each(['ffe', 'ups', 'echoship'] as const)(
    'preserves known delivery on %s unknown, missing, failed and not-found results',
    async (code) => {
      const { reference, observe } = await fixture(code);
      await observe(mapped(code, reference, 'Delivered', today));

      for (const result of [
        mapped(code, reference, 'Unrecognized provider status', null),
        {
          outcome: 'found',
          snapshot: {
            carrierStatus: null,
            carrierStatusDetail: null,
            pickedUpOn: null,
            estimatedDeliveryOn: tomorrow,
            deliveredOn: null,
          },
          sourceData: null,
        },
        {
          outcome: 'failed',
          retryable: true,
          reasonCode: 'TIMEOUT',
          message: null,
          sourceData: null,
        },
        { outcome: 'not_found', sourceData: null },
        mapped(code, reference, 'Delivered', null),
      ] satisfies TrackingResult[]) {
        expect(await observe(result)).toMatchObject({
          monitoringStatus: 'active',
          currentTracking: { deliveredOn: today },
        });
      }
    },
  );
});
