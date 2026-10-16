import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  CARRIERS_REPOSITORY,
  type CarrierRecord,
} from '@modules/carriers/carriers.repository.js';
import { ShipmentsService } from './shipments.service.js';
import { SHIPMENTS_REPOSITORY } from './shipments.repository.js';

const carrierExternalId = 'c3bdfc02-24bb-4001-8c71-c5848b6ac3d5';
const carrier: CarrierRecord = {
  externalId: carrierExternalId,
  code: 'ups',
  name: 'UPS',
  isActive: true,
  fetchMode: 'request',
  notFoundPauseThreshold: 5,
  pollIntervalMinutes: 30,
  rateLimitPerMinute: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function setup() {
  const repository = {
    createMany: vi.fn().mockResolvedValue({
      kind: 'created',
      inserted: [{ externalId: 'created-shipment' }],
      duplicates: [],
    }),
    search: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      tabCounts: { all: 0, active: 0, paused: 0, delivered: 0, attention: 0 },
    }),
    history: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    }),
  };
  const carriers = { find: vi.fn().mockResolvedValue(carrier) };
  const module = await Test.createTestingModule({
    providers: [
      ShipmentsService,
      { provide: SHIPMENTS_REPOSITORY, useValue: repository },
      { provide: CARRIERS_REPOSITORY, useValue: carriers },
    ],
  }).compile();

  return { service: module.get(ShipmentsService), repository, carriers };
}

describe('Shipment search', () => {
  it('applies defaults and normalizes the public query', async () => {
    const { service, repository } = await setup();

    await service.search({});
    await service.search({
      tab: 'all',
      q: '  001Ab  ',
      carrierExternalId: carrierExternalId.toUpperCase(),
      page: '2',
      pageSize: '100',
      sortBy: 'estimatedDeliveryOn',
      sortDirection: 'asc',
    });

    expect(repository.search).toHaveBeenNthCalledWith(1, {
      tab: 'active',
      q: undefined,
      carrierExternalId: undefined,
      page: 1,
      pageSize: 25,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    expect(repository.search).toHaveBeenNthCalledWith(2, {
      tab: 'all',
      q: '001Ab',
      carrierExternalId,
      page: 2,
      pageSize: 100,
      sortBy: 'estimatedDeliveryOn',
      sortDirection: 'asc',
    });
  });

  it.each([
    { unknown: 'field' },
    { tab: 'unknown' },
    { q: 'x'.repeat(256) },
    { q: 'bad\u0000search' },
    { carrierExternalId: 'not-a-uuid' },
    { lookupOutcome: 'failed' },
    { createdFrom: '2026-03-08' },
    { createdTo: '2026-03-08' },
    { estimatedDeliveryFrom: '2026-11-01' },
    { estimatedDeliveryTo: '2026-11-01' },
    { undeliveredOnly: 'true' },
    { sortBy: 'lastAttemptedAt' },
    { page: '0' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { page: String(Number.MAX_SAFE_INTEGER) },
    { pageSize: '10' },
    { pageSize: '101' },
    { sortBy: 'notes' },
    { sortDirection: 'sideways' },
  ])(
    'rejects an invalid or unknown query without reading: %j',
    async (query) => {
      const { service, repository } = await setup();

      expect(() => service.search(query)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
      expect(repository.search).not.toHaveBeenCalled();
    },
  );
});

describe('Shipment history', () => {
  it('normalizes the Shipment identity and applies pagination defaults', async () => {
    const { service, repository } = await setup();

    await service.history(carrierExternalId.toUpperCase(), {});
    await service.history(carrierExternalId, { page: '2', pageSize: '100' });

    expect(repository.history).toHaveBeenNthCalledWith(1, carrierExternalId, {
      page: 1,
      pageSize: 25,
    });
    expect(repository.history).toHaveBeenNthCalledWith(2, carrierExternalId, {
      page: 2,
      pageSize: 100,
    });
  });

  it.each([
    { unknown: 'field' },
    { page: '0' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { page: String(Number.MAX_SAFE_INTEGER) },
    { pageSize: '10' },
    { pageSize: '101' },
  ])('rejects invalid pagination without reading: %j', async (query) => {
    const { service, repository } = await setup();

    await expect(service.history(carrierExternalId, query)).rejects.toEqual(
      expect.objectContaining({ status: 400 }),
    );
    expect(repository.history).not.toHaveBeenCalled();
  });

  it('returns 404 when the repository cannot find a nondeleted Shipment', async () => {
    const { service, repository } = await setup();

    repository.history.mockResolvedValueOnce(null);

    await expect(service.history(carrierExternalId, {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('Shipment creation', () => {
  it('preserves reference case, normalizes fields, and returns the created shipment', async () => {
    const { service, repository } = await setup();
    const shipment = { externalId: 'shipment-id' };
    repository.createMany.mockResolvedValueOnce({
      kind: 'created',
      inserted: [shipment],
      duplicates: [],
    });

    await expect(
      service.create({
        carrierExternalId: carrierExternalId.toUpperCase(),
        trackingReference: ' 001Ab ',
        notes: ' First ',
      }),
    ).resolves.toEqual({ outcome: 'created', shipment });

    expect(repository.createMany).toHaveBeenCalledWith(
      [{ carrierExternalId, trackingReference: '001Ab', notes: 'First' }],
      null,
    );
  });

  it('returns an existing shipment without overwriting it', async () => {
    const { service, repository } = await setup();
    const shipment = { externalId: 'existing-id', notes: 'Original' };
    repository.createMany.mockResolvedValueOnce({
      kind: 'created',
      inserted: [],
      duplicates: [shipment],
    });

    await expect(
      service.create({
        carrierExternalId,
        trackingReference: '001Ab',
        notes: 'Replacement',
      }),
    ).resolves.toEqual({ outcome: 'existing', shipment });
  });

  it.each([
    null,
    {},
    { items: [] },
    { carrierExternalId, trackingReference: 'valid', createdById: 1 },
  ])('rejects invalid request shapes: %j', async (input) => {
    const { service, repository } = await setup();

    await expect(service.create(input)).rejects.toMatchObject({ status: 400 });

    expect(repository.createMany).not.toHaveBeenCalled();
  });

  it.each([
    { trackingReference: '' },
    { trackingReference: '  ' },
    { trackingReference: 'a'.repeat(256) },
    { trackingReference: 'bad\u0000reference' },
    { trackingReference: null },
    { trackingReference: true },
    { notes: '' },
    { notes: '   ' },
    { notes: 1 },
    { notes: 'bad\u0000note' },
    { carrierExternalId: 1 },
    { carrierExternalId: 'not-uuid' },
    { createdById: 1 },
    { updatedById: 1 },
    { deletedById: 1 },
    { verificationUrl: 'https://example.com' },
    { monitoringStatus: 'paused' },
    { CANARY_UNKNOWN_FIELD: 'CANARY_VALUE' },
  ])(
    'rejects invalid fields without writes or echoing sensitive input: %j',
    async (changes) => {
      const { service, repository } = await setup();
      const error = await service
        .create({
          carrierExternalId,
          trackingReference: 'valid',
          ...changes,
        })
        .catch((error) => error);

      expect(error).toMatchObject({ status: 400 });
      expect(JSON.stringify(error.response)).not.toContain('CANARY');
      expect(repository.createMany).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...carrier, isActive: false }])(
    'rejects a missing, deleted, or disabled Carrier',
    async (value) => {
      const { service, repository, carriers } = await setup();

      carriers.find.mockResolvedValueOnce(value);
      await expect(
        service.create({
          carrierExternalId,
          trackingReference: 'invalid-carrier',
        }),
      ).rejects.toMatchObject({
        response: {
          details: [
            { field: 'carrierExternalId', message: expect.any(String) },
          ],
        },
      });

      expect(repository.createMany).not.toHaveBeenCalled();
    },
  );

  it('reports the Carrier field when eligibility changes during creation', async () => {
    const { service, repository } = await setup();

    repository.createMany.mockResolvedValue({
      kind: 'unavailable',
      carrierExternalIds: [carrierExternalId],
    });
    await expect(
      service.create({
        carrierExternalId,
        trackingReference: 'race',
      }),
    ).rejects.toMatchObject({
      response: {
        details: [{ field: 'carrierExternalId', message: expect.any(String) }],
      },
    });
  });

  it('accepts generic references for each seeded Carrier and exact length boundaries', async () => {
    const { service, repository, carriers } = await setup();

    for (const code of ['ups', 'echoship', 'ffe']) {
      carriers.find.mockResolvedValue({ ...carrier, code });
      await service.create({
        carrierExternalId,
        trackingReference: 'x'.repeat(255),
        notes: 'n'.repeat(500),
      });
    }

    expect(repository.createMany).toHaveBeenCalledTimes(3);
  });

  it('exposes safe field errors', async () => {
    const { service, repository } = await setup();

    await expect(
      service.create({
        carrierExternalId,
        trackingReference: 123,
        notes: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'shipment_validation_failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'trackingReference' }),
          expect.objectContaining({ field: 'notes' }),
        ]),
      },
    });

    expect(repository.createMany).not.toHaveBeenCalled();
  });
});
