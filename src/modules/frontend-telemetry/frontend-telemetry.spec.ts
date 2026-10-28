import { describe, expect, it, vi } from 'vitest';
import {
  frontendEventSchema,
  FrontendTelemetryController,
} from './frontend-telemetry.module.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

const event = {
  kind: 'browser',
  page: '/shipments/:id',
  release: 'development',
  errorName: 'TypeError',
  frames: ['assets/main-abc.js:12:34'],
};

describe('frontend event validation', () => {
  it('rejects payloads, raw messages, URL queries and oversized frames', () => {
    for (const change of [
      { message: 'secret' },
      { body: 'secret' },
      { page: '/shipments?token=secret' },
      { frames: Array(9).fill('assets/app.js:1:2') },
      { frames: ['https://private.example/path?token=secret'] },
      { failedRequestId: 'forged' },
    ]) {
      expect(
        frontendEventSchema.safeParse({ ...event, ...change }).success,
      ).toBe(false);
    }
  });

  it('writes a fixed message with projected fields and no user identity', () => {
    const warn = vi.fn();
    const child = vi.fn().mockReturnValue({ warn });
    const controller = new FrontendTelemetryController({
      child,
    } as unknown as ProjectLogger);
    controller.report(event);
    expect(child).toHaveBeenCalledWith({ component: 'frontend' });
    expect(warn).toHaveBeenCalledWith(
      'frontend.error',
      'Frontend error reported',
      event,
    );
    expect(() => controller.report({ ...event, password: 'secret' })).toThrow(
      'Invalid frontend event',
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
