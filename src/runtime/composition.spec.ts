import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { WorkerModule } from '../worker.module.js';
import { HealthController } from '../modules/health/health.controller.js';
import { ReadinessService } from '../modules/health/readiness.service.js';
import { WorkerLifetimeService } from './worker-lifetime.service.js';
import { testEnvironment } from '../../test/support/environment.js';

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
    }).compile();
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
    }).compile();
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
