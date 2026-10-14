import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import axios, { type AxiosAdapter } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { randomUUID } from 'node:crypto';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { safeErrorFields } from '@infrastructure/logging/safe-error-fields.js';
import { UpsConfiguration } from './ups.config.js';
import {
  UpsFailure,
  invalidUpsResponse,
  upsHttpFailure,
} from './ups.failure.js';
import { delay, waitFor } from './ups.async.js';
import {
  retryAfterMs,
  retryableHttpStatus,
  retryableTransportError,
} from './ups.retry.js';

export const UPS_HTTP_ADAPTER = Symbol('UPS_HTTP_ADAPTER');

@Injectable()
export class UpsClient implements OnModuleDestroy {
  private limiter?: Bottleneck;
  private readonly stopped = new AbortController();
  private rpm = 0;
  private lastStarted = -Infinity;
  private transitionUntil = 0;
  private cooldownUntil = 0;
  private longCooldownUntil = 0;
  private readonly http;

  constructor(
    @Inject(UpsConfiguration) private readonly configuration: UpsConfiguration,
    @Inject(UPS_HTTP_ADAPTER) transport: AxiosAdapter,
    @Inject(ProjectLogger) logger: ProjectLogger,
  ) {
    this.http = axios.create({
      timeout: 15_000,
      maxContentLength: 1_048_576,
      maxBodyLength: 16_384,
      maxRedirects: 0,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
      adapter: (config) => {
        const signal = AbortSignal.any([
          config.signal as AbortSignal,
          this.stopped.signal,
        ]);

        return waitFor(
          this.limiter!.schedule(async () => {
            signal.throwIfAborted();
            this.assertAvailable();

            // Bottleneck reserves launch times; event-loop delay must not compress physical sends.
            const remaining =
              Math.max(
                this.lastStarted + Math.ceil(60_000 / this.rpm),
                this.cooldownUntil,
                this.transitionUntil,
              ) - Date.now();

            if (remaining > 0) await delay(remaining, signal);

            this.assertAvailable();
            this.lastStarted = Date.now();
            config.headers.set('transId', randomUUID());

            const timeout = new AbortController();
            const timer = setTimeout(
              () =>
                timeout.abort(
                  new axios.AxiosError(
                    'UPS request timed out.',
                    'ETIMEDOUT',
                    config,
                  ),
                ),
              15_000,
            );
            const physicalSignal = AbortSignal.any([signal, timeout.signal]);

            try {
              const response = await waitFor(
                Promise.resolve().then(() =>
                  transport({ ...config, signal: physicalSignal }),
                ),
                physicalSignal,
              );

              if (
                !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
                  String(response.headers['content-type'] ?? ''),
                )
              )
                throw invalidUpsResponse();

              return response;
            } catch (error) {
              if (timeout.signal.aborted && !signal.aborted)
                throw timeout.signal.reason;

              if (
                axios.isAxiosError(error) &&
                error.response &&
                retryableHttpStatus(error.response.status)
              ) {
                const retryAfter = retryAfterMs(
                  error.response.headers['retry-after'],
                  Date.now(),
                );

                if (retryAfter !== undefined) {
                  this.cooldownUntil = Math.max(
                    this.cooldownUntil,
                    Date.now() + retryAfter,
                  );

                  if (retryAfter > 60_000)
                    this.longCooldownUntil = this.cooldownUntil;
                }
              }

              throw error;
            } finally {
              clearTimeout(timer);
            }
          }),
          signal,
        );
      },
    });

    const oauthLog = logger.child({
      carrierCode: 'ups',
      component: 'ups.oauth',
    });
    const trackingLog = logger.child({
      carrierCode: 'ups',
      component: 'ups.tracking',
    });

    this.http.interceptors.response.use(undefined, (error: unknown) => {
      const log =
        axios.isAxiosError(error) && error.config?.url?.includes('/oauth/token')
          ? oauthLog
          : trackingLog;

      if (!axios.isCancel(error))
        log.warn(
          'ups.request.failed',
          'UPS HTTP request failed',
          safeErrorFields(error),
        );

      return Promise.reject(error);
    });
    axiosRetry(this.http, {
      retries: 2,
      shouldResetTimeout: true,
      retryCondition: (error) =>
        this.longCooldownUntil <= Date.now() && retryableTransportError(error),
      retryDelay: (count, error) =>
        Math.max(
          500 * 2 ** (count - 1),
          retryAfterMs(error.response?.headers['retry-after'], Date.now()) ?? 0,
        ),
    });
  }

  assertAvailable(): void {
    if (this.longCooldownUntil > Date.now())
      throw new UpsFailure(
        'UPS_RATE_LIMITED',
        true,
        'UPS temporarily unavailable. Tracking will retry later.',
      );
  }

  async configureRateLimit(configured: number | null): Promise<void> {
    const maximum = this.configuration.read().maximumRpm;

    if (
      configured !== null &&
      (!Number.isSafeInteger(configured) || configured < 1)
    )
      throw new UpsFailure(
        'UPS_CONFIGURATION_INVALID',
        false,
        'UPS request rate must be a positive integer.',
      );

    const nextRpm = Math.min(configured ?? maximum, maximum);

    // A changed database cap cannot erase the previous minute's physical requests.
    if (this.rpm && nextRpm !== this.rpm)
      this.transitionUntil = this.lastStarted + 60_000;

    this.rpm = nextRpm;

    if (!this.limiter)
      this.limiter = new Bottleneck({
        maxConcurrent: 1,
        minTime: Math.ceil(60_000 / this.rpm),
      });
    else
      await this.limiter.updateSettings({
        minTime: Math.ceil(60_000 / this.rpm),
      });
  }

  async oauth(signal: AbortSignal): Promise<unknown> {
    const config = this.configuration.read();

    try {
      const response = await this.http.post(
        `${config.origin}/security/v1/oauth/token`,
        'grant_type=client_credentials',
        {
          signal,
          'axios-retry': { retries: 1 },
          auth: { username: config.clientId, password: config.clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      return response.data;
    } catch (error) {
      signal.throwIfAborted();
      this.assertAvailable();

      throw upsHttpFailure(error, true);
    }
  }

  async track(
    reference: string,
    token: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.http.get(
      `${this.configuration.read().origin}/api/track/v1/details/${encodeURIComponent(reference)}`,
      {
        signal,
        params: {
          locale: 'en_US',
          returnSignature: false,
          returnMilestones: false,
          returnPOD: false,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          transactionSrc: 'grd-dashboard',
        },
      },
    );

    return response.data;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped.abort();
    await this.limiter?.stop({ dropWaitingJobs: true });
    await this.limiter?.disconnect();
  }
}
