import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import { HealthModule } from './health.module.js';
import {
  READINESS_DEPENDENCIES,
  ReadinessService,
  type ReadinessDependency,
} from './readiness.service.js';

describe('health lifecycle and dependency checks', () => {
  let module: TestingModule | undefined;

  async function create(dependencies: ReadinessDependency[] = []) {
    module = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(READINESS_DEPENDENCIES)
      .useValue(dependencies)
      .compile();
    return {
      controller: module.get(HealthController),
      readiness: module.get(ReadinessService),
    };
  }

  afterEach(async () => {
    vi.useRealTimers();
    await module?.close();
  });

  it('is live before initialization but ready only after bootstrap', async () => {
    const { controller } = await create();
    expect(controller.live()).toEqual({ status: 'ok' });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await module!.init();
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      info: { application: { status: 'up' } },
      error: {},
      details: { application: { status: 'up' } },
    });
  });

  it('includes successful dependencies', async () => {
    const { controller } = await create([
      { name: 'database', check: async () => {} },
    ]);
    await module!.init();
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' } },
    });
  });

  it.each([
    new Error('CANARY_HEALTH_SECRET'),
    { password: 'CANARY_HEALTH_SECRET' },
    'CANARY_HEALTH_SECRET',
  ])(
    'contains dependency failures and keeps liveness independent',
    async (failure) => {
      const { controller } = await create([
        {
          name: 'database',
          check: () => {
            throw failure;
          },
        },
      ]);
      await module!.init();
      const error = await controller.ready().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toMatchObject({
        status: 'error',
        error: { database: { status: 'down' } },
      });
      expect(JSON.stringify(response)).not.toContain('CANARY_HEALTH_SECRET');
      expect(controller.live()).toEqual({ status: 'ok' });
    },
  );

  it('bounds a stalled dependency and supplies a cancellation signal', async () => {
    let signal: AbortSignal | undefined;
    const { controller } = await create([
      {
        name: 'database',
        check: (value) => {
          signal = value;
          return new Promise<void>(() => {});
        },
      },
    ]);
    await module!.init();
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(signal?.aborted).toBe(true);
  });

  it('stops reporting readiness on shutdown', async () => {
    const { controller, readiness } = await create();
    await module!.init();
    readiness.beforeApplicationShutdown();
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(controller.live()).toEqual({ status: 'ok' });
  });
});
