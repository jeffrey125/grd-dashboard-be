import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { HealthController } from '@modules/health/health.controller.js';
import { ReadinessService } from '@modules/health/readiness.service.js';
import { WorkerModule } from '@app/worker.module.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { testEnvironment } from '@test/support/environment.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerLifetimeService } from './worker-lifetime.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('composition roots', () => {
  it('does not create worker providers in the API', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .compile();
    try {
      expect(module.get(HealthController)).toBeDefined();
      expect(() => module.get(WorkerLifetimeService)).toThrow();
    } finally {
      await module.close();
    }
  });

  it('starts a controller-free worker and releases its keepalive on close', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    vi.useFakeTimers();
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
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
