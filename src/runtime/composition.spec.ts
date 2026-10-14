import { AUTH_ENGINE } from '@modules/auth/auth.engine.js';
import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { HealthController } from '@modules/health/health.controller.js';
import { ReadinessService } from '@modules/health/readiness.service.js';
import { WorkerModule } from '@app/worker.module.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { testEnvironment } from '@test/support/environment.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('composition roots', () => {
  it('keeps API and worker cache entries independent', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    const api = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(AUTH_ENGINE)
      .useValue({})
      .compile();
    try {
      const worker = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideModule(DatabaseModule)
        .useModule(TestDatabaseModule)
        .overrideProvider(AUTH_ENGINE)
        .useValue({})
        .compile();
      try {
        const apiCache = api.get<Cache>(CACHE_MANAGER);
        const workerCache = worker.get<Cache>(CACHE_MANAGER);
        await apiCache.set('shared-key', 'api');
        await expect(workerCache.get('shared-key')).resolves.toBeUndefined();
        await workerCache.set('shared-key', 'worker');
        await expect(apiCache.get('shared-key')).resolves.toBe('api');
        await workerCache.del('shared-key');
        await expect(apiCache.get('shared-key')).resolves.toBe('api');
      } finally {
        await worker.close();
      }
    } finally {
      await api.close();
    }
  });

  it('does not create worker providers in the API', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(AUTH_ENGINE)
      .useValue({})
      .compile();
    try {
      expect(module.get(HealthController)).toBeDefined();
      expect(() => module.get(TrackingSchedulerService)).toThrow();
    } finally {
      await module.close();
    }
  });

  it('starts a controller-free worker and releases its scheduler timer on close', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    vi.useFakeTimers();
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(AUTH_ENGINE)
      .useValue({})
      .compile();
    try {
      expect(() => module.get(HealthController)).toThrow();
      await module.init();
      expect(vi.getTimerCount()).toBe(1);
      await expect(module.get(ReadinessService).check()).resolves.toMatchObject(
        { status: 'ok' },
      );
    } finally {
      await module.close();
    }
    expect(vi.getTimerCount()).toBe(0);
    await expect(module.get(ReadinessService).check()).rejects.toThrow();
  });
});
