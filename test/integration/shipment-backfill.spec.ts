import { runShipmentBackfill } from '@modules/shipments/typeorm-shipment-backfill.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { createShipmentSchema } from '@modules/shipments/shipments.schemas.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('reviewed shipment backfill', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let repository: TypeOrmShipmentsRepository;
  let carrierExternalId: string;

  beforeAll(async () => {
    db = await shipmentDatabase();
    repository = new TypeOrmShipmentsRepository(db.source);
    carrierExternalId = (
      await db.source
        .getRepository(CarrierEntity)
        .findOneByOrFail({ code: 'ups' })
    ).externalId;
  });
  afterAll(async () => {
    await db?.close();
  });

  async function create(trackingReference: string, fields = {}) {
    const result = await repository.createMany([
      createShipmentSchema.parse({
        carrierExternalId,
        trackingReference,
        ...fields,
      }),
    ]);
    if (result.kind !== 'created') throw new Error('Creation failed');
    return result.inserted[0] ?? result.duplicates[0]!;
  }

  it('previews without writes, fills only reviewed blanks, rejects stale plans and verifies persisted backfill results', async () => {
    const first = await create('backfill-empty-a');
    const second = await create('backfill-empty-b');
    const expected = {
      customer: null,
      vendor: null,
      poNumber: null,
      poNumbers: [],
      soNumbers: [],
      products: [],
    };
    const plan = {
      sourceSha256: 'a'.repeat(64),
      updates: [first, second].map((row, index) => ({
        externalId: row.externalId,
        carrierId: 1,
        trackingReference: row.trackingReference,
        sourceRows: [index + 2],
        expected,
        changes: {
          customer: 'Customer',
          vendor: 'Warehouse',
          poNumbers: ['0'],
          soNumbers: ['00123'],
          products: ['Cacao, Powder'],
        },
      })),
    };
    expect(await runShipmentBackfill(db.source, plan)).toMatchObject({
      mode: 'read-only preview',
      shipments: 2,
      fields: 10,
    });
    expect((await repository.find(first.externalId))?.customer).toBeNull();
    // A stale second record aborts the entire plan before the first record is written.
    await repository.update(second.externalId, {
      customer: 'Changed elsewhere',
    });
    await expect(runShipmentBackfill(db.source, plan, true)).rejects.toThrow(
      'Shipment field changed',
    );
    expect((await repository.find(first.externalId))?.customer).toBeNull();
    plan.updates = plan.updates.slice(0, 1);
    expect(await runShipmentBackfill(db.source, plan, true)).toMatchObject({
      mode: 'applied',
      shipments: 1,
      fields: 5,
    });
    expect(await repository.find(first.externalId)).toMatchObject({
      customer: 'Customer',
      vendor: 'Warehouse',
      poNumber: '0',
      poNumbers: ['0'],
      soNumbers: ['00123'],
      products: ['Cacao, Powder'],
    });
    await expect(runShipmentBackfill(db.source, plan, true)).rejects.toThrow(
      'Shipment field changed',
    );
    expect((await repository.find(second.externalId))?.customer).toBe(
      'Changed elsewhere',
    );
  });
});
