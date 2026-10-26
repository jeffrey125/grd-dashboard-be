import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { CarriersService } from './carriers.service.js';
import {
  CARRIERS_REPOSITORY,
  type CarrierRecord,
  type CarriersRepository,
} from './carriers.repository.js';

const externalId = 'c3bdfc02-24bb-4001-8c71-c5848b6ac3d5';
const carrier: CarrierRecord = {
  externalId,
  code: 'ups',
  name: 'UPS',
  isActive: true,
  failurePauseEnabled: true,
  failurePauseThreshold: 2,
  sessionFailureDisableEnabled: true,
  sessionFailureDisableThreshold: 2,
  consecutiveSessionFailures: 0,
  sessionGeneration: 0,
  autoDisabledReason: null,
  fetchMode: 'request',
  notFoundPauseThreshold: 5,
  pollIntervalMinutes: 30,
  rateLimitPerMinute: 10,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

async function setup() {
  const repository = {
    list: vi.fn<CarriersRepository['list']>(),
    listActive: vi.fn<CarriersRepository['listActive']>(),
    find: vi.fn<CarriersRepository['find']>(),
    update: vi.fn<CarriersRepository['update']>(),
  };
  const module = await Test.createTestingModule({
    providers: [
      CarriersService,
      { provide: CARRIERS_REPOSITORY, useValue: repository },
    ],
  }).compile();

  return { repository, service: module.get(CarriersService) };
}

describe('Carrier configuration', () => {
  it.each(['request', 'browser'])('allows FFE %s mode', async (fetchMode) => {
    const { service, repository } = await setup();

    repository.find.mockResolvedValue({ ...carrier, code: 'ffe' });
    repository.update.mockResolvedValue({ ...carrier, code: 'ffe' });
    await expect(
      service.update(externalId, { fetchMode }),
    ).resolves.toBeDefined();
  });
  it('allows EchoShip browser mode but rejects unsupported UPS mode', async () => {
    const { service, repository } = await setup();

    repository.find.mockResolvedValue({ ...carrier, code: 'echoship' });
    repository.update.mockResolvedValue({ ...carrier, code: 'echoship' });
    await expect(
      service.update(externalId, { fetchMode: 'browser' }),
    ).resolves.toBeDefined();
    repository.find.mockResolvedValue(carrier);
    await expect(
      service.update(externalId, { fetchMode: 'browser' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    {},
    { name: '   ' },
    { name: 'a'.repeat(101) },
    { name: 'Invalid\u0000name' },
    { isActive: 'false' },
    { notFoundPauseThreshold: 1 },
    { notFoundPauseThreshold: 32768 },
    { pollIntervalMinutes: 0 },
    { pollIntervalMinutes: 1.5 },
    { pollIntervalMinutes: 32768 },
    { rateLimitPerMinute: 0 },
    { rateLimitPerMinute: 32768 },
    { rateLimitPerMinute: '10' },
    { name: null },
    { code: 'replacement' },
    { id: 1 },
    { externalId },
    { updatedById: 1 },
    { endpoint: 'https://example.com' },
    null,
    [],
  ])('rejects invalid configuration before persistence: %j', async (input) => {
    const { service, repository } = await setup();

    await expect(service.update(externalId, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('trims a display name and accepts explicit disable and unlimited rate', async () => {
    const { service, repository } = await setup();

    vi.mocked(repository.update).mockResolvedValue(carrier);
    await service.update(externalId, {
      name: '  UPS Display  ',
      isActive: false,
      notFoundPauseThreshold: 2,
      pollIntervalMinutes: 32767,
      rateLimitPerMinute: null,
    });

    expect(repository.update).toHaveBeenCalledWith(
      externalId,
      {
        name: 'UPS Display',
        isActive: false,
        notFoundPauseThreshold: 2,
        pollIntervalMinutes: 32767,
        rateLimitPerMinute: null,
      },
      null,
    );
  });

  it('reports absent or soft-deleted Carriers as not found', async () => {
    const { service, repository } = await setup();

    vi.mocked(repository.find).mockResolvedValue(null);
    vi.mocked(repository.update).mockResolvedValue(null);
    await expect(service.find(externalId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update(externalId, { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves an omitted rate limit and accepts the numeric boundaries', async () => {
    const { service, repository } = await setup();

    vi.mocked(repository.update).mockResolvedValue(carrier);
    await service.update(externalId, {
      notFoundPauseThreshold: 32767,
      pollIntervalMinutes: 1,
    });

    expect(repository.update).toHaveBeenCalledWith(
      externalId,
      {
        notFoundPauseThreshold: 32767,
        pollIntervalMinutes: 1,
      },
      null,
    );

    await service.update(externalId, { rateLimitPerMinute: 32767 });

    expect(repository.update).toHaveBeenLastCalledWith(
      externalId,
      {
        rateLimitPerMinute: 32767,
      },
      null,
    );
  });

  it.each(['1', 'not-a-uuid', '00000000-0000-1000-8000-000000000000'])(
    'rejects an invalid public identifier before persistence: %s',
    async (id) => {
      const { service, repository } = await setup();

      await expect(service.find(id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.update(id, { isActive: false }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});
