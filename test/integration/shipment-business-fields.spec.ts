import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import {
  createShipmentSchema,
  updateShipmentSchema,
  shipmentSearchQuerySchema,
} from '@modules/shipments/shipments.schemas.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('shipment business fields', () => {
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

  it('round-trips normalized text, allows repeated PO numbers and preserves duplicate records', async () => {
    const fields = {
      poNumber: ' 001-A ',
      customer: ' Acme%_ ',
      vendor: ' Vendor-X ',
    };
    const first = await create('metadata-1', fields);
    expect(first).toMatchObject({
      poNumber: '001-A',
      customer: 'Acme%_',
      vendor: 'Vendor-X',
    });
    expect(await create('metadata-2', fields)).toMatchObject({
      poNumber: '001-A',
    });
    expect(
      await create('metadata-1', { customer: 'Replacement' }),
    ).toMatchObject({ customer: 'Acme%_' });
    const updated = await repository.update(
      first.externalId,
      updateShipmentSchema.parse({ customer: ' Updated ', vendor: '  ' }),
    );
    expect(updated).toMatchObject({
      customer: 'Updated',
      vendor: null,
      poNumber: '001-A',
    });
    expect(updated?.recordUpdatedAt).toBeInstanceOf(Date);
    expect(await repository.find(first.externalId)).toMatchObject({
      customer: 'Updated',
      vendor: null,
    });
  });

  it('searches each field literally and case-insensitively before counts', async () => {
    const row = await create('search-metadata', {
      poNumber: 'AbC-001',
      customer: 'Unique%_Customer',
      vendor: 'SpecialVendor',
    });
    for (const q of ['abc-001', '%_customer', 'specialvendor']) {
      const result = await repository.search(
        shipmentSearchQuerySchema.parse({ tab: 'all', q }),
      );
      expect(result.items.map((item) => item.externalId)).toEqual([
        row.externalId,
      ]);
      expect(result.total).toBe(1);
      expect(result.tabCounts.all).toBe(1);
    }
  });

  it('sorts all three fields lexically with null last in both directions', async () => {
    await create('sorting-blank');
    await create('sorting-2', {
      poNumber: 'PO-2',
      customer: 'PO-2',
      vendor: 'PO-2',
    });
    await create('sorting-10', {
      poNumber: 'PO-10',
      customer: 'PO-10',
      vendor: 'PO-10',
    });
    for (const sortBy of ['poNumber', 'customer', 'vendor'] as const) {
      for (const sortDirection of ['asc', 'desc']) {
        const result = await repository.search(
          shipmentSearchQuerySchema.parse({
            tab: 'all',
            q: 'sorting-',
            sortBy,
            sortDirection,
          }),
        );
        expect(result.items.map((item) => item[sortBy])).toEqual(
          sortDirection === 'asc'
            ? ['PO-10', 'PO-2', null]
            : ['PO-2', 'PO-10', null],
        );
      }
    }
  });
});
