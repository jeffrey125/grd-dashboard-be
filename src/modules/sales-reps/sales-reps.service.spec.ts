import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  SALES_REPS_REPOSITORY,
  type SalesRepsRepository,
} from './sales-reps.repository.js';
import { SalesRepsService } from './sales-reps.service.js';

const externalId = 'c3bdfc02-24bb-4001-8c71-c5848b6ac3d5';

async function setup() {
  const repository: Pick<SalesRepsRepository, keyof SalesRepsRepository> = {
    listActive: vi.fn(),
    listAll: vi.fn(),
    findActive: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
  };
  const module = await Test.createTestingModule({
    providers: [
      SalesRepsService,
      { provide: SALES_REPS_REPOSITORY, useValue: repository },
    ],
  }).compile();

  return { repository, service: module.get(SalesRepsService) };
}

describe('Sales Rep configuration', () => {
  it('trims names before creating a Sales Rep', async () => {
    const { service, repository } = await setup();
    const created = { externalId, firstName: 'Jake', lastName: 'Wald' };
    vi.mocked(repository.create).mockResolvedValue(created as never);

    await expect(
      service.create({ firstName: ' Jake ', lastName: ' Wald ' }, 7),
    ).resolves.toBe(created);
    expect(repository.create).toHaveBeenCalledWith(
      { firstName: 'Jake', lastName: 'Wald' },
      7,
    );
  });

  it.each([
    null,
    {},
    { firstName: '' },
    { lastName: 'Wald' },
    { role: 'admin' },
  ])('rejects invalid create input: %j', async (input) => {
    const { service, repository } = await setup();

    await expect(service.create(input, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('soft-deletes active reps and reports missing rows', async () => {
    const { service, repository } = await setup();
    vi.mocked(repository.remove)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(service.remove(externalId, 7)).resolves.toBeUndefined();
    await expect(service.remove(externalId, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('restores only an inactive rep', async () => {
    const { service, repository } = await setup();
    vi.mocked(repository.restore)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(repository.find).mockResolvedValue({ externalId } as never);

    await expect(service.restore(externalId, 7)).resolves.toEqual({
      externalId,
    });
    await expect(service.restore(externalId, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
