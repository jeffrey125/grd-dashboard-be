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
  notFoundPauseThreshold: 5,
  pollIntervalMinutes: 30,
  rateLimitPerMinute: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function setup() {
  const repository = {
    createMany: vi
      .fn()
      .mockResolvedValue({ kind: 'created', inserted: [], duplicates: [] }),
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

describe('Shipment creation', () => {
  it('preserves strings and case, normalizes UUIDs, and uses the last repeated pair including omitted notes', async () => {
    const { service, repository } = await setup();
    await service.create({
      items: [
        {
          carrierExternalId: carrierExternalId.toUpperCase(),
          trackingReference: ' 001Ab ',
          notes: 'First',
        },
        { carrierExternalId, trackingReference: '001Ab' },
        { carrierExternalId, trackingReference: '001ab', notes: ' Last ' },
      ],
    });
    expect(repository.createMany).toHaveBeenCalledWith([
      { carrierExternalId, trackingReference: '001Ab', notes: null },
      { carrierExternalId, trackingReference: '001ab', notes: 'Last' },
    ]);
  });

  it.each([
    null,
    {},
    { items: [] },
    {
      items: Array.from({ length: 11 }, () => ({
        carrierExternalId,
        trackingReference: '1',
      })),
    },
    { items: [], createdById: 1 },
  ])('rejects invalid envelopes: %j', async (input) => {
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
    'rejects invalid items without writes or echoing sensitive input: %j',
    async (changes) => {
      const { service, repository } = await setup();
      const error = await service
        .create({
          items: [
            { carrierExternalId, trackingReference: 'valid', ...changes },
          ],
        })
        .catch((error) => error);
      expect(error).toMatchObject({ status: 400 });
      expect(JSON.stringify(error.response)).not.toContain('CANARY');
      expect(repository.createMany).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...carrier, isActive: false }])(
    'rejects missing/deleted or disabled Carriers for the entire batch',
    async (value) => {
      const { service, repository, carriers } = await setup();
      carriers.find.mockResolvedValueOnce(carrier).mockResolvedValueOnce(value);
      await expect(
        service.create({
          items: [
            { carrierExternalId, trackingReference: 'valid' },
            { carrierExternalId, trackingReference: 'invalid-carrier' },
          ],
        }),
      ).rejects.toMatchObject({
        response: {
          details: [
            { row: 2, field: 'carrierExternalId', message: expect.any(String) },
          ],
        },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
    },
  );

  it('retains original row numbers when Carrier eligibility changes during creation', async () => {
    const { service, repository } = await setup();
    repository.createMany.mockResolvedValue({
      kind: 'unavailable',
      carrierExternalIds: [carrierExternalId],
    });
    await expect(
      service.create({
        items: [
          { carrierExternalId, trackingReference: 'repeated' },
          { carrierExternalId, trackingReference: 'repeated' },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        details: [
          { row: 1, field: 'carrierExternalId', message: expect.any(String) },
          { row: 2, field: 'carrierExternalId', message: expect.any(String) },
        ],
      },
    });
  });

  it('accepts generic references for each seeded Carrier and exact length boundaries', async () => {
    const { service, repository, carriers } = await setup();
    for (const code of ['ups', 'echoship', 'ffe']) {
      carriers.find.mockResolvedValue({ ...carrier, code });
      await service.create({
        items: [
          {
            carrierExternalId,
            trackingReference: 'x'.repeat(255),
            notes: 'n'.repeat(500),
          },
        ],
      });
    }
    expect(repository.createMany).toHaveBeenCalledTimes(3);
  });

  it('rejects every invalid row before any writes and exposes safe row errors', async () => {
    const { service, repository } = await setup();
    await expect(
      service.create({
        items: [
          { carrierExternalId, trackingReference: 'valid' },
          { carrierExternalId, trackingReference: 123 },
          {
            carrierExternalId,
            trackingReference: 'other',
            notes: 'x'.repeat(501),
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'shipment_validation_failed',
        details: expect.arrayContaining([
          expect.objectContaining({ row: 2, field: 'trackingReference' }),
          expect.objectContaining({ row: 3, field: 'notes' }),
        ]),
      },
    });
    expect(repository.createMany).not.toHaveBeenCalled();
  });
});
