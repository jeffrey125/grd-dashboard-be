import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { AxiosAdapter } from 'axios';
import {
  carrierReferencePolicy,
  trackingReferenceSchema,
} from '@modules/carriers/carrier-reference-policy.js';
import type { CarrierAdapter, TrackingSession } from '../carrier-adapter.js';
import { CarrierRequestLimiter } from '../carrier-request-limiter.js';
import { FfeConfiguration } from './ffe.config.js';
import { FfeFailure, ffeFailure, failedResult } from './ffe.failure.js';
import { FfeRequest } from './ffe.request.js';
import {
  FfeBrowser,
  launchFfeBrowser,
  type FfeBrowserLauncher,
} from './ffe.browser.js';

export const FFE_HTTP_ADAPTER = Symbol('FFE_HTTP_ADAPTER');
export const FFE_BROWSER_LAUNCHER = Symbol('FFE_BROWSER_LAUNCHER');

@Injectable()
export class FfeAdapter implements CarrierAdapter, OnModuleDestroy {
  readonly code = 'ffe';
  readonly minimumIntervalMinutes = 5;
  readonly referencePolicy = carrierReferencePolicy('ffe');
  private readonly limiter = new CarrierRequestLimiter();
  private readonly sessions = new Set<TrackingSession>();
  constructor(
    @Inject(FfeConfiguration) private readonly configuration: FfeConfiguration,
    @Inject(FFE_HTTP_ADAPTER) private readonly transport: AxiosAdapter,
    @Inject(FFE_BROWSER_LAUNCHER)
    private readonly launchBrowser: FfeBrowserLauncher = launchFfeBrowser,
  ) {}
  validateConfiguration() {
    this.configuration.read();
  }
  async openSession(
    options: Parameters<CarrierAdapter['openSession']>[0],
  ): Promise<TrackingSession> {
    options.signal.throwIfAborted();
    if (
      options.rateLimitPerMinute !== null &&
      (!Number.isSafeInteger(options.rateLimitPerMinute) ||
        options.rateLimitPerMinute < 1)
    )
      throw new FfeFailure('FFE_CONFIGURATION_INVALID', false);
    if (!['request', 'browser'].includes(options.fetchMode ?? ''))
      throw new FfeFailure('FFE_MODE_INVALID', false);
    const settings = {
      settings: this.configuration.read(),
      limiter: this.limiter,
      rpm: options.rateLimitPerMinute,
      signal: options.signal,
    };
    const portal =
      options.fetchMode === 'browser'
        ? new FfeBrowser(settings, this.launchBrowser)
        : new FfeRequest(settings, this.transport);
    try {
      await portal.login(options.signal);
    } catch (error) {
      await portal.close();
      throw ffeFailure(error);
    }
    let authenticationFailed = false;
    let closed = false;
    const session: TrackingSession = {
      read: async (reference, signal) => {
        signal.throwIfAborted();
        if (closed) return failedResult(new FfeFailure('FFE_SESSION_CLOSED'));
        if (authenticationFailed)
          return failedResult(new FfeFailure('FFE_AUTHENTICATION_FAILED'));
        const parsed = trackingReferenceSchema.safeParse(reference);
        if (!parsed.success)
          return failedResult(new FfeFailure('FFE_INVALID_REFERENCE', false));
        try {
          return await portal.read(parsed.data, signal);
        } catch (error) {
          signal.throwIfAborted();
          options.signal.throwIfAborted();
          const failure = ffeFailure(error);
          authenticationFailed = failure.code === 'FFE_AUTHENTICATION_FAILED';
          return failedResult(failure);
        }
      },
      close: async () => {
        closed = true;
        try {
          await portal.close();
        } finally {
          this.sessions.delete(session);
        }
      },
    };
    this.sessions.add(session);
    return session;
  }
  async onModuleDestroy() {
    await Promise.all([...this.sessions].map((session) => session.close()));
    await this.limiter.close();
  }
}
