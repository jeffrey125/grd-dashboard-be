import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { AxiosAdapter } from 'axios';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import type { CarrierAdapter, TrackingSession } from '../carrier-adapter.js';
import { EchoShipConfiguration } from './echoship.config.js';
import { EchoShipRequest } from './echoship.request.js';
import { EchoShipLimiter } from './echoship.limiter.js';
import {
  EchoShipFailure,
  echoShipFailure,
  failedResult,
} from './echoship.failure.js';
import {
  EchoShipBrowser,
  launchEchoShipBrowser,
  type EchoShipBrowserLauncher,
} from './echoship.browser.js';

export const ECHOSHIP_HTTP_ADAPTER = Symbol('ECHOSHIP_HTTP_ADAPTER');
export const ECHOSHIP_BROWSER_LAUNCHER = Symbol('ECHOSHIP_BROWSER_LAUNCHER');

@Injectable()
export class EchoShipAdapter implements CarrierAdapter, OnModuleDestroy {
  readonly code = 'echoship';
  readonly minimumIntervalMinutes = 5;
  readonly referencePolicy = carrierReferencePolicy('echoship');
  private readonly limiter = new EchoShipLimiter();
  private readonly sessions = new Set<TrackingSession>();
  private cachedRequest?: { portal: EchoShipRequest; key: string };
  private readonly lifetime = new AbortController();

  async invalidateSession(): Promise<void> {
    const cached = this.cachedRequest;
    this.cachedRequest = undefined;
    await cached?.portal.close();
  }

  constructor(
    @Inject(EchoShipConfiguration)
    private readonly configuration: EchoShipConfiguration,
    @Inject(ECHOSHIP_HTTP_ADAPTER) private readonly transport: AxiosAdapter,
    @Inject(ECHOSHIP_BROWSER_LAUNCHER)
    private readonly launchBrowser: EchoShipBrowserLauncher = launchEchoShipBrowser,
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
      throw new EchoShipFailure('ECHOSHIP_CONFIGURATION_INVALID', false);

    const settings = this.configuration.read();

    if (!['request', 'browser'].includes(options.fetchMode ?? ''))
      throw new EchoShipFailure('ECHOSHIP_MODE_INVALID', false);

    const key = JSON.stringify([
      settings,
      options.rateLimitPerMinute,
      options.sessionGeneration ?? 0,
    ]);
    let portal: EchoShipRequest | EchoShipBrowser;

    if (options.fetchMode === 'browser') {
      await this.invalidateSession();
      portal = new EchoShipBrowser(
        settings,
        this.launchBrowser,
        this.limiter,
        options.rateLimitPerMinute,
        options.signal,
      );
      try {
        await portal.login(options.signal);
      } catch (error) {
        await portal.close();
        throw echoShipFailure(error);
      }
    } else {
      if (this.cachedRequest?.key !== key) await this.invalidateSession();
      if (this.cachedRequest) {
        try {
          await this.cachedRequest.portal.validateSession(options.signal);
        } catch (error) {
          options.signal.throwIfAborted();
          const failure = echoShipFailure(error);
          // An inconclusive check must not trigger a credential submission.
          if (failure.code !== 'ECHOSHIP_AUTHENTICATION_FAILED') throw failure;
          await this.invalidateSession();
        }
      }
      if (!this.cachedRequest) {
        const request = new EchoShipRequest(
          settings,
          this.transport,
          this.limiter,
          options.rateLimitPerMinute,
          this.lifetime.signal,
        );
        try {
          await request.login(options.signal);
        } catch (error) {
          await request.close();
          throw echoShipFailure(error);
        }
        this.cachedRequest = { portal: request, key };
      }
      portal = this.cachedRequest.portal;
    }

    let authenticationFailed = false;
    let closed = false;
    const session: TrackingSession = {
      read: async (reference, signal) => {
        signal.throwIfAborted();

        if (closed)
          return failedResult(new EchoShipFailure('ECHOSHIP_SESSION_CLOSED'));

        if (authenticationFailed)
          return failedResult(
            new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED'),
          );

        if (!/^\d{1,20}$/.test(reference))
          return failedResult(
            new EchoShipFailure('ECHOSHIP_INVALID_REFERENCE', false),
          );

        try {
          return await portal.read(reference, signal);
        } catch (error) {
          signal.throwIfAborted();

          const failure = echoShipFailure(error);

          authenticationFailed = [
            'ECHOSHIP_AUTHENTICATION_FAILED',
            'ECHOSHIP_ACCOUNT_LOCKED',
          ].includes(failure.code);

          return failedResult(failure);
        }
      },
      close: async () => {
        closed = true;
        try {
          if (options.fetchMode === 'browser') await portal.close();
          else if (authenticationFailed || options.signal.aborted)
            await this.invalidateSession();
        } finally {
          this.sessions.delete(session);
        }
      },
    };

    this.sessions.add(session);

    return session;
  }

  async onModuleDestroy() {
    this.lifetime.abort();
    await Promise.all([...this.sessions].map((session) => session.close()));
    await this.invalidateSession();
    await this.limiter.close();
  }
}
